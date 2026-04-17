// Workday generic adapter — biggest coverage unlock. Pattern:
//   POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
//   body: {"limit":20,"offset":0,"searchText":""}
//   response: {total, jobPostings: [{title, locationsText, externalPath, postedOn}]}
//
// Workday only returns a summary per posting (no JD body). We accept that
// tradeoff — filters operate on title+location, the LLM gets the same
// summary for tailoring. YOE will be `unknown` for most Workday postings;
// they still pass the filter and Mohammed can click through.

import type { Job, SourceAdapter } from "../types.ts";
import { postJson } from "./http.ts";

type WorkdayJobPosting = {
  title: string;
  externalPath: string;
  locationsText: string;
  postedOn?: string;
  bulletFields?: string[];
  timeLeftToApply?: string;
};

type WorkdayResponse = {
  total: number;
  jobPostings: WorkdayJobPosting[];
};

export type WorkdayTenant = {
  name: string;
  tenant: string; // e.g. "adobe"
  wdN: string; // "wd1".."wd12"
  site: string; // e.g. "external_experienced"
};

// Verified live 2026-04-16 against the public Workday APIs.
export const WORKDAY_TENANTS: WorkdayTenant[] = [
  { name: "Adobe", tenant: "adobe", wdN: "wd5", site: "external_experienced" },
  { name: "Nvidia", tenant: "nvidia", wdN: "wd5", site: "NVIDIAExternalCareerSite" },
  { name: "Salesforce", tenant: "salesforce", wdN: "wd12", site: "External_Career_Site" },
  { name: "PayPal", tenant: "paypal", wdN: "wd1", site: "jobs" },
  { name: "Mastercard", tenant: "mastercard", wdN: "wd1", site: "CorporateCareers" },
  { name: "Intel", tenant: "intel", wdN: "wd1", site: "External" },
  { name: "Dell", tenant: "dell", wdN: "wd1", site: "External" },
  { name: "Walmart", tenant: "walmart", wdN: "wd5", site: "WalmartExternal" },
  { name: "Netflix", tenant: "netflix", wdN: "wd1", site: "Netflix" },
  { name: "Autodesk", tenant: "autodesk", wdN: "wd1", site: "Ext" },
  { name: "Workday", tenant: "workday", wdN: "wd5", site: "workday" },
];

// Best-effort parse of Workday's fuzzy relative-date strings into ISO. We
// use mid-window estimates because Workday's buckets are coarse — "Posted
// Today" covers the full 0-24h window, not "right this minute". Mapping
// "Today" to now.toISOString() made jobs posted this morning display as
// "just now" in Telegram which was misleading.
//
// Mapping:
//   "Posted Today"     → 12h ago (midpoint of 0-24h)
//   "Posted Yesterday" → 36h ago (midpoint of 24-48h)
//   "Posted N Days Ago"/"N Days Ago" → N × 24h (lower bound; accurate when
//     Workday shows exact days, safe when it shows "30+")
//
// Examples: "Posted Today", "Posted 3 Days Ago", "Posted 30+ Days Ago".
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function parsePostedOn(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const now = Date.now();
  const lower = s.toLowerCase();
  if (lower.includes("yesterday")) {
    return new Date(now - 36 * HOUR_MS).toISOString();
  }
  const m = /posted\s+(\d+)\+?\s+day/i.exec(s);
  if (m) {
    const days = parseInt(m[1]!, 10);
    return new Date(now - days * DAY_MS).toISOString();
  }
  const m2 = /(\d+)\+?\s+days?\s+ago/i.exec(s);
  if (m2) {
    const days = parseInt(m2[1]!, 10);
    return new Date(now - days * DAY_MS).toISOString();
  }
  if (lower.includes("today")) {
    return new Date(now - 12 * HOUR_MS).toISOString();
  }
  return undefined;
}

async function fetchTenantPage(
  t: WorkdayTenant,
  offset: number,
  limit: number
): Promise<WorkdayResponse> {
  const url = `https://${t.tenant}.${t.wdN}.myworkdayjobs.com/wday/cxs/${t.tenant}/${t.site}/jobs`;
  return postJson<WorkdayResponse>(url, { limit, offset, searchText: "" });
}

// Fetch India + remote roles up to a cap. Workday paginates 20 at a time.
// We pull first 60 rows per tenant — far more than we need after filters,
// and keeps each tenant's fetch under 3 round-trips.
async function fetchTenant(t: WorkdayTenant): Promise<Job[]> {
  const PAGE_SIZE = 20;
  const MAX_PAGES = 3;
  const now = new Date().toISOString();
  const collected: WorkdayJobPosting[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const resp = await fetchTenantPage(t, page * PAGE_SIZE, PAGE_SIZE);
    const postings = resp.jobPostings ?? [];
    if (!postings.length) break;
    collected.push(...postings);
    if (collected.length >= resp.total) break;
  }
  // Job URLs must include the site path — without it Workday returns 404.
  // e.g. /jobs/job/... (not /job/...).
  const base = `https://${t.tenant}.${t.wdN}.myworkdayjobs.com/${t.site}`;
  return collected.map((p) => {
    const reqId = p.bulletFields?.[0] ?? p.externalPath.split("_").pop() ?? p.externalPath;
    return {
      key: `workday:${t.tenant}:${reqId}`,
      source: `workday:${t.tenant}`,
      company: t.name,
      title: p.title,
      location: p.locationsText ?? "",
      url: base + p.externalPath,
      description: `${p.title} · ${p.locationsText ?? ""} · ${t.name}`,
      descriptionMd: `${p.title} · ${p.locationsText ?? ""} · ${t.name}`,
      postedAt: parsePostedOn(p.postedOn),
      fetchedAt: now,
    };
  });
}

export const workdayAdapter: SourceAdapter = {
  name: "workday",
  fetch: async () => {
    const results = await Promise.allSettled(
      WORKDAY_TENANTS.map((t) => fetchTenant(t))
    );
    const jobs: Job[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const t = WORKDAY_TENANTS[i]!;
      if (r.status === "fulfilled") {
        jobs.push(...r.value);
      } else {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`[workday:${t.tenant}] failed: ${reason.slice(0, 200)}`);
      }
    }
    return jobs;
  },
};
