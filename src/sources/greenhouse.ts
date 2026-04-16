import type { Job, SourceAdapter } from "../types.ts";
import { BY_ATS } from "../config/companies.ts";
import { getJson } from "./http.ts";
import { htmlToMarkdown, stripHtml } from "./md.ts";

type GreenhouseJob = {
  id: number;
  title: string;
  location: { name: string };
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  content?: string;
};

type GreenhouseResponse = {
  jobs: GreenhouseJob[];
};

async function fetchCompany(slug: string, name: string): Promise<Job[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const data = await getJson<GreenhouseResponse>(url);
  const now = new Date().toISOString();
  return (data.jobs ?? []).map((j) => {
    const decodedContent = j.content ? decodeHtmlEntities(j.content) : "";
    return {
      key: `greenhouse:${slug}:${j.id}`,
      source: `greenhouse:${slug}`,
      company: name,
      title: j.title ?? "",
      location: j.location?.name ?? "",
      url: j.absolute_url,
      description: stripHtml(decodedContent),
      descriptionMd: htmlToMarkdown(decodedContent),
      postedAt: j.first_published ?? j.updated_at,
      fetchedAt: now,
    };
  });
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

export const greenhouseAdapter: SourceAdapter = {
  name: "greenhouse",
  fetch: async () => {
    const companies = BY_ATS.greenhouse;
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
        console.error(`[greenhouse:${c.slug}] failed: ${r.reason}`);
      }
    }
    return jobs;
  },
};
