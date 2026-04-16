// TODO: Workday generic adapter
// Pattern: POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/External/jobs
// Needs per-tenant discovery of wdN number + site path. Implement as one adapter
// iterating over BY_ATS.workday entries. Each tenant gets its own wd-number
// and site-path in config.
import type { SourceAdapter } from "../types.ts";

export const workdayAdapter: SourceAdapter = {
  name: "workday",
  fetch: async () => [],
};
