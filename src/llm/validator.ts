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

export function validateTailoring(
  response: TailoringResponse,
  resumeMd: string
): ValidationResult {
  const warnings: string[] = [];
  const resume = resumeMd.toLowerCase();

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
          `Bullet has invented numbers [${inventedNumbers.join(", ")}] in ${exp.role}`
        );
      }
      cleanedBullets.push(bullet);
    }
    return { role: exp.role, bullets: cleanedBullets };
  });

  const cleaned: TailoringResponse = {
    ...response,
    resume_edits: {
      ...response.resume_edits,
      skills: filteredSkills.join(", "),
      experience: cleanedExperience,
    },
  };

  return { cleaned, warnings };
}

function isGenericNumber(n: string): boolean {
  const val = parseFloat(n);
  if (!Number.isFinite(val)) return true;
  const generic = new Set([
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "100",
    "1000",
    "2",
    "3",
  ]);
  return generic.has(n);
}
