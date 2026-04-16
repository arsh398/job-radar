import { GoogleGenAI } from "@google/genai";
import type { FilteredJob, LlmOutput } from "../types.ts";
import { TailoringResponseSchema } from "../types.ts";
import {
  SYSTEM_PROMPT,
  TAILORING_JSON_SCHEMA,
  buildUserPrompt,
} from "./prompt.ts";

// Flash primary: 10 RPM, 1M TPM, 500 RPD on free tier — fits 20 jobs/run easily.
// Pro is too restrictive (5 RPM) for our burst pattern; skip it for now.
const PRIMARY_MODEL = "gemini-2.5-flash";

function client(): GoogleGenAI | null {
  const apiKey = process.env["GOOGLE_AI_STUDIO_API_KEY"];
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

export async function callGemini(
  resumeMd: string,
  job: FilteredJob,
  model: string = PRIMARY_MODEL
): Promise<LlmOutput> {
  const ai = client();
  if (!ai) return { ok: false, error: "GOOGLE_AI_STUDIO_API_KEY missing" };

  const prompt = buildUserPrompt(resumeMd, job);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: TAILORING_JSON_SCHEMA as unknown as Record<
          string,
          unknown
        >,
      },
    });

    const text =
      typeof response.text === "string"
        ? response.text
        : response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { ok: false, error: `${model} returned empty response` };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        return { ok: false, error: `${model} returned non-JSON: ${text.slice(0, 200)}` };
      }
      parsedJson = JSON.parse(match[0]);
    }

    const result = TailoringResponseSchema.safeParse(parsedJson);
    if (!result.success) {
      return {
        ok: false,
        error: `${model} schema validation failed: ${result.error.message}`,
      };
    }

    return { ok: true, kind: "full", data: result.data, model };
  } catch (err) {
    return {
      ok: false,
      error: `${model} error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
