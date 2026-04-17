// RemoteOK public JSON feed. ~100 active remote jobs at any time. Most
// are US/global remote, but some are India-eligible (India-remote, APAC,
// Worldwide). The location filter + skill-ontology handle the signal.

import type { Job, SourceAdapter } from "../types.ts";
import { getJson } from "./http.ts";

type RemoteOkEntry = {
  slug?: string;
  id?: string;
  date?: string;
  epoch?: number;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  apply_url?: string;
  url?: string;
  legal?: string;
};

export const remoteokAdapter: SourceAdapter = {
  name: "remoteok",
  fetch: async () => {
    try {
      const data = await getJson<RemoteOkEntry[]>("https://remoteok.com/api", {
        headers: {
          "user-agent":
            "job-radar/0.1 (+https://github.com/arsh398/job-radar; link-back to remoteok.com)",
        },
      });
      const now = new Date().toISOString();
      const jobs: Job[] = [];
      for (const j of data) {
        if (j.legal) continue; // First entry is ToS notice.
        if (!j.id || !j.position || !j.company) continue;
        const location = j.location || "Remote";
        const tags = (j.tags ?? []).join(", ");
        const desc = [
          j.description ?? "",
          tags ? `\nTags: ${tags}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        jobs.push({
          key: `remoteok:${j.id}`,
          source: "remoteok",
          company: j.company,
          title: j.position,
          location,
          url: j.url || j.apply_url || "",
          description: desc,
          descriptionMd: desc,
          postedAt: j.date
            ? j.date
            : j.epoch
              ? new Date(j.epoch * 1000).toISOString()
              : undefined,
          fetchedAt: now,
        });
      }
      return jobs;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[remoteok] failed: ${reason.slice(0, 200)}`);
      return [];
    }
  },
};
