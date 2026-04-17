// Maps JobAlert → Notion page properties. The database schema Mohammed
// must configure is documented in README-NOTION.md. Any property the
// schema lacks is silently skipped (Notion rejects unknown properties).

import type { JobAlert, PdfAttachment } from "../types.ts";

type AnyProp = Record<string, unknown>;

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

function yoeString(alert: JobAlert): string {
  const y = alert.job.parsedYoe;
  if (y.unknown) return "not stated";
  const min = y.min ?? "?";
  return y.max != null ? `${min}-${y.max} yrs` : `${min}+ yrs`;
}

function statusForNewRow(): AnyProp {
  // Start every alert at "New" — Mohammed moves through Applied / Interview /
  // Rejected / Offer by hand in the Notion UI.
  return select("New");
}

export function buildProperties(
  alert: JobAlert,
  primary?: { uploadId: string; attachment: PdfAttachment },
  alt?: { uploadId: string; attachment: PdfAttachment }
): AnyProp {
  const verdict = alert.llm.ok ? alert.llm.data.verdict : "unknown";
  const verdictReason = alert.llm.ok ? alert.llm.data.verdict_reason : "";
  const missing = alert.llm.ok
    ? alert.llm.data.missing_keywords.join(", ")
    : alert.atsMatch.missing.slice(0, 8).join(", ");
  const cover = alert.llm.ok ? alert.llm.data.cover_note : "";
  const referral = alert.llm.ok ? alert.llm.data.referral_draft : "";
  const source = alert.job.source.split(":")[0] ?? alert.job.source;

  return {
    Name: title(`${alert.job.company} — ${alert.job.title}`),
    Company: select(alert.job.company),
    Role: richText(alert.job.title),
    Status: statusForNewRow(),
    Verdict: select(verdict),
    Track: select(alert.job.track),
    "Fit %": number(Math.round(alert.fit.overall * 100)),
    "ATS %": number(Math.round(alert.atsMatch.score * 100)),
    Posted: date(alert.job.postedAt),
    Source: select(source),
    Location: richText(alert.job.location),
    YOE: richText(yoeString(alert)),
    "JD URL": url(alert.job.url),
    "Missing Keywords": richText(missing),
    "LLM Reason": richText(verdictReason),
    "Cover Note": richText(cover),
    "Referral Draft": richText(referral),
    "Resume (primary)": primary
      ? fileUploads([{ uploadId: primary.uploadId, name: primary.attachment.filename }])
      : fileUploads([]),
    "Resume (alt)": alt
      ? fileUploads([{ uploadId: alt.uploadId, name: alt.attachment.filename }])
      : fileUploads([]),
    Key: richText(alert.job.key),
  };
}
