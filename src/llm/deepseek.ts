import type { FilteredJob, LlmOutput } from "../types.ts";
import { TailoringPlanSchema } from "../types.ts";
import type { ParsedResume } from "../resume/parser.ts";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.ts";

// Paid Gemini 2.5 Flash-Lite via OpenRouter. Same model we prefer on the
// Google AI Studio free tier, just via OpenRouter's paid routing — so
// when the free Gemini daily quota is exhausted, we fall through here
// and keep the same model quality without waiting for the quota to reset.
// OpenRouter model ID verified against https://openrouter.ai/models
// Cost: ~$0.10/M input, $0.40/M output (2026-04).
const FALLBACK_MODEL =
  process.env["OPENROUTER_MODEL"] ?? "google/gemini-2.5-flash-lite";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const JSON_REMINDER = `\n\nRESPOND ONLY WITH A SINGLE JSON OBJECT matching the required schema. No markdown fences, no prose before or after.`;

export async function callOpenRouter(
  resume: ParsedResume,
  job: FilteredJob
): Promise<LlmOutput> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY missing" };

  const userPrompt = buildUserPrompt(resume, job) + JSON_REMINDER;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-title": "job-radar",
      },
      body: JSON.stringify({
        model: FALLBACK_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `OpenRouter HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content;
    if (!text) {
      return { ok: false, error: "OpenRouter returned empty response" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        return {
          ok: false,
          error: `OpenRouter returned non-JSON: ${text.slice(0, 200)}`,
        };
      }
      parsed = JSON.parse(match[0]);
    }

    const result = TailoringPlanSchema.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        error: `OpenRouter schema validation failed: ${result.error.message}`,
      };
    }

    return {
      ok: true,
      kind: "plan",
      data: result.data,
      model: FALLBACK_MODEL,
    };
  } catch (err) {
    return {
      ok: false,
      error: `OpenRouter error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export const callDeepSeek = callOpenRouter;
