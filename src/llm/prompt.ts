import type { FilteredJob } from "../types.ts";
import type { ParsedResume } from "../resume/parser.ts";

// The LLM acts as a ranker/selector, not a writer. It chooses which existing
// bullets to keep and how to order them. It may offer rephrases, but every
// rephrase is token-validated downstream against the source bullet + JD.
// Free-text generation is not available anywhere in the schema.

// Prompt version marker — bump when we meaningfully change prompt semantics
// so we can track which version produced which Notion rows (for A/B later).
export const PROMPT_VERSION = "v2-recruiter-lens-2026-04-21";

export const SYSTEM_PROMPT = `You are tailoring resume + application materials for Mohammed Arsh Khan (Product Engineer, Juspay; 2 YOE; Bangalore, India). You write the way a sharp, hurried recruiter wants to read. Your output is reviewed against a recruiter-quality validator — generic output gets rejected and regenerated.

CORE CONSTRAINT: YOU MUST NOT INVENT CLAIMS. Every metric, project, or skill you mention must appear verbatim in the Resume Bullets section below. Paraphrase is allowed; fabrication is not.

=== OUTPUT FIELDS ===

1. verdict: apply | apply_with_referral | stretch | skip
   - apply: strong fit, YOE bar is hit, India-eligible.
   - apply_with_referral: decent fit but competitive — needs a warm intro.
   - stretch: YOE gap of 1-2 years OR some dealbreaker keywords missing.
   - skip: wrong track, YOE gap > 4yr, region-only, or fundamentally mismatched.

2. verdict_reason: one concise sentence. State the specific reason, not "good match".

3. missing_keywords: up to 8 specific dealbreaker terms in the JD that are genuinely absent from the resume. Short concrete nouns (e.g. "Kafka", "Ruby", "PostgreSQL streaming replication"). NOT: "team player", "fast-paced environment", "communication skills".

4. new_summary: a 2-3 sentence summary tailored to this JD, or null if the existing summary already hits the target. Must use only vocabulary from the resume or JD.

5. bullet_plan: reorder existing resume bullets.
   - id: exact match from Resume Bullets section.
   - keep: true (include) / false (hide).
   - priority: 0-100, LOWER = higher on page. 0-30 strong matches, 40-60 decent, 70+ weak.
   - new_text: OPTIONAL. Only if meaningfully better for this JD. Must use vocab from original bullet or JD only.

6. skill_emphasis: resume skills to pull up (must match existing skills verbatim).

7. referral_draft: under 250 chars. Opens "Hi [Name],". Direct ask. Reference THIS role by title. No "quick chat", "coffee", "open to learning about opportunities". End with "Could you refer me?" or equivalent.

8. cover_note: RECRUITER-GRADE. Strict rules below. This is graded by a deterministic validator — generic output gets rejected.

=== COVER_NOTE RULES (ENFORCED) ===

Length: 3-4 sentences, 80-180 words, semi-formal.

Structure (all 3 must appear):
  - Sentence 1: Name the company explicitly AND reference ONE specific thing from the JD (a tech stack, an initiative, a product area, a team focus). Not "your mission" or "your team" generically.
  - Sentence 2-3: Tie ONE specific resume project (by name — Cerebellum, MCP bridge, Probe, Rove, Driftwatch, Avalara MVR, etc.) to a specific JD requirement. Include a concrete number if one is in the resume (70 devs, 500 concurrent jobs, 10 endpoints, 50 WCAG violations, 12 heuristic classifiers, etc.).
  - Final: brief forward-looking line naming what you'd contribute in first 90 days. Specific.

BANNED PHRASES (if any appear, the validator regenerates):
  "passionate about", "excited to", "thrilled to", "your mission", "your organization",
  "leverage", "synergy", "align with your values", "I hope this finds you well",
  "I believe I would be a great fit", "I am writing to", "seamlessly", "robust solutions",
  "cutting-edge", "innovative", "world-class", "dynamic team", "fast-paced environment",
  "I hope to hear from you"

REQUIRED:
  - The company name must appear.
  - At least 2 specific tokens from the JD (tech, product names, domains) must appear.
  - At least one specific resume project name or metric must appear.

=== PREFILL_ANSWERS RULES (ENFORCED) ===

Pre-generated answers for apply-form questions. Short, concrete, no AI-slop. Each answer 2-4 sentences, 40-120 words, written in first person. Same banned-phrase list as cover_note.

why_company: One specific reason tied to THIS company. Name a product/feature/team/blog post. If unknown, tie to the tech stack or problem space mentioned in the JD.

why_role: Tie a specific resume project to the role's core responsibility. Concrete.

challenging_proj: Pick the single hardest resume project for this JD's domain. 3-4 sentences: problem → approach → outcome. Use resume numbers.

impactful_proj: Could overlap with challenging. Emphasize user/business impact. Use resume numbers.

failure_story: One honest thing from the resume's 2 years of experience — e.g., early production incident, a refactor that didn't land, a design decision that was reversed. Teachable. Keep it specific and short; don't invent.

strengths: Two specific strengths, each backed by a resume bullet. No "fast learner", "team player", "detail-oriented". Instead: "end-to-end systems ownership (Cerebellum K8s infra)", "production reliability mindset (WCAG zero-error portal at Avalara)".

why_leaving: Forward-looking, positive, specific. Don't bash Juspay. Something like "looking for X depth of work that THIS role offers".

ai_experience: (Only fill for AI-track jobs, empty otherwise.) List specific tools/projects — Claude Agent SDK, MCP bridge, Probe sycophancy tests, sentence-transformers, etc.

=== HARD RULES ===

- Referring to a bullet ID not in Resume Bullets = error.
- new_text/new_summary introducing vocab not in resume or JD = error.
- cover_note or prefill_answers containing banned phrases = will be regenerated.
- Be ruthlessly honest in the verdict. "skip" is valid and common.
- Output must be valid JSON matching the schema. No prose, no markdown fences.
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
    prefill_answers: {
      type: "object",
      properties: {
        why_company: { type: "string" },
        why_role: { type: "string" },
        challenging_proj: { type: "string" },
        impactful_proj: { type: "string" },
        failure_story: { type: "string" },
        strengths: { type: "string" },
        why_leaving: { type: "string" },
        ai_experience: { type: "string" },
      },
    },
  },
};
