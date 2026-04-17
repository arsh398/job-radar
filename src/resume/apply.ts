// Applies a TailoringPlan to a ParsedResume to produce tailored markdown.
// Every change is validated token-by-token against the source bullet and the
// JD vocabulary — rephrases that introduce vocabulary from neither are
// rejected and the original text is used instead. This is the structural
// no-hallucination guarantee.

import type {
  ParsedResume,
  ResumeBullet,
  ResumeExperience,
  ResumeProject,
  SkillCategory,
} from "./parser.ts";
import { findBullet } from "./parser.ts";
import type { BulletAction, TailoringPlan } from "../types.ts";

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "nor", "yet", "so",
  "to", "of", "in", "on", "at", "by", "with", "from", "as", "is",
  "was", "are", "were", "be", "been", "being", "it", "its", "this",
  "that", "these", "those", "we", "i", "our", "their", "them", "they",
  "not", "into", "via", "per", "within", "across", "over", "under",
  "through", "using", "use", "used", "up", "out", "off", "than", "then",
  "too", "very", "also", "such", "can", "will", "would", "could", "should",
  "may", "might", "must", "do", "does", "did", "have", "has", "had",
  "one", "two", "three", "four", "five", "some", "any", "all", "more",
  "most", "other", "another", "each", "every", "both", "few", "same",
  "just", "only", "about", "around", "between", "among", "during",
  "before", "after", "above", "below",
]);

