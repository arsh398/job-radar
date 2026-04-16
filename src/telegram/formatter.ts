import type { JobAlert, FilteredJob, TailoringResponse } from "../types.ts";

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

const MAX_CODE_BLOCK = 3500;

function codeBlock(content: string): string {
  let trimmed = content.trim();
  if (trimmed.length > MAX_CODE_BLOCK) {
    trimmed = trimmed.slice(0, MAX_CODE_BLOCK) + "\n…(truncated)";
  }
  return "```\n" + escCode(trimmed) + "\n```";
}

// Each section becomes its own short Telegram message so we never split a
// code block across the 4000-char API limit.
export type FormattedAlert = {
  header: string;
  followUps: string[];
};

export function formatJobMessages(alert: JobAlert): FormattedAlert {
  const { job, llm } = alert;
  const verdict = llm.ok ? llm.data.verdict : "stretch";
  const emoji = VERDICT_EMOJI[verdict] ?? "⚪";

  const yoe = yoeLabel(job);
  const metaParts = [
    job.location || "location unspecified",
    ...(yoe ? [yoe] : []),
    postedAgo(job.postedAt),
  ];
  const headerBase = [
    `${emoji} *${escMd(job.company)}* — ${escMd(job.title)}`,
    `📍 ${metaParts.map(escMd).join(" · ")}`,
    `🔗 ${escMd(job.url)}`,
  ];

  if (!llm.ok) {
    return {
      header: [
        ...headerBase,
        ``,
        `⚠️ LLM unavailable: ${escMd(llm.error.slice(0, 160))}`,
      ].join("\n"),
      followUps: [],
    };
  }

  const d: TailoringResponse = llm.data;

  if (verdict === "skip") {
    const reason = d.missing_keywords.length
      ? `Skip: missing ${escMd(d.missing_keywords.slice(0, 4).join(", "))}`
      : `Skip`;
    return {
      header: [...headerBase, ``, reason].join("\n"),
      followUps: [],
    };
  }

  if (d.missing_keywords.length) {
    headerBase.push("");
    headerBase.push(
      `❌ *Missing:* ${escMd(d.missing_keywords.slice(0, 6).join(", "))}`
    );
  }

  const followUps: string[] = [];

  if (d.resume_edits.summary) {
    followUps.push(
      ["📝 *Summary*", codeBlock(d.resume_edits.summary)].join("\n")
    );
  }

  if (d.resume_edits.skills) {
    followUps.push(
      ["🛠 *Skills*", codeBlock(d.resume_edits.skills)].join("\n")
    );
  }

  for (const exp of d.resume_edits.experience) {
    if (!exp.bullets.length) continue;
    followUps.push(
      [
        `💼 *${escMd(exp.role)}*`,
        codeBlock(exp.bullets.map((b) => `• ${b}`).join("\n")),
      ].join("\n")
    );
  }

  if (d.resume_edits.projects.length) {
    followUps.push(
      [
        "🧪 *Projects*",
        codeBlock(
          d.resume_edits.projects
            .map((p) => `${p.name} — ${p.description}`)
            .join("\n\n")
        ),
      ].join("\n")
    );
  }

  followUps.push(["💬 *Referral*", codeBlock(d.referral_draft)].join("\n"));
  followUps.push(["✉️ *Cover note*", codeBlock(d.cover_note)].join("\n"));

  return { header: headerBase.join("\n"), followUps };
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
