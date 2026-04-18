import type { SourceAdapter, SourceResult } from "../types.ts";
import { greenhouseAdapter } from "./greenhouse.ts";
import { leverAdapter } from "./lever.ts";
import { ashbyAdapter } from "./ashby.ts";
import { workdayAdapter } from "./workday.ts";
import { amazonAdapter } from "./amazon.ts";
import { remoteokAdapter } from "./remoteok.ts";
import { workableAdapter } from "./workable.ts";
import { smartrecruitersAdapter } from "./smartrecruiters.ts";

export const ALL_ADAPTERS: SourceAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workdayAdapter,
  workableAdapter,
  smartrecruitersAdapter,
  amazonAdapter,
  remoteokAdapter,
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
