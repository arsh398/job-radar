// Maps JobAlert → Notion page (properties + body blocks).
//
// Two layers:
//   - PROPERTIES: only the at-a-glance triage fields. These are the
//     columns in the table view — Mohammed sorts/filters here.
//   - PAGE BODY: everything else as formatted blocks. Click into a row
//     and the cover note, referral draft, missing keywords, and job
//     metadata are all laid out cleanly, not crammed into skinny columns.

import type { JobAlert, PdfAttachment } from "../types.ts";

type AnyProp = Record<string, unknown>;
type AnyBlock = Record<string, unknown>;

// ---------- property builders ----------

function title(text: string): AnyProp {
  return { title: [{ text: { content: text.slice(0, 200) } }] };
}
function richText(text: string | undefined): AnyProp {
  const s = (text ?? "").trim();
  if (!s) return { rich_text: [] };
  return { rich_text: [{ text: { content: s.slice(0, 2000) } }] };
}
function select(name: string | undefined): AnyProp {
  if (!name) return { select: null };
  return { select: { name: name.slice(0, 100) } };
}
function number(n: number | undefined): AnyProp {
  return { number: Number.isFinite(n) ? Number(n) : null };
}
function date(iso: string | undefined): AnyProp {
  if (!iso) return { date: null };
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { date: null };
  return { date: { start: d.toISOString() } };
}
function url(u: string | undefined): AnyProp {
  if (!u) return { url: null };
  return { url: u };
}
function fileUploads(
  files: Array<{ uploadId: string; name: string }>
): AnyProp {
  return {
    files: files.map((f) => ({
      name: f.name.slice(0, 100),
      type: "file_upload",
      file_upload: { id: f.uploadId },
    })),
  };
}

// ---------- block builders ----------

