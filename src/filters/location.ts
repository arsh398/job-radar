// Strict India + truly-global-remote-eligible.
// "Remote" alone is NOT enough — it must be paired with India, or with a
// genuinely global term (global, worldwide, anywhere, apac with India context).
// Hybrid locations like "San Francisco | Remote" or "Remote, US" are dropped.

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

// Truly-global terms that imply India is eligible.
const TRULY_GLOBAL_PATTERNS = [
  /\b(global(?!\s+remote)|worldwide|anywhere)\b/i,
  /\bremote\s*[-:,]?\s*(global|worldwide|anywhere|world)\b/i,
];

// APAC alone is risky — many "APAC" roles are actually Singapore/Japan/Australia
// only. Require explicit India mention to accept APAC.
const APAC_INDIA_PATTERNS = [
  /\bapac\s+including\s+india\b/i,
  /\bremote\s*[-:,]?\s*apac\s*\(india/i,
  /\bremote\s*[-:,]?\s*india\s+\/\s+apac\b/i,
];

export type LocationMatch = "india" | "global_remote" | "no_match";

export function matchLocation(location: string): LocationMatch {
  if (!location) return "no_match";
  const text = location.trim();

  // Split multi-location strings on common separators and check each piece.
  const parts = text.split(/\s*[|;]\s*|\s*\/\s+/);

  // If ANY part is India-explicit, accept as india.
  for (const part of parts) {
    if (INDIA_PATTERNS.some((p) => p.test(part))) return "india";
  }

  // Else check for truly global eligibility (any part).
  for (const part of parts) {
    if (TRULY_GLOBAL_PATTERNS.some((p) => p.test(part))) return "global_remote";
    if (APAC_INDIA_PATTERNS.some((p) => p.test(part))) return "global_remote";
  }

  return "no_match";
}
