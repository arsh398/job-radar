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
import { loadProfiles, pickProfile } from "./resume/profiles.ts";
import type { ResumeProfile } from "./resume/profiles.ts";
import { applyPlan } from "./resume/apply.ts";
import { computeAtsMatch } from "./filters/ats_match.ts";
import { computeFitScore } from "./match/score.ts";
import { embedText } from "./match/embeddings.ts";
import { renderMarkdownToPdf, closePdfBrowser } from "./pdf/render.ts";
import { buildVariants } from "./resume/variants.ts";
import type {
  AtsMatch,
  FitScore,
  FilteredJob,
  JobAlert,
  LlmOutput,
  PdfAttachment,
} from "./types.ts";

loadEnv();

const ROOT = resolve(process.cwd());
const SEEN_PATH = resolve(ROOT, "seen.json");
const HEALTH_PATH = resolve(ROOT, "source_health.json");

const DRY_RUN = process.env["DRY_RUN"] === "1";
const MAX_LLM_PER_RUN = Number(process.env["MAX_LLM_PER_RUN"] ?? 20);
const ALERT_SKIPS = process.env["ALERT_SKIPS"] !== "0";
const MAX_AGE_DAYS = Number(process.env["MAX_AGE_DAYS"] ?? 14);
const MAX_PER_COMPANY = Number(process.env["MAX_PER_COMPANY"] ?? 3);
const ENABLE_PDF = process.env["ENABLE_PDF"] !== "0";
// Skip LLM below this fit score — saves tokens on obvious mismatches.
const MIN_FIT_FOR_LLM = Number(process.env["MIN_FIT_FOR_LLM"] ?? 0.2);

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

function pdfFilename(job: FilteredJob, variantLabel: string): string {
  return `resume-${slugFile(job.company)}-${slugFile(job.title)}-${variantLabel}.pdf`;
}

const SEND_GAP_MS = 180;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function shouldAlert(llm: LlmOutput): boolean {
  if (!llm.ok) return true;
  if (llm.data.verdict === "skip") return ALERT_SKIPS;
  return true;
}

async function ensureProfileEmbedding(
  profile: ResumeProfile
): Promise<void> {
  if (profile.embedding) return;
  const signal = `${profile.parsed.summary}\n\nSkills: ${profile.parsed.skills
    .map((c) => `${c.category}: ${c.items.join(", ")}`)
    .join(" | ")}`;
  profile.embedding = await embedText(signal, "RETRIEVAL_DOCUMENT");
}

