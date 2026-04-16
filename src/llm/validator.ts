import type { ParsedResume } from "../resume/parser.ts";
import { allBulletIds } from "../resume/parser.ts";
import type { TailoringPlan } from "../types.ts";

export type PlanValidationResult = {
  cleaned: TailoringPlan;
  warnings: string[];
};

// Lightweight plan-shape validation: drop actions that reference unknown IDs,
// and strip skill_emphasis entries that aren't actually in the resume. The
// heavy token-level validation lives in resume/apply.ts (where we also have
// access to the JD vocabulary).
export function validatePlan(
  plan: TailoringPlan,
  resume: ParsedResume
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

  const knownSkills = new Set<string>();
  for (const c of resume.skills) {
    for (const item of c.items) knownSkills.add(item.toLowerCase());
  }
  const cleanedEmphasis = plan.skill_emphasis.filter((s) => {
    if (!knownSkills.has(s.trim().toLowerCase())) {
      warnings.push(`skill_emphasis dropped unknown skill: ${s}`);
      return false;
    }
    return true;
  });

  return {
    cleaned: {
      ...plan,
      bullet_plan: cleanedBulletPlan,
      skill_emphasis: cleanedEmphasis,
    },
    warnings,
  };
}
