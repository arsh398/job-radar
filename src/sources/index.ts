import type { SourceAdapter, SourceResult } from "../types.ts";
import { greenhouseAdapter } from "./greenhouse.ts";
import { leverAdapter } from "./lever.ts";
import { ashbyAdapter } from "./ashby.ts";

// Only adapters with real implementations are registered. Stubs
// (workable/smartrecruiters/workday/custom_json/custom_scraper) return empty
// lists and were polluting source-health with false "ok=true, 0 jobs" signals.
// Re-add them here once each is implemented.
export const ALL_ADAPTERS: SourceAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
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
