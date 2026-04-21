// Ad-hoc single-job tailoring entry point.
//
// Called with a JD URL as the first argument. Detects the ATS from the URL,
// fetches the single job's details (title + company + JD body), runs the
// full tailor pipeline (profile pick → ATS match → fit score → LLM tailor
// → PDF render → Notion write). Deliberately skips the age/location/title/
// YOE filters — when you explicitly paste a URL, you want it processed
// regardless of what the cron-time filters would have said.
//
// Usage:   tsx scripts/tailor-one.ts <URL>
// Exits non-zero on fetch failure, Notion failure, or missing credentials.

import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadProfiles, pickProfile } from "../src/resume/profiles.ts";
import { applyPlan } from "../src/resume/apply.ts";
import { buildVariants } from "../src/resume/variants.ts";
import { computeAtsMatch } from "../src/filters/ats_match.ts";
import { computeFitScore } from "../src/match/score.ts";
import { embedText } from "../src/match/embeddings.ts";
import { tailorForJob } from "../src/llm/index.ts";
import { runQualityChecks } from "../src/llm/validator.ts";
import { PROMPT_VERSION } from "../src/llm/prompt.ts";
import { renderMarkdownToPdf, closePdfBrowser } from "../src/pdf/render.ts";
import { sendAlertToNotion } from "../src/notion/index.ts";
import { getJson, postJson } from "../src/sources/http.ts";
import { htmlToMarkdown, stripHtml } from "../src/sources/md.ts";
import type {
  Job,
  FilteredJob,
  JobAlert,
  LlmOutput,
  PdfAttachment,
  Track,
} from "../src/types.ts";

loadEnv();

const ROOT = resolve(process.cwd());
const CANDIDATE_NAME = process.env["CANDIDATE_NAME"] ?? "Mohammed Arsh Khan";

// ---------- URL → single-job fetchers ----------

type SingleJob = {
  job: Job;
  detected: string;
};