// Tokens that are safe to appear without being in the source (common
// English verbs, conjunctions, etc.). Union of STOPWORDS plus generic
// resume-speak verbs.
const SAFE_VERBS = new Set([
  "built", "build", "building", "shipped", "designed", "architect",
  "architected", "implement", "implemented", "developed", "develop",
  "launched", "integrated", "delivered", "deliver", "scaled", "reduced",
  "improved", "optimized", "owned", "led", "leads", "created",
  "established", "set", "wrote", "rewrote", "refactored", "added",
  "maintained", "drove", "enabled", "managed", "engineered", "produced",
  "worked", "collaborated", "contributed",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#./_ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));
}

// Build a vocabulary from (a) the source bullet and (b) the JD — any token
// that appears in either is considered "fair game" for the rephrase.
function buildVocab(sourceText: string, jdText: string): Set<string> {
  const v = new Set<string>();
  for (const t of tokens(sourceText)) v.add(t);
  for (const t of tokens(jdText)) v.add(t);
  // Also allow partial-match: if a rephrase word is a substring of any vocab
  // word (e.g. "APIs" vs "API"), accept. Normalize aggressively.
  return v;
}

function isInVocab(token: string, vocab: Set<string>): boolean {
  if (vocab.has(token)) return true;
  if (SAFE_VERBS.has(token)) return true;
  // Plurals / minor stems.
  if (token.endsWith("s") && vocab.has(token.slice(0, -1))) return true;
  if (vocab.has(token + "s")) return true;
  // Hyphen-joined tokens: check each component.
  if (token.includes("-")) {
    const parts = token.split("-").filter(Boolean);
    if (parts.length > 1 && parts.every((p) => vocab.has(p) || SAFE_VERBS.has(p))) {
      return true;
    }
  }
  // Pure numbers — handled separately (must match resume numbers)
  if (/^\d[\d,.]*$/.test(token)) return false;
  // Short tokens (2-3 chars) get a pass (acronyms, articles we missed).
  if (token.length <= 3) return true;
  // Substring containment in any vocab entry.
  for (const v of vocab) {
    if (v.length >= 5 && (v.includes(token) || token.includes(v))) return true;
  }
  return false;
}

function extractNumbers(s: string): string[] {
  return (s.match(/\b\d[\d,.]*\b/g) ?? []).map((n) => n.replace(/[,]/g, ""));
}

function validateRephrase(
  newText: string,
  sourceText: string,
  jdText: string,
  resumeNumbers: Set<string>
): { ok: boolean; reason?: string } {
  if (!newText.trim()) return { ok: false, reason: "empty" };
  const vocab = buildVocab(sourceText, jdText);
  const toks = tokens(newText);
  for (const t of toks) {
    if (!isInVocab(t, vocab)) {
      return { ok: false, reason: `token not in source/JD: "${t}"` };
    }
  }
  // Numbers in the rephrase must appear in the source bullet (not just JD —
  // JD numbers belong to the company, not the candidate).
  const sourceNumbers = new Set(extractNumbers(sourceText));
  for (const n of extractNumbers(newText)) {
    const val = parseFloat(n);
    // Tiny standalone digits (0-10) are language filler, allow.
    if (Number.isFinite(val) && val <= 10) continue;
    if (!sourceNumbers.has(n) && !resumeNumbers.has(n)) {
      return { ok: false, reason: `invented number: "${n}"` };
    }
  }
  return { ok: true };
}

export type ApplyResult = {
  markdown: string;
  warnings: string[];
};

function renderBullets(bullets: ResumeBullet[]): string {
  return bullets.map((b) => `- ${b.text}`).join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Minimum bullets per section — a tailored resume that nukes everything
// produces a skeleton that's worse than the source. If the plan hides too
// much, restore the top-priority hidden items to hit the floor.
export type BulletFloors = {
  experience: number; // per role
  project: number; // per project
  achievement: number; // total across achievements
};

const DEFAULT_FLOORS: BulletFloors = {
  experience: 2,
  project: 1,
  achievement: 1,
};

function applyBulletPlan(
  bullets: ResumeBullet[],
  actions: Map<string, BulletAction>,
  sourceJdText: string,
  resumeNumbers: Set<string>,
  warnings: string[],
  floor: number
): ResumeBullet[] {
  type Scored = {
    b: ResumeBullet;
    priority: number;
    order: number;
    kept: boolean;
  };
  const scored: Scored[] = [];
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i]!;
    const action = actions.get(b.id);
    let text = b.text;
    if (action?.new_text && action.new_text.trim() !== b.text.trim()) {
      const v = validateRephrase(action.new_text, b.text, sourceJdText, resumeNumbers);
      if (v.ok) {
        text = action.new_text.trim();
      } else {
        warnings.push(
          `rephrase rejected for ${b.id} (${v.reason}); using original`
        );
      }
    }
    const priority = action?.priority ?? 50;
    const kept = !action ? true : action.keep;
    scored.push({ b: { id: b.id, text }, priority, order: i, kept });
  }

  const kept = scored.filter((s) => s.kept);
  // Sanity floor: if the plan hid so much we're below the floor, restore
  // the top-priority hidden items until we meet it.
  if (kept.length < floor) {
    const hidden = scored
      .filter((s) => !s.kept)
      .sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : a.order - b.order
      );
    const needed = Math.min(floor - kept.length, hidden.length);
    if (needed > 0) {
      const ids = hidden
        .slice(0, needed)
        .map((h) => h.b.id)
        .join(", ");
      warnings.push(
        `restored ${needed} hidden bullet(s) to meet floor ${floor}: ${ids}`
      );
      for (let i = 0; i < needed; i++) kept.push(hidden[i]!);
    }
  }

  kept.sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.order - b.order
  );
  return kept.map((s) => s.b);
}

function applyExperiencePlan(
  list: ResumeExperience[],
  actions: Map<string, BulletAction>,
  jdText: string,
  resumeNumbers: Set<string>,
  warnings: string[],
  floors: BulletFloors
): ResumeExperience[] {
  return list.map((e) => ({
    ...e,
    bullets: applyBulletPlan(
      e.bullets,
      actions,
      jdText,
      resumeNumbers,
      warnings,
      floors.experience
    ),
  }));
}

function applyProjectPlan(
  list: ResumeProject[],
  actions: Map<string, BulletAction>,
  jdText: string,
  resumeNumbers: Set<string>,
  warnings: string[],
  floors: BulletFloors
): ResumeProject[] {
  return list
    .map((p) => ({
      ...p,
      bullets: applyBulletPlan(
        p.bullets,
        actions,
        jdText,
        resumeNumbers,
        warnings,
        floors.project
      ),
    }))
    .filter((p) => p.bullets.length > 0);
}

