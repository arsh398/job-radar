import type { FilteredJob, LlmOutput } from "../types.ts";
import { callGemini } from "./gemini.ts";
import { callOpenRouter } from "./deepseek.ts";
import { validateTailoring } from "./validator.ts";

// Gemini free tier RPMs:
//   2.5-flash:      10 RPM,  250 RPD
//   2.5-flash-lite: 15 RPM, 1000 RPD  ← deep quota for fallback
//   2.0-flash:      15 RPM,  200 RPD
// Throttle keeps us under the lowest RPM in the chain.
const MIN_GAP_MS = 4500;
let lastCallAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  lastCallAt = Date.now();
}

const CHAIN: { kind: "gemini"; model: string }[] | { kind: "openrouter" }[] = [];
type Attempt =
  | { kind: "gemini"; model: string }
  | { kind: "openrouter" };

const ATTEMPTS: Attempt[] = [
  { kind: "gemini", model: "gemini-2.5-flash" },
  { kind: "gemini", model: "gemini-2.5-flash-lite" },
  { kind: "gemini", model: "gemini-2.0-flash" },
  { kind: "openrouter" },
];

export async function tailorForJob(
  resumeMd: string,
  job: FilteredJob
): Promise<LlmOutput> {
  await throttle();

  let lastErr = "no attempts made";
  for (const attempt of ATTEMPTS) {
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
    const provider =
      attempt.kind === "gemini" ? attempt.model : "openrouter";
    console.warn(
      `[llm] ${provider} failed for ${job.company} — ${job.title.slice(0, 40)}: ${result.error.slice(0, 140)}`
    );
  }

  return { ok: false, error: `All providers exhausted. Last: ${lastErr}` };
}
