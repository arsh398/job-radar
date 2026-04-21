import type { ParsedResume } from "../resume/parser.ts";
import { allBulletIds } from "../resume/parser.ts";
import type { TailoringPlan, FilteredJob } from "../types.ts";
import { filterMissingKeywords } from "../filters/ats_match.ts";

export type PlanValidationResult = {
  cleaned: TailoringPlan;
  warnings: string[];
  // True if cover_note / prefill_answers tripped the recruiter-quality
  // checks (banned phrases, missing company name, etc). Used to flag the
  // Notion row so Mohammed can eyeball before sending.
  qualityWarnings: string[];
};

// Phrases we outlawed in the system prompt. Checked again here because LLMs
// occasionally slip through. Lower-cased for case-insensitive match.
const BANNED_PHRASES = [
  "passionate about",
  "excited to",
  "thrilled to",
  "your mission",
  "your organization",
  "leverage",
  "synergy",
  "align with your values",
  "i hope this finds you well",
  "i believe i would be a great fit",
  "i am writing to",
  "seamlessly",
  "robust solutions",
  "cutting-edge",
  "innovative",
  "world-class",
  "dynamic team",
  "fast-paced environment",
  "i hope to hear from you",
  "i would love to",
  "i would be excited to",
  "great opportunity",
];

// Resume project / achievement tokens Mohammed's cover_note should reach
// for. Check that at least one of these appears in the final cover_note —
// catches LLM output that paraphrased everything into vagueness.
const RESUME_SPECIFICITY_TOKENS = [
  "cerebellum",
  "mcp bridge",
  "mcp",
  "tara",
  "juspay",
  "avalara",
  "mvr",
  "probe",
  "rove",
  "driftwatch",
  "wcag",
  "kubernetes",
  "jenkins",
  "playwright",
  "axe-core",
  "500 concurrent",
  "70+ developers",
  "70 developers",
  "10+ restful",
  "50+ wcag",
  "433 loc",
  "12 heuristic",
  "400 pressure templates",
  "icpc",
  "codeforces",
  "leetcode",
];

function containsAny(text: string, needles: string[]): string[] {
  const lower = text.toLowerCase();
  return needles.filter((n) => lower.includes(n));
}

function countSpecificJdTokens(text: string, job: FilteredJob): number {
  // Pull the distinctive nouns from JD — rough heuristic. Proper nouns,
  // tech terms (often camelCase or with version numbers). Checks whether
  // the cover_note echoed at least some of them back.
  const jd = (job.descriptionMd || job.description || "").toLowerCase();
  const txt = text.toLowerCase();
  if (!jd) return 0;
  const tokens = new Set<string>();
  // Proper-noun-ish single words (Capitalized) in original JD.
  const caps = (job.descriptionMd || job.description || "").match(
    /\b[A-Z][a-zA-Z]{3,}\b/g
  ) || [];
  for (const c of caps) {
    const lc = c.toLowerCase();
    // Skip noise
    if (lc.length < 4) continue;
    if (["we", "you", "this", "that", "with", "from", "their", "our"].includes(lc)) continue;
    tokens.add(lc);
  }
  // Tech/product tokens like "GraphQL", "Redis", version-style
  const techs = jd.match(/\b[a-z][a-z0-9]*(?:\.[a-z]+|\d+\b|-[a-z0-9]+)/gi) || [];
  for (const t of techs) tokens.add(t.toLowerCase());

  let hits = 0;
  for (const t of tokens) if (txt.includes(t)) hits++;
  return hits;
}

export type QualityCheckResult = {
  field: string;
  passes: boolean;
  warnings: string[];
};

