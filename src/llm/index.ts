import type { FilteredJob, LlmOutput } from "../types.ts";
import { callGemini } from "./gemini.ts";
import { callOpenRouter } from "./deepseek.ts";
import { validateTailoring } from "./validator.ts";

// Per-model RPM budget on Google AI Studio free tier.
//   2.5-flash:      10 RPM,  250 RPD
//   2.5-flash-lite: 15 RPM, 1000 RPD  ← most headroom, primary
//   2.0-flash:      15 RPM,  200 RPD
// Throttle gap is 60s/RPM with a small safety buffer.
const MIN_GAP_MS: Record<string, number> = {
  "gemini-2.5-flash": 6500,
  "gemini-2.5-flash-lite": 4500,
  "gemini-2.0-flash": 4500,
  "openrouter": 3000,
};

const lastCallAt: Record<string, number> = {};

async function throttle(provider: string): Promise<void> {
  const gap = MIN_GAP_MS[provider] ?? 4500;
  const last = lastCallAt[provider] ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < gap) {
    await new Promise((r) => setTimeout(r, gap - elapsed));
  }
  lastCallAt[provider] = Date.now();
}

type Attempt =
  | { kind: "gemini"; model: string }
  | { kind: "openrouter" };

// Flash-Lite primary because it has 4× the daily quota of Flash with similar
// quality for structured-output tasks. Flash and 2.0-Flash are fallbacks
// before OpenRouter (which is shared/saturated).
const ATTEMPTS: Attempt[] = [
  { kind: "gemini", model: "gemini-2.5-flash-lite" },
  { kind: "gemini", model: "gemini-2.5-flash" },
  { kind: "gemini", model: "gemini-2.0-flash" },
  { kind: "openrouter" },
];

const RATE_LIMIT_RE = /429|quota|rate[- ]?limit|RESOURCE_EXHAUSTED/i;
const SERVICE_ERR_RE = /5\d\d|UNAVAILABLE|timeout|503/i;
const RETRY_AFTER_MS = 30_000;

export async function tailorForJob(
  resumeMd: string,
  job: FilteredJob
): Promise<LlmOutput> {
  let lastErr = "no attempts made";
  let backoffApplied = false;

  for (const attempt of ATTEMPTS) {
    const provider =
      attempt.kind === "gemini" ? attempt.model : "openrouter";
    await throttle(provider);

    const result =
      attempt.kind === "gemini"
        ? await callGemini(resumeMd, job, attempt.model)
        : await callOpenRouter(resumeMd, job);

    if (result.ok) {
      const { cleaned, warnings } = validateTailoring(result.data, resumeMd);
      if (warnings.length) {
        console.warn(
          `[validator] ${job.company} — ${job.title}: ${warnings.length} fixes`
        );
        for (const w of warnings) console.warn(`  - ${w}`);
      }
      return { ...result, data: cleaned };
    }

    lastErr = result.error;
    console.warn(
      `[llm] ${provider} failed for ${job.company} — ${job.title.slice(0, 40)}: ${result.error.slice(0, 140)}`
    );

    // On rate-limit at this provider, mark its lastCallAt far in the future
    // so subsequent jobs don't waste a call slot here. Effectively skip until
    // cooldown.
    if (RATE_LIMIT_RE.test(result.error)) {
      lastCallAt[provider] = Date.now() + RETRY_AFTER_MS;
      // Apply one global backoff so the very next provider in chain gets a
      // moment to breathe (helps when all providers are spiked simultaneously).
      if (!backoffApplied) {
        backoffApplied = true;
        await new Promise((r) => setTimeout(r, 2000));
      }
      continue;
    }

    if (SERVICE_ERR_RE.test(result.error)) {
      // Brief pause then try next tier
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    // Other errors (schema validation, malformed JSON, missing key) — try next.
    continue;
  }

  return { ok: false, error: `All providers exhausted. Last: ${lastErr}` };
}
