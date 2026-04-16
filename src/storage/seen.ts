import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Job, SeenMap } from "../types.ts";

const PRUNE_DAYS = 90;
const PRUNE_MS = PRUNE_DAYS * 24 * 60 * 60 * 1000;

export async function loadSeen(path: string): Promise<SeenMap> {
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as SeenMap;
  } catch {
    return {};
  }
}

export function splitNewAndSeen(
  jobs: Job[],
  seen: SeenMap
): { fresh: Job[]; known: Job[] } {
  const fresh: Job[] = [];
  const known: Job[] = [];
  for (const j of jobs) {
    if (seen[j.key]) known.push(j);
    else fresh.push(j);
  }
  return { fresh, known };
}

export function recordSeen(seen: SeenMap, jobs: Job[]): SeenMap {
  const now = new Date().toISOString();
  for (const j of jobs) {
    if (!seen[j.key]) {
      seen[j.key] = {
        firstSeen: now,
        company: j.company,
        title: j.title,
      };
    }
  }
  return seen;
}

export function pruneSeen(seen: SeenMap): SeenMap {
  const cutoff = Date.now() - PRUNE_MS;
  const pruned: SeenMap = {};
  for (const [key, entry] of Object.entries(seen)) {
    const t = Date.parse(entry.firstSeen);
    if (!Number.isFinite(t)) continue;
    if (t >= cutoff) pruned[key] = entry;
  }
  return pruned;
}

export async function saveSeen(path: string, seen: SeenMap): Promise<void> {
  const sorted: SeenMap = {};
  for (const key of Object.keys(seen).sort()) {
    sorted[key] = seen[key]!;
  }
  await writeFile(path, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}
