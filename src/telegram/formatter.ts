import type { JobAlert, FilteredJob, TailoringResponse } from "../types.ts";

const VERDICT_EMOJI: Record<string, string> = {
  apply: "🟢",
  apply_with_referral: "🟡",
  stretch: "🟠",
  skip: "🔴",
};

// Telegram MarkdownV2 reserved characters that need escaping inside text.
// (Inside a code block, only ` and \ need escaping.)
const MDV2_ESCAPE_RE = /[_*\[\]()~`>#+\-=|{}.!]/g;

function escMd(s: string): string {
  return (s ?? "").replace(MDV2_ESCAPE_RE, (c) => `\\${c}`);
}

function escCode(s: string): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

function postedAgo(postedAt?: string): string {
  if (!postedAt) return "posted time unknown";
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return "posted time unknown";
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function yoeLabel(job: FilteredJob): string {
  if (job.parsedYoe.unknown) return "YOE: not stated";
  const min = job.parsedYoe.min ?? "?";
  const max = job.parsedYoe.max;
  return max != null ? `${min}-${max} yrs` : `${min}+ yrs`;
}

function codeBlock(content: string): string {
  return "```\n" + escCode(content.trim()) + "\n```";
}

export type FormattedAlert = {
  header: string;
  resumeEdits: string;
  referral: string;
  coverNote: string;
};

export function formatJobMessages(alert: JobAlert): FormattedAlert | null {
  const { job, llm } = alert;
  const verdict = llm.ok ? llm.data.verdict : "stretch";
  const emoji = VERDICT_EMOJI[verdict] ?? "⚪";

  if (!llm.ok) {
    const header = [
      `${emoji} *${escMd(job.company)}* — ${escMd(job.title)}`,
      `📍 ${escMd(job.location || "location unspecified")} · ${escMd(yoeLabel(job))} · ${escMd(postedAgo(job.postedAt))}`,
      `🔗 ${escMd(job.url)}`,
      ``,
      `⚠️ LLM unavailable: ${escMd(llm.error.slice(0, 160))}`,
    ].join("\n");
    return { header, resumeEdits: "", referral: "", coverNote: "" };
  }

  const d: TailoringResponse = llm.data;

  // Skip alerts: header only with one-line reason.
  if (verdict === "skip") {
    const header = [
      `${emoji} *${escMd(job.company)}* — ${escMd(job.title)}`,
      `📍 ${escMd(job.location || "location unspecified")} · ${escMd(yoeLabel(job))} · ${escMd(postedAgo(job.postedAt))}`,
      `🔗 ${escMd(job.url)}`,
      ``,
      `Skip${d.missing_keywords.length ? `: missing ${escMd(d.missing_keywords.slice(0, 4).join(", "))}` : ""}`,
    ].join("\n");
    return { header, resumeEdits: "", referral: "", coverNote: "" };
  }

  const headerLines = [
    `${emoji} *${escMd(job.company)}* — ${escMd(job.title)}`,
    `📍 ${escMd(job.location || "location unspecified")} · ${escMd(yoeLabel(job))} · ${escMd(postedAgo(job.postedAt))}`,
    `🔗 ${escMd(job.url)}`,
  ];
  if (d.missing_keywords.length) {
    headerLines.push("");
    headerLines.push(
      `❌ *Missing:* ${escMd(d.missing_keywords.slice(0, 6).join(", "))}`
    );
  }
  const header = headerLines.join("\n");

  // Resume edits: each section as its own labeled code block.
  const editLines: string[] = ["📝 *RESUME EDITS*"];

  if (d.resume_edits.summary) {
    editLines.push("");
    editLines.push("*Summary:*");
    editLines.push(codeBlock(d.resume_edits.summary));
  }

  if (d.resume_edits.skills) {
    editLines.push("");
    editLines.push("*Skills:*");
    editLines.push(codeBlock(d.resume_edits.skills));
  }

  for (const exp of d.resume_edits.experience) {
    if (!exp.bullets.length) continue;
    editLines.push("");
    editLines.push(`*${escMd(exp.role)}:*`);
    editLines.push(codeBlock(exp.bullets.map((b) => `• ${b}`).join("\n")));
  }

  if (d.resume_edits.projects.length) {
    editLines.push("");
    editLines.push("*Projects:*");
    editLines.push(
      codeBlock(
        d.resume_edits.projects.map((p) => `${p.name} — ${p.description}`).join("\n\n")
      )
    );
  }

  const resumeEdits = editLines.join("\n");

  const referral = ["💬 *REFERRAL*", codeBlock(d.referral_draft)].join("\n");
  const coverNote = ["✉️ *COVER NOTE*", codeBlock(d.cover_note)].join("\n");

  return { header, resumeEdits, referral, coverNote };
}

export function formatSourceBroken(sources: string[]): string {
  const lines = ["⚠️ *Source\\(s\\) broken or silent for 48h\\+:*", ""];
  for (const s of sources) {
    lines.push(`• ${escMd(s)}`);
  }
  lines.push("");
  lines.push("Check GitHub Actions logs\\.");
  return lines.join("\n");
}
