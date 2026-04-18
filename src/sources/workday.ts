// Workday generic adapter — biggest coverage unlock. Pattern:
//   POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
//   body: {"limit":20,"offset":0,"searchText":""}
//   response: {total, jobPostings: [{title, locationsText, externalPath, postedOn}]}
//
// Two-stage fetch: (1) list all jobs via the /jobs POST endpoint, (2) for
// postings whose location hints at India/remote, GET /job{externalPath} to
// pull the full jobDescription HTML. Stage-2 is batched (5 parallel, 150ms
// gap) and skipped for obviously region-locked postings — cuts detail calls
// by ~80% and avoids rate-limiting while still giving LLM real JD text for
// the postings that matter.

import type { Job, SourceAdapter } from "../types.ts";
import { getJson, postJson } from "./http.ts";

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

// Verified live 2026-04-16 against the public Workday APIs. Broken
// tenants are flagged by source_health and can be pruned if they fail
// consistently.
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
  // Expansion batch — common Workday tenants in tech. Unverified slugs
  // here are cheaper than missing the employer entirely; adapter wraps
  // per-tenant failure and source_health will surface broken ones.
  { name: "Visa", tenant: "visa", wdN: "wd1", site: "Visa" },
  { name: "Cisco", tenant: "cisco", wdN: "wd5", site: "Cisco" },
  { name: "HP", tenant: "hp", wdN: "wd5", site: "ExternalCareerSite" },
  { name: "HPE", tenant: "hpe", wdN: "wd5", site: "jobs" },
  { name: "Qualcomm", tenant: "qualcomm", wdN: "wd5", site: "External" },
  { name: "Micron", tenant: "micron", wdN: "wd1", site: "External" },
  { name: "Accenture", tenant: "accenture", wdN: "wd3", site: "AccentureCareers" },
  { name: "Capgemini", tenant: "capgemini", wdN: "wd3", site: "CapgeminiCareers" },
  { name: "Juniper Networks", tenant: "juniper", wdN: "wd5", site: "JuniperCareers" },
  { name: "Synopsys", tenant: "synopsys", wdN: "wd1", site: "Careers" },
  { name: "Cadence", tenant: "cadence", wdN: "wd1", site: "External_Careers" },
  { name: "ServiceNow", tenant: "servicenow", wdN: "wd1", site: "ServiceNow" },
  { name: "Red Hat", tenant: "redhat", wdN: "wd5", site: "jobs" },
  { name: "Citrix", tenant: "citrix", wdN: "wd5", site: "Citrix" },
  { name: "Akamai", tenant: "akamai", wdN: "wd1", site: "External_Careers" },
  { name: "Broadcom", tenant: "broadcom", wdN: "wd5", site: "External_Career_Site" },
  { name: "Splunk", tenant: "splunk", wdN: "wd5", site: "ExternalSplunkCareers" },
  { name: "VMware", tenant: "vmware", wdN: "wd1", site: "VMware" },
  { name: "Arista", tenant: "arista", wdN: "wd5", site: "External" },
  { name: "Zscaler", tenant: "zscaler", wdN: "wd5", site: "ExternalCareerSite" },
  { name: "CrowdStrike", tenant: "crowdstrike", wdN: "wd5", site: "crowdstrikecareers" },
  { name: "Fortinet", tenant: "fortinet", wdN: "wd5", site: "External" },
  { name: "Palo Alto Networks", tenant: "paloaltonetworks", wdN: "wd1", site: "PaloAltoNetworks" },
  { name: "Tesla", tenant: "tesla", wdN: "wd1", site: "External" },
  { name: "Flipkart", tenant: "flipkart", wdN: "wd3", site: "Careers" },
  { name: "Swiggy", tenant: "swiggy", wdN: "wd3", site: "External" },
  { name: "Target India", tenant: "target", wdN: "wd5", site: "targetcareers" },
  { name: "Thomson Reuters", tenant: "thomsonreuters", wdN: "wd3", site: "External_Career_Site" },
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
  // appliedFacets: {} is required by several Workday tenants (ServiceNow,
  // Cisco, Synopsys, Capgemini, etc). Harmless on the ones that don't
  // require it, so include by default.
  return postJson<WorkdayResponse>(url, {
    appliedFacets: {},
    limit,
    offset,
    searchText: "",
  });
}

type WorkdayDetailResponse = {
  jobPostingInfo?: {
    jobDescription?: string;
    location?: string;
    postedOn?: string;
    timeType?: string;
  };
};

// Pre-fetch filter: only fetch JD body for rows whose list-level location
// hints at India or unqualified Remote, or where location is empty (JD
// body might reveal it). Cuts detail calls ~80% vs. fetching-all.
const LOCATION_WORTH_DETAIL = /\b(india|bangalore|bengaluru|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|chennai|noida|kolkata|remote|anywhere|worldwide|global)\b/i;

async function fetchDetail(
  t: WorkdayTenant,
  externalPath: string
): Promise<string | undefined> {
  const url = `https://${t.tenant}.${t.wdN}.myworkdayjobs.com/wday/cxs/${t.tenant}/${t.site}/job${externalPath}`;
  try {
    const resp = await getJson<WorkdayDetailResponse>(url, {
      timeoutMs: 12_000,
      retries: 1,
    });
    return resp.jobPostingInfo?.jobDescription;
  } catch {
    return undefined;
  }
}

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

  // Fetch JD bodies for India/remote-hinted postings, batched 5-parallel.
  const BATCH = 5;
  const GAP_MS = 150;
  const detailsMap = new Map<string, string>();
  const worthDetail = collected.filter(
    (p) => !p.locationsText || LOCATION_WORTH_DETAIL.test(p.locationsText)
  );
  for (let i = 0; i < worthDetail.length; i += BATCH) {
    const batch = worthDetail.slice(i, i + BATCH);
    const resolved = await Promise.all(
      batch.map(async (p) => ({
        key: p.externalPath,
        body: await fetchDetail(t, p.externalPath),
      }))
    );
    for (const r of resolved) {
      if (r.body) detailsMap.set(r.key, r.body);
    }
    if (i + BATCH < worthDetail.length) {
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  const base = `https://${t.tenant}.${t.wdN}.myworkdayjobs.com/${t.site}`;
  return collected.map((p): Job => {
    const reqId = p.bulletFields?.[0] ?? p.externalPath.split("_").pop() ?? p.externalPath;
    const jdHtml = detailsMap.get(p.externalPath);
    // Summary-only fallback for jobs we didn't fetch detail for (regional
    // mismatches, rate limit, etc). These score low on semantic fit but
    // still pass the funnel if location matches.
    const summary = `${p.title} · ${p.locationsText ?? ""} · ${t.name}`;
    return {
      key: `workday:${t.tenant}:${reqId}`,
      source: `workday:${t.tenant}`,
      company: t.name,
      title: p.title,
      location: p.locationsText ?? "",
      url: base + p.externalPath,
      description: jdHtml ? jdHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : summary,
      descriptionMd: jdHtml ?? summary,
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
