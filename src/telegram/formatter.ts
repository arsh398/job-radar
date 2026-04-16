import type { JobAlert, TailoringResponse, FilteredJob } from "../types.ts";

const VERDICT_EMOJI: Record<string, string> = {
  apply: "🟢",
  apply_with_referral: "🟡",
  stretch: "🟠",
  skip: "🔴",
};

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

function headerLine(job: FilteredJob, verdict: string, score: number): string {
  const emoji = VERDICT_EMOJI[verdict] ?? "⚪";
  return `${emoji} ${score.toFixed(0)}/10 · ${job.company} — ${job.title}`;
}

function locLine(job: FilteredJob): string {
  const loc = job.location || "location unspecified";
  return `📍 ${loc} · ${yoeLabel(job)} · ${postedAgo(job.postedAt)}`;
}

export function formatSkipAlert(alert: JobAlert): string {
  const { job, llm } = alert;
  if (!llm.ok) {
    return [
      headerLine(job, "skip", 0),
      locLine(job),
      job.url,
      `Skip: ${llm.error}`,
    ].join("\n");
  }
  const data = llm.data as TailoringResponse;
  const reasoning = data.match.reasoning.slice(0, 200);
  return [
    headerLine(job, "skip", data.match.score),
    locLine(job),
    job.url,
    `Skip: ${reasoning}`,
  ].join("\n");
}

export function formatFullAlert(alert: JobAlert): string {
  const { job, llm } = alert;
  if (!llm.ok || llm.kind !== "full") {
    return [
      headerLine(job, "stretch", 0),
      locLine(job),
      job.url,
      "⚠️ LLM unavailable — tailoring skipped. Raw job info above.",
    ].join("\n");
  }

  const d = llm.data;
  const lines: string[] = [];

  lines.push(headerLine(job, d.match.verdict, d.match.score));
  lines.push(locLine(job));
  lines.push(job.url);
  lines.push("");
  lines.push(`📌 ${d.company_context}`);
  lines.push("");
  lines.push(
    `✅ Match: ${d.requirements.met.slice(0, 6).join(", ") || "(none surfaced)"}`
  );
  if (d.requirements.missing.length) {
    lines.push(`❌ Missing: ${d.requirements.missing.slice(0, 6).join(", ")}`);
  }
  if (d.requirements.stretch.length) {
    lines.push(
      `⚠️ Stretch: ${d.requirements.stretch.slice(0, 4).join(", ")}`
    );
  }
  if (d.concerns.length) {
    lines.push(`🚩 Concerns: ${d.concerns.slice(0, 3).join(" | ")}`);
  }
  lines.push(`YOE fit: ${d.match.yoe_fit}`);

  lines.push("");
  lines.push("—— RESUME EDITS ——");
  lines.push("");
  lines.push("Summary:");
  lines.push(d.resume_edits.summary);
  lines.push("");
  lines.push("Skills:");
  lines.push(d.resume_edits.skills);
  lines.push("");
  for (const exp of d.resume_edits.experience) {
    lines.push(`${exp.role}:`);
    for (const bullet of exp.bullets) {
      lines.push(`• ${bullet}`);
    }
    lines.push("");
  }
  if (d.resume_edits.projects.length) {
    lines.push("Projects:");
    for (const p of d.resume_edits.projects) {
      lines.push(`• ${p.name} — ${p.description}`);
    }
    lines.push("");
  }

  lines.push("—— REFERRAL ——");
  lines.push(d.referral_draft.message);
  lines.push("");
  lines.push("—— COVER NOTE ——");
  lines.push(d.cover_note);

  return lines.join("\n");
}

export function formatAlert(alert: JobAlert): string {
  const { llm } = alert;
  if (llm.ok && llm.kind === "full" && llm.data.match.verdict === "skip") {
    return formatSkipAlert(alert);
  }
  return formatFullAlert(alert);
}

export function formatSourceBroken(sources: string[]): string {
  return `⚠️ Source(s) broken or silent for 48h+:\n${sources.map((s) => `• ${s}`).join("\n")}\n\nCheck GitHub Actions logs.`;
}
