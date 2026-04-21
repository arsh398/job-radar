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
import { detectGhost } from "./filters/ghost.ts";
import { runQualityChecks } from "./llm/validator.ts";
import { PROMPT_VERSION } from "./llm/prompt.ts";
import { computeFitScore } from "./match/score.ts";
import { embedText } from "./match/embeddings.ts";
import { renderMarkdownToPdf, closePdfBrowser } from "./pdf/render.ts";
import { buildVariants } from "./resume/variants.ts";
import { sendAlertToNotion } from "./notion/index.ts";
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
// MAX_LLM_PER_RUN is a COST SAFETY CAP, not a feature gate. The real gate
// is MIN_FIT_FOR_LLM below. Set generously so a single burst of good
// matches isn't silently clipped. Anything above fit threshold gets an
// LLM opinion; we only hit this ceiling on true anomaly days.
const MAX_LLM_PER_RUN = Number(process.env["MAX_LLM_PER_RUN"] ?? 200);
const ALERT_SKIPS = process.env["ALERT_SKIPS"] !== "0";
const MAX_AGE_DAYS = Number(process.env["MAX_AGE_DAYS"] ?? 14);
const ENABLE_PDF = process.env["ENABLE_PDF"] !== "0";
const ENABLE_TELEGRAM = process.env["ENABLE_TELEGRAM"] !== "0";
const ENABLE_NOTION = process.env["ENABLE_NOTION"] !== "0";
// Confidence threshold — the only real gate into LLM scoring. Raised to
// 0.30 for a quality-first apply strategy: fewer, stronger matches flow
// through to the LLM + tailoring + Notion. Below 0.30 is typically weak
// ATS overlap + neutral YOE + middling semantic fit, which produces
// generic tailoring and wasted apply attempts. Every match clearing
// 0.30 gets an LLM opinion.
const MIN_FIT_FOR_LLM = Number(process.env["MIN_FIT_FOR_LLM"] ?? 0.3);

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

