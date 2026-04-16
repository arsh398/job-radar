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

const INDIA_ELIGIBLE_GLOBAL_PATTERNS = [
  /\b(global|worldwide|anywhere)\b/i,
  /\bapac\b/i,
  /\basia[- ]?pacific\b/i,
  /\basia(?!-pacific)\b/i,
];

const EXCLUSIVE_NON_INDIA_REGIONS = [
  /\bamericas?\b/i,
  /\bcanada\b/i,
  /\b(us|usa|united\s+states|u\.s\.|u\.s\.a\.)\b/i,
  /\b(uk|united\s+kingdom|britain|scotland|wales)\b/i,
  /\b(eu|europe|european|eea)\b/i,
  /\bemea\b/i,
  /\blatam\b/i,
  /\bmexico\b/i,
  /\bbrazil\b/i,
  /\baustralia\b/i,
  /\bnew\s+zealand\b/i,
  /\b(japan|korea|south\s+korea|singapore|philippines|thailand|vietnam|indonesia|malaysia|taiwan|hong\s+kong|china)\b/i,
  /\b(ireland|estonia|germany|france|netherlands|poland|spain|italy|portugal|sweden|denmark|finland|norway|switzerland|austria|belgium|czech|romania|hungary|greece|turkey|ukraine|lithuania|latvia|bulgaria|serbia|croatia|slovenia|slovakia)\b/i,
  /\b(argentina|chile|colombia|peru|venezuela|uruguay|ecuador)\b/i,
  /\b(south\s+africa|nigeria|egypt|kenya|morocco)\b/i,
  /\b(uae|u\.a\.e\.|saudi\s+arabia|israel|qatar|dubai)\b/i,
];

const REMOTE_RE = /\bremote\b/i;

export type LocationMatch = "india" | "global_remote" | "no_match";

export function matchLocation(location: string): LocationMatch {
  if (!location) return "no_match";

  if (INDIA_PATTERNS.some((p) => p.test(location))) return "india";

  if (INDIA_ELIGIBLE_GLOBAL_PATTERNS.some((p) => p.test(location))) {
    return "global_remote";
  }

  if (EXCLUSIVE_NON_INDIA_REGIONS.some((p) => p.test(location))) {
    return "no_match";
  }

  if (REMOTE_RE.test(location)) return "global_remote";

  return "no_match";
}
