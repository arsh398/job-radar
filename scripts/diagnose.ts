import { runAllAdapters } from "../src/sources/index.ts";
import { applyFilters } from "../src/filters/index.ts";
import { parseYoe } from "../src/filters/yoe.ts";
import { matchLocation } from "../src/filters/location.ts";
import { matchTitle } from "../src/filters/title.ts";
import { decideAge } from "../src/filters/age.ts";

async function main() {
  const results = await runAllAdapters();
  const all = results.flatMap((r) => r.jobs);

  // Filter for jobs that would survive age+title+location, then inspect YOE parse
  const candidates = all.filter((j) => {
    if (!decideAge(j.postedAt).pass) return false;
    const loc = matchLocation(j.location);
    if (loc === "no_match") return false;
    const t = matchTitle(j.title);
    if (!t.pass) return false;
    return true;
  });

  console.log(`\n=== ${candidates.length} candidates survive age+loc+title ===\n`);

  // YOE parse breakdown
  let unknown = 0;
  let match = 0;
  let reject = 0;
  const unknownSamples: Array<{ company: string; title: string; snippet: string }> = [];

  for (const j of candidates) {
    const p = parseYoe(j.description);
    if (p.unknown) {
      unknown++;
      // Scan description for YOE-looking text
      const snip = findYoeLikeSnippet(j.description);
      if (snip) unknownSamples.push({ company: j.company, title: j.title, snippet: snip });
    } else if (p.min !== null && p.min > 2) reject++;
    else match++;
  }

  console.log(`YOE parse: match=${match}, reject=${reject}, unknown=${unknown}`);
  console.log(`\n=== UNKNOWN samples (where YOE-like text WAS in description) ===`);
  for (const s of unknownSamples.slice(0, 25)) {
    console.log(`[${s.company}] ${s.title}`);
    console.log(`  >> ${s.snippet}`);
  }

  // Location drop samples — what locations are we rejecting?
  const locDropped = all.filter((j) => matchLocation(j.location) === "no_match");
  const locCounts = new Map<string, number>();
  for (const j of locDropped) {
    const k = j.location.trim();
    locCounts.set(k, (locCounts.get(k) ?? 0) + 1);
  }
  const topLocs = [...locCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log(`\n=== Top 20 dropped locations (out of ${locDropped.length}) ===`);
  for (const [loc, n] of topLocs) console.log(`  ${n}\t${loc}`);
}

function findYoeLikeSnippet(text: string): string | null {
  if (!text) return null;
  // Look for any year/YOE mention
  const re = /([^.!?\n]{0,80}\b(?:\d+\s*\+?\s*(?:years?|yrs?|yoe)|yoe|years? of experience|experience\s*:?\s*\d)[^.!?\n]{0,80})/i;
  const m = re.exec(text);
  return m ? m[1]!.replace(/\s+/g, " ").trim() : null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
