// Backfill existing Notion rows with Phase 1 new fields.
//
// For each existing row in the DB:
//   1. Skip if Prefill Data is already populated (idempotent re-runs).
//   2. Fetch the JD body via the row's JD URL (reuses the ATS resolvers
//      from scripts/tailor-one.ts — Greenhouse/Lever/Ashby/Workable/
//      SmartRecruiters/Workday).
//   3. Re-run the tailoring pipeline (pickProfile → ATS match → fit →
//      LLM with v2 prompts → quality checks).
//   4. PATCH only the new properties (Prefill Data, Prompt Version,
//      Resume Variant, Quality Warnings, Verdict, Fit). Existing
//      Status, Applied At, Response Type, etc. are preserved because
//      PATCH is selective.
//
// Does NOT regenerate PDFs (keeps old ones). Does NOT rewrite page
// body (keeps old cover note / referral intact). For richer body
// refresh, delete + recreate via the normal poll-jobs flow.
//
// Usage: tsx scripts/backfill-notion.ts
//   env: NOTION_API_KEY, NOTION_DATABASE_ID, OPENROUTER_API_KEY,
//        (optional) GOOGLE_AI_STUDIO_API_KEY for embeddings,
//        (optional) MAX_BACKFILL_PER_RUN (default 60)
//
// Safe to re-run — idempotent on rows already processed.

import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadProfiles, pickProfile } from "../src/resume/profiles.ts";
import { computeAtsMatch } from "../src/filters/ats_match.ts";
import { computeFitScore } from "../src/match/score.ts";
import { embedText } from "../src/match/embeddings.ts";
import { tailorForJob } from "../src/llm/index.ts";
import { runQualityChecks } from "../src/llm/validator.ts";
import { PROMPT_VERSION } from "../src/llm/prompt.ts";
import {
  queryAllPages,
  patchPageProperties,
  type NotionPage,
} from "../src/notion/client.ts";
import type { FilteredJob, LlmOutput, Track } from "../src/types.ts";
import { getJson } from "../src/sources/http.ts";
import { htmlToMarkdown, stripHtml } from "../src/sources/md.ts";

loadEnv();

const ROOT = resolve(process.cwd());
const MAX_BACKFILL_PER_RUN = Number(
  process.env["MAX_BACKFILL_PER_RUN"] ?? 60
);
const SKIP_IF_PREFILL_PRESENT = process.env["FORCE_BACKFILL"] !== "1";

// ---------- Notion property readers ----------

function readUrl(page: NotionPage, key: string): string {
  const p = (page.properties as Record<string, unknown>)[key] as
    | { url?: string }
    | undefined;
  return p?.url ?? "";
}

function readText(page: NotionPage, key: string): string {
  const p = (page.properties as Record<string, unknown>)[key] as
    | {
        rich_text?: Array<{ plain_text?: string }>;
        title?: Array<{ plain_text?: string }>;
      }
    | undefined;
  if (p?.rich_text) return p.rich_text.map((t) => t.plain_text ?? "").join("");
  if (p?.title) return p.title.map((t) => t.plain_text ?? "").join("");
  return "";
}

function readSelect(page: NotionPage, key: string): string {
  const p = (page.properties as Record<string, unknown>)[key] as
    | { select?: { name?: string } }
    | undefined;
  return p?.select?.name ?? "";
}

// ---------- ATS URL → Job resolution (shared with tailor-one) ----------

const AI_RE =
  /\b(ml|ai|machine\s+learning|applied\s+scientist|nlp|computer\s+vision|gen\s*ai|llm|mle|deep\s+learning|data\s+scientist)\b/i;
function inferTrack(title: string): Track {
  return AI_RE.test(title) ? "ai" : "sde";
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return u;
  }
}

