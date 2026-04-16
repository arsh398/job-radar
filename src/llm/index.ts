import type { FilteredJob, LlmOutput } from "../types.ts";
import { callGemini } from "./gemini.ts";
import { callOpenRouter } from "./deepseek.ts";
import { validateTailoring } from "./validator.ts";

// Throttle to stay safely under Gemini Flash 10 RPM.
const MIN_GAP_MS = 6500;
let lastCallAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  lastCallAt = Date.now();
}

export async function tailorForJob(
  resumeMd: string,
  job: FilteredJob
): Promise<LlmOutput> {
  await throttle();
  const primary = await callGemini(resumeMd, job);
  const result = primary.ok ? primary : await callOpenRouter(resumeMd, job);

  if (result.ok && result.kind === "full") {
    const { cleaned, warnings } = validateTailoring(result.data, resumeMd);
    if (warnings.length) {
      console.warn(
        `[validator] ${job.company} — ${job.title}: ${warnings.length} fixes`
      );
      for (const w of warnings) console.warn(`  - ${w}`);
    }
    return { ...result, data: cleaned };
  }

  return result;
}
