// Workable adapter — public widget API, no auth.
//   List (with JD bodies): GET https://apply.workable.com/api/v1/widget/accounts/{slug}
//
// This endpoint is what Workable's own "embed jobs on your careers page"
// widget uses. It returns {name, description, jobs: [{id, title, shortcode,
// url, country, city, state, description, requirements, benefits, ...}]}
// — JD body is included, so no second-fetch needed.

import type { Job, SourceAdapter } from "../types.ts";
import { BY_ATS } from "../config/companies.ts";
import { getJson } from "./http.ts";
import { htmlToMarkdown, stripHtml } from "./md.ts";

type WorkableWidgetJob = {
  id?: string;
  shortcode?: string;
  title?: string;
  full_title?: string;
  url?: string;
  application_url?: string;
  shortlink?: string;
  country?: string;
  city?: string;
  state?: string;
  location?: {
    country?: string;
    city?: string;
    region?: string;
  };
  created_at?: string;
  published_on?: string;
  remote?: boolean;
  department?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
};

type WorkableWidgetResponse = {
  name?: string;
  description?: string | null;
  jobs?: WorkableWidgetJob[];
};

function formatLocation(j: WorkableWidgetJob): string {
  const locs: string[] = [];
  const primary = j.location ?? {};
  const city = j.city ?? primary.city;
  const country = j.country ?? primary.country;
  const region = j.state ?? primary.region;
  if (city) locs.push(city);
  if (region && region !== city) locs.push(region);
  if (country) locs.push(country);
  if (j.remote) locs.push("Remote");
  return locs.join(", ");
}

async function fetchCompany(slug: string, name: string): Promise<Job[]> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
  const data = await getJson<WorkableWidgetResponse>(url, { timeoutMs: 20_000 });
  const listed = data.jobs ?? [];
  const now = new Date().toISOString();

  return listed.map((j): Job => {
    const html = [j.description, j.requirements, j.benefits]
      .filter(Boolean)
      .join("<br/><br/>");
    const shortcode = j.shortcode ?? j.id ?? "";
    return {
      key: `workable:${slug}:${shortcode}`,
      source: `workable:${slug}`,
      company: name,
      title: j.title ?? j.full_title ?? "",
      location: formatLocation(j),
      url: j.shortlink || j.url || j.application_url ||
        `https://apply.workable.com/${slug}/j/${shortcode}`,
      description: html ? stripHtml(html) : (j.title ?? ""),
      descriptionMd: html ? htmlToMarkdown(html) : (j.title ?? ""),
      postedAt: j.published_on || j.created_at,
      fetchedAt: now,
    };
  });
}

export const workableAdapter: SourceAdapter = {
  name: "workable",
  fetch: async () => {
    const companies = BY_ATS.workable;
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
        console.error(`[workable:${c.slug}] failed: ${reason.slice(0, 200)}`);
      }
    }
    return jobs;
  },
};
