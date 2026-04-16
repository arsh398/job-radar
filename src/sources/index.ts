import type { SourceAdapter, SourceResult } from "../types.ts";
import { greenhouseAdapter } from "./greenhouse.ts";
import { leverAdapter } from "./lever.ts";
import { ashbyAdapter } from "./ashby.ts";
import { workableAdapter } from "./workable.ts";
import { smartrecruitersAdapter } from "./smartrecruiters.ts";
import { workdayAdapter } from "./workday.ts";
import { customJsonAdapter } from "./custom_json.ts";
import { customScraperAdapter } from "./custom_scraper.ts";

export const ALL_ADAPTERS: SourceAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workableAdapter,
  smartrecruitersAdapter,
  workdayAdapter,
  customJsonAdapter,
  customScraperAdapter,
];

export async function runAllAdapters(): Promise<SourceResult[]> {
  const results = await Promise.all(
    ALL_ADAPTERS.map(async (adapter): Promise<SourceResult> => {
      const start = Date.now();
      try {
        const jobs = await adapter.fetch();
        return {
          source: adapter.name,
          ok: true,
          jobs,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          source: adapter.name,
          ok: false,
          jobs: [],
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        };
      }
    })
  );
  return results;
}
