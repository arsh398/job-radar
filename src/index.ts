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
  sendJobAlert,
  sendBrokenSourcesAlert,
  formatJobMessages,
} from "./telegram/index.ts";
import type { Job, JobAlert, FilteredJob, LlmOutput } from "./types.ts";

loadEnv();

const ROOT = resolve(process.cwd());
const RESUME_PATH = resolve(ROOT, "resume.md");
const SEEN_PATH = resolve(ROOT, "seen.json");
const HEALTH_PATH = resolve(ROOT, "source_health.json");

const DRY_RUN = process.env["DRY_RUN"] === "1";
const MAX_LLM_PER_RUN = Number(process.env["MAX_LLM_PER_RUN"] ?? 20);
const ALERT_SKIPS = process.env["ALERT_SKIPS"] !== "0";

async function loadResume(): Promise<string> {
  try {
    return await readFile(RESUME_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read resume at ${RESUME_PATH}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function dedupeAcrossSources(jobs: Job[]): Job[] {
  const byFingerprint = new Map<string, Job>();
  for (const j of jobs) {
    const fp = `${j.company.toLowerCase()}|${j.title.toLowerCase().trim()}|${j.location.toLowerCase().trim()}`;
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, j);
  }
  return [...byFingerprint.values()];
}

async function main(): Promise<void> {
  const start = Date.now();
  console.log(
    `[job-radar] start at ${new Date().toISOString()} (dry_run=${DRY_RUN})`
  );

  const resumeMd = await loadResume();
  console.log(`[job-radar] resume loaded (${resumeMd.length} chars)`);

  const [seen, health] = await Promise.all([
    loadSeen(SEEN_PATH),
    loadHealth(HEALTH_PATH),
  ]);
  console.log(
    `[job-radar] state loaded — seen=${Object.keys(seen).length}, sources_tracked=${Object.keys(health).length}`
  );

  const sourceResults = await runAllAdapters();
  const allJobs: Job[] = [];
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

  const { passed: passedUnsorted, stats, dropReasons } = applyFilters(fresh);
  const passed = [...passedUnsorted].sort((a, b) => {
    const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
    const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
    return tb - ta;
  });
  console.log(
    `[job-radar] filter stats — total=${stats.total} droppedLoc=${stats.droppedLocation} droppedTitle=${stats.droppedTitle} droppedYoe=${stats.droppedYoe} passed=${stats.passed}`
  );
  if (Object.keys(dropReasons).length) {
    const top = Object.entries(dropReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log(
      `[job-radar] top drop reasons: ${top.map(([r, c]) => `${r} (${c})`).join(" | ")}`
    );
  }

  const toProcess = passed.slice(0, MAX_LLM_PER_RUN);
  if (passed.length > MAX_LLM_PER_RUN) {
    console.warn(
      `[job-radar] capping LLM calls at ${MAX_LLM_PER_RUN}; ${passed.length - MAX_LLM_PER_RUN} jobs deferred to next run`
    );
  }

  const alerts: JobAlert[] = [];
  for (const job of toProcess) {
    if (DRY_RUN) {
      console.log(
        `[dry-run] would LLM: ${job.company} — ${job.title} (${job.location})`
      );
      alerts.push({
        job,
        llm: { ok: false, error: "DRY_RUN=1, skipped LLM" },
      });
      continue;
    }
    const llm: LlmOutput = await tailorForJob(resumeMd, job);
    alerts.push({ job, llm });
    if (!llm.ok) {
      console.error(
        `[job-radar] LLM failed for ${job.company} — ${job.title}: ${llm.error}`
      );
    }
  }

  let sentCount = 0;
  for (const alert of alerts) {
    const shouldSend = shouldSendAlert(alert);
    if (!shouldSend) continue;

    if (DRY_RUN) {
      console.log("\n========= ALERT PREVIEW =========");
      const msgs = formatJobMessages(alert);
      if (msgs) {
        console.log("--- HEADER ---");
        console.log(msgs.header);
        if (msgs.resumeEdits) {
          console.log("--- RESUME EDITS ---");
          console.log(msgs.resumeEdits);
        }
        if (msgs.referral) {
          console.log("--- REFERRAL ---");
          console.log(msgs.referral);
        }
        if (msgs.coverNote) {
          console.log("--- COVER NOTE ---");
          console.log(msgs.coverNote);
        }
      }
      console.log("=================================\n");
      sentCount++;
      continue;
    }

    try {
      await sendJobAlert(alert);
      sentCount++;
    } catch (err) {
      console.error(
        `[job-radar] telegram send failed for ${alert.job.company}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  console.log(`[job-radar] sent ${sentCount} alerts (of ${alerts.length} processed)`);

  const deferred = passed.slice(MAX_LLM_PER_RUN);
  for (const job of passed) {
    if (!deferred.includes(job)) continue;
  }

  const freshToRecord = fresh.filter((j) =>
    toProcess.some((p) => p.key === j.key) || !passed.some((p) => p.key === j.key)
  );
  const updatedSeen = recordSeen(seen, freshToRecord);
  const prunedSeen = pruneSeen(updatedSeen);
  if (!DRY_RUN) {
    await saveSeen(SEEN_PATH, prunedSeen);
  }

  const { health: updatedHealth, brokenSources } = updateHealth(
    health,
    sourceResults
  );
  if (!DRY_RUN) {
    await saveHealth(HEALTH_PATH, updatedHealth);
  }
  if (brokenSources.length > 0) {
    console.warn(
      `[job-radar] broken sources: ${brokenSources.join(", ")}`
    );
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

  const durMs = Date.now() - start;
  console.log(
    `[job-radar] done in ${durMs}ms — alerts=${sentCount}, seen_now=${Object.keys(prunedSeen).length}`
  );
}

function shouldSendAlert(alert: JobAlert): boolean {
  if (DRY_RUN) return true;
  const { llm } = alert;
  if (!llm.ok) return true;
  if (llm.data.verdict === "skip") {
    return ALERT_SKIPS;
  }
  return true;
}

main().catch((err) => {
  console.error("[job-radar] fatal:", err);
  process.exit(1);
});
