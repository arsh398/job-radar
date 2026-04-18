// Location match — three-tier:
//   - "india"              : explicit India city/word → accept (highest confidence)
//   - "global_remote"      : worldwide/global/anywhere terms → accept (high)
//   - "remote_unqualified" : "Remote" alone, no disqualifying region → accept
//                            with the caveat that LLM may later mark skip if
//                            the JD itself demands US/EU work authorization
//   - "no_match"           : explicit region-only (US-only, EMEA, etc) → drop
//
// Rationale: the previous strict rule ("Remote must be paired with India or
// 'global'") killed 60–70% of genuinely India-eligible remote roles. Most
// startups list "Remote" without specifying region. We now accept unqualified
// remote and let the LLM reality-check work-authorization requirements.

const INDIA_PATTERNS = [
  /\bindia\b/i,
  /\bbangalore\b/i,
  /\bbengaluru\b/i,
  /\bhyderabad\b/i,
  /\bpune\b/i,
  /\bmumbai\b/i,
  /\b(new\s+)?delhi\b/i,
  /\bgurgaon\b/i,
  /\bgurugram\b/i,
  /\bchennai\b/i,
  /\bnoida\b/i,
  /\bkolkata\b/i,
  /\bahmedabad\b/i,
  /\bjaipur\b/i,
  /\bkochi\b/i,
  /\b(trivandrum|thiruvananthapuram)\b/i,
];

const TRULY_GLOBAL_PATTERNS = [
  /\b(worldwide|anywhere)\b/i,
  /\bglobal(?!\s*[-,]?\s*(us|usa|emea|europe|apac))\b/i,
  /\bremote\s*[-:,]?\s*(global|worldwide|anywhere|world)\b/i,
];

const APAC_INDIA_PATTERNS = [
  /\bapac\s+including\s+india\b/i,
  /\bremote\s*[-:,]?\s*apac\s*\(india/i,
  /\bremote\s*[-:,]?\s*india\s+\/\s+apac\b/i,
];

// Region-locked remotes we must drop. Detects things like:
//   "Remote - United States", "Remote (US)", "US Remote", "Remote, EMEA",
//   "Remote - Europe", "Remote, Canada", "US only", "Canada only",
//   "must be authorized to work in the US", "U.S. based".
const REGION_ONLY_REMOTE_RE = new RegExp(
  [
    // "Remote - X" / "Remote (X)" / "Remote, X" / "Remote X"
    `\\bremote\\s*[-(,:]?\\s*(us|u\\.s\\.|usa|united\\s+states|canada|americas?|emea|europe|eu|uk|united\\s+kingdom|latam|latin\\s+america|germany|france|brazil|mexico)\\b`,
    // "X Remote" (US/EMEA/etc prefix)
    `\\b(us|u\\.s\\.|usa|canada|emea|europe|eu|uk|latam)\\s+remote\\b`,
    // "X only" / "X-only" / "X based"
    `\\b(us|usa|united\\s+states|canada|uk|united\\s+kingdom|australia|europe|emea|americas?|latam)\\s*[-,]?\\s*(only|based|region)\\b`,
    // "(US)" / "(US/Canada)" short tags
    `\\((?:us|usa|uk|canada|emea|europe|americas?)(?:\\s*\\/\\s*(?:canada|usa|uk))?\\s*\\)`,
    // Work authorization giveaways
    `\\bmust\\s+be\\s+authoriz(?:ed|able)\\s+to\\s+work\\s+in\\s+the\\s+(us|united\\s+states|eu|uk|canada)\\b`,
    `\\beligib(?:le|ility)\\s+to\\s+work\\s+in\\s+the\\s+(us|united\\s+states|eu|uk|canada)\\b`,
  ].join("|"),
  "i"
);

const REMOTE_RE = /\bremote\b/i;

export type LocationMatch = "india" | "global_remote" | "remote_unqualified" | "no_match";

export function matchLocation(location: string): LocationMatch {
  if (!location) return "no_match";
  const text = location.trim();
  const parts = text.split(/\s*[|;]\s*|\s*\/\s+/);

  // 1. India-explicit in any part → highest-confidence accept.
  for (const part of parts) {
    if (INDIA_PATTERNS.some((p) => p.test(part))) return "india";
  }

  // 2. Truly-global (any part) → accept as global remote.
  for (const part of parts) {
    if (TRULY_GLOBAL_PATTERNS.some((p) => p.test(part))) return "global_remote";
    if (APAC_INDIA_PATTERNS.some((p) => p.test(part))) return "global_remote";
  }

  // 3. Explicit region-only remote (US-only, EMEA, etc) → drop. Checked
  //    BEFORE unqualified-remote so we don't accept "Remote - US".
  if (REGION_ONLY_REMOTE_RE.test(text)) return "no_match";

  // 4. Plain "Remote" without a disqualifying region → accept with caveat.
  //    LLM pass may still mark skip if JD body demands local auth.
  if (REMOTE_RE.test(text)) return "remote_unqualified";

  return "no_match";
}
