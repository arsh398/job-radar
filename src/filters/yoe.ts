export type YoeParse = {
  min: number | null;
  max: number | null;
  unknown: boolean;
};

const INTERN_RE =
  /\b(intern|internship|co-op|summer\s+intern|spring\s+intern|winter\s+intern)\b/i;

const NEW_GRAD_RE =
  /\b(new\s*grad|new\s*graduate|entry\s*level|no\s+experience\s+required|0\s*years\s*of\s*experience)\b/i;

const RANGES: Array<{ re: RegExp; extract: (m: RegExpExecArray) => YoeParse }> = [
  {
    re: /(\d+)\s*[-–to]+\s*(\d+)\s*(?:\+)?\s*years?\b/i,
    extract: (m) => ({ min: +m[1]!, max: +m[2]!, unknown: false }),
  },
  {
    re: /\b(?:at\s+least|minimum(?:\s+of)?|min\.?)\s*(\d+)\s*\+?\s*years?\b/i,
    extract: (m) => ({ min: +m[1]!, max: null, unknown: false }),
  },
  {
    re: /(\d+)\s*\+\s*years?\b/i,
    extract: (m) => ({ min: +m[1]!, max: null, unknown: false }),
  },
  {
    re: /\b(\d+)\s*years?\s+of\s+(?:experience|professional)\b/i,
    extract: (m) => ({ min: +m[1]!, max: null, unknown: false }),
  },
];

export function parseYoe(text: string): YoeParse {
  if (!text) return { min: null, max: null, unknown: true };
  if (NEW_GRAD_RE.test(text)) {
    return { min: 0, max: 1, unknown: false };
  }
  for (const { re, extract } of RANGES) {
    const m = re.exec(text);
    if (m) return extract(m);
  }
  return { min: null, max: null, unknown: true };
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
