import type { FilteredJob, Job } from "../types.ts";
import { matchLocation } from "./location.ts";
import { matchTitle } from "./title.ts";
import { decideYoe, parseYoe } from "./yoe.ts";

export type FilterStats = {
  total: number;
  droppedLocation: number;
  droppedTitle: number;
  droppedYoe: number;
  passed: number;
};

export function applyFilters(
  jobs: Job[]
): { passed: FilteredJob[]; stats: FilterStats; dropReasons: Record<string, number> } {
  const stats: FilterStats = {
    total: jobs.length,
    droppedLocation: 0,
    droppedTitle: 0,
    droppedYoe: 0,
    passed: 0,
  };
  const dropReasons: Record<string, number> = {};
  const passed: FilteredJob[] = [];

  for (const job of jobs) {
    const loc = matchLocation(job.location);
    if (loc === "no_match") {
      stats.droppedLocation++;
      continue;
    }
    const title = matchTitle(job.title);
    if (!title.pass) {
      stats.droppedTitle++;
      dropReasons[title.reason] = (dropReasons[title.reason] ?? 0) + 1;
      continue;
    }
    const yoe = decideYoe(job.description);
    if (!yoe.pass) {
      stats.droppedYoe++;
      dropReasons[yoe.reason] = (dropReasons[yoe.reason] ?? 0) + 1;
      continue;
    }
    const parsedYoe = parseYoe(job.description);
    passed.push({
      ...job,
      track: title.track,
      parsedYoe,
      locationMatch: loc,
    });
    stats.passed++;
  }

  return { passed, stats, dropReasons };
}
