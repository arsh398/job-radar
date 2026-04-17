import type { FilteredJob, LlmOutput } from "../types.ts";
import type { ParsedResume } from "../resume/parser.ts";
import { callOpenRouter } from "./openrouter.ts";
import { validatePlan } from "./validator.ts";

// Single provider: OpenRouter with a paid Gemini 2.5 Flash-Lite (or whatever
// OPENROUTER_MODEL is set to). Gemini free-tier was dropped — the daily RPD
// caps made it a net loss once we had paid credits anywhere. Fewer moving
// parts, no more "LLM unavailable" alerts from free-tier 429s.
//
// One retry on transient network/5xx. Client errors (4xx) do not retry.
const RETRY_DELAY_MS = 1200;

async function callWithRetry(
  resume: ParsedResume,
  job: FilteredJob
): Promise<LlmOutput> {
  const first = await callOpenRouter(resume, job);
  if (first.ok) return first;
  // Don't retry client errors — if the request was malformed or the key was
  // rejected (4xx), a retry will just burn another call.
  if (/HTTP 4\d\d/.test(first.error)) return first;
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  return callOpenRouter(resume, job);
}

export async function tailorForJob(
  resume: ParsedResume,
  resumeMd: string,
  job: FilteredJob
): Promise<LlmOutput> {
  const result = await callWithRetry(resume, job);
  if (!result.ok) {
    console.warn(
      `[llm] failed for ${job.company} — ${job.title.slice(0, 40)}: ${result.error.slice(0, 180)}`
    );
    return result;
  }
  const { cleaned, warnings } = validatePlan(result.data, resume, resumeMd);
  if (warnings.length) {
    console.warn(
      `[plan-validate] ${job.company} — ${job.title}: ${warnings.length} fixes`
    );
    for (const w of warnings.slice(0, 3)) console.warn(`  - ${w}`);
  }
  return { ...result, data: cleaned };
}
