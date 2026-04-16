import type { Job, SourceAdapter } from "../types.ts";
import { BY_ATS } from "../config/companies.ts";
import { getJson } from "./http.ts";
import { htmlToMarkdown, stripHtml } from "./md.ts";

type LeverJob = {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
  };
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  additional?: string;
  lists?: { text: string; content: string }[];
};

async function fetchCompany(slug: string, name: string): Promise<Job[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const data = await getJson<LeverJob[]>(url);
  const now = new Date().toISOString();
  return (data ?? []).map((j) => {
    const descHtml = [
      j.description ?? "",
      ...(j.lists ?? []).map((l) => `<h3>${l.text}</h3>${l.content}`),
      j.additional ?? "",
    ].join("\n");
    return {
      key: `lever:${slug}:${j.id}`,
      source: `lever:${slug}`,
      company: name,
      title: j.text,
      location: j.categories?.location ?? "",
      url: j.hostedUrl,
      description:
        stripHtml(descHtml) ||
        j.descriptionPlain ||
        j.additionalPlain ||
        "",
      descriptionMd: htmlToMarkdown(descHtml),
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      fetchedAt: now,
    };
  });
}

export const leverAdapter: SourceAdapter = {
  name: "lever",
  fetch: async () => {
    const companies = BY_ATS.lever;
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
        console.error(`[lever:${c.slug}] failed: ${r.reason}`);
      }
    }
    return jobs;
  },
};
