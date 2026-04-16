import type { Track } from "../types.ts";

const ENG = "(?:eng(?:ineer)?|developer|dev)";

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

// Hard senior/role exclusions — drop regardless of context.
const SENIORITY_EXCLUDE_RE =
  /\b(staff|principal|senior\s+staff|distinguished|fellow|architect|vp|director|head\s+of|engineering\s+manager|cto|product\s+manager|program\s+manager|technical\s+lead|tech\s+lead|research\s+scientist|recruiter|designer|qa\s+(eng|tester|analyst))\b/i;

// Internal-IT-style roles — wrong career track for product engineers.
const NON_PRODUCT_EXCLUDE_RE =
  /\b(it\s+automation|it\s+operations|it\s+support|help\s*desk|business\s+analyst|sales\s+eng(?:ineer)?|solutions\s+eng(?:ineer)?|customer\s+(?:success|support)|deal\s+desk|operations\s+(?:associate|specialist|analyst|manager))\b/i;

// On-call / shift-based roles — different career path, often grueling.
const SHIFT_EXCLUDE_RE =
  /\b(shift\s+basis|on[- ]call\s+(?:rotation|shift)|24\s*x\s*7|24\/7|night\s+shift)\b/i;

// Region-only suffixes/tags in title that indicate this role is NOT India-eligible.
// EMEA / UKIE / LATAM in title is always a drop (India is not EMEA).
// For US / UK / Canada / Australia / Europe / Americas — only drop if suffixed with
// "only" / "region" / "based" or bracketed.
const REGION_ONLY_EXCLUDE_RE = new RegExp(
  [
    `\\b(emea|ukie|latam|latin\\s+america)\\b`,
    `\\b(us|usa|uk|canada|australia|europe|americas?)\\s*[-/]?\\s*(only|focus(?:ed)?|region|based)\\b`,
    `\\((?:us|usa|uk|canada|australia|europe|americas|emea)\\s*\\/?\\s*only?\\)`,
  ].join("|"),
  "i"
);

// "Manager" alone usually means people manager. Allow only "X Manager" where X is
// clearly a non-management technical scope (e.g. "Technical Account Manager" = sales,
// already excluded by NON_PRODUCT). Just dropping bare "Manager" word.
const MANAGER_EXCLUDE_RE = /\bmanager\b/i;

// "Lead" is allowed only when followed by an engineering domain word.
const LEAD_OK_RE =
  /\blead\s+(software|backend|frontend|full[- ]?stack|platform|data|ml|ai|infra(?:structure)?|systems?|cloud)\b/i;
const LEAD_RE = /\blead\b/i;

// "Senior" with no explicit YOE in title is a problem at GitLab/Atlassian where
// Senior = 5+ YOE. We KEEP "Senior" titles in the title filter (no auto-exclude),
// but YOE check on description body catches it. The LLM will mark
// underqualified if YOE > 2 — handled downstream.

export type TitleMatch =
  | { pass: true; track: Track }
  | { pass: false; reason: string };

export function matchTitle(title: string): TitleMatch {
  if (!title) return { pass: false, reason: "empty title" };

  if (SENIORITY_EXCLUDE_RE.test(title)) {
    return { pass: false, reason: `excluded seniority: ${title}` };
  }
  if (NON_PRODUCT_EXCLUDE_RE.test(title)) {
    return { pass: false, reason: `non-product role: ${title}` };
  }
  if (SHIFT_EXCLUDE_RE.test(title)) {
    return { pass: false, reason: `shift/on-call role: ${title}` };
  }
  if (REGION_ONLY_EXCLUDE_RE.test(title)) {
    return { pass: false, reason: `region-only suffix: ${title}` };
  }
  if (MANAGER_EXCLUDE_RE.test(title)) {
    return { pass: false, reason: `manager role: ${title}` };
  }
  if (LEAD_RE.test(title) && !LEAD_OK_RE.test(title)) {
    return { pass: false, reason: `non-eng Lead role: ${title}` };
  }

  const isAi = AI_RE.test(title);
  const isSde = SDE_RE.test(title);
  if (isAi) return { pass: true, track: "ai" };
  if (isSde) return { pass: true, track: "sde" };
  return { pass: false, reason: `no track match: ${title}` };
}
