# job-radar

Personal job discovery + resume-tailoring pipeline. Polls ~60 company career APIs every 30 min, filters India-eligible SDE/AI roles at ≤ 2 YOE, runs each new match through Gemini 2.5 Pro (with Flash + DeepSeek fallbacks) to produce paste-ready resume edits, a concise referral ask, and a cover note, then pushes it all to Telegram.

## Setup (one-time, ~15 minutes)

### 1. Create a private GitHub repo and push

```bash
cd /Users/mohammed.khan/projects/job-radar
git init
git add .
git commit -m "initial scaffold"
gh repo create job-radar --private --source=. --push
```

### 2. Get API keys (all free)

**Gemini** (Google AI Studio): https://aistudio.google.com/apikey — create a key.

**OpenRouter** (DeepSeek fallback): https://openrouter.ai/keys — sign up, create a key. Free tier includes `deepseek/deepseek-chat-v3.1:free`.

**Telegram bot**:
1. Open Telegram, message `@BotFather`
2. Send `/newbot`, follow prompts (name + username)
3. Copy the bot token it returns
4. Send any message to your new bot (start a chat with it)
5. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser
6. Find `"chat":{"id":...}` in the response — that's your chat ID

### 3. Add GitHub Actions secrets

```bash
gh secret set GOOGLE_AI_STUDIO_API_KEY
gh secret set OPENROUTER_API_KEY
gh secret set TELEGRAM_BOT_TOKEN
gh secret set TELEGRAM_CHAT_ID
```

### 4. Enable Actions write permission

Repo → Settings → Actions → General → Workflow permissions → "Read and write permissions" (so the workflow can commit `seen.json` back).

### 5. Verify locally (optional but recommended)

```bash
pnpm install
cp .env.example .env
# fill in values in .env
pnpm dry-run     # fetches sources, applies filters, previews alerts, no Telegram sends
pnpm start       # full run with Telegram sends
```

## What it does

1. **Every 30 min**, GitHub Actions runs `pnpm start`.
2. Fetches jobs from Greenhouse, Lever, Ashby across ~60 configured companies in parallel.
3. Dedupes across sources (same job posted in multiple places) and against `seen.json` (already alerted).
4. Applies filters: India or global-remote-with-India-eligibility location, SDE/AI/DevOps/SRE/Data-Engineer title, min YOE ≤ 2.
5. For each new match (capped at 20/run), calls Gemini 2.5 Pro with your resume + JD, falls back to Flash then DeepSeek on rate-limits.
6. Hallucination validator strips invented skills/numbers from LLM output.
7. Formats result as a Telegram message with:
   - Match score + verdict (🟢 apply / 🟡 apply-with-referral / 🟠 stretch / 🔴 skip)
   - Company context + concerns
   - Paste-ready resume edits (summary, skills, experience bullets, projects)
   - Referral draft (under 300 chars, direct ask)
   - Cover note (3-4 sentences)
8. Commits updated `seen.json` and `source_health.json` back to repo.
9. Alerts if a source has been silent for 48h (silent scraper breakage).

## Configuration

- **Company list**: `src/config/companies.ts` — add companies to the appropriate ATS section.
- **Filters**: `src/filters/` — location patterns, title regex, YOE parsing.
- **Resume**: `resume.md` — single source of truth, LLM tailors per job.
- **Cadence**: `.github/workflows/poll-jobs.yml` — default `*/30 * * * *`.
- **LLM caps**: env vars `MAX_LLM_PER_RUN` (default 20), `ALERT_SKIPS` (default 1).

## Coverage (v1)

**Implemented** — 60+ companies via 3 ATS adapters:
- Greenhouse: Stripe, Airbnb, Coinbase, Databricks, Snowflake, Figma, Notion, Ramp, Atlassian, Cloudflare, GitLab, HashiCorp, MongoDB, DoorDash, Plaid, Robinhood, Discord, Reddit, Rippling, Brex, Postman, Confluent, Datadog, Shopify, Pinterest, Dropbox, Lyft, Instacart, Asana, Okta, Anthropic, Cohere, Mistral, Cursor (anysphere), Glean, Harvey, Writer, ElevenLabs, UiPath, Nutanix, Rubrik, Druva, Wise, Mercury, Harness, and more
- Lever: Elastic, Mixpanel, BrowserStack, Groww, Freshworks, Zepto, Dream11, MPL, CRED, Razorpay
- Ashby: Perplexity, Linear, Vercel, Retool, Replit, OpenAI, Character AI, Runway, LangChain, Pinecone, Anyscale

**Stubbed, pending** — structure ready, adapters return `[]`:
- Workable, SmartRecruiters
- Workday generic (Adobe, Oracle, Salesforce, Walmart, Nvidia, Qualcomm, Mastercard, Visa, PayPal, Block, Cisco, SAP, Intel, Dell)
- Custom JSON (Amazon, Google, Microsoft, Apple, Uber, IBM, ServiceNow, Samsung R&D)
- Indian custom portals (Flipkart, Myntra, Swiggy, Zomato, Paytm, PhonePe, CRED, Razorpay custom, Juspay, Meesho, Zerodha, Ola, Unacademy, Sarvam AI, Krutrim, Ola Krutrim)

Add adapters incrementally — each is an isolated file under `src/sources/` implementing `SourceAdapter`.

## Troubleshooting

- **"Telegram 400"**: double-check `TELEGRAM_CHAT_ID` — must be a number string, not the bot username.
- **"GOOGLE_AI_STUDIO_API_KEY missing"**: secret not set in GitHub Actions.
- **"Schema validation failed"** in logs: LLM returned malformed JSON. One-off — next run retries different model.
- **Silent source**: check `source_health.json` — shows last successful fetch per source.
- **No alerts for hours**: check Actions tab → latest run → logs. Filters may be dropping everything.
- **Too many alerts**: tighten `src/filters/title.ts` regex or lower `MAX_LLM_PER_RUN`.

## Costs

All zero. Gemini free tier handles realistic volume (< 100 new matches/day). GitHub Actions private-repo free tier (2000 min/mo) fits 30-min cadence with ~45s runs.
