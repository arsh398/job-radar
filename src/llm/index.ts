import type { FilteredJob, LlmOutput } from "../types.ts";
import { callGeminiWithFallback } from "./gemini.ts";
import { callDeepSeek } from "./deepseek.ts";
import { validateTailoring } from "./validator.ts";

export async function tailorForJob(
  resumeMd: string,
  job: FilteredJob
): Promise<LlmOutput> {
  const gemini = await callGeminiWithFallback(resumeMd, job);
  const result = gemini.ok ? gemini : await callDeepSeek(resumeMd, job);

  if (result.ok && result.kind === "full") {
    const { cleaned, warnings } = validateTailoring(result.data, resumeMd);
    if (warnings.length) {
      console.warn(
        `[validator] ${job.company} — ${job.title}: ${warnings.length} warnings`
      );
      for (const w of warnings) console.warn(`  - ${w}`);
    }
    return { ...result, data: cleaned };
  }

  return result;
}
