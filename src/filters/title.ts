import type { Track } from "../types.ts";

// Match "Engineer", "engineer", "Eng", "eng", "Developer", "Dev"
const ENG = "(?:eng(?:ineer)?|developer|dev)";

// SDE-track titles. Each branch ends at a word boundary.
const SDE_RE = new RegExp(
  [
    `\\bsde(?:[\\s-]*\\d+)?\\b`,
    `\\bswe\\b`,
    `\\bsoftware\\s+${ENG}\\b`,
    `\\bbackend(?:\\s+${ENG})?\\b`,
    `\\bfront[- ]?end(?:\\s+${ENG})?\\b`,
    `\\bfull[- ]?stack(?:\\s+${ENG})?\\b`,
    `\\bapplication\\s+${ENG}\\b`,
    `\\bproduct\\s+${ENG}\\b`,
    `\\binfrastructure\\s+${ENG}\\b`,
    `\\bplatform\\s+${ENG}\\b`,
    `\\bsystems\\s+${ENG}\\b`,
    `\\bdevops(?:\\s+${ENG})?\\b`,
    `\\bsre\\b`,
    `\\bsite\\s+reliability(?:\\s+${ENG})?\\b`,
    `\\bdata\\s+${ENG}\\b`,
    `\\bcloud\\s+${ENG}\\b`,
    `\\bdeveloper\\b`,
  ].join("|"),
  "i"
);

// AI/ML-track titles.
const AI_RE = new RegExp(
  [
    `\\bml(?:\\s+${ENG})?\\b`,
    `\\bai(?:\\s+${ENG})?\\b`,
    `\\bmachine\\s+learning(?:\\s+${ENG})?\\b`,
    `\\bapplied\\s+scientist\\b`,
    `\\bresearch\\s+${ENG}\\b`,
    `\\bmle\\b`,
    `\\bdeep\\s+learning(?:\\s+${ENG})?\\b`,
    `\\bdata\\s+scientist\\b`,
    `\\bnlp(?:\\s+${ENG})?\\b`,
    `\\bcomputer\\s+vision\\b`,
    `\\bgen\\s*ai(?:\\s+${ENG})?\\b`,
    `\\bllm(?:\\s+${ENG})?\\b`,
    `\\bai\\s+research\\b`,
    `\\bgenai(?:\\s+${ENG})?\\b`,
  ].join("|"),
  "i"
);

// Drop these regardless — too senior or wrong function.
const EXCLUDE_RE =
  /\b(staff|principal|senior\s+staff|distinguished|fellow|architect|vp|director|head\s+of|manager|engineering\s+manager|cto|product\s+manager|program\s+manager|technical\s+lead|tech\s+lead|research\s+scientist|recruiter|designer)\b/i;

// "Lead Software Engineer" / "Lead Backend" etc. is allowed despite "Lead".
const LEAD_SE_RE =
  /\blead\s+(software|backend|frontend|full[- ]?stack|platform|data|ml|ai|infra)\b/i;

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
