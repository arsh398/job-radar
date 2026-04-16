// TODO: SmartRecruiters adapter
// Endpoint: https://api.smartrecruiters.com/v1/companies/{company}/postings
// Public, no auth. Implement when needed.
import type { SourceAdapter } from "../types.ts";

export const smartrecruitersAdapter: SourceAdapter = {
  name: "smartrecruiters",
  fetch: async () => [],
};
