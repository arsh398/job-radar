# Job Radar Apply Assist

Chrome extension that autofills application forms and brings your Notion-tracked tailored resume + cover note into the apply flow. Falls back to on-demand tailoring via GitHub Actions when a job isn't in Notion yet.

## Install (one-time)

1. In Chrome, go to `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and pick this `extension/` folder.
4. Click the extension's icon (or **Details → Extension options**) and fill in:
   - **Notion token** — integration secret from notion.so/my-integrations (share your job-radar DB with the integration)
   - **Notion database ID** — 32-char ID from your DB URL
   - **GitHub PAT** — personal access token with `workflow` / `actions:write` scope
   - **GitHub repo** — `arsh398/job-radar`
   - **Profile JSON** — your common fields (name, email, phone, LinkedIn, GitHub, location)

## How it works

When you open a job/apply page on any supported ATS (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday):

1. **Common fields auto-fill** from the saved profile JSON. Runs on every matched page, no Notion call needed.
2. **URL match against Notion** — if the current URL matches a row's **JD URL** property, the floating panel shows:
   - Tailored resume PDFs (one click → browser download → drag into the upload field)
   - **Cover Note** — one-click copy
   - **Referral DM** — one-click copy
   - **Mark Applied** — updates the Notion row's Status
3. **Unmatched page** — panel offers **Tailor for this URL**. Click it → the extension dispatches `tailor-ad-hoc.yml` on GitHub with the current URL. It polls Notion every 15 s; once the new row lands (2–3 min), the panel switches to the matched view.

## Notion schema expected

The extension reads/writes these properties from your job-radar DB:

| Property | Type | Used for |
|---|---|---|
| Name | title | display |
| Status | select | `Mark Applied` sets to "Applied" |
| Applied At | date | stamped when Status flips |
| Verdict | select | display |
| Fit | number | display |
| Source | select | display |
| JD URL | url | primary URL match key |
| Resume | files | downloaded on click |
| Key | rich_text | (read-only; job-radar writes it) |

"Applied At" is added by this extension. Add it as a Date property in your DB if it's not there yet.

Cover Note and Referral DM are pulled from the page body (code blocks under "Cover Note" / "Referral DM" headings) — that's already how job-radar writes them.

## Known limits

- **File uploads** are not programmatic. The extension downloads the tailored PDF; you drag it into the upload field manually. Browser security can't be bypassed here.
- **LinkedIn job URLs** aren't handled by the ad-hoc tailoring workflow (LinkedIn blocks scraping). Paste a JD URL from the actual ATS.
- **Form field detection** relies on name / id / aria-label / placeholder matching. Most standard ATS fields match; some custom forms may need adjusted aliases in `content.js` (FIELD_MAP).