async function resolveJob(url: string): Promise<FilteredJob | null> {
  const now = new Date().toISOString();
  const normalized = normalizeUrl(url);

  // Greenhouse
  const gh = /^https?:\/\/(?:job-)?boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/.exec(normalized);
  if (gh) {
    const [, slug, id] = gh;
    try {
      const j = await getJson<{
        id: number;
        title: string;
        location?: { name: string };
        absolute_url: string;
        company_name?: string;
        content?: string;
        first_published?: string;
        updated_at?: string;
      }>(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?questions=false`
      );
      const html = (j.content ?? "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return {
        key: `greenhouse:${slug}:${j.id}`,
        source: `greenhouse:${slug}`,
        company: j.company_name ?? slug,
        title: j.title,
        location: j.location?.name ?? "",
        url: normalized,
        description: stripHtml(html),
        descriptionMd: htmlToMarkdown(html),
        postedAt: j.first_published ?? j.updated_at,
        fetchedAt: now,
        track: inferTrack(j.title),
        parsedYoe: { min: null, max: null, unknown: true },
        locationMatch: "global_remote",
      };
    } catch {
      return null;
    }
  }

  // Lever
  const lv = /^https?:\/\/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/.exec(normalized);
  if (lv) {
    const [, slug, postingId] = lv;
    try {
      const j = await getJson<{
        id: string;
        text: string;
        hostedUrl: string;
        createdAt?: number;
        categories?: { location?: string };
        description?: string;
        additional?: string;
        lists?: { text: string; content: string }[];
      }>(`https://api.lever.co/v0/postings/${slug}/${postingId}?mode=json`);
      const descHtml = [
        j.description ?? "",
        ...(j.lists ?? []).map((l) => `<h3>${l.text}</h3>${l.content}`),
        j.additional ?? "",
      ].join("\n");
      return {
        key: `lever:${slug}:${j.id}`,
        source: `lever:${slug}`,
        company: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        title: j.text,
        location: j.categories?.location ?? "",
        url: normalized,
        description: stripHtml(descHtml),
        descriptionMd: htmlToMarkdown(descHtml),
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
        fetchedAt: now,
        track: inferTrack(j.text),
        parsedYoe: { min: null, max: null, unknown: true },
        locationMatch: "global_remote",
      };
    } catch {
      return null;
    }
  }

  // Ashby
  const ash = /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([a-f0-9-]+)/.exec(normalized);
  if (ash) {
    const [, slug, jobId] = ash;
    try {
      const data = await getJson<{
        jobs: Array<{
          id: string;
          title: string;
          location: string;
          secondaryLocations?: { location?: string }[];
          isRemote?: boolean;
          jobUrl: string;
          descriptionHtml?: string;
          publishedAt?: string;
        }>;
      }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
      const j = (data.jobs ?? []).find((x) => x.id === jobId);
      if (!j) return null;
      const loc = [
        j.location,
        ...(j.secondaryLocations ?? []).map((s) => s.location ?? ""),
        j.isRemote ? "Remote" : "",
      ]
        .filter(Boolean)
        .join(" | ");
      return {
        key: `ashby:${slug}:${j.id}`,
        source: `ashby:${slug}`,
        company: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        title: j.title,
        location: loc,
        url: normalized,
        description: stripHtml(j.descriptionHtml ?? ""),
        descriptionMd: htmlToMarkdown(j.descriptionHtml ?? ""),
        postedAt: j.publishedAt,
        fetchedAt: now,
        track: inferTrack(j.title),
        parsedYoe: { min: null, max: null, unknown: true },
        locationMatch: "global_remote",
      };
    } catch {
      return null;
    }
  }

  // Workable (widget endpoint)
  const wbApply = /^https?:\/\/apply\.workable\.com\/([^/]+)\/j\/([^/?#]+)/i.exec(normalized);
  const wbSub = /^https?:\/\/([^.]+)\.workable\.com\/j\/([^/?#]+)/i.exec(normalized);
  const wb = wbApply ?? wbSub;
  if (wb) {
    const [, slug, shortcode] = wb;
    try {
      const data = await getJson<{
        name?: string;
        jobs?: Array<{
          shortcode?: string;
          title?: string;
          country?: string;
          city?: string;
          state?: string;
          remote?: boolean;
          published_on?: string;
          created_at?: string;
          description?: string;
          requirements?: string;
          benefits?: string;
        }>;
      }>(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
      const j = (data.jobs ?? []).find((x) => x.shortcode === shortcode);
      if (!j) return null;
      const html = [j.description, j.requirements, j.benefits].filter(Boolean).join("<br/><br/>");
      const loc = [j.city, j.state, j.country, j.remote ? "Remote" : ""]
        .filter(Boolean)
        .join(", ");
      return {
        key: `workable:${slug}:${shortcode}`,
        source: `workable:${slug}`,
        company: data.name ?? slug,
        title: j.title ?? "",
        location: loc,
        url: normalized,
        description: html ? stripHtml(html) : (j.title ?? ""),
        descriptionMd: html ? htmlToMarkdown(html) : (j.title ?? ""),
        postedAt: j.published_on || j.created_at,
        fetchedAt: now,
        track: inferTrack(j.title ?? ""),
        parsedYoe: { min: null, max: null, unknown: true },
        locationMatch: "global_remote",
      };
    } catch {
      return null;
    }
  }

  // SmartRecruiters
  const sr = /^https?:\/\/jobs\.smartrecruiters\.com\/([^/]+)\/(\d+)/.exec(normalized);
  if (sr) {
    const [, slug, id] = sr;
    try {
      const j = await getJson<{
        id: string;
        name: string;
        location?: { city?: string; region?: string; country?: string; remote?: boolean };
        releasedDate?: string;
        createdOn?: string;
        jobAd?: {
          sections?: {
            jobDescription?: { text?: string };
            qualifications?: { text?: string };
            additionalInformation?: { text?: string };
          };
        };
      }>(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${id}`);
      const s = j.jobAd?.sections;
      const html = [s?.jobDescription?.text, s?.qualifications?.text, s?.additionalInformation?.text]
        .filter(Boolean)
        .join("<br/><br/>");
      const loc = [j.location?.city, j.location?.region, j.location?.country, j.location?.remote ? "Remote" : ""]
        .filter(Boolean)
        .join(", ");
      return {
        key: `smartrecruiters:${slug}:${j.id}`,
        source: `smartrecruiters:${slug}`,
        company: slug,
        title: j.name,
        location: loc,
        url: normalized,
        description: html ? stripHtml(html) : j.name,
        descriptionMd: html ? htmlToMarkdown(html) : j.name,
        postedAt: j.releasedDate || j.createdOn,
        fetchedAt: now,
        track: inferTrack(j.name),
        parsedYoe: { min: null, max: null, unknown: true },
        locationMatch: "global_remote",
      };
    } catch {
      return null;
    }
  }

  // Workday
  const wd =
    /^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:(?:[a-z]{2}-[A-Z]{2})\/)?([^/]+)(\/.+)$/.exec(
      normalized
    );
  if (wd) {
    const [, tenant, wdN, site, pathTail] = wd;
    try {
      const data = await getJson<{
        jobPostingInfo?: {
          id?: string;
          title?: string;
          location?: string;
          postedOn?: string;
          jobDescription?: string;
        };
      }>(
        `https://${tenant}.${wdN}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${pathTail}`
      );
      const info = data.jobPostingInfo;
      if (!info) return null;
      const html = info.jobDescription ?? "";
      return {
        key: `workday:${tenant}:${info.id ?? pathTail}`,
        source: `workday:${tenant}`,
        company: tenant,
        title: info.title ?? "",
        location: info.location ?? "",
        url: normalized,
        description: html ? stripHtml(html) : (info.title ?? ""),
        descriptionMd: html ? htmlToMarkdown(html) : (info.title ?? ""),
        postedAt: info.postedOn,
        fetchedAt: now,
        track: inferTrack(info.title ?? ""),
        parsedYoe: { min: null, max: null, unknown: true },
        locationMatch: "global_remote",
      };
    } catch {
      return null;
    }
  }

  return null;
}

// ---------- Main ----------

async function main(): Promise<void> {
  const dbId = process.env["NOTION_DATABASE_ID"]?.replace(/-/g, "");
  if (!dbId) {
    console.error("[backfill] NOTION_DATABASE_ID not set");
    process.exit(2);
  }

  console.log(
    `[backfill] starting — max ${MAX_BACKFILL_PER_RUN} rows/run, skip-if-prefilled=${SKIP_IF_PREFILL_PRESENT}`
  );

  // Load profiles + prewarm embeddings
  const profiles = await loadProfiles(ROOT);
  for (const p of profiles) {
    if (!p.embedding) {
      const signal = `${p.parsed.summary}\n\nSkills: ${p.parsed.skills
        .map((c) => `${c.category}: ${c.items.join(", ")}`)
        .join(" | ")}`;
      p.embedding = await embedText(signal, "RETRIEVAL_DOCUMENT");
    }
  }

  let seen = 0;
  let skipped = 0;
  let processed = 0;
  let failed = 0;
  let unresolvable = 0;

  for await (const page of queryAllPages(dbId)) {
    seen++;
    if (processed >= MAX_BACKFILL_PER_RUN) {
      console.log(
        `[backfill] hit MAX_BACKFILL_PER_RUN=${MAX_BACKFILL_PER_RUN}; stopping. Re-run to continue.`
      );
      break;
    }

    const rowName = readText(page, "Name") || "(unnamed)";
    const jdUrl = readUrl(page, "JD URL");
    const existingPrefill = readText(page, "Prefill Data");

    if (SKIP_IF_PREFILL_PRESENT && existingPrefill.trim().length > 10) {
      skipped++;
      continue;
    }

    if (!jdUrl) {
      console.warn(`[backfill] skip ${rowName}: no JD URL`);
      skipped++;
      continue;
    }

    console.log(`[backfill] ${rowName} ← ${jdUrl.slice(0, 80)}`);
    const job = await resolveJob(jdUrl);
    if (!job) {
      console.warn(`[backfill] unresolvable: ${rowName} (${jdUrl})`);
      unresolvable++;
      continue;
    }

    const jdText = job.descriptionMd || job.description;
    if (!jdText) {
      console.warn(`[backfill] empty JD body: ${rowName}`);
      unresolvable++;
      continue;
    }

    try {
      const picked = await pickProfile(profiles, jdText, job.track);
      const atsMatch = computeAtsMatch(jdText, picked.profile.md);
      const fit = await computeFitScore(job, atsMatch, picked.profile.embedding);

      let llm: LlmOutput;
      try {
        llm = await tailorForJob(picked.profile.parsed, picked.profile.md, job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        llm = { ok: false, error: msg };
      }

      const qualityResults = llm.ok ? runQualityChecks(llm.data, job) : [];
      const qualityWarnings = qualityResults
        .filter((r) => !r.passes)
        .flatMap((r) => r.warnings.map((w) => `${r.field}: ${w}`));

      const prefillAnswers = llm.ok ? llm.data.prefill_answers : null;
      const prefillData = JSON.stringify({
        version: PROMPT_VERSION,
        answers: prefillAnswers ?? {},
        standard_hints: {
          cover_note: llm.ok ? llm.data.cover_note : "",
          referral_draft: llm.ok ? llm.data.referral_draft : "",
          why_company_summary: prefillAnswers?.why_company ?? "",
        },
      });

      const qwSummary = qualityWarnings.length
        ? `${qualityWarnings.length} warning(s): ${qualityWarnings.slice(0, 3).join(" | ")}`
        : "";
      const verdict = llm.ok ? llm.data.verdict : "unknown";

      // PATCH selective properties — Status/Applied At/Response Type untouched.
      await patchPageProperties(page.id, {
        "Prefill Data": {
          rich_text: [{ text: { content: prefillData.slice(0, 2000) } }],
        },
        "Prompt Version": { select: { name: PROMPT_VERSION } },
        "Resume Variant": { select: { name: picked.profile.name } },
        "Quality Warnings": qwSummary
          ? { rich_text: [{ text: { content: qwSummary.slice(0, 2000) } }] }
          : { rich_text: [] },
        Verdict: { select: { name: verdict.slice(0, 100) } },
        Fit: { number: Math.round(fit.overall * 100) },
      });

      console.log(
        `[backfill] ✓ ${rowName} — verdict=${verdict} fit=${(fit.overall * 100).toFixed(0)}% qw=${qualityWarnings.length}`
      );
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] failed ${rowName}: ${msg.slice(0, 200)}`);
      failed++;
    }

    // Throttle: 300ms between rows to respect Notion rate limits + LLM.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(
    `[backfill] done — seen=${seen} processed=${processed} skipped=${skipped} unresolvable=${unresolvable} failed=${failed}`
  );
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
