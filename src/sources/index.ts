import type { SourceAdapter, SourceResult } from "../types.ts";
import { greenhouseAdapter } from "./greenhouse.ts";
import { leverAdapter } from "./lever.ts";
import { ashbyAdapter } from "./ashby.ts";
import { workdayAdapter } from "./workday.ts";
import { amazonAdapter } from "./amazon.ts";

// Adapters with real implementations only. Remaining stubs (workable,
// smartrecruiters, custom_scraper) return empty lists and would pollute
// source-health with false "ok=true, 0 jobs" — re-add once they have
// real fetchers.
export const ALL_ADAPTERS: SourceAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workdayAdapter,
  amazonAdapter,
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
