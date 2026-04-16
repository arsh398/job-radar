import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SourceHealthMap, SourceResult } from "../types.ts";

const SILENCE_ALERT_MS = 48 * 60 * 60 * 1000;

export async function loadHealth(path: string): Promise<SourceHealthMap> {
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as SourceHealthMap;
  } catch {
    return {};
  }
}

export function updateHealth(
  health: SourceHealthMap,
  results: SourceResult[]
): { health: SourceHealthMap; brokenSources: string[] } {
  const now = new Date().toISOString();
  const brokenSources: string[] = [];

  for (const r of results) {
    const prev = health[r.source] ?? {
      lastRun: now,
      lastOk: null,
      lastFail: null,
      consecutiveFailures: 0,
      lastJobCount: 0,
      lastJobCountAt: null,
      alerted: false,
    };

    const next = { ...prev, lastRun: now };

    if (r.ok) {
      next.lastOk = now;
      next.consecutiveFailures = 0;
      if (r.jobs.length > 0) {
        next.lastJobCount = r.jobs.length;
        next.lastJobCountAt = now;
        next.alerted = false;
      } else if (prev.lastJobCountAt) {
        const silenceMs = Date.now() - Date.parse(prev.lastJobCountAt);
        if (
          silenceMs > SILENCE_ALERT_MS &&
          prev.lastJobCount > 0 &&
          !prev.alerted
        ) {
          brokenSources.push(r.source);
          next.alerted = true;
        }
      }
    } else {
      next.lastFail = now;
      next.consecutiveFailures = prev.consecutiveFailures + 1;
      if (next.consecutiveFailures >= 3 && !prev.alerted) {
        brokenSources.push(r.source);
        next.alerted = true;
      }
    }

    health[r.source] = next;
  }

  return { health, brokenSources };
}

export async function saveHealth(
  path: string,
  health: SourceHealthMap
): Promise<void> {
  const sorted: SourceHealthMap = {};
  for (const key of Object.keys(health).sort()) {
    sorted[key] = health[key]!;
  }
  await writeFile(path, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}