// Greenhouse public board URLs look like:
//   https://boards.greenhouse.io/{slug}/jobs/{id}
//   https://job-boards.greenhouse.io/{slug}/jobs/{id}
//   https://{company}.greenhouse.io/jobs/{id}  (hosted subdomain variant)
async function tryGreenhouse(url: string): Promise<SingleJob | null> {
  const m1 = /^https?:\/\/(?:job-)?boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/.exec(url);
  if (m1) {
    const [, slug, id] = m1;
    const api = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?questions=false`;
    const j = await getJson<{
      id: number;
      title: string;
      location?: { name: string };
      absolute_url: string;
      company_name?: string;
      content?: string;
      first_published?: string;
      updated_at?: string;
    }>(api);
    const html = (j.content ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return {
      detected: "greenhouse",
      job: {
        key: `greenhouse:${slug}:${j.id}`,
        source: `greenhouse:${slug}`,
        company: j.company_name ?? slug,
        title: j.title,
        location: j.location?.name ?? "",
        url: j.absolute_url ?? url,
        description: stripHtml(html),
        descriptionMd: htmlToMarkdown(html),
        postedAt: j.first_published ?? j.updated_at,
        fetchedAt: new Date().toISOString(),
      },
    };
  }
  return null;
}

// Lever URLs:  https://jobs.lever.co/{slug}/{postingId}
async function tryLever(url: string): Promise<SingleJob | null> {
  const m = /^https?:\/\/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/.exec(url);
  if (!m) return null;
  const [, slug, postingId] = m;
  const api = `https://api.lever.co/v0/postings/${slug}/${postingId}?mode=json`;
  const j = await getJson<{
    id: string;
    text: string;
    hostedUrl: string;
    createdAt?: number;
    categories?: { location?: string };
    description?: string;
    additional?: string;
    lists?: { text: string; content: string }[];
  }>(api);
  const descHtml = [
    j.description ?? "",
    ...(j.lists ?? []).map((l) => `<h3>${l.text}</h3>${l.content}`),
    j.additional ?? "",
  ].join("\n");
  return {
    detected: "lever",
    job: {
      key: `lever:${slug}:${j.id}`,
      source: `lever:${slug}`,
      company: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      title: j.text,
      location: j.categories?.location ?? "",
      url: j.hostedUrl ?? url,
      description: stripHtml(descHtml),
      descriptionMd: htmlToMarkdown(descHtml),
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      fetchedAt: new Date().toISOString(),
    },
  };
}

// Ashby URLs:  https://jobs.ashbyhq.com/{slug}/{jobId}
async function tryAshby(url: string): Promise<SingleJob | null> {
  const m = /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([a-f0-9-]+)/.exec(url);
  if (!m) return null;
  const [, slug, jobId] = m;
  // Ashby's posting-api returns all jobs for a board; filter client-side to
  // the specific id. Cheaper than chasing their authenticated GraphQL endpoint.
  const api = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const data = await getJson<{
    jobs: Array<{
      id: string;
      title: string;
      location: string;
      secondaryLocations?: { location?: string }[];
      isRemote?: boolean;
      jobUrl: string;
      applyUrl?: string;
      descriptionHtml?: string;
      publishedAt?: string;
    }>;
  }>(api);
  const j = (data.jobs ?? []).find((x) => x.id === jobId);
  if (!j) throw new Error(`Ashby posting ${jobId} not found on board ${slug}`);
  const loc = [
    j.location,
    ...(j.secondaryLocations ?? []).map((s) => s.location ?? ""),
    j.isRemote ? "Remote" : "",
  ]
    .filter(Boolean)
    .join(" | ");
  return {
    detected: "ashby",
    job: {
      key: `ashby:${slug}:${j.id}`,
      source: `ashby:${slug}`,
      company: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      title: j.title,
      location: loc,
      url: j.jobUrl || j.applyUrl || url,
      description: stripHtml(j.descriptionHtml ?? ""),
      descriptionMd: htmlToMarkdown(j.descriptionHtml ?? ""),
      postedAt: j.publishedAt,
      fetchedAt: new Date().toISOString(),
    },
  };
}

// Workable:  https://apply.workable.com/{slug}/j/{shortcode}/
//            https://{slug}.workable.com/j/{shortcode}
async function tryWorkable(url: string): Promise<SingleJob | null> {
  const m1 = /^https?:\/\/apply\.workable\.com\/([^/]+)\/j\/([^/?#]+)/i.exec(url);
  const m2 = /^https?:\/\/([^.]+)\.workable\.com\/j\/([^/?#]+)/i.exec(url);
  const m = m1 ?? m2;
  if (!m) return null;
  const [, slug, shortcode] = m;
  const api = `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
  const data = await getJson<{
    name?: string;
    jobs?: Array<{
      shortcode?: string;
      id?: string;
      title?: string;
      full_title?: string;
      country?: string;
      city?: string;
      state?: string;
      remote?: boolean;
      published_on?: string;
      created_at?: string;
      shortlink?: string;
      url?: string;
      description?: string;
      requirements?: string;
      benefits?: string;
    }>;
  }>(api);
  const j = (data.jobs ?? []).find((x) => x.shortcode === shortcode || x.id === shortcode);
  if (!j) throw new Error(`Workable posting ${shortcode} not found on ${slug}`);
  const html = [j.description, j.requirements, j.benefits].filter(Boolean).join("<br/><br/>");
  const loc = [j.city, j.state, j.country, j.remote ? "Remote" : ""]
    .filter(Boolean)
    .join(", ");
  return {
    detected: "workable",
    job: {
      key: `workable:${slug}:${shortcode}`,
      source: `workable:${slug}`,
      company: data.name ?? slug,
      title: j.title ?? j.full_title ?? "",
      location: loc,
      url: j.shortlink || j.url || url,
      description: html ? stripHtml(html) : (j.title ?? ""),
      descriptionMd: html ? htmlToMarkdown(html) : (j.title ?? ""),
      postedAt: j.published_on || j.created_at,
      fetchedAt: new Date().toISOString(),
    },
  };
}

// SmartRecruiters:  https://jobs.smartrecruiters.com/{company}/{id}
async function trySmartRecruiters(url: string): Promise<SingleJob | null> {
  const m = /^https?:\/\/jobs\.smartrecruiters\.com\/([^/]+)\/(\d+)/.exec(url);
  if (!m) return null;
  const [, slug, id] = m;
  const api = `https://api.smartrecruiters.com/v1/companies/${slug}/postings/${id}`;
  const j = await getJson<{
    id: string;
    name: string;
    location?: { city?: string; region?: string; country?: string; remote?: boolean };
    postingUrl?: string;
    applyUrl?: string;
    releasedDate?: string;
    createdOn?: string;
    jobAd?: {
      sections?: {
        jobDescription?: { text?: string };
        qualifications?: { text?: string };
        additionalInformation?: { text?: string };
      };
    };
  }>(api);
  const s = j.jobAd?.sections;
  const html = [s?.jobDescription?.text, s?.qualifications?.text, s?.additionalInformation?.text]
    .filter(Boolean)
    .join("<br/><br/>");
  const loc = [j.location?.city, j.location?.region, j.location?.country, j.location?.remote ? "Remote" : ""]
    .filter(Boolean)
    .join(", ");
  return {
    detected: "smartrecruiters",
    job: {
      key: `smartrecruiters:${slug}:${j.id}`,
      source: `smartrecruiters:${slug}`,
      company: slug,
      title: j.name,
      location: loc,
      url: j.postingUrl || j.applyUrl || url,
      description: html ? stripHtml(html) : j.name,
      descriptionMd: html ? htmlToMarkdown(html) : j.name,
      postedAt: j.releasedDate || j.createdOn,
      fetchedAt: new Date().toISOString(),
    },
  };
}

// Workday URLs look like:
//   https://{tenant}.wd{N}.myworkdayjobs.com/{site}/job/{loc}/{title}_{reqId}
//   https://{tenant}.wd{N}.myworkdayjobs.com/en-US/{site}/job/...
async function tryWorkday(url: string): Promise<SingleJob | null> {
  const m = /^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:(?:[a-z]{2}-[A-Z]{2})\/)?([^/]+)(\/.+)$/.exec(url);
  if (!m) return null;
  const [, tenant, wdN, site, pathTail] = m;
  // Workday detail GET: .../wday/cxs/{tenant}/{site}/job{externalPath}
  // externalPath is the URL tail starting at /job/... (no site prefix).
  const externalPath = pathTail.replace(/^\/job/, "/job"); // normalize
  const api = `https://${tenant}.${wdN}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${externalPath}`;
  const data = await getJson<{
    jobPostingInfo?: {
      id?: string;
      title?: string;
      location?: string;
      postedOn?: string;
      jobDescription?: string;
      externalUrl?: string;
    };
  }>(api);
  const info = data.jobPostingInfo;
  if (!info) throw new Error(`Workday detail missing for ${externalPath}`);
  const html = info.jobDescription ?? "";
  return {
    detected: "workday",
    job: {
      key: `workday:${tenant}:${info.id ?? externalPath}`,
      source: `workday:${tenant}`,
      company: tenant,
      title: info.title ?? "",
      location: info.location ?? "",
      url: info.externalUrl ?? url,
      description: html ? stripHtml(html) : (info.title ?? ""),
      descriptionMd: html ? htmlToMarkdown(html) : (info.title ?? ""),
      postedAt: info.postedOn,
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function resolveUrl(url: string): Promise<SingleJob> {
  const resolvers = [tryGreenhouse, tryLever, tryAshby, tryWorkable, trySmartRecruiters, tryWorkday];
  for (const fn of resolvers) {
    try {
      const out = await fn(url);
      if (out) return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tailor-one] ${fn.name} failed: ${msg}`);
      throw err;
    }
  }
  throw new Error(
    `[tailor-one] URL not recognized as Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Workday: ${url}`
  );
}

// ---------- Track inference from title (minimal heuristic) ----------

const AI_RE = /\b(ml|ai|machine\s+learning|applied\s+scientist|nlp|computer\s+vision|gen\s*ai|llm|mle|deep\s+learning|data\s+scientist)\b/i;

function inferTrack(title: string): Track {
  return AI_RE.test(title) ? "ai" : "sde";
}

// ---------- Filename helper ----------

function toTitleSlug(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

function pdfFilename(company: string, variantSuffix: string): string {
  const name = CANDIDATE_NAME.replace(/\s+/g, "-");
  const cleanCompany = toTitleSlug(company.replace(/[^\w\s]/g, ""));
  const suffix = variantSuffix ? `-${variantSuffix}` : "";
  return `${name}-${cleanCompany}-Resume${suffix}.pdf`;
}

// ---------- Main ----------

// Strip hash and trailing slash so that URLs from different entry points
// (user-typed, Notion-clicked, extension auto-detected) normalize to the
// same string. Keeps query params since some ATSes use them as job keys
// (e.g. Greenhouse's ?gh_jid=X redirect chain).
function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    // Strip trailing slash from path unless path is just "/"
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return u;
  }
}

async function main(): Promise<void> {
  const rawUrl = process.argv[2];
  if (!rawUrl) {
    console.error("Usage: tsx scripts/tailor-one.ts <JD_URL>");
    process.exit(2);
  }
  const url = normalizeUrl(rawUrl);

  console.log(`[tailor-one] resolving ${url}`);
  const { job, detected } = await resolveUrl(url);
  // Override the job's URL with the user-provided (normalized) input URL.
  // This is what the extension polls against — if we stored the ATS's
  // canonical URL instead, the poll never matches.
  job.url = url;
  console.log(`[tailor-one] detected ats=${detected} company="${job.company}" title="${job.title}"`);

  const track = inferTrack(job.title);
  const jdText = job.descriptionMd || job.description;
  if (!jdText) {
    throw new Error(`[tailor-one] JD body empty after fetch — cannot tailor`);
  }

  const filtered: FilteredJob = {
    ...job,
    track,
    parsedYoe: { min: null, max: null, unknown: true },
    // Ad-hoc URLs bypass the location filter entirely — user explicitly
    // asked for this one. Mark as global_remote so Notion's location
    // column has a sane value.
    locationMatch: "global_remote",
  };

  const profiles = await loadProfiles(ROOT);
  for (const p of profiles) {
    if (!p.embedding) {
      const signal = `${p.parsed.summary}\n\nSkills: ${p.parsed.skills
        .map((c) => `${c.category}: ${c.items.join(", ")}`)
        .join(" | ")}`;
      p.embedding = await embedText(signal, "RETRIEVAL_DOCUMENT");
    }
  }
  const picked = await pickProfile(profiles, jdText, track);
  console.log(`[tailor-one] profile=${picked.profile.name}`);

  const atsMatch = computeAtsMatch(jdText, picked.profile.md);
  const fit = await computeFitScore(filtered, atsMatch, picked.profile.embedding);
  console.log(
    `[tailor-one] fit=${(fit.overall * 100).toFixed(0)}% ats=${(fit.ats * 100).toFixed(0)}% sem=${(fit.semantic * 100).toFixed(0)}% yoe=${(fit.yoe * 100).toFixed(0)}%`
  );

  let llm: LlmOutput;
  try {
    llm = await tailorForJob(picked.profile.parsed, picked.profile.md, filtered);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    llm = { ok: false, error: msg };
  }
  if (!llm.ok) {
    console.warn(`[tailor-one] LLM failed: ${llm.error}`);
  } else {
    console.log(`[tailor-one] verdict=${llm.data.verdict}`);
  }

  const pdfs: PdfAttachment[] = [];
  if (llm.ok && llm.data.verdict !== "skip") {
    try {
      const { markdown: tailoredMd, warnings } = applyPlan(
        picked.profile.parsed,
        picked.profile.md,
        llm.data,
        jdText
      );
      if (warnings.length) {
        console.warn(`[tailor-one] apply-plan fixes: ${warnings.length}`);
      }
      const variants = buildVariants();
      for (const v of variants) {
        const variantMd = v.transform(tailoredMd);
        const buffer = await renderMarkdownToPdf(variantMd);
        pdfs.push({
          buffer,
          filename: pdfFilename(job.company, v.suffix),
          caption: v.caption.slice(0, 1000),
        });
      }
      console.log(`[tailor-one] rendered ${pdfs.length} PDF variants`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tailor-one] PDF render failed: ${msg}`);
    }
  }

  const qualityResults = llm.ok ? runQualityChecks(llm.data, filtered) : [];
  const qualityWarnings = qualityResults
    .filter((r) => !r.passes)
    .flatMap((r) => r.warnings.map((w) => `${r.field}: ${w}`));
  if (qualityWarnings.length) {
    console.warn(`[tailor-one] ${qualityWarnings.length} quality warning(s)`);
    for (const w of qualityWarnings.slice(0, 5)) console.warn(`  - ${w}`);
  }

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

  const alert: JobAlert = {
    job: filtered,
    llm,
    atsMatch,
    fit,
    profileName: picked.profile.name,
    pdfs,
    qualityWarnings,
    promptVersion: PROMPT_VERSION,
    prefillData,
  };

  await sendAlertToNotion(alert);
  console.log(`[tailor-one] done`);

  await closePdfBrowser();
}

main().catch((err) => {
  console.error("[tailor-one] fatal:", err);
  process.exit(1);
});
