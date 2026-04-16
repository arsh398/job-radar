import type { FilteredJob, LlmOutput } from "../types.ts";
import { TailoringResponseSchema } from "../types.ts";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.ts";

// OpenRouter free fallback. DeepSeek free was removed from OpenRouter's free
// tier; Llama 3.3 70B is the strongest reliable free model now (verified 2026-04).
const FALLBACK_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const JSON_REMINDER = `\n\nRESPOND ONLY WITH A SINGLE JSON OBJECT matching the required schema. No markdown fences, no prose before or after.`;

export async function callOpenRouter(
  resumeMd: string,
  job: FilteredJob
): Promise<LlmOutput> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY missing" };

  const userPrompt = buildUserPrompt(resumeMd, job) + JSON_REMINDER;

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

    const result = TailoringResponseSchema.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        error: `OpenRouter schema validation failed: ${result.error.message}`,
      };
    }

    return {
      ok: true,
      kind: "full",
      data: result.data,
      model: FALLBACK_MODEL,
    };
  } catch (err) {
    return {
      ok: false,
      error: `OpenRouter error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Backwards-compat alias (file name kept for now).
export const callDeepSeek = callOpenRouter;
