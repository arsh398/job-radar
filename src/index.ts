import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { runAllAdapters } from "./sources/index.ts";
import { applyFilters } from "./filters/index.ts";
import {
  loadSeen,
  splitNewAndSeen,
  recordSeen,
  pruneSeen,
  saveSeen,
} from "./storage/seen.ts";
import {
  loadHealth,
  updateHealth,
  saveHealth,
} from "./storage/health.ts";
import { tailorForJob } from "./llm/index.ts";
import {
  sendEarlyPing,
  sendEnrichedFollowUp,
  sendBrokenSourcesAlert,
} from "./telegram/index.ts";
import { parseResume } from "./resume/parser.ts";
import { applyPlan } from "./resume/apply.ts";
import { computeAtsMatch } from "./filters/ats_match.ts";
import { renderMarkdownToPdf, closePdfBrowser } from "./pdf/render.ts";
import type { FilteredJob, JobAlert, LlmOutput, AtsMatch } from "./types.ts";

loadEnv();

const ROOT = resolve(process.cwd());
const RESUME_PATH = resolve(ROOT, "resume.md");
const SEEN_PATH = resolve(ROOT, "seen.json");
const HEALTH_PATH = resolve(ROOT, "source_health.json");

const DRY_RUN = process.env["DRY_RUN"] === "1";
const MAX_LLM_PER_RUN = Number(process.env["MAX_LLM_PER_RUN"] ?? 20);
const ALERT_SKIPS = process.env["ALERT_SKIPS"] !== "0";
const MAX_AGE_DAYS = Number(process.env["MAX_AGE_DAYS"] ?? 14);
const MAX_PER_COMPANY = Number(process.env["MAX_PER_COMPANY"] ?? 3);
const ENABLE_PDF = process.env["ENABLE_PDF"] !== "0";

