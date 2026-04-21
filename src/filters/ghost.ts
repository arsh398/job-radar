// Ghost-job detector — deterministic, no LLM.
//
// A "ghost job" is a posting that either never gets filled (the req was
// approved to satisfy headcount reporting but nobody's hiring), or has
// been reposted for so long that the hiring manager has long since moved
// on. Applying to ghost jobs wastes tailoring effort and apply budget.
//
// Signals used (all deterministic):
//   1. Age: posted > 60 days ago → likely stale.
//   2. Boilerplate ratio: fraction of JD that is generic corporate text
//      (benefits, EEO statement, "about us", "we offer"). High ratio =
//      the actual role content is minimal → hiring manager didn't write
//      this JD, it's a template.
//   3. Specificity floor: JD length vs. specific technical/responsibility
//      token count. Short JDs with no specifics = vague → often ghost.
//
// Returns a score and a set of reasons. Consumer decides the threshold.

import type { Job } from "../types.ts";

export type GhostSignal = {
  isGhost: boolean;
  score: number; // 0..1, higher = more ghost-like
  reasons: string[];
};

const BOILERPLATE_MARKERS = [
  "equal opportunity employer",
  "we are committed to diversity",
  "reasonable accommodation",
  "accommodations will be provided",
  "eeo",
  "affirmative action",
  "background check",
  "drug-free workplace",
  "at-will employment",
  "about us",
  "our culture",
  "our values",
  "we offer competitive",
  "comprehensive benefits",
  "401(k)",
  "paid time off",
  "health insurance",
  "generous vacation",
  "stock options",
  "flexible work arrangements",
  "work-life balance",
  "pay transparency",
  "salary range",
  "base salary",
  "total compensation",
];

// Specific-signal tokens — technical/role vocab. Counted to ensure the JD
// has concrete content, not just fluff.
const SPECIFICITY_TOKENS = /\b(python|javascript|typescript|java|go\b|golang|rust|c\+\+|swift|kotlin|ruby|scala|sql|postgresql|mysql|redis|kafka|rabbitmq|docker|kubernetes|terraform|aws|gcp|azure|react|vue|angular|next\.js|fastapi|express|django|flask|spring|grpc|graphql|rest|microservices|distributed|k8s|ci\/cd|pipeline|ml|llm|rag|embedding|transformer|pytorch|tensorflow|numpy|pandas|api|backend|frontend|infra|devops|observability|monitoring|logging|tracing|alerting|sre|dashboard|sla|slo|latency|throughput|concurrency|scaling)\b/gi;

function ageDays(postedAt: string | undefined): number | null {
  if (!postedAt) return null;
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

function countOccurrences(text: string, needles: string[]): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const m of needles) {
    let idx = 0;
    while ((idx = lower.indexOf(m, idx)) !== -1) {
      n++;
      idx += m.length;
    }
  }
  return n;
}

export function detectGhost(job: Job): GhostSignal {
  const reasons: string[] = [];
  let score = 0;

  // --- Signal 1: age ---
  const age = ageDays(job.postedAt);
  if (age !== null) {
    if (age > 60) {
      score += 0.35;
      reasons.push(`posted ${Math.round(age)}d ago`);
    } else if (age > 30) {
      score += 0.15;
    }
  }

  const jd = job.descriptionMd || job.description || "";
  const words = jd.split(/\s+/).filter(Boolean).length;

  // --- Signal 2: boilerplate ratio ---
  // JD < 200 words with 3+ boilerplate markers is almost certainly a
  // template/ghost. JD < 500 words with 5+ markers is suspicious.
  const boilerplateHits = countOccurrences(jd, BOILERPLATE_MARKERS);
  if (words > 0) {
    if (words < 250 && boilerplateHits >= 3) {
      score += 0.35;
      reasons.push(`${boilerplateHits} boilerplate markers in ${words}-word JD`);
    } else if (words < 600 && boilerplateHits >= 5) {
      score += 0.2;
      reasons.push(`${boilerplateHits} boilerplate markers`);
    }
  }

  // --- Signal 3: specificity floor ---
  // Count technical/role tokens. If JD is long but has <= 3 specific
  // tokens, the content is mostly fluff.
  const matches = jd.match(SPECIFICITY_TOKENS) || [];
  const specificTokens = new Set(matches.map((m) => m.toLowerCase())).size;
  if (words > 400 && specificTokens <= 3) {
    score += 0.25;
    reasons.push(
      `only ${specificTokens} specific tech/role tokens in ${words}-word JD`
    );
  } else if (words > 200 && specificTokens <= 1) {
    score += 0.25;
    reasons.push(`only ${specificTokens} specific tokens`);
  }

  // --- Signal 4: extremely short JD ---
  // Below 120 words, nobody could plausibly define a real role.
  if (words > 0 && words < 120) {
    score += 0.15;
    reasons.push(`JD is only ${words} words`);
  }

  // Clip
  score = Math.min(1, score);

  // Ghost threshold: 0.5 cumulative. Any single signal below threshold
  // is a "soft" flag that gets surfaced but doesn't block.
  return {
    isGhost: score >= 0.5,
    score,
    reasons,
  };
}
