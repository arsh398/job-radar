# job-radar

Personal job discovery + resume-tailoring pipeline. Polls ~80 company career APIs every 30 min, filters India-eligible SDE/AI roles at ≤ 2 YOE, runs each new match through Gemini 2.5 Flash-Lite (with fallbacks) to produce a diff-based tailoring plan against a structured resume, applies the plan to build a tailored markdown resume, renders it to an ATS-safe PDF, and pushes the PDF plus referral-ready text to Telegram.

## Why this is different

1. **Zero-hallucination tailoring by construction.** The LLM never generates free-text bullets. It returns a JSON plan with `bullet_plan: [{id, keep, priority, new_text?}]` — every bullet is addressed by a stable ID derived from the parsed `resume.md`. Rephrases are validated token-by-token against (source bullet ∪ JD vocab) before being applied; anything else is dropped and the original text is used.
2. **Two-stage alerts.** An early Telegram ping with `URL + ATS match score + posted-ago` fires the moment a new job clears filters — before any LLM call. The enriched follow-up (verdict, referral DM, cover note, tailored PDF) threads under it a few seconds later. Time-to-click is sub-10s even when LLM is slow.
3. **Deterministic ATS match score.** Every job is scored against a 150+ item tech vocabulary. Displayed in the header, usable for at-a-glance triage without opening the JD.
4. **Tailored PDF, not paste-ready blobs.** The applied plan is rendered through markdown-it + Puppeteer with ATS-safe CSS (single column, serif, no graphics). Attached to Telegram as a ready-to-submit document.

## Setup (~15 minutes)

### 1. Clone & push to a private GitHub repo

```bash
cd /path/to/job-radar
git init
git add .
git commit -m "initial scaffold"
gh repo create job-radar --private --source=. --push
```

### 2. Get API keys (all free)

- **Gemini** — Google AI Studio: <https://aistudio.google.com/apikey>
- **OpenRouter** (fallback) — <https://openrouter.ai/keys>
- **Telegram bot** — message `@BotFather`, run `/newbot`, save the token. Then send any message to your bot, visit `https://api.telegram.org/bot<TOKEN>/getUpdates`, and pull `chat.id`.

### 3. GitHub Actions secrets

```bash
gh secret set GOOGLE_AI_STUDIO_API_KEY
gh secret set OPENROUTER_API_KEY
gh secret set TELEGRAM_BOT_TOKEN
gh secret set TELEGRAM_CHAT_ID
```

Then: Repo → Settings → Actions → General → Workflow permissions → "Read and write permissions" (so the workflow can commit `seen.json` / `source_health.json`).

### 4. Verify locally

```bash
pnpm install
pnpm exec puppeteer browsers install chrome   # one-time, for PDF rendering
cp .env.example .env                           # fill in API keys
pnpm dry-run                                   # no Telegram sends, no LLM calls
pnpm start                                     # full run with Telegram + PDF
```

## What it does

1. **Every 30 min** (configurable) the GH Actions workflow runs `pnpm start`.
2. Fetches jobs in parallel from all registered adapters (Greenhouse, Lever, Ashby).
3. Deduplicates across sources and against `seen.json`.
4. Applies filters: India or global-remote location, SDE/AI/DevOps/SRE/Data-Engineer title, YOE ≤ 2, posted ≤ 14 days ago. Caps 3 per company.
5. Computes a deterministic ATS match score for each passed job.
6. **Stage 1 — early ping:** Telegram header (company, title, location, YOE, ATS %, URL) fires in parallel for every candidate.
7. **Stage 2 — enrichment:** for each job, calls Gemini with the structured resume + JD. The LLM returns a `TailoringPlan` with bullet IDs. Fallback chain: Flash-Lite → Flash → 2.0-Flash → OpenRouter Llama 3.3 70B.
8. The plan is applied to the parsed resume: bullets kept/hidden/reordered, skills emphasis applied, new summary inserted (after validation).
9. Tailored markdown → ATS-safe PDF via Puppeteer.
10. Enrichment messages (verdict, referral draft, cover note) thread under the early ping, followed by the PDF attached as a document.
11. Commits updated `seen.json` and `source_health.json` back to the repo.
12. Alerts if any source has been silent for 48h+.

## Architecture

```
src/
├── sources/           Live adapters (greenhouse, lever, ashby) + retrying HTTP
├── filters/           Age, location, title, YOE, and ATS match scoring
├── resume/            Parser (resume.md → structured bullets) + plan applier
├── llm/               Gemini + OpenRouter callers, plan validator, fallback chain
├── pdf/               markdown-it → Puppeteer → ATS-safe PDF
├── telegram/          Early ping + enrichment + document send
├── storage/           seen.json dedup + source_health.json
├── config/            Company list (per-ATS)
├── types.ts           Zod schemas for the full pipeline
└── index.ts           Orchestrator
```

