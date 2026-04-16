import type { ParsedResume } from "../resume/parser.ts";
import { allBulletIds } from "../resume/parser.ts";
import type { TailoringPlan } from "../types.ts";
import { filterMissingKeywords } from "../filters/ats_match.ts";

export type PlanValidationResult = {
  cleaned: TailoringPlan;
  warnings: string[];
};

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
  };
}
