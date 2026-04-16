// TODO: Workable adapter — api.workable.com/spi/v3/...
// Endpoint shape: https://apply.workable.com/api/v1/widget/accounts/{slug}
// Free to call, no auth. Implement when needed.
import type { SourceAdapter } from "../types.ts";

export const workableAdapter: SourceAdapter = {
  name: "workable",
  fetch: async () => [],
};