async function loadResume(): Promise<string> {
  try {
    return await readFile(RESUME_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read resume at ${RESUME_PATH}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeAcrossSources<T extends { company: string; title: string; location: string }>(
  jobs: T[]
): T[] {
  const byFingerprint = new Map<string, T>();
  for (const j of jobs) {
    const fp = `${normalize(j.company)}|${normalize(j.title)}|${normalize(j.location)}`;
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, j);
  }
  return [...byFingerprint.values()];
}

function capPerCompany<T extends { company: string }>(
  items: T[],
  maxPerCompany: number
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const key = item.company.toLowerCase();
    const n = counts.get(key) ?? 0;
    if (n >= maxPerCompany) continue;
    counts.set(key, n + 1);
    out.push(item);
  }
  return out;
}

function slugFile(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function pdfFilename(job: FilteredJob): string {
  const company = slugFile(job.company);
  const title = slugFile(job.title);
  return `resume-${company}-${title}.pdf`;
}

function shouldAlert(llm: LlmOutput, atsMatch: AtsMatch): boolean {
  if (!llm.ok) return true;
  if (llm.data.verdict === "skip") {
    return ALERT_SKIPS;
  }
  return true;
}

async function main(): Promise<void> {
  const start = Date.now();
  console.log(
    `[job-radar] start at ${new Date().toISOString()} (dry_run=${DRY_RUN})`
  );

  const resumeMd = await loadResume();
  const parsedResume = parseResume(resumeMd);
  console.log(
    `[job-radar] resume loaded (${resumeMd.length} chars, ${parsedResume.experience.length} roles, ${parsedResume.projects.length} projects)`
  );

  const [seen, health] = await Promise.all([
    loadSeen(SEEN_PATH),
    loadHealth(HEALTH_PATH),
  ]);
  console.log(
    `[job-radar] state loaded — seen=${Object.keys(seen).length}, sources_tracked=${Object.keys(health).length}`
  );

  const sourceResults = await runAllAdapters();
  const allJobs = [];
  for (const r of sourceResults) {
    console.log(
      `[job-radar] source=${r.source} ok=${r.ok} jobs=${r.jobs.length} dur=${r.durationMs}ms${r.error ? ` err=${r.error.slice(0, 120)}` : ""}`
    );
    allJobs.push(...r.jobs);
  }

  const deduped = dedupeAcrossSources(allJobs);
  console.log(
    `[job-radar] fetched ${allJobs.length} jobs (${deduped.length} after cross-source dedup)`
  );

  const { fresh } = splitNewAndSeen(deduped, seen);
  console.log(`[job-radar] ${fresh.length} new jobs after seen.json dedup`);

  const { passed: passedUnsorted, stats, dropReasons } = applyFilters(fresh, {
    maxAgeDays: MAX_AGE_DAYS,
  });
  const passedNewestFirst = [...passedUnsorted].sort((a, b) => {
    const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
    const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
    return tb - ta;
  });
  const capped = capPerCompany(passedNewestFirst, MAX_PER_COMPANY);

  // Compute ATS match score per job (deterministic, no LLM).
  const withMatch: Array<{ job: FilteredJob; atsMatch: AtsMatch }> = capped.map(
    (job) => ({
      job,
      atsMatch: computeAtsMatch(job.descriptionMd || job.description, resumeMd),
    })
  );

  // Send oldest first → newest last so freshest lands at the bottom.
  withMatch.sort((a, b) => {
    const ta = a.job.postedAt ? Date.parse(a.job.postedAt) : 0;
    const tb = b.job.postedAt ? Date.parse(b.job.postedAt) : 0;
    return ta - tb;
  });

  console.log(
    `[job-radar] filter stats — total=${stats.total} droppedAge=${stats.droppedAge} droppedLoc=${stats.droppedLocation} droppedTitle=${stats.droppedTitle} droppedYoe=${stats.droppedYoe} passed=${stats.passed}`
  );
  if (Object.keys(dropReasons).length) {
    const top = Object.entries(dropReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log(
      `[job-radar] top drop reasons: ${top.map(([r, c]) => `${r} (${c})`).join(" | ")}`
    );
  }

  const toProcess = withMatch.slice(0, MAX_LLM_PER_RUN);
  if (withMatch.length > MAX_LLM_PER_RUN) {
    console.warn(
      `[job-radar] capping LLM calls at ${MAX_LLM_PER_RUN}; ${withMatch.length - MAX_LLM_PER_RUN} jobs deferred to next run`
    );
  }

  // Stage 1: fire the early ping for EVERY job first (in parallel). This
  // minimizes time-to-click — Mohammed sees the URL within seconds, before
  // we spend 5-30s per job on LLM + PDF.
  const earlyPings = await Promise.all(
    toProcess.map(async ({ job, atsMatch }) => {
      if (DRY_RUN) {
        console.log(
          `[dry-run] would early-ping: ${job.company} — ${job.title} (${Math.round(atsMatch.score * 100)}% ATS, ${atsMatch.missing.length} missing)`
        );
        return { messageId: undefined as number | undefined };
      }
      try {
        const res = await sendEarlyPing(job, atsMatch);
        return { messageId: res.messageId };
      } catch (err) {
        console.error(
          `[job-radar] early-ping failed for ${job.company}: ${err instanceof Error ? err.message : String(err)}`
        );
        return { messageId: undefined };
      }
    })
  );

  // Stage 2: per job, run LLM, render tailored resume PDF, send enrichment.
  let sentCount = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const { job, atsMatch } = toProcess[i]!;
    const parentMessageId = earlyPings[i]!.messageId;

    let llm: LlmOutput;
    if (DRY_RUN) {
      llm = { ok: false, error: "DRY_RUN=1, skipped LLM" };
    } else {
      llm = await tailorForJob(parsedResume, job);
    }
    if (!llm.ok) {
      console.error(
        `[job-radar] LLM failed for ${job.company} — ${job.title}: ${llm.error}`
      );
    }

    let pdf: JobAlert["pdf"] = undefined;
    if (ENABLE_PDF && !DRY_RUN && llm.ok && llm.data.verdict !== "skip") {
      try {
        const jdText = job.descriptionMd || job.description;
        const { markdown: tailoredMd, warnings } = applyPlan(
          parsedResume,
          resumeMd,
          llm.data,
          jdText
        );
        if (warnings.length) {
          console.warn(
            `[apply-plan] ${job.company} — ${job.title}: ${warnings.length} rejections`
          );
          for (const w of warnings.slice(0, 3)) console.warn(`  - ${w}`);
        }
        const buffer = await renderMarkdownToPdf(tailoredMd);
        pdf = { buffer, filename: pdfFilename(job) };
      } catch (err) {
        console.error(
          `[pdf] render failed for ${job.company}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const alert: JobAlert = { job, llm, atsMatch, pdf };
    if (!shouldAlert(llm, atsMatch)) {
      console.log(
        `[job-radar] skip alert for ${job.company} — ${job.title} (verdict=skip, ALERT_SKIPS=0)`
      );
      continue;
    }

    if (DRY_RUN) {
      console.log("\n========= ENRICHMENT PREVIEW =========");
      console.log(`[${job.company}] ${job.title}`);
      console.log(
        `  ATS: ${Math.round(atsMatch.score * 100)}% (${atsMatch.matched.slice(0, 5).join(", ")}...)`
      );
      if (llm.ok) {
        console.log(`  verdict: ${llm.data.verdict} — ${llm.data.verdict_reason}`);
        console.log(
          `  bullets: keep=${llm.data.bullet_plan.filter((b) => b.keep).length} hide=${llm.data.bullet_plan.filter((b) => !b.keep).length}`
        );
      }
      console.log("======================================\n");
      sentCount++;
      continue;
    }

    try {
      await sendEnrichedFollowUp(alert, parentMessageId);
      sentCount++;
    } catch (err) {
      console.error(
        `[job-radar] enrichment send failed for ${job.company}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  console.log(
    `[job-radar] sent ${sentCount} enrichments (of ${toProcess.length} processed)`
  );

  // Record every candidate as seen (including ones deferred — no point
  // LLM-ing them later when they're already 14d old by next run).
  const freshToRecord = fresh;
  const updatedSeen = recordSeen(seen, freshToRecord);
  const prunedSeen = pruneSeen(updatedSeen);
  if (!DRY_RUN) await saveSeen(SEEN_PATH, prunedSeen);

  const { health: updatedHealth, brokenSources } = updateHealth(
    health,
    sourceResults
  );
  if (!DRY_RUN) await saveHealth(HEALTH_PATH, updatedHealth);
  if (brokenSources.length > 0) {
    console.warn(`[job-radar] broken sources: ${brokenSources.join(", ")}`);
    if (!DRY_RUN) {
      try {
        await sendBrokenSourcesAlert(brokenSources);
      } catch (err) {
        console.error(
          `[job-radar] broken-source alert failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  await closePdfBrowser();

  const durMs = Date.now() - start;
  console.log(
    `[job-radar] done in ${durMs}ms — alerts=${sentCount}, seen_now=${Object.keys(prunedSeen).length}`
  );
}

main().catch((err) => {
  console.error("[job-radar] fatal:", err);
  process.exit(1);
});
