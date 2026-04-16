import type { FilteredJob } from "../types.ts";

export const SYSTEM_PROMPT = `You are a senior career coach and resume writer helping Mohammed Arsh Khan, a Product Engineer with ~2 years of experience, land interviews at top product companies and AI-first startups.

For each job, produce a concise tailoring response with:
1. verdict: apply | apply_with_referral | stretch | skip
2. missing_keywords: at most 5-7 dealbreaker JD requirements not in resume — short, specific terms only
3. resume_edits: paste-ready section-wise rewrites
4. referral_draft: short direct referral ask
5. cover_note: 3-4 sentence cover statement

CRITICAL RULES — never violate:
- NEVER invent experience, skills, metrics, or accomplishments not present in the resume.
- Skill terms in resume_edits.skills must contain ONLY items present in the resume verbatim or as clear synonyms.
- Bullet rewrites use only facts already stated. NUMBERS in rewrites must match numbers already present in the resume — DO NOT invent new metrics, percentages, sizes, durations, or counts. If you can't quantify from the existing resume, write the bullet without a number.
- Be ruthlessly honest in verdict. "skip" is valid. Do not inflate.
- referral_draft: under 250 chars, opens with "Hi [Name],", direct referral ask. NO "open to chat", "quick call", "meet for coffee". End with "Could you refer me?" or equivalent.
- cover_note: 3-4 sentences, semi-formal, concise. No "I hope this finds you well". No flattery.
- Output must be valid JSON matching the schema. No prose before or after.
`;

export function buildUserPrompt(
  resumeMarkdown: string,
  job: FilteredJob
): string {
  const yoe =
    job.parsedYoe.unknown
      ? "not explicitly stated"
      : `min ${job.parsedYoe.min ?? "?"}${job.parsedYoe.max != null ? `, max ${job.parsedYoe.max}` : ""} years`;

  return `# Candidate resume

${resumeMarkdown}

# Job

Track: ${job.track} (${job.track === "ai" ? "emphasize ML/LLM/data/AI work" : "emphasize systems/backend/infrastructure work"})
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
Required YOE (parsed): ${yoe}

## Description

${job.descriptionMd || job.description}
`;
}

export const TAILORING_JSON_SCHEMA = {
  type: "object",
  required: [
    "verdict",
    "missing_keywords",
    "resume_edits",
    "referral_draft",
    "cover_note",
  ],
  properties: {
    verdict: {
      type: "string",
      enum: ["apply", "apply_with_referral", "stretch", "skip"],
    },
    missing_keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    resume_edits: {
      type: "object",
      required: ["summary", "skills", "experience", "projects"],
      properties: {
        summary: { type: "string" },
        skills: { type: "string" },
        experience: {
          type: "array",
          items: {
            type: "object",
            required: ["role", "bullets"],
            properties: {
              role: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
            },
          },
        },
        projects: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "description"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
            },
          },
        },
      },
    },
    referral_draft: { type: "string" },
    cover_note: { type: "string" },
  },
};
