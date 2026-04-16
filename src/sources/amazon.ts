// Amazon careers custom adapter. Public search.json endpoint returns every
// currently-open Amazon role (~2900+ India roles). No auth, no rate limit
// observed. Response fields are generous — we get description_short, YOE
// hint ("basic_qualifications"), and posted_date.

import type { Job, SourceAdapter } from "../types.ts";
import { getJson } from "./http.ts";

type AmazonJob = {
  id: string;
  title: string;
  normalized_location?: string;
  city?: string;
  country_code?: string;
  description?: string;
  description_short?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
  posted_date?: string;
  job_path: string;
  is_intern?: boolean;
};

type AmazonResponse = {
  jobs: AmazonJob[];
  hits?: number;
};

const BASE = "https://www.amazon.jobs";

function parsePostedDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  // "April 16, 2026" → ISO
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return undefined;
}

async function fetchIndia(): Promise<Job[]> {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 3; // up to 300 newest India roles per run
  const now = new Date().toISOString();
  const out: Job[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const url = `${BASE}/en/search.json?normalized_country_code%5B%5D=IND&result_limit=${PAGE_SIZE}&offset=${offset}&sort=recent`;
    const resp = await getJson<AmazonResponse>(url);
    const jobs = resp.jobs ?? [];
    if (!jobs.length) break;
    for (const j of jobs) {
      const desc = [
        j.description_short ?? "",
        j.description ?? "",
        j.basic_qualifications
          ? `\n\nBasic qualifications:\n${j.basic_qualifications}`
          : "",
        j.preferred_qualifications
          ? `\n\nPreferred qualifications:\n${j.preferred_qualifications}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      out.push({
        key: `amazon:${j.id}`,
        source: "amazon",
        company: "Amazon",
        title: j.title,
        location: j.normalized_location || j.city || "India",
        url: BASE + j.job_path,
        description: desc,
        descriptionMd: desc,
        postedAt: parsePostedDate(j.posted_date),
        fetchedAt: now,
      });
    }
    if (jobs.length < PAGE_SIZE) break;
  }
  return out;
}

export const amazonAdapter: SourceAdapter = {
  name: "amazon",
  fetch: async () => {
    try {
      return await fetchIndia();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[amazon] failed: ${reason.slice(0, 200)}`);
      return [];
    }
  },
};
