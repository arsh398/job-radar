# Notion integration — one-time setup

After this setup, every job-radar run will create a new row in your Notion
database with all the structured fields and the two tailored PDFs attached.
You can sort/filter/status-track the whole pipeline there.

---

## 1. Create a Notion integration (your personal API key)

1. Go to <https://www.notion.so/profile/integrations>
2. Click **New integration**
3. Name it `job-radar`, choose the workspace, leave Type as **Internal**
4. Click **Save**
5. Copy the **Internal Integration Secret** — this is your `NOTION_API_KEY`

## 2. Create the database in Notion

Create a new page in your workspace, then add a full-page **Database**
(not inline) with the exact property schema below. Property names must
match exactly — the code references them by name.

| Property name | Type | Options / notes |
|---|---|---|
| **Name** | Title | (default — leave as title) |
| **Company** | Select | Add options as they appear |
| **Role** | Text (rich text) | |
| **Status** | Select | Options: `New`, `Reviewing`, `Applied`, `Rejected`, `Interview`, `Offer`, `Passed` |
| **Verdict** | Select | Options: `apply`, `apply_with_referral`, `stretch`, `skip`, `unknown` |
| **Track** | Select | Options: `sde`, `ai` |
| **Fit %** | Number | Integer |
| **ATS %** | Number | Integer |
| **Posted** | Date | |
| **Source** | Select | Options: `greenhouse`, `lever`, `ashby`, `workday`, `amazon`, `remoteok` |
| **Location** | Text | |
| **YOE** | Text | |
| **JD URL** | URL | |
| **Missing Keywords** | Text | |
| **LLM Reason** | Text | |
| **Cover Note** | Text | |
| **Referral Draft** | Text | |
| **Resume (primary)** | Files & media | |
| **Resume (alt)** | Files & media | |
| **Key** | Text | (used internally for dedup) |

### Shortcut: add the db from a template

If you'd rather not click through, copy <https://www.notion.so> → create a
database with the columns above. Notion doesn't have a public "import
schema from markdown" feature, so this is manual.

## 3. Share the database with your integration

On the database page → **Share / Connections** (top right) → select your
`job-radar` integration → **Confirm**. Without this, the API returns 404.

## 4. Get the database ID

Open the database as a full page. Look at the URL:

```
https://www.notion.so/workspace/<DATABASE_ID>?v=<VIEW_ID>
```

Copy the 32-character string before the `?v=`. That's your
`NOTION_DATABASE_ID` (hyphens in the URL are optional — the code strips
them).

## 5. Add both secrets to GitHub Actions

```bash
gh secret set NOTION_API_KEY
# paste the integration secret

gh secret set NOTION_DATABASE_ID
# paste the DB id
```

(Or via the web UI at <https://github.com/arsh398/job-radar/settings/secrets/actions>.)

## 6. Verify

Trigger a workflow run or wait for the next cron. The logs should show
`[notion] created Company — Role (abc12345)` for each new alert. Open
your Notion database — new rows appear with all fields populated and
the two tailored PDFs attached as file blocks.

## Suggested Notion views

Once data starts flowing, set up these database views for fast triage:

1. **Table — By fit** — sort by `Fit %` descending, filter `Status = New`
2. **Board — By status** — board view grouped by `Status` column → drag
   cards across the kanban as you move through the pipeline
3. **Table — AI roles only** — filter `Track = ai`, sort by `Fit %` desc
4. **Table — Recent** — sort by `Posted` descending, limit last 14 days
5. **Calendar — Application timeline** — by `Posted` date

## Troubleshooting

- **`401 unauthorized`** — integration secret is wrong or not a real
  Bearer token. Regenerate in Notion → Integrations.
- **`404 Object not found` on queryDatabase** — database wasn't shared
  with the integration. Share → Connections → add `job-radar`.
- **`400 invalid property`** — one of the property names doesn't match
  exactly. Copy them verbatim from the table above.
- **File upload fails** — the `/v1/file_uploads` endpoint requires the
  integration to have the `insert_content` capability. It's included in
  "Internal" integrations by default.
- **Duplicate rows** — the dedup query on `Key` failed. Check the Key
  property exists as a Text type on the database.

## Turning off Telegram (Notion-only mode)

Set `ENABLE_TELEGRAM: '0'` in the workflow env to run silent-to-Notion.
The pipeline will stop posting to Telegram but still fill Notion on
every run.
