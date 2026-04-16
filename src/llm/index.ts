import type { FilteredJob, LlmOutput } from "../types.ts";
import type { ParsedResume } from "../resume/parser.ts";
import { callGemini } from "./gemini.ts";
import { callOpenRouter } from "./deepseek.ts";
import { validatePlan } from "./validator.ts";

// Per-provider throttling gap. Free-tier RPM translates to a minimum inter-call
// gap with a small safety buffer.
const MIN_GAP_MS: Record<string, number> = {
  "gemini-2.5-flash": 6500,
  "gemini-2.5-flash-lite": 4500,
  "gemini-2.0-flash": 4500,
  openrouter: 3000,
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

type Attempt = { kind: "gemini"; model: string } | { kind: "openrouter" };

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
  resume: ParsedResume,
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
        ? await callGemini(resume, job, attempt.model)
        : await callOpenRouter(resume, job);

    if (result.ok) {
      const { cleaned, warnings } = validatePlan(result.data, resume);
      if (warnings.length) {
        console.warn(
          `[plan-validate] ${job.company} — ${job.title}: ${warnings.length} fixes`
        );
        for (const w of warnings.slice(0, 3)) console.warn(`  - ${w}`);
      }
      return { ...result, data: cleaned };
    }

    lastErr = result.error;
    console.warn(
      `[llm] ${provider} failed for ${job.company} — ${job.title.slice(0, 40)}: ${result.error.slice(0, 140)}`
    );

    if (RATE_LIMIT_RE.test(result.error)) {
      lastCallAt[provider] = Date.now() + RETRY_AFTER_MS;
      if (!backoffApplied) {
        backoffApplied = true;
        await new Promise((r) => setTimeout(r, 2000));
      }
      continue;
    }

    if (SERVICE_ERR_RE.test(result.error)) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
  }

  return { ok: false, error: `All providers exhausted. Last: ${lastErr}` };
}
