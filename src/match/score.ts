// Combined fit score — deterministic, no LLM. Produces a 0..1 ranking
// signal we use to (a) order jobs within a run (highest-fit first) and
// (b) gate LLM expense (skip LLM below a low threshold).
//
// Components:
//   - ATS keyword overlap (how many JD tech keywords appear in resume,
//     after ontology expansion)
//   - Semantic embedding fit (Gemini embeddings, cosine similarity)
//   - YOE fit (1.0 if YOE is met, decays for gap)
//
// All components are in 0..1, combined as a weighted sum.

import type { AtsMatch, FilteredJob } from "../types.ts";
import { embedText, semanticFit } from "./embeddings.ts";

export type FitScore = {
  overall: number; // 0..1
  ats: number;
  semantic: number; // 0..1; 0 if embeddings unavailable
  yoe: number; // 0..1
};

function yoeFit(job: FilteredJob, ceiling = 2): number {
  if (job.parsedYoe.unknown) return 0.7; // unknown is neutral-positive
  const min = job.parsedYoe.min ?? 0;
  if (min <= ceiling) return 1;
  const gap = min - ceiling;
  // 1yr gap = 0.7, 2yr = 0.5, 3yr = 0.35, 5yr = 0.15
  return Math.max(0.05, 1 / (1 + gap * 0.55));
}

export async function computeFitScore(
  job: FilteredJob,
  atsMatch: AtsMatch,
  resumeEmbedding: number[] | null
): Promise<FitScore> {
  let semantic = 0;
  if (resumeEmbedding) {
    const jdText = job.descriptionMd || job.description;
    const jdVec = await embedText(jdText, "RETRIEVAL_QUERY");
    if (jdVec) {
      semantic = semanticFit(resumeEmbedding, jdVec);
    }
  }
  const ats = atsMatch.score;
  const yoe = yoeFit(job);
  // Weights: ATS and semantic are the main signals, YOE is a gate.
  const overall = 0.45 * ats + 0.35 * semantic + 0.2 * yoe;
  return { overall, ats, semantic, yoe };
}
