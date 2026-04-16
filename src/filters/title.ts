import type { Track } from "../types.ts";

const SDE_RE =
  /\b(sde|swe|software\s+(dev|engineer)|backend(?:\s+eng)?|front[- ]?end(?:\s+eng)?|full[- ]?stack|application\s+eng|product\s+eng|infrastructure\s+eng|platform\s+eng|systems\s+eng|devops|sre|site\s+reliability|data\s+engineer|developer)\b/i;

const AI_RE =
  /\b(ml\s+eng|ai\s+eng|machine\s+learning|applied\s+scientist|research\s+eng|mle|deep\s+learning|data\s+scientist|nlp\s+eng|computer\s+vision|gen\s*ai|llm\s+eng|ai\s+research|genai)\b/i;

const EXCLUDE_RE =
  /\b(staff|principal|senior\s+staff|distinguished|fellow|architect|vp|director|head\s+of|manager|engineering\s+manager|cto|product\s+manager|program\s+manager|technical\s+lead|research\s+scientist)\b/i;

const LEAD_SE_RE = /\blead\s+(software|backend|frontend|platform|data|ml|ai)\b/i;

export type TitleMatch =
  | { pass: true; track: Track }
  | { pass: false; reason: string };

export function matchTitle(title: string): TitleMatch {
  if (!title) return { pass: false, reason: "empty title" };
  const excluded = EXCLUDE_RE.test(title) && !LEAD_SE_RE.test(title);
  if (excluded) {
    return { pass: false, reason: `excluded seniority: ${title}` };
  }
  const isAi = AI_RE.test(title);
  const isSde = SDE_RE.test(title);
  if (isAi) return { pass: true, track: "ai" };
  if (isSde) return { pass: true, track: "sde" };
  return { pass: false, reason: `no track match: ${title}` };
}
