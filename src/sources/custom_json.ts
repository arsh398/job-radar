// TODO: Custom JSON adapters for:
//   - Amazon (amazon.jobs/en/search.json)
//   - Google (careers.google.com/api/v3/search/ — POST)
//   - Microsoft (gcsservices.careers.microsoft.com/search/api/v1/search)
//   - Apple (jobs.apple.com/api/role/search — POST)
//   - Uber (uber.com/api/loader/careers/list)
//   - IBM (careers.ibm.com/TGWebHost/searchjobs — POST)
//   - ServiceNow (servicenow.wd1.myworkdayjobs.com — actually workday)
//   - Samsung R&D (samsung.com/in/careers/ — complex, may need scraper)
//
// Each is a separate per-company function; this adapter dispatches to all.
import type { SourceAdapter } from "../types.ts";

export const customJsonAdapter: SourceAdapter = {
  name: "custom_json",
  fetch: async () => [],
};
