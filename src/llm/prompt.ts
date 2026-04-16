import type { FilteredJob } from "../types.ts";
import type { ParsedResume } from "../resume/parser.ts";

// The LLM acts as a ranker/selector, not a writer. It chooses which existing
// bullets to keep and how to order them. It may offer rephrases, but every
// rephrase is token-validated downstream against the source bullet + JD.
// Free-text generation is not available anywhere in the schema.

export const SYSTEM_PROMPT = `You are a resume tailoring assistant for Mohammed Arsh Khan, a Product Engineer with 2 years of experience. Your job is to pick the most relevant existing bullets for the given JD, reorder them, and optionally propose light rephrases.

YOU MUST NOT INVENT CLAIMS. The schema restricts you to referring to existing bullets by ID. You may not fabricate experience, skills, metrics, or accomplishments.

For each job, return a JSON plan with:

1. verdict: apply | apply_with_referral | stretch | skip
   - "apply": resume fit is strong and YOE bar is reasonable.
   - "apply_with_referral": fit is decent but competition is high — needs a warm intro.
   - "stretch": YOE ceiling exceeded by 1-2 years OR some dealbreaker keywords missing.
   - "skip": wrong track, >4 YOE gap, or fundamentally mismatched.

2. verdict_reason: one concise sentence explaining the verdict.

3. missing_keywords: up to 8 dealbreaker terms from the JD that are NOT in the resume. Short, specific terms only. No generic fluff like "team player".

4. new_summary: an optional 2-3 sentence summary tailored to this JD. Use only language that appears in either the resume or the JD. If the existing summary is already good for this JD, return null.

5. bullet_plan: one entry per bullet you want to KEEP or HIDE.
   - id: must exactly match one of the bullet IDs from the Resume Bullets section below.
   - keep: true to include, false to hide.
   - priority: 0-100. LOWER number = HIGHER on the page. Use 0-30 for strong matches, 40-60 for decent, 70+ for weak. Bullets not listed default to keep=true, priority=50.
   - new_text: OPTIONAL. Only include if the rephrase is clearly better for this JD. The rephrase MUST use vocabulary from the original bullet or the JD — do not introduce terms from elsewhere. Numbers in rephrases must appear in the original bullet.

6. skill_emphasis: list existing skill items in the resume that are MOST relevant for this JD, in order of relevance. These will be reordered first. Each item must exactly match an item that is already in the Resume Skills section — verbatim.

7. referral_draft: under 250 chars, direct ask, opens with "Hi [Name],". NO "open to chat", "quick call", "coffee". End with "Could you refer me?" or equivalent. Reference this specific role.

8. cover_note: 3-4 sentences, semi-formal. No "I hope this finds you well", no flattery. Mention one specific project or achievement from the resume that directly matches the JD.

HARD RULES:
- Referring to a bullet ID that does not exist in the Resume Bullets section is an error.
- new_text rephrases that introduce vocabulary not in the source bullet or the JD will be rejected.
- new_summary that introduces new claims beyond what the resume states will be rejected.
- Be ruthlessly honest in the verdict. "skip" is valid and expected for mismatches.
- Output must be valid JSON matching the schema. No prose before or after.
`;

function formatBullet(id: string, text: string): string {
  return `[${id}] ${text}`;
}

function formatResumeForLlm(resume: ParsedResume): string {
  const lines: string[] = [];
  lines.push("## Summary (current)");
  lines.push(resume.summary);
  lines.push("");
  if (resume.achievements.length) {
    lines.push("## Resume Bullets — Achievements");
    for (const b of resume.achievements) lines.push(formatBullet(b.id, b.text));
    lines.push("");
  }
  if (resume.experience.length) {
    lines.push("## Resume Bullets — Experience");
    for (const e of resume.experience) {
      lines.push(`### ${e.heading} (${e.meta})`);
      for (const b of e.bullets) lines.push(formatBullet(b.id, b.text));
      lines.push("");
    }
  }
  if (resume.projects.length) {
    lines.push("## Resume Bullets — Projects");
    for (const p of resume.projects) {
      lines.push(`### ${p.heading} — ${p.techStack}`);
      for (const b of p.bullets) lines.push(formatBullet(b.id, b.text));
      lines.push("");
    }
  }
  if (resume.skills.length) {
    lines.push("## Resume Skills (available items — skill_emphasis must match these exactly)");
    for (const c of resume.skills) {
      lines.push(`${c.category}: ${c.items.join(", ")}`);
    }
  }
  return lines.join("\n");
}

export function buildUserPrompt(
  resume: ParsedResume,
  job: FilteredJob
): string {
  const yoe = job.parsedYoe.unknown
    ? "not explicitly stated"
    : `min ${job.parsedYoe.min ?? "?"}${
        job.parsedYoe.max != null ? `, max ${job.parsedYoe.max}` : ""
      } years`;

  return `# Candidate resume (structured)

${formatResumeForLlm(resume)}

# Job

Track: ${job.track} (${
    job.track === "ai"
      ? "emphasize ML/LLM/data/AI work"
      : "emphasize systems/backend/infrastructure work"
  })
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
Required YOE (parsed): ${yoe}

## Description

${job.descriptionMd || job.description}
`;
}

// JSON schema (Gemini structured output format) matching TailoringPlanSchema.
export const TAILORING_JSON_SCHEMA = {
  type: "object",
  required: ["verdict", "verdict_reason"],
  properties: {
    verdict: {
      type: "string",
      enum: ["apply", "apply_with_referral", "stretch", "skip"],
    },
    verdict_reason: { type: "string" },
    missing_keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    new_summary: { type: "string", nullable: true },
    bullet_plan: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "keep"],
        properties: {
          id: { type: "string" },
          keep: { type: "boolean" },
          priority: { type: "number" },
          new_text: { type: "string" },
        },
      },
    },
    skill_emphasis: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
    },
    referral_draft: { type: "string" },
    cover_note: { type: "string" },
  },
};
