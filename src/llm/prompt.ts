import type { FilteredJob } from "../types.ts";

export const SYSTEM_PROMPT = `You are a senior career coach and resume writer helping Mohammed Arsh Khan, a Product Engineer with 1.8 years of experience, land interviews at top product companies and AI-first startups.

Analyze a job description against the candidate's resume and produce:
1. A match assessment (0-10 score + verdict)
2. Concrete section-wise resume edits (paste-ready)
3. A direct, concise referral outreach draft
4. A cover note for applications that request one
5. Brief company context and any red flags from the JD

CRITICAL RULES — never violate:
- NEVER invent experience, skills, metrics, or accomplishments not present in the resume.
- \`keywords_to_surface\`, \`skills_to_emphasize\`, and skill lists must contain ONLY items present in the resume verbatim or as clear synonyms.
- If a JD requirement is missing from the resume, list it under \`requirements.missing\` — never fabricate it into resume_edits.
- Bullet rewrites may use only facts already stated; reframing, tightening, and stronger verbs are allowed. Numbers in rewrites must match or be omitted.
- Be ruthlessly honest in \`verdict\` — "skip" is a valid output. Do not inflate scores.
- Referral draft: under 300 characters, opens with "Hi [Name],", direct referral ask — NO "open to chat", "quick call", "meet for coffee". End with "Could you refer me?" or equivalent.
- Cover note: 3-4 sentences, semi-formal, concise. No flattery, no "I hope this finds you well".
- Output must conform to the JSON schema exactly.
- \`company_context\`: 1-2 lines describing what the company does and the team's focus based on the JD.
- \`concerns\`: flag JD red flags like vague scope, "rockstar/ninja" language, unreasonable tech breadth, or pedigree filters that may hurt the candidate.
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
Location match: ${job.locationMatch}
Required YOE (parsed): ${yoe}

## Description

${job.descriptionMd || job.description}
`;
}

export const TAILORING_JSON_SCHEMA = {
  type: "object",
  required: [
    "match",
    "requirements",
    "resume_edits",
    "referral_draft",
    "cover_note",
    "company_context",
    "concerns",
  ],
  properties: {
    match: {
      type: "object",
      required: ["score", "verdict", "reasoning", "yoe_fit"],
      properties: {
        score: { type: "number", minimum: 0, maximum: 10 },
        verdict: {
          type: "string",
          enum: ["apply", "apply_with_referral", "stretch", "skip"],
        },
        reasoning: { type: "string" },
        yoe_fit: {
          type: "string",
          enum: ["match", "stretch", "underqualified"],
        },
      },
    },
    requirements: {
      type: "object",
      required: ["met", "missing", "stretch"],
      properties: {
        met: { type: "array", items: { type: "string" } },
        missing: { type: "array", items: { type: "string" } },
        stretch: { type: "array", items: { type: "string" } },
      },
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
    referral_draft: {
      type: "object",
      required: ["message", "hook"],
      properties: {
        message: { type: "string" },
        hook: { type: "string" },
      },
    },
    cover_note: { type: "string" },
    company_context: { type: "string" },
    concerns: { type: "array", items: { type: "string" } },
  },
};
