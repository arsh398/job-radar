// One-shot Notion database bootstrap.
//
// Prereqs:
//   - NOTION_API_KEY env var set (the integration secret)
//   - A Notion page shared with the integration — its page id passed as argv
//
// Usage:
//   NOTION_API_KEY=secret_xxx pnpm exec tsx scripts/setup-notion.ts <parent_page_id>
//
// Creates the `job-radar` database under that page with the full 20-property
// schema the pipeline expects. Prints the DATABASE_ID — paste it into the
// NOTION_DATABASE_ID GitHub secret.

const API_VERSION = "2022-06-28";
const BASE = "https://api.notion.com/v1";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env["NOTION_API_KEY"];
  if (!key) {
    console.error("NOTION_API_KEY env var is required");
    process.exit(1);
  }
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      "notion-version": API_VERSION,
      "content-type": "application/json",
      ...(init.headers as Record<string, string>),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Notion ${res.status}: ${text}`);
    process.exit(1);
  }
  return JSON.parse(text) as T;
}

async function main() {
  const parentId = process.argv[2];
  if (!parentId) {
    console.error("Usage: tsx scripts/setup-notion.ts <parent_page_id>");
    console.error(
      "Create any page in Notion, share with your integration, copy its 32-char id from the URL."
    );
    process.exit(1);
  }

  // Slim schema: only the fields that deserve a table column (triage/
  // sort/filter signals). Everything else (cover note, referral draft,
  // missing keywords, full match details) goes into each row's page
  // body as formatted blocks — click a row to see the rich detail
  // without cluttering the table view.
  const properties: Record<string, unknown> = {
    Name: { title: {} },
    Status: {
      select: {
        options: [
          { name: "New", color: "blue" },
          { name: "Reviewing", color: "yellow" },
          { name: "Applied", color: "green" },
          { name: "Interview", color: "purple" },
          { name: "Offer", color: "pink" },
          { name: "Rejected", color: "red" },
          { name: "Passed", color: "gray" },
        ],
      },
    },
    Fit: { number: { format: "number" } },
    Verdict: {
      select: {
        options: [
          { name: "apply", color: "green" },
          { name: "apply_with_referral", color: "yellow" },
          { name: "stretch", color: "orange" },
          { name: "skip", color: "red" },
          { name: "unknown", color: "gray" },
        ],
      },
    },
    Posted: { date: {} },
    Source: {
      select: {
        options: [
          { name: "greenhouse", color: "green" },
          { name: "lever", color: "blue" },
          { name: "ashby", color: "purple" },
          { name: "workday", color: "orange" },
          { name: "amazon", color: "yellow" },
          { name: "remoteok", color: "gray" },
        ],
      },
    },
    "JD URL": { url: {} },
    Resume: { files: {} },
    Key: { rich_text: {} },
  };

  const resp = await apiFetch<{ id: string; url: string }>("/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentId.replace(/-/g, "") },
      title: [{ type: "text", text: { content: "Job Radar — Applications" } }],
      properties,
    }),
  });

  console.log("");
  console.log("  ✓ Database created.");
  console.log("");
  console.log(`  DATABASE_ID = ${resp.id.replace(/-/g, "")}`);
  console.log("");
  console.log("  Next: gh secret set NOTION_DATABASE_ID");
  console.log("        (paste the id above when prompted)");
  console.log("");
  console.log(`  Open the DB: ${resp.url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