function headingBlock(text: string): AnyBlock {
  return {
    object: "block",
    heading_2: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}
function paragraphBlock(text: string): AnyBlock {
  return {
    object: "block",
    paragraph: {
      rich_text: [
        { type: "text", text: { content: text.slice(0, 2000) } },
      ],
    },
  };
}
function calloutBlock(text: string, emoji: string): AnyBlock {
  return {
    object: "block",
    callout: {
      icon: { type: "emoji", emoji },
      rich_text: [
        { type: "text", text: { content: text.slice(0, 2000) } },
      ],
    },
  };
}
function bulletedListBlock(text: string): AnyBlock {
  return {
    object: "block",
    bulleted_list_item: {
      rich_text: [
        { type: "text", text: { content: text.slice(0, 2000) } },
      ],
    },
  };
}
// A code block renders as monospaced in a copyable frame — perfect for
// cover notes and referral DMs Mohammed wants to copy verbatim.
function codeBlock(text: string, language = "plain text"): AnyBlock {
  return {
    object: "block",
    code: {
      language,
      rich_text: [
        { type: "text", text: { content: text.slice(0, 2000) } },
      ],
    },
  };
}

// ---------- helpers ----------

function yoeString(alert: JobAlert): string {
  const y = alert.job.parsedYoe;
  if (y.unknown) return "not stated";
  const min = y.min ?? "?";
  return y.max != null ? `${min}-${y.max} yrs` : `${min}+ yrs`;
}

function sourceOf(alert: JobAlert): string {
  return alert.job.source.split(":")[0] ?? alert.job.source;
}

// ---------- public API ----------

// Slim property set: only the triage signals that deserve a column, plus
// the bookmarklet-facing Prefill Data blob and observability properties
// for later A/B analysis.
//
// NOTE: these new properties must exist in the Notion DB. If you don't
// have them yet, add as follows (type shown):
//   - "Prefill Data"    rich_text   (bookmarklet reads this JSON)
//   - "Prompt Version"  select      (enum of prompt semantic versions)
//   - "Resume Variant"  select      (default / ai / backend / frontend)
//   - "Quality Warnings" rich_text  (recruiter-quality check results)
//   - "Applied At"      date        (stamped by extension on Mark Applied)
//   - "Response Type"   select      (None / Auto-reject / Human / Interview)
//   - "Response At"     date        (manually filled when you hear back)
// Missing properties are silently ignored by Notion on write (they just
// won't store), so the code is safe to deploy before the DB schema is
// updated.
export function buildProperties(
  alert: JobAlert,
  pdfUploads: Array<{ uploadId: string; attachment: PdfAttachment }>
): AnyProp {
  const verdict = alert.llm.ok ? alert.llm.data.verdict : "unknown";
  const qwSummary = alert.qualityWarnings?.length
    ? `${alert.qualityWarnings.length} warning(s): ${alert.qualityWarnings.slice(0, 3).join(" | ")}`
    : "";
  return {
    Name: title(`${alert.job.company} — ${alert.job.title}`),
    Status: select("New"),
    Fit: number(Math.round(alert.fit.overall * 100)),
    Verdict: select(verdict),
    Posted: date(alert.job.postedAt),
    Source: select(sourceOf(alert)),
    "JD URL": url(alert.job.url),
    Resume: fileUploads(
      pdfUploads.map((u) => ({
        uploadId: u.uploadId,
        name: u.attachment.filename,
      }))
    ),
    Key: richText(alert.job.key),
    // New observability + bookmarklet-support properties:
    "Prefill Data": richText(alert.prefillData),
    "Prompt Version": select(alert.promptVersion),
    "Resume Variant": select(alert.profileName),
    "Quality Warnings": richText(qwSummary),
  };
}

// Rich page body. Every detail Mohammed might want once he clicks in.
export function buildChildren(alert: JobAlert): AnyBlock[] {
  const blocks: AnyBlock[] = [];
  const plan = alert.llm.ok ? alert.llm.data : null;
  const verdict = plan ? plan.verdict : "unknown";
  const verdictEmoji: Record<string, string> = {
    apply: "🟢",
    apply_with_referral: "🟡",
    stretch: "🟠",
    skip: "🔴",
    unknown: "⚪",
  };
  const emoji = verdictEmoji[verdict] ?? "⚪";

  // Header callout with the most important at-a-glance info.
  const summaryLine = [
    `${verdict.toUpperCase()} · ${Math.round(alert.fit.overall * 100)}% fit`,
    `${Math.round(alert.atsMatch.score * 100)}% ATS`,
    yoeString(alert),
    alert.job.location || "location n/a",
  ].join(" · ");
  blocks.push(calloutBlock(summaryLine, emoji));

  if (plan?.verdict_reason) {
    blocks.push(paragraphBlock(plan.verdict_reason));
  }

  // Match details — things Mohammed would sort by if he needed them but
  // are too numerous for column view.
  blocks.push(headingBlock("Match Details"));
  const sem = Math.round(alert.fit.semantic * 100);
  const yoeFit = Math.round(alert.fit.yoe * 100);
  blocks.push(
    paragraphBlock(
      [
        `Company: ${alert.job.company}`,
        `Role: ${alert.job.title}`,
        `Track: ${alert.job.track}`,
        `Location: ${alert.job.location || "—"}`,
        `YOE: ${yoeString(alert)}`,
        `ATS: ${Math.round(alert.atsMatch.score * 100)}% · Semantic: ${sem}% · YOE fit: ${yoeFit}%`,
        `Source: ${sourceOf(alert)}`,
      ].join(" · ")
    )
  );

  // Missing keywords — shown as bullets so Mohammed can scan quickly.
  const missing = plan?.missing_keywords ?? alert.atsMatch.missing.slice(0, 8);
  if (missing.length > 0) {
    blocks.push(headingBlock("Missing Keywords"));
    for (const kw of missing.slice(0, 10)) {
      blocks.push(bulletedListBlock(kw));
    }
  }

  // Referral DM — as a code block so it's visually distinct + copyable.
  const referral = plan?.referral_draft?.trim();
  if (referral) {
    blocks.push(headingBlock("Referral DM"));
    blocks.push(codeBlock(referral));
  }

  // Cover note — same copyable code-block treatment.
  const cover = plan?.cover_note?.trim();
  if (cover) {
    blocks.push(headingBlock("Cover Note"));
    blocks.push(codeBlock(cover));
  }

  // Pre-generated apply-form answers. Each rendered as its own labeled
  // code block for easy copy-paste into the actual form. Bookmarklet
  // reads the same data from the "Prefill Data" property.
  const pfa = plan?.prefill_answers;
  if (pfa) {
    const answerPairs: Array<[string, string]> = [
      ["Why this company?", pfa.why_company],
      ["Why this role?", pfa.why_role],
      ["Most challenging project", pfa.challenging_proj],
      ["Most impactful project", pfa.impactful_proj],
      ["Failure story", pfa.failure_story],
      ["Strengths", pfa.strengths],
      ["Why leaving current role?", pfa.why_leaving],
      ["AI / LLM experience", pfa.ai_experience],
    ];
    const filled = answerPairs.filter(([, v]) => v && v.trim());
    if (filled.length) {
      blocks.push(headingBlock("Apply-Form Answers"));
      for (const [label, text] of filled) {
        blocks.push(paragraphBlock(`▸ ${label}`));
        blocks.push(codeBlock(text.trim()));
      }
    }
  }

  // Quality warnings block — visible at-a-glance before sending.
  if (alert.qualityWarnings?.length) {
    blocks.push(headingBlock("⚠ Quality Warnings"));
    blocks.push(
      paragraphBlock(
        `${alert.qualityWarnings.length} check(s) failed — review cover note and prefill answers before sending:`
      )
    );
    for (const w of alert.qualityWarnings.slice(0, 10)) {
      blocks.push(bulletedListBlock(w));
    }
  }

  return blocks;
}