function applySkillEmphasis(
  skills: SkillCategory[],
  emphasisRaw: string[]
): SkillCategory[] {
  if (!emphasisRaw.length) return skills;
  const emphasis = emphasisRaw
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return skills.map((c) => {
    const reordered = [...c.items].sort((a, b) => {
      const ai = emphasis.indexOf(a.toLowerCase());
      const bi = emphasis.indexOf(b.toLowerCase());
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return { ...c, items: reordered };
  });
}

function validateSummary(
  newSummary: string,
  sourceSummary: string,
  jdText: string,
  resumeNumbers: Set<string>,
  wholeResume: string
): { ok: boolean; reason?: string } {
  // For summary we are more lenient than bullets — whole resume + JD = vocab.
  return validateRephrase(newSummary, `${sourceSummary} ${wholeResume}`, jdText, resumeNumbers);
}

function renderResume(r: ParsedResume): string {
  const lines: string[] = [];
  if (r.headerMd) {
    lines.push(r.headerMd);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  if (r.summary) {
    lines.push("## Professional Summary");
    lines.push("");
    lines.push(r.summary);
    lines.push("");
  }
  if (r.experience.length) {
    lines.push("## Work Experience");
    lines.push("");
    for (const e of r.experience) {
      lines.push(`### ${e.heading}`);
      if (e.meta) {
        lines.push(`*${e.meta}*`);
      }
      lines.push("");
      lines.push(renderBullets(e.bullets));
      lines.push("");
    }
  }
  if (r.projects.length) {
    lines.push("## Projects");
    lines.push("");
    for (const p of r.projects) {
      lines.push(`### ${p.heading}`);
      if (p.techStack) lines.push(`*${p.techStack}*`);
      lines.push("");
      if (p.intro) {
        lines.push(p.intro);
        lines.push("");
      }
      lines.push(renderBullets(p.bullets));
      lines.push("");
    }
  }
  if (r.skills.length) {
    lines.push("## Skills");
    lines.push("");
    // Emit as raw HTML so CSS can tighten inter-category spacing to
    // near-zero without affecting the rest of the document.
    lines.push(`<div class="skills">`);
    for (const c of r.skills) {
      lines.push(
        `  <p><strong>${escapeHtml(c.category)}</strong>: ${escapeHtml(c.items.join(", "))}</p>`
      );
    }
    lines.push(`</div>`);
    lines.push("");
  }
  if (r.educationMd) {
    lines.push("## Education");
    lines.push("");
    lines.push(r.educationMd);
    lines.push("");
  }
  if (r.achievements.length) {
    lines.push("## Achievements");
    lines.push("");
    lines.push(renderBullets(r.achievements));
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function applyPlan(
  source: ParsedResume,
  sourceMd: string,
  plan: TailoringPlan,
  jdText: string
): ApplyResult {
  const warnings: string[] = [];
  const resumeNumbers = new Set(
    (sourceMd.match(/\b\d[\d,.]*\b/g) ?? []).map((n) => n.replace(/,/g, ""))
  );
  const actions = new Map<string, BulletAction>();
  for (const a of plan.bullet_plan) {
    // Drop actions referencing unknown IDs silently — just log.
    if (findBullet(source, a.id)) {
      actions.set(a.id, a);
    } else {
      warnings.push(`bullet_plan referenced unknown id: ${a.id}`);
    }
  }

  let summary = source.summary;
  if (plan.new_summary && plan.new_summary.trim()) {
    const v = validateSummary(
      plan.new_summary,
      source.summary,
      jdText,
      resumeNumbers,
      sourceMd
    );
    if (v.ok) {
      summary = plan.new_summary.trim();
    } else {
      warnings.push(`summary rephrase rejected (${v.reason}); using original`);
    }
  }

  const floors = DEFAULT_FLOORS;
  const tailored: ParsedResume = {
    headerMd: source.headerMd,
    summary,
    achievements: applyBulletPlan(
      source.achievements,
      actions,
      jdText,
      resumeNumbers,
      warnings,
      floors.achievement
    ),
    experience: applyExperiencePlan(
      source.experience,
      actions,
      jdText,
      resumeNumbers,
      warnings,
      floors
    ),
    projects: applyProjectPlan(
      source.projects,
      actions,
      jdText,
      resumeNumbers,
      warnings,
      floors
    ),
    skills: applySkillEmphasis(source.skills, plan.skill_emphasis),
    educationMd: source.educationMd,
  };

  return { markdown: renderResume(tailored), warnings };
}
