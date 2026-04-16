export type YoeParse = {
  min: number | null;
  max: number | null;
  unknown: boolean;
};

const INTERN_RE =
  /\b(intern|internship|co-op|summer\s+intern|spring\s+intern|winter\s+intern)\b/i;

const NEW_GRAD_RE =
  /\b(new\s*grad|new\s*graduate|entry\s*level|no\s+experience\s+required|fresher|freshers|fresh\s+graduate|freshly\s+graduated|0\s*years?\s*of?\s*experience)\b/i;

// Unit fragment: years | year | yrs | yr | yoe (word-bounded). Order matters
// so longer forms match first.
const UNIT = "(?:years?|yrs?|yoe)";

const RANGES: Array<{ re: RegExp; extract: (m: RegExpExecArray) => YoeParse }> = [
  // "2-5 years", "2 - 5 yrs", "2 to 5 years", "0–3 yoe"
  {
    re: new RegExp(`(\\d+)\\s*(?:-|–|to)\\s*(\\d+)\\s*\\+?\\s*${UNIT}\\b`, "i"),
    extract: (m) => ({ min: +m[1]!, max: +m[2]!, unknown: false }),
  },
  // "at least 3 years", "minimum of 3 yrs", "min 3 YOE"
  {
    re: new RegExp(
      `\\b(?:at\\s+least|minimum(?:\\s+of)?|min\\.?)\\s*(\\d+)\\s*\\+?\\s*${UNIT}\\b`,
      "i"
    ),
    extract: (m) => ({ min: +m[1]!, max: null, unknown: false }),
  },
  // "3+ years", "3 + yrs", "3+ YOE"
  {
    re: new RegExp(`(\\d+)\\s*\\+\\s*${UNIT}\\b`, "i"),
    extract: (m) => ({ min: +m[1]!, max: null, unknown: false }),
  },
  // "3 years of experience", "3 yrs of professional", "3 YOE of software"
  {
    re: new RegExp(
      `\\b(\\d+)\\s*${UNIT}\\s+of\\s+(?:experience|professional|relevant|hands[- ]on|industry)\\b`,
      "i"
    ),
    extract: (m) => ({ min: +m[1]!, max: null, unknown: false }),
  },
  // "3 years experience", "3 yrs professional experience" (no "of")
  {
    re: new RegExp(
      `\\b(\\d+)\\s*${UNIT}\\s+(?:of\\s+)?(?:\\w+\\s+){0,3}?experience\\b`,
      "i"
    ),
    extract: (m) => ({ min: +m[1]!, max: null, unknown: false }),
  },
  // "experience: 3+ years", "experience of 3 years"
  {
    re: new RegExp(
      `\\bexperience\\s*(?::|of)\\s*(\\d+)\\s*\\+?\\s*${UNIT}\\b`,
      "i"
    ),
    extract: (m) => ({ min: +m[1]!, max: null, unknown: false }),
  },
];

// Run every matcher across the whole text and keep the MOST GENEROUS (lowest
// min) finding. JDs often mention multiple numbers — "6-12 years of eng" next
// to "1+ years of Python" — and we want to accept the lower bar.
export function parseYoe(text: string): YoeParse {
  if (!text) return { min: null, max: null, unknown: true };
  if (NEW_GRAD_RE.test(text)) {
    return { min: 0, max: 1, unknown: false };
  }

  const findings: YoeParse[] = [];
  for (const { re, extract } of RANGES) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
      findings.push(extract(m));
      if (m.index === global.lastIndex) global.lastIndex++;
    }
  }
  if (findings.length === 0) {
    return { min: null, max: null, unknown: true };
  }
  // Lowest min wins; keep the matching max.
  findings.sort((a, b) => (a.min ?? Infinity) - (b.min ?? Infinity));
  return findings[0]!;
}

export type YoeDecision =
  | { pass: true; reason: "match" | "unknown_pass" }
  | { pass: false; reason: string };

export function decideYoe(text: string, yoeCeiling = 2): YoeDecision {
  if (INTERN_RE.test(text)) {
    return { pass: false, reason: "intern/coop role" };
  }
  const parsed = parseYoe(text);
  if (parsed.unknown) {
    return { pass: true, reason: "unknown_pass" };
  }
  if (parsed.min !== null && parsed.min > yoeCeiling) {
    return { pass: false, reason: `min YOE ${parsed.min} > ${yoeCeiling}` };
  }
  return { pass: true, reason: "match" };
}