// Run recruiter-quality checks on cover_note and prefill_answers. Returns
// a list of warnings per field. Does NOT mutate the plan — we surface
// warnings to Notion so Mohammed can see which rows need manual review
// before sending. For a v2 upgrade we could force regeneration here.
export function runQualityChecks(
  plan: TailoringPlan,
  job: FilteredJob
): QualityCheckResult[] {
  const results: QualityCheckResult[] = [];
  const companyLower = job.company.toLowerCase();

  // --- cover_note ---
  const cover = (plan.cover_note ?? "").trim();
  const coverWarns: string[] = [];
  if (cover) {
    const banned = containsAny(cover, BANNED_PHRASES);
    if (banned.length) {
      coverWarns.push(`banned phrase(s): ${banned.join(", ")}`);
    }
    // Company name must appear somewhere (allow partial — "Stripe"
    // company with "stripe" in cover counts).
    if (!cover.toLowerCase().includes(companyLower.split(/\s+/)[0]!)) {
      coverWarns.push(`company name "${job.company}" not referenced`);
    }
    // At least 2 JD-specific tokens
    const jdHits = countSpecificJdTokens(cover, job);
    if (jdHits < 2) {
      coverWarns.push(`only ${jdHits} JD-specific tokens (need ≥2)`);
    }
    // At least 1 resume specificity token
    const resHits = containsAny(cover, RESUME_SPECIFICITY_TOKENS);
    if (resHits.length < 1) {
      coverWarns.push(`no specific resume project/metric referenced`);
    }
    // Length check — 60-220 words roughly
    const words = cover.split(/\s+/).filter(Boolean).length;
    if (words < 50) coverWarns.push(`too short: ${words} words (min 50)`);
    if (words > 250) coverWarns.push(`too long: ${words} words (max 250)`);
  }
  results.push({
    field: "cover_note",
    passes: coverWarns.length === 0,
    warnings: coverWarns,
  });

  // --- prefill_answers ---
  const answerFields: Array<keyof TailoringPlan["prefill_answers"]> = [
    "why_company",
    "why_role",
    "challenging_proj",
    "impactful_proj",
    "failure_story",
    "strengths",
    "why_leaving",
    "ai_experience",
  ];
  for (const f of answerFields) {
    const text = (plan.prefill_answers?.[f] ?? "").trim();
    if (!text) continue; // empty is OK (model decided not to answer)
    const warns: string[] = [];
    const banned = containsAny(text, BANNED_PHRASES);
    if (banned.length) warns.push(`banned phrase(s): ${banned.join(", ")}`);
    if (f === "why_company" && !text.toLowerCase().includes(companyLower.split(/\s+/)[0]!)) {
      warns.push(`company name not mentioned`);
    }
    if (["challenging_proj", "impactful_proj"].includes(f)) {
      const resHits = containsAny(text, RESUME_SPECIFICITY_TOKENS);
      if (resHits.length < 1) warns.push(`no specific resume project token`);
    }
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 200) warns.push(`too long: ${words} words`);
    results.push({
      field: `prefill_answers.${f}`,
      passes: warns.length === 0,
      warnings: warns,
    });
  }

  return results;
}

// Plan-shape validation and sanity checks:
//   1. Drop bullet_plan entries referencing unknown IDs.
//   2. Drop skill_emphasis entries that are not verbatim in resume.skills.
//   3. Strip missing_keywords that are covered by the resume's implied skills
//      (so a React engineer never sees HTML/CSS flagged as "missing").
// Heavy token-level validation of rephrases lives in resume/apply.ts where
// JD vocabulary is available.
export function validatePlan(
  plan: TailoringPlan,
  resume: ParsedResume,
  resumeMd: string
): PlanValidationResult {
  const warnings: string[] = [];
  const knownIds = allBulletIds(resume);

  const cleanedBulletPlan = plan.bullet_plan.filter((a) => {
    if (!knownIds.has(a.id)) {
      warnings.push(`plan dropped unknown bullet id: ${a.id}`);
      return false;
    }
    return true;
  });

  const knownSkillsLower = new Set<string>();
  for (const c of resume.skills) {
    for (const item of c.items) knownSkillsLower.add(item.toLowerCase());
  }
  const cleanedEmphasis = plan.skill_emphasis.filter((s) => {
    if (!knownSkillsLower.has(s.trim().toLowerCase())) {
      warnings.push(`skill_emphasis dropped unknown skill: ${s}`);
      return false;
    }
    return true;
  });

  const originalMissing = plan.missing_keywords;
  const cleanedMissing = filterMissingKeywords(originalMissing, resumeMd);
  if (cleanedMissing.length < originalMissing.length) {
    const dropped = originalMissing.filter((k) => !cleanedMissing.includes(k));
    warnings.push(
      `missing_keywords filtered (implied by resume): ${dropped.join(", ")}`
    );
  }

  return {
    cleaned: {
      ...plan,
      bullet_plan: cleanedBulletPlan,
      skill_emphasis: cleanedEmphasis,
      missing_keywords: cleanedMissing,
    },
    warnings,
    qualityWarnings: [], // populated later by runQualityChecks
  };
}