async function main(): Promise<void> {
  const start = Date.now();
  console.log(
    `[job-radar] start at ${new Date().toISOString()} (dry_run=${DRY_RUN})`
  );

  const profiles = await loadProfiles(ROOT);
  for (const p of profiles) {
    console.log(
      `[job-radar] profile=${p.name} (${p.md.length} chars, ${p.parsed.experience.length} roles, ${p.parsed.projects.length} projects)`
    );
  }

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
  const capped = capPerCompany(
    [...passedUnsorted].sort((a, b) => {
      const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
      const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
      return tb - ta;
    }),
    MAX_PER_COMPANY
  );

  // Pre-warm profile embeddings once (rather than N times per job).
  for (const p of profiles) await ensureProfileEmbedding(p);

  // For each capped job: pick best profile, compute ATS + fit score.
  type Enriched = {
    job: FilteredJob;
    atsMatch: AtsMatch;
    fit: FitScore;
    profile: ResumeProfile;
  };
  const enriched: Enriched[] = [];
  for (const job of capped) {
    const jdText = job.descriptionMd || job.description;
    const picked = await pickProfile(profiles, jdText, job.track);
    const atsMatch = computeAtsMatch(jdText, picked.profile.md);
    const fit = await computeFitScore(job, atsMatch, picked.profile.embedding);
    enriched.push({ job, atsMatch, fit, profile: picked.profile });
  }

  // Rank by fit score — best fits first. Display order sends oldest first
  // so newest/best lands at the bottom of the chat (most visible).
  enriched.sort((a, b) => b.fit.overall - a.fit.overall);
  const toProcess = enriched.slice(0, MAX_LLM_PER_RUN);
  if (enriched.length > MAX_LLM_PER_RUN) {
    console.warn(
      `[job-radar] capping LLM calls at ${MAX_LLM_PER_RUN}; ${enriched.length - MAX_LLM_PER_RUN} jobs deferred`
    );
  }
  // Send oldest first → newest last so the freshest/best is at bottom.
  const ordered = [...toProcess].sort((a, b) => {
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
  for (const e of ordered) {
    console.log(
      `[job-radar] candidate ${e.job.company} — ${e.job.title}: fit=${(e.fit.overall * 100).toFixed(0)}% ats=${(e.fit.ats * 100).toFixed(0)}% sem=${(e.fit.semantic * 100).toFixed(0)}% yoe=${(e.fit.yoe * 100).toFixed(0)}% profile=${e.profile.name}`
    );
  }

  // Stage 1: early ping for every candidate — SEQUENTIAL with a small gap
  // so Telegram receives them in the intended chronological order (oldest →
  // newest, so the freshest lands at the bottom of the chat). Parallel
  // sends can reshuffle server-side based on network jitter.
  const earlyPings: Array<{ messageId: number | undefined }> = [];
  for (const { job, atsMatch, fit } of ordered) {
    if (DRY_RUN) {
      console.log(
        `[dry-run] would early-ping: ${job.company} — ${job.title} (${Math.round(atsMatch.score * 100)}% ATS, ${atsMatch.missing.length} missing)`
      );
      earlyPings.push({ messageId: undefined });
      continue;
    }
    try {
      const res = await sendEarlyPing(job, atsMatch, fit);
      earlyPings.push({ messageId: res.messageId });
    } catch (err) {
      console.error(
        `[job-radar] early-ping failed for ${job.company}: ${err instanceof Error ? err.message : String(err)}`
      );
      earlyPings.push({ messageId: undefined });
    }
    await sleep(SEND_GAP_MS);
  }

  // Stage 2: per job — LLM + PDF + enrichment.
  let sentCount = 0;
  for (let i = 0; i < ordered.length; i++) {
    const { job, atsMatch, fit, profile } = ordered[i]!;
    const parentMessageId = earlyPings[i]!.messageId;

    let llm: LlmOutput;
    if (DRY_RUN) {
      llm = { ok: false, error: "DRY_RUN=1, skipped LLM" };
    } else if (fit.overall < MIN_FIT_FOR_LLM) {
      llm = {
        ok: false,
        error: `skipped LLM — fit ${(fit.overall * 100).toFixed(0)}% < ${(MIN_FIT_FOR_LLM * 100).toFixed(0)}% threshold`,
      };
      console.log(
        `[job-radar] skipping LLM for ${job.company} (fit=${(fit.overall * 100).toFixed(0)}%)`
      );
    } else {
      llm = await tailorForJob(profile.parsed, profile.md, job);
    }
    if (!llm.ok) {
      console.warn(
        `[job-radar] LLM skipped/failed for ${job.company} — ${job.title}: ${llm.error}`
      );
    }

    const pdfs: PdfAttachment[] = [];
    if (ENABLE_PDF && !DRY_RUN && llm.ok && llm.data.verdict !== "skip") {
      try {
        const jdText = job.descriptionMd || job.description;
        const { markdown: tailoredMd, warnings } = applyPlan(
          profile.parsed,
          profile.md,
          llm.data,
          jdText
        );
        if (warnings.length) {
          console.warn(
            `[apply-plan] ${job.company} — ${job.title}: ${warnings.length} fixes`
          );
          for (const w of warnings.slice(0, 5)) console.warn(`  - ${w}`);
        }
        const variants = buildVariants();
        for (const v of variants) {
          const variantMd = v.transform(tailoredMd);
          const buffer = await renderMarkdownToPdf(variantMd);
          pdfs.push({
            buffer,
            filename: pdfFilename(job, v.label),
            caption: `${v.caption} — ${job.company}: ${job.title}`.slice(0, 1000),
          });
        }
      } catch (err) {
        console.error(
          `[pdf] render failed for ${job.company}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const alert: JobAlert = {
      job,
      llm,
      atsMatch,
      fit,
      profileName: profile.name,
      pdfs,
    };
    if (!shouldAlert(llm)) {
      console.log(
        `[job-radar] skip alert for ${job.company} — ${job.title} (verdict=skip, ALERT_SKIPS=0)`
      );
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[dry-run] enrichment preview: ${job.company} — ${job.title}: fit=${(fit.overall * 100).toFixed(0)}% profile=${profile.name}`
      );
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
    `[job-radar] sent ${sentCount} enrichments (of ${ordered.length} processed)`
  );

  const updatedSeen = recordSeen(seen, fresh);
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
