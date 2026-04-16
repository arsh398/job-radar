import { z } from "zod";

export type Track = "sde" | "ai";

export type Job = {
  key: string;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  descriptionMd?: string;
  postedAt?: string;
  fetchedAt: string;
  raw?: unknown;
};

export type FilteredJob = Job & {
  track: Track;
  parsedYoe: { min: number | null; max: number | null; unknown: boolean };
  locationMatch: "india" | "global_remote";
};

export type SourceAdapter = {
  name: string;
  fetch: () => Promise<Job[]>;
};

export type SourceResult = {
  source: string;
  ok: boolean;
  jobs: Job[];
  error?: string;
  durationMs: number;
};

export type SeenEntry = {
  firstSeen: string;
  company: string;
  title: string;
};

export type SeenMap = Record<string, SeenEntry>;

export type SourceHealth = {
  lastRun: string;
  lastOk: string | null;
  lastFail: string | null;
  consecutiveFailures: number;
  lastJobCount: number;
  lastJobCountAt: string | null;
  alerted: boolean;
};

export type SourceHealthMap = Record<string, SourceHealth>;

export const ResumeEditsSchema = z.object({
  summary: z.string(),
  skills: z.string(),
  experience: z.array(
    z.object({
      role: z.string(),
      bullets: z.array(z.string()),
    })
  ),
  projects: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      })
    )
    .default([]),
});

export const TailoringResponseSchema = z.object({
  verdict: z.enum(["apply", "apply_with_referral", "stretch", "skip"]),
  missing_keywords: z.array(z.string()).max(8),
  resume_edits: ResumeEditsSchema,
  referral_draft: z.string(),
  cover_note: z.string(),
});

export type TailoringResponse = z.infer<typeof TailoringResponseSchema>;

export type LlmOutput =
  | { ok: true; kind: "full"; data: TailoringResponse; model: string }
  | { ok: false; error: string };

export type JobAlert = {
  job: FilteredJob;
  llm: LlmOutput;
};
