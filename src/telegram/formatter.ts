import type { FilteredJob, JobAlert, TailoringPlan, AtsMatch } from "../types.ts";

const VERDICT_EMOJI: Record<string, string> = {
  apply: "🟢",
  apply_with_referral: "🟡",
  stretch: "🟠",
  skip: "🔴",
};

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

function yoeLabel(job: FilteredJob): string | null {
  if (job.parsedYoe.unknown) return null;
  const min = job.parsedYoe.min ?? "?";
  const max = job.parsedYoe.max;
  return max != null ? `${min}-${max} yrs` : `${min}+ yrs`;
}

function atsLabel(m: AtsMatch): string {
  const pct = Math.round(m.score * 100);
  return `${pct}% ATS`;
}

const MAX_CODE_BLOCK = 3500;

function codeBlock(content: string): string {
  let trimmed = (content ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length > MAX_CODE_BLOCK) {
    trimmed = trimmed.slice(0, MAX_CODE_BLOCK) + "\n…(truncated)";
  }
  return "```\n" + escCode(trimmed) + "\n```";
}

// Early header — sent BEFORE the LLM runs so Mohammed can click through to
// the JD within seconds of detection, without waiting for tailoring.
export function formatEarlyHeader(job: FilteredJob, atsMatch: AtsMatch): string {
  const yoe = yoeLabel(job);
  const metaParts = [
    job.location || "location unspecified",
    ...(yoe ? [yoe] : []),
    atsLabel(atsMatch),
    postedAgo(job.postedAt),
  ];
  return [
    `🆕 *${escMd(job.company)}* — ${escMd(job.title)}`,
    `📍 ${metaParts.map(escMd).join(" · ")}`,
    `🔗 ${escMd(job.url)}`,
  ].join("\n");
}

// Enrichment follow-up(s) — sent AFTER the LLM completes, threaded under the
// early header. Returns an array so multiple short messages can stack
// without exceeding the 4000-char limit.
export function formatEnrichment(alert: JobAlert): string[] {
  const { llm, atsMatch } = alert;
  const out: string[] = [];

  if (!llm.ok) {
    out.push(`⚠️ LLM unavailable: ${escMd(llm.error.slice(0, 200))}`);
    if (atsMatch.missing.length) {
      out.push(
        `❌ *Missing vs JD:* ${escMd(atsMatch.missing.slice(0, 8).join(", "))}`
      );
    }
    return out;
  }

  const plan = llm.data;
  const emoji = VERDICT_EMOJI[plan.verdict] ?? "⚪";
  const verdictLine = `${emoji} *${escMd(plan.verdict)}*${
    plan.verdict_reason ? ` — ${escMd(plan.verdict_reason)}` : ""
  }`;
  const lines: string[] = [verdictLine];

  if (plan.missing_keywords.length) {
    lines.push(
      `❌ *LLM missing:* ${escMd(plan.missing_keywords.slice(0, 6).join(", "))}`
    );
  }
  if (atsMatch.missing.length) {
    lines.push(
      `🏷 *ATS gaps:* ${escMd(atsMatch.missing.slice(0, 8).join(", "))}`
    );
  }
  out.push(lines.join("\n"));

  if (plan.verdict === "skip") {
    return out;
  }

  const referral = plan.referral_draft?.trim();
  if (referral) {
    out.push(`💬 *Referral DM*\n${codeBlock(referral)}`);
  }
  const cover = plan.cover_note?.trim();
  if (cover) {
    out.push(`✉️ *Cover note*\n${codeBlock(cover)}`);
  }

  return out;
}

export function formatPdfCaption(job: FilteredJob, plan: TailoringPlan | null): string {
  const verdict = plan ? VERDICT_EMOJI[plan.verdict] ?? "⚪" : "📄";
  const verdictText = plan ? plan.verdict : "resume";
  const head = `${verdict} ${verdictText} — ${job.company}: ${job.title}`;
  return head.slice(0, 1000);
}

export function formatSourceBroken(sources: string[]): string {
  const lines = ["⚠️ *Source\\(s\\) broken or silent for 48h\\+:*", ""];
  for (const s of sources) lines.push(`• ${escMd(s)}`);
  lines.push("");
  lines.push("Check GitHub Actions logs\\.");
  return lines.join("\n");
}