function slugFile(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// Candidate name lives in resume.md header — for filenames we use a
// stable human-readable form. This is what gets uploaded into the ATS
// portal, so it should read like a normal resume filename, not an
// internal tool's slugified dump.
const CANDIDATE_NAME = process.env["CANDIDATE_NAME"] ?? "Mohammed Arsh Khan";

function toTitleSlug(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

function pdfFilename(job: FilteredJob, variantSuffix: string): string {
  const name = CANDIDATE_NAME.replace(/\s+/g, "-");
  const company = toTitleSlug(job.company.replace(/[^\w\s]/g, ""));
  const suffix = variantSuffix ? `-${variantSuffix}` : "";
  return `${name}-${company}-Resume${suffix}.pdf`;
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

  // Ghost-job filter — deterministic, no LLM. Drops postings that are
  // stale, boilerplate-heavy, or vague (likely filled/template reqs).
  let ghostDropped = 0;
  const afterGhost = passedUnsorted.filter((job) => {
    const g = detectGhost(job);
    if (g.isGhost) {
      ghostDropped++;
      if (ghostDropped <= 5) {
        console.log(
          `[ghost] drop ${job.company} — ${job.title} (score=${g.score.toFixed(2)}, ${g.reasons.join("; ")})`
        );
      }
      return false;
    }
    return true;
  });
  if (ghostDropped > 0) {
    console.log(`[job-radar] ghost filter dropped ${ghostDropped} jobs`);
  }

  // Sort newest-first. No per-company cap — every confident match flows
  // through, even if a single company dominates the batch.
  const capped = [...afterGhost].sort((a, b) => {
    const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
    const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
    return tb - ta;
  });

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
  let embeddingOk = 0;
  let embeddingMiss = 0;
  for (const job of capped) {
    const jdText = job.descriptionMd || job.description;
    const picked = await pickProfile(profiles, jdText, job.track);
    const atsMatch = computeAtsMatch(jdText, picked.profile.md);
    const fit = await computeFitScore(job, atsMatch, picked.profile.embedding);
    if (fit.semantic > 0) embeddingOk++;
    else embeddingMiss++;
    enriched.push({ job, atsMatch, fit, profile: picked.profile });
  }
  if (capped.length > 0) {
    const rate = embeddingOk / capped.length;
    console.log(
      `[job-radar] embedding health: ${embeddingOk}/${capped.length} scored (${(rate * 100).toFixed(0)}% ok, ${embeddingMiss} missing)`
    );
    if (rate < 0.8) {
      console.warn(
        `[job-radar] ⚠ embedding health low — GOOGLE_AI_STUDIO_API_KEY may be missing or rate-limited. Pre-rank is ATS+YOE only, semantic signal is degraded.`
      );
    }
  }

  // Rank by fit, drop sub-threshold jobs, then cap for cost safety. The
  // fit threshold is the real gate — every job above it gets an LLM
  // opinion (no top-N arbitrary cut). The cap only kicks in on anomaly
  // days when >200 confident matches show up at once.
  enriched.sort((a, b) => b.fit.overall - a.fit.overall);
  const confident = enriched.filter((e) => e.fit.overall >= MIN_FIT_FOR_LLM);
  const belowThreshold = enriched.length - confident.length;
  if (belowThreshold > 0) {
    console.log(
      `[job-radar] ${belowThreshold} jobs below fit threshold ${(MIN_FIT_FOR_LLM * 100).toFixed(0)}% — not scored`
    );
  }
  const toProcess = confident.slice(0, MAX_LLM_PER_RUN);
  if (confident.length > MAX_LLM_PER_RUN) {
    console.warn(
      `[job-radar] capping LLM calls at ${MAX_LLM_PER_RUN}; ${confident.length - MAX_LLM_PER_RUN} jobs deferred to next run`
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

  // Per-job pipeline, sequential end-to-end. Header fires first so the URL
  // lands immediately, then LLM + PDF, then enrichment + attachments thread
  // under that header. Only after all of that completes do we move to the
  // next job. This keeps the Telegram chat chronologically clean — each
  // job is a self-contained block, nothing interleaves across jobs.
  let sentCount = 0;
  for (let i = 0; i < ordered.length; i++) {
    const { job, atsMatch, fit, profile } = ordered[i]!;

    // 1. Early header ping (sub-second, URL lands first — Telegram only)
    let parentMessageId: number | undefined;
    if (DRY_RUN) {
      console.log(
        `[dry-run] would early-ping: ${job.company} — ${job.title} (${Math.round(atsMatch.score * 100)}% ATS, ${atsMatch.missing.length} missing)`
      );
    } else if (ENABLE_TELEGRAM) {
      try {
        const res = await sendEarlyPing(job, atsMatch, fit);
        parentMessageId = res.messageId;
      } catch (err) {
        console.error(
          `[job-radar] early-ping failed for ${job.company}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      await sleep(SEND_GAP_MS);
    }

    // 2. LLM tailoring (possibly gated on fit score)
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
            filename: pdfFilename(job, v.suffix),
            caption: v.caption.slice(0, 1000),
          });
        }
      } catch (err) {
        console.error(
          `[pdf] render failed for ${job.company}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Recruiter-quality checks — surface warnings in Notion so Mohammed
    // knows which rows need eyeballing before send. Does not block send.
    const qualityResults = llm.ok ? runQualityChecks(llm.data, job) : [];
    const qualityWarnings = qualityResults
      .filter((r) => !r.passes)
      .flatMap((r) => r.warnings.map((w) => `${r.field}: ${w}`));
    if (qualityWarnings.length) {
      console.warn(
        `[quality] ${job.company} — ${job.title}: ${qualityWarnings.length} warnings`
      );
      for (const w of qualityWarnings.slice(0, 5)) console.warn(`  - ${w}`);
    }

    // Prefill Data — everything the bookmarklet needs to autofill the
    // apply form. Kept as a compact JSON string; the extension parses it.
    const prefillAnswers = llm.ok ? llm.data.prefill_answers : null;
    const prefillData = JSON.stringify({
      version: PROMPT_VERSION,
      answers: prefillAnswers ?? {},
      // Profile hints the extension can fall back on if the user's
      // browser profile JSON is missing a field (e.g. early setup).
      standard_hints: {
        cover_note: llm.ok ? llm.data.cover_note : "",
        referral_draft: llm.ok ? llm.data.referral_draft : "",
        why_company_summary: prefillAnswers?.why_company ?? "",
      },
    });

    const alert: JobAlert = {
      job,
      llm,
      atsMatch,
      fit,
      profileName: profile.name,
      pdfs,
      qualityWarnings,
      promptVersion: PROMPT_VERSION,
      prefillData,
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

    // Fire Telegram + Notion in parallel per job — Telegram for push,
    // Notion as the structured source of truth Mohammed sorts through.
    const delivered: Promise<unknown>[] = [];
    if (ENABLE_TELEGRAM) {
      delivered.push(
        sendEnrichedFollowUp(alert, parentMessageId).catch((err) =>
          console.error(
            `[job-radar] telegram enrichment failed for ${job.company}: ${err instanceof Error ? err.message : String(err)}`
          )
        )
      );
    }
    if (ENABLE_NOTION) {
      delivered.push(sendAlertToNotion(alert));
    }
    await Promise.all(delivered);
    sentCount++;
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
