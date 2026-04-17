# Mohammed Arsh Khan

Bangalore, India · mdarshkhan9898@gmail.com · +91 9131110480 · linkedin.com/in/mdarshkhan · github.com/arshkhann98

---

## Summary

Product Engineer with 2 years shipping production systems at Juspay (Kubernetes-based remote execution, MCP tooling) and Avalara (customer-facing tax APIs, WCAG-compliant UI). Built AI behavioral testing platforms and deterministic web QA scanners.

## Work Experience

### Product Engineer — Juspay
*Feb 2026 – Present · Bangalore*

- Designed and built **Cerebellum**, a Kubernetes-based remote execution environment handling 500 concurrent jobs with JWT-authenticated REST APIs, enabling 70+ developers to run CI commands on any branch without local codebase setup. Deployed across AWS S3 (ap-south-1), 2 ECR accounts, and multi-region GCS.
- Architected a **snapshot pipeline with incremental git-diff overlays** on GCS/AWS S3 tarballs, eliminating full repository clones per run. Execution pods pull only changed files, bounded by 5-minute snapshot pull+extract, 2 GB pod memory, and 10-minute per-command ceilings.
- Built **MCP bridge** (433 LOC) exposing 2 Cerebellum tools (`run_checks`, `get_check_status`) to **Tara**, a Slack-based AI assistant — enabling it to execute arbitrary commands against any branch and codebase state on demand, with intelligent response truncation (512 KB cap) and async job polling.
- Built **Jenkins CI pipelines** with parallel Yama AI review + compilation stages across 3 deployment targets (S3 + 2 ECR accounts + GCS), auto-triggered on PR detection with auto-deployment flag parsing.

### Software Engineer — Avalara
*Jul 2024 – Jan 2026 · Pune*

- Built and integrated **10+ RESTful API endpoints** for the MVR (Motor Vehicle Rental) tax filing portal — handling document uploads, draft preparation, and compliance checks used by thousands of customers across US tax jurisdictions.
- Resolved **50+ WCAG accessibility violations** flagged by axe and WAVE, bringing the customer-facing portal to **zero errors** reported by both tools.
- Refactored 20+ high-complexity modules, reviewed 100+ merge requests, and maintained CI/CD pipelines using Jest and GitLab CI within a **6-person engineering team**.

## Projects

### Probe — AI Behavioral Testing Platform
*Python, FastAPI, sentence-transformers, sympy, SQLModel*

Tests LLMs for sycophancy, goal drift, and sandbagging — detecting when models agree with false claims, change answers under pressure, or hide capabilities.

- Architected a **zero-AI scoring pipeline** with 5 independent verifiers (sympy symbolic math, sandboxed code execution, cached ground-truth database, 25-pattern regex hedge detection, and local sentence-transformer embeddings), eliminating circular AI-evaluating-AI dependency.
- Designed a **polymorphic template system with 400 pressure templates across 8 escalation levels** (NEUTRAL→META), with fitness-scored evolutionary mutation. Tests 4 LLM providers (Anthropic, OpenAI, Google, OpenAI-compatible) across a 17-table SQLModel schema.
- Built **KS-test dual-behavior detection** with a 1%-sampling canary SDK (146 LOC) that intercepts live LLM traffic and compares response distributions against test baselines (min 30 samples), catching models behaving differently in eval vs production.

### Rove — Deterministic Web QA Scanner
*TypeScript, Next.js, Playwright, Prisma*

Scans web applications by testing every interactive element — finds bugs that manual testers and URL-based crawlers miss.

- Architected **deterministic-first scanning**: 12 heuristic bug classifiers (form validation, network errors, console crashes, UX regressions) handle the majority of bug detection. Single batched LLM call for ambiguous interactions (max 30, 15 per batch) plus one optional summary call = **2 LLM calls per full scan**.
- Designed **DOM hash-based state queue** (DJB2 hash of tagName+className) for SPA sub-state deduplication, capturing modals and dynamic views URL-based crawlers miss. Path-pattern paginator caps states per template to prevent crawl explosions.
- Integrated **axe-core (4.9.1) accessibility audits + 5 security header checks** (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) + mixed-content/sensitive-data detection into a single scan pass, with real-time SSE streaming to a Next.js dashboard (past-event replay on reconnect).

## Skills

**Languages**: TypeScript, JavaScript, Python, C#

**Backend & APIs**: Node.js, Express.js, FastAPI, .NET, REST APIs, Prisma, SQLModel

**Frontend**: React, Next.js, SSE streaming, real-time dashboards

**AI & LLM Engineering**: Claude Agent SDK, MCP (Model Context Protocol), LLM evaluation and behavioral testing, sentence-transformers, zero-AI scoring pipelines

**Cloud & Infrastructure**: AWS (S3, ECR, EKS, IRSA), GCP (GCS, Autopilot), Docker, Kubernetes, Jenkins, GitLab CI/CD

**Databases**: PostgreSQL, SQLite

**Testing & Quality**: Jest, Vitest, Playwright, axe-core, WAVE, SonarQube, KS-test statistical analysis

## Education

**Bachelor of Engineering in Computer Science** — 2020–2024
*Institute of Engineering and Technology, DAVV, Indore* · CGPA 8.32

## Achievements

- **ICPC Regionalist** (2021, 2023) · **Codeforces Expert** · **Leetcode Knight** · **CodeChef 5★** · 1200+ problems solved across competitive programming platforms
