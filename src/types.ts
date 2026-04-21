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

// Diff-based tailoring plan: LLM decides which existing bullets to keep, hide,
// or rephrase. It cannot invent new bullets. Every rephrase is validated
// against the source bullet + JD vocabulary. This kills hallucination at the
// schema level, not after-the-fact.
export const BulletActionSchema = z.object({
  id: z.string(),
  keep: z.boolean(),
  // Lower = earlier in rendered output. Relative order is what matters;
  // we intentionally don't bound the range so LLMs can emit any integer
  // (some like to use 1..N ranks, others 0..100 percentiles).
  priority: z.number().default(50),
  // Optional rewrite; if present it replaces the bullet text. Must pass
  // token-level validation against source bullet + JD vocab.
  new_text: z.string().optional(),
});

// Anticipated apply-form question answers, keyed by a canonical question
// slug that the bookmarklet fuzzy-matches against form labels. Values are
// short strings the bookmarklet can drop straight into textarea/input
// fields. Generated at tailor time so bookmarklet has zero LLM latency.
//
// Canonical keys (stable across jobs; bookmarklet's fuzzy matcher maps
// form-specific label variants to these):
//   why_company       — "Why are you interested in working at X?"
//   why_role          — "Why this role specifically?"
//   challenging_proj  — "Describe your most challenging project"
//   impactful_proj    — "What's the most impactful thing you've shipped?"
//   failure_story     — "Tell us about a time you failed"
//   strengths         — "What are your strengths?"
//   why_leaving       — "Why are you looking to leave your current role?"
//   ai_experience     — "What's your experience with AI/LLMs?" (AI-track only)
export const PrefillAnswersSchema = z.object({
  why_company: z.string().default(""),
  why_role: z.string().default(""),
  challenging_proj: z.string().default(""),
  impactful_proj: z.string().default(""),
  failure_story: z.string().default(""),
  strengths: z.string().default(""),
  why_leaving: z.string().default(""),
  ai_experience: z.string().default(""),
});

export const TailoringPlanSchema = z.object({
  verdict: z.enum(["apply", "apply_with_referral", "stretch", "skip"]),
  // Why we're recommending this verdict — one line, max ~160 chars.
  verdict_reason: z.string().max(300).default(""),
  // JD keywords that are genuine dealbreakers AND missing from the resume.
  missing_keywords: z.array(z.string()).max(8).default([]),
  // Rewrite of the summary. Validated against the whole resume + JD.
  new_summary: z.string().nullable().default(null),
  // Plan for bullets across achievements + experience + projects.
  bullet_plan: z.array(BulletActionSchema).default([]),
  // Skills to emphasize — existing skill items only, reordered first.
  // Each string must match an item already in resume.skills.
  skill_emphasis: z.array(z.string()).max(20).default([]),
  referral_draft: z.string().default(""),
  cover_note: z.string().default(""),
  // Pre-generated answers to common apply-form questions. Bookmarklet
  // reads this on the apply page and fills matching textareas.
  prefill_answers: PrefillAnswersSchema.default({}),
});

export type BulletAction = z.infer<typeof BulletActionSchema>;
export type TailoringPlan = z.infer<typeof TailoringPlanSchema>;
export type PrefillAnswers = z.infer<typeof PrefillAnswersSchema>;

export type LlmOutput =
  | { ok: true; kind: "plan"; data: TailoringPlan; model: string }
  | { ok: false; error: string };

// ATS keyword-match signal — computed deterministically, no LLM.
export type AtsMatch = {
  score: number; // 0..1
  matched: string[];
  missing: string[];
};

// Combined fit score — deterministic, no LLM. See src/match/score.ts.
export type FitScore = {
  overall: number;
  ats: number;
  semantic: number;
  yoe: number;
};

export type PdfAttachment = {
  buffer: Uint8Array;
  filename: string;
  caption: string;
};

export type JobAlert = {
  job: FilteredJob;
  llm: LlmOutput;
  atsMatch: AtsMatch;
  fit: FitScore;
  profileName: string;
  pdfs: PdfAttachment[];
  // Recruiter-quality checks — one warning per check that failed.
  // Empty = clean, safe to send as-is.
  qualityWarnings: string[];
  // Prompt semantic version that produced this row. Tracked in Notion
  // so we can A/B later (did v3 prompts beat v2 on interview rate?).
  promptVersion: string;
  // Serialized Prefill Data blob the extension/bookmarklet reads to
  // autofill apply forms. JSON string: { profile hints, prefill_answers }.
  prefillData: string;
};
