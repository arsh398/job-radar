import type { TailoringResponse } from "../types.ts";

export type ValidationResult = {
  cleaned: TailoringResponse;
  warnings: string[];
};

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function extractNumbers(s: string): string[] {
  return (s.match(/\b\d[\d,.]*\b/g) ?? []).map((n) => n.replace(/[,]/g, ""));
}

function isGenericNumber(n: string): boolean {
  const val = parseFloat(n);
  if (!Number.isFinite(val)) return true;
  // Allow tiny standalone digits (1-10) since they're often part of language
  // ("3 sentences", "2 years"), not invented metrics.
  if (val >= 0 && val <= 10) return true;
  return false;
}

export function validateTailoring(
  response: TailoringResponse,
  resumeMd: string
): ValidationResult {
  const warnings: string[] = [];
  const resume = resumeMd.toLowerCase();

  // Strip skills not present in resume.
  const skillsStr = response.resume_edits.skills;
  const skillTokens = skillsStr
    .split(/[,|•·\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 80);

  const filteredSkills: string[] = [];
  for (const s of skillTokens) {
    if (containsCaseInsensitive(resume, s)) {
      filteredSkills.push(s);
    } else {
      warnings.push(`Skill not in resume, dropped: ${s}`);
    }
  }

  // Drop bullets that introduce numbers not present in the resume.
  const resumeNumbers = new Set(extractNumbers(resumeMd));
  const cleanedExperience = response.resume_edits.experience.map((exp) => {
    const cleanedBullets: string[] = [];
    for (const bullet of exp.bullets) {
      const bulletNumbers = extractNumbers(bullet);
      const inventedNumbers = bulletNumbers.filter(
        (n) => !resumeNumbers.has(n) && !isGenericNumber(n)
      );
      if (inventedNumbers.length > 0) {
        warnings.push(
          `Bullet dropped (invented numbers ${inventedNumbers.join(", ")}): ${bullet.slice(0, 80)}`
        );
        continue;
      }
      cleanedBullets.push(bullet);
    }
    return { role: exp.role, bullets: cleanedBullets };
  });

  // Drop projects with invented numbers in description.
  const cleanedProjects = response.resume_edits.projects.filter((p) => {
    const nums = extractNumbers(p.description);
    const invented = nums.filter(
      (n) => !resumeNumbers.has(n) && !isGenericNumber(n)
    );
    if (invented.length > 0) {
      warnings.push(
        `Project dropped (invented numbers ${invented.join(", ")}): ${p.name}`
      );
      return false;
    }
    return true;
  });

  const cleaned: TailoringResponse = {
    ...response,
    resume_edits: {
      ...response.resume_edits,
      skills: filteredSkills.join(", "),
      experience: cleanedExperience,
      projects: cleanedProjects,
    },
  };

  return { cleaned, warnings };
}
