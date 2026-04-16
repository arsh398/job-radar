// Gemini embeddings — free, 3072-dim, used as a deterministic semantic
// ranker so we don't burn LLM calls on jobs that are a poor fit.
//
// Free-tier constraints (gemini-embedding-001 as of 2026-04):
//   - 100 requests/minute, 1000 requests/day, 30000 tokens/minute
//   - 3072 dimensions (can be reduced via outputDimensionality)
//
// Strategy: batch embed each JD once per run, embed resume profiles once
// per run, compute cosine similarities. All results cached in-process so a
// 2nd call for the same text is free.

import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-embedding-001";

function client(): GoogleGenAI | null {
  const apiKey = process.env["GOOGLE_AI_STUDIO_API_KEY"];
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

const cache = new Map<string, number[]>();

// Hard cap per text — embedding API truncates anyway, but explicit cap
// keeps us safely inside the per-request token budget.
const MAX_CHARS = 8000;

function cacheKey(text: string, taskType: string): string {
  return `${taskType}|${text.slice(0, 200).toLowerCase()}|${text.length}`;
}

export type EmbedTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY";

export async function embedText(
  text: string,
  taskType: EmbedTaskType = "SEMANTIC_SIMILARITY"
): Promise<number[] | null> {
  const trimmed = (text ?? "").slice(0, MAX_CHARS).trim();
  if (!trimmed) return null;
  const key = cacheKey(trimmed, taskType);
  const cached = cache.get(key);
  if (cached) return cached;

  const ai = client();
  if (!ai) return null;

  try {
    const res = await ai.models.embedContent({
      model: MODEL,
      contents: [{ parts: [{ text: trimmed }] }],
      config: {
        taskType,
        // 768 dims is plenty for cosine on short docs and halves bandwidth.
        outputDimensionality: 768,
      },
    });
    const vec = res.embeddings?.[0]?.values;
    if (!vec || !vec.length) return null;
    cache.set(key, vec);
    return vec;
  } catch (err) {
    console.warn(
      `[embed] failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    aa += ai * ai;
    bb += bi * bi;
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

// Convenience: semantic fit (0..1). -1..1 range of cosine squashed so
// anti-correlated docs get ~0 rather than a negative.
export function semanticFit(a: number[], b: number[]): number {
  const c = cosineSimilarity(a, b);
  return Math.max(0, (c + 1) / 2);
}