## Configuration

- **Companies** — `src/config/companies.ts`. Add to the relevant ATS section. Verify the slug is live with `curl` before committing.
- **Filters** — `src/filters/`. Title regex in `title.ts`, YOE patterns in `yoe.ts`, etc.
- **Resume** — `resume.md`. Bullets are auto-parsed into IDs like `exp-product-engineer-juspay-0`. Edit freely; IDs re-generate on each run.
- **Cron cadence** — `.github/workflows/poll-jobs.yml` (`*/30 * * * *` default).
- **LLM caps** — env `MAX_LLM_PER_RUN` (default 20).
- **Per-company cap** — env `MAX_PER_COMPANY` (default 3).
- **Age cutoff** — env `MAX_AGE_DAYS` (default 14).
- **PDF** — env `ENABLE_PDF` (default on; set to `0` to skip rendering).

## Coverage

Currently 80+ companies across 3 ATS adapters, verified live on 2026-04-16:

- **Greenhouse (~43):** Stripe, Airbnb, Coinbase, Databricks, Figma, Cloudflare, GitLab, MongoDB, Robinhood, Discord, Reddit, Brex, Postman, Datadog, Pinterest, Dropbox, Lyft, Instacart, Asana, Okta, PagerDuty, Airtable, Webflow, Affirm, Anthropic, LaunchDarkly, Temporal, PlanetScale, Scale AI, Together AI, Fireworks AI, Algolia, Netlify, Twilio, Rubrik, Druva, Celonis, Mercury, Glean, DeepMind, Neuralink, Elastic, Mixpanel, Groww.
- **Lever (~7):** CRED, Freshworks, Paytm, Meesho, Upstox, Mistral, StackBlitz.
- **Ashby (~31):** Perplexity, Linear, Vercel, Retool, Replit, Statsig, Character AI, LangChain, Pinecone, Anyscale, Runway, Cursor, Notion, Supabase, Docker, Plaid, Confluent, Zapier, Sentry, Ramp, Zip, Braintrust, Poolside, Decagon, Contextual AI, ElevenLabs, Baseten, Nous Research, Bolt, Turbopuffer, Sarvam AI.

Gaps (known, not yet adapter-backed):
- **Workday tenants** — Adobe, Oracle, Salesforce, Nvidia, Qualcomm, Mastercard, Visa, PayPal, Cisco, SAP, Intel, Dell. Needs a generic Workday adapter (tenant + wdN number + site path per company).
- **FAANG** — Amazon, Google, Microsoft, Apple, Meta. Each runs a custom careers API.
- **Indian portals** — Razorpay, Zepto, Dream11, MPL, Flipkart, Myntra, Swiggy, Zomato, PhonePe, Juspay, Zerodha, Ola, Unacademy, Krutrim. Most have custom portals; each needs its own scraper.
- **Moved off public ATS** — Atlassian, Snowflake, HashiCorp, DoorDash, Rippling, Shopify. Custom scrapers.

Adapter files for pending ATS types exist under `src/sources/` as stubs but are not registered in `ALL_ADAPTERS` — register them once each is real.

## Troubleshooting

- **"Telegram 400" on sendDocument** — caption probably contains unescaped MarkdownV2 characters, or file is too large (PDF limit 50 MB; ours are ~150KB).
- **"Schema validation failed" in logs** — LLM returned a malformed plan. One-off; the fallback chain retries with a different model.
- **"rephrase rejected" warnings** — the LLM tried to introduce vocabulary not in the source bullet or JD. The validator prevented hallucination; the original bullet was used.
- **Silent source** — check `source_health.json`. Shows last successful fetch per source. If a source has been silent for 48h a broken-sources alert fires once.
- **No alerts for hours** — check Actions logs. Filters may be dropping everything. Run `pnpm exec tsx scripts/diagnose.ts` to see the funnel breakdown and what locations are being rejected.
- **Too many alerts** — tighten `src/filters/title.ts` regex, lower `MAX_LLM_PER_RUN`, or raise the YOE ceiling in `src/filters/yoe.ts` (default 2).

## Costs

All zero. Gemini free tier handles ~960 calls/day (20 jobs × 48 runs) within the 1500 RPD limit of Flash-Lite. GH Actions private-repo free tier (2000 min/month) fits a 30-min cadence with ~60-90s runs.
