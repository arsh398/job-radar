const DEFAULT_MAX_AGE_DAYS = 14;

export type AgeDecision = { pass: true } | { pass: false; reason: string };

export function decideAge(
  postedAt: string | undefined,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS
): AgeDecision {
  if (!postedAt) return { pass: true };
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return { pass: true };
  const ageMs = Date.now() - t;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > maxAgeDays) {
    return { pass: false, reason: `posted ${Math.floor(ageDays)}d ago > ${maxAgeDays}d max` };
  }
  return { pass: true };
}
