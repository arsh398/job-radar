// SmartRecruiters adapter — public API, no auth.
//   List:   GET https://api.smartrecruiters.com/v1/companies/{company}/postings
//   Detail: GET https://api.smartrecruiters.com/v1/companies/{company}/postings/{id}
//
// List returns id/name/location/releasedDate but we need detail for the JD
// body. We fetch details batched so scoring has real text.

import type { Job, SourceAdapter } from "../types.ts";
import { BY_ATS } from "../config/companies.ts";
import { getJson } from "./http.ts";
import { htmlToMarkdown, stripHtml } from "./md.ts";

type SRLocation = {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
  fullLocation?: string;
};

type SRPosting = {
  id: string;
  name: string;
  uuid?: string;
  refNumber?: string;
  location?: SRLocation;
  locations?: SRLocation[];
  releasedDate?: string;
  createdOn?: string;
  postingUrl?: string;
  applyUrl?: string;
};

type SRListResponse = {
  offset?: number;
  limit?: number;
  totalFound?: number;
  content: SRPosting[];
};

type SRDetail = SRPosting & {
  jobAd?: {
    sections?: {
      companyDescription?: { text?: string; title?: string };
      jobDescription?: { text?: string; title?: string };
      qualifications?: { text?: string; title?: string };
      additionalInformation?: { text?: string; title?: string };
    };
  };
};

function formatLocation(p: SRPosting): string {
  const parts: string[] = [];
  const primary = p.location;
  if (primary) {
    if (primary.fullLocation) parts.push(primary.fullLocation);
    else {
      const chunks = [primary.city, primary.region, primary.country].filter(Boolean);
      if (chunks.length) parts.push(chunks.join(", "));
    }
    if (primary.remote) parts.push("Remote");
  }
  if (p.locations?.length) {
    for (const l of p.locations) {
      const s = l.fullLocation || [l.city, l.region, l.country].filter(Boolean).join(", ");
      if (s && !parts.includes(s)) parts.push(s);
      if (l.remote && !parts.includes("Remote")) parts.push("Remote");
    }
  }
  return parts.join(" | ");
}

async function fetchDetail(company: string, id: string): Promise<SRDetail | null> {
  const url = `https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`;
  try {
    return await getJson<SRDetail>(url, { timeoutMs: 15_000, retries: 1 });
  } catch {
    return null;
  }
}

async function fetchCompany(slug: string, name: string): Promise<Job[]> {
  const listUrl = `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`;
  const data = await getJson<SRListResponse>(listUrl, { timeoutMs: 20_000 });
  const listed = data.content ?? [];
  const now = new Date().toISOString();

  const BATCH = 5;
  const GAP_MS = 150;
  const details: Array<SRDetail | null> = [];
  for (let i = 0; i < listed.length; i += BATCH) {
    const batch = listed.slice(i, i + BATCH);
    const resolved = await Promise.all(batch.map((p) => fetchDetail(slug, p.id)));
    details.push(...resolved);
    if (i + BATCH < listed.length) {
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  return listed.map((p, idx): Job => {
    const detail = details[idx] ?? null;
    const s = detail?.jobAd?.sections;
    const htmlParts = [
      s?.jobDescription?.text,
      s?.qualifications?.text,
      s?.additionalInformation?.text,
    ].filter(Boolean) as string[];
    const html = htmlParts.join("<br/><br/>");
    return {
      key: `smartrecruiters:${slug}:${p.id}`,
      source: `smartrecruiters:${slug}`,
      company: name,
      title: p.name ?? "",
      location: formatLocation(p),
      url: p.postingUrl || p.applyUrl ||
        `https://jobs.smartrecruiters.com/${slug}/${p.id}`,
      description: html ? stripHtml(html) : p.name,
      descriptionMd: html ? htmlToMarkdown(html) : p.name,
      postedAt: p.releasedDate || p.createdOn,
      fetchedAt: now,
    };
  });
}

export const smartrecruitersAdapter: SourceAdapter = {
  name: "smartrecruiters",
  fetch: async () => {
    const companies = BY_ATS.smartrecruiters;
    if (!companies.length) return [];
    const results = await Promise.allSettled(
      companies.map((c) => fetchCompany(c.slug, c.name))
    );
    const jobs: Job[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const c = companies[i]!;
      if (r.status === "fulfilled") {
        jobs.push(...r.value);
      } else {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`[smartrecruiters:${c.slug}] failed: ${reason.slice(0, 200)}`);
      }
    }
    return jobs;
  },
};
