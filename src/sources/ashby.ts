import type { Job, SourceAdapter } from "../types.ts";
import { BY_ATS } from "../config/companies.ts";
import { getJson } from "./http.ts";
import { htmlToMarkdown, stripHtml } from "./md.ts";

type AshbyJob = {
  id: string;
  title: string;
  location: string;
  locationIds?: string[];
  secondaryLocations?: { location?: string }[];
  department?: string;
  team?: string;
  employmentType?: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  isRemote?: boolean;
};

type AshbyResponse = {
  apiVersion?: string;
  jobs: AshbyJob[];
};

async function fetchCompany(slug: string, name: string): Promise<Job[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const data = await getJson<AshbyResponse>(url);
  const now = new Date().toISOString();
  return (data.jobs ?? []).map((j) => {
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
      company: name,
      title: j.title,
      location: loc,
      url: j.jobUrl || j.applyUrl || "",
      description: stripHtml(j.descriptionHtml ?? ""),
      descriptionMd: htmlToMarkdown(j.descriptionHtml ?? ""),
      postedAt: j.publishedAt,
      fetchedAt: now,
    };
  });
}

export const ashbyAdapter: SourceAdapter = {
  name: "ashby",
  fetch: async () => {
    const companies = BY_ATS.ashby;
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
        console.error(`[ashby:${c.slug}] failed: ${r.reason}`);
      }
    }
    return jobs;
  },
};
