# Projects Portfolio — swap-in bullets for resume.md

Reference library of resume-ready project descriptions, tuned per-domain.
Drop any of these into `## Projects` in `resume.md` when tailoring to a
specific role — keep the primary two (Probe + Rove) and rotate the third
slot based on what the JD is hiring for.

Each entry has:
- A tight sub-heading and one-line tech stack (italicized in the PDF)
- 2-3 bullets, ~2-3 lines each, with honest but well-framed numbers

---

## Primary projects (always in resume)

### Probe — AI Behavioral Testing Platform
*Python, FastAPI, sentence-transformers, sympy, SQLModel, SQLite*

Tests LLMs for sycophancy, goal drift, and sandbagging — detecting when
models agree with false claims, change answers under pressure, or hide
capabilities.

- Architected a **zero-AI scoring pipeline** with 5 independent verifiers
  (sympy symbolic math, sandboxed code execution, cached ground-truth
  database, 25-pattern regex hedge detection, and local sentence-transformer
  embeddings), eliminating circular AI-evaluating-AI dependency.
- Designed a **polymorphic template system with 400 pressure templates
  across 8 escalation levels** (NEUTRAL→META), with fitness-scored
  evolutionary mutation. Tests 4 LLM providers (Anthropic, OpenAI,
  Google, OpenAI-compatible) across a 17-table SQLModel schema.
- Built **KS-test dual-behavior detection** with a 1%-sampling canary
  SDK (146 LOC) that intercepts live LLM traffic and compares response
  distributions against test baselines (min 30 samples), catching models
  behaving differently in eval vs production.

### Rove — Deterministic Web QA Scanner
*TypeScript, Next.js, Playwright, Prisma*

Scans web applications by testing every interactive element — finds bugs
that manual testers and URL-based crawlers miss.

- Architected **deterministic-first scanning**: 12 heuristic bug
  classifiers (form validation, network errors, console crashes, UX
  regressions) handle the majority of bug detection. Single batched LLM
  call for ambiguous interactions (max 30, 15 per batch) plus one
  optional summary call = **2 LLM calls per full scan**.
- Designed **DOM hash-based state queue** (DJB2 hash of
  tagName+className) for SPA sub-state deduplication, capturing modals
  and dynamic views URL-based crawlers miss. Path-pattern paginator
  caps states per template to prevent crawl explosions.
- Integrated **axe-core (4.9.1) accessibility audits + 5 security header
  checks** (CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy) + mixed-content/sensitive-data detection into a single
  scan pass, with real-time SSE streaming to a Next.js dashboard (past-
  event replay on reconnect).

---

## Secondary projects (swap in for targeted roles)

### Driftwatch — Quality Infrastructure for AI-Powered Products
*TypeScript, pnpm + Turborepo monorepo, Playwright, Next.js*

Two-in-one platform: AI regression tests (YAML-defined, 17 assertion
types, LLM-as-judge) + autonomous browser QA agent that explores web apps
and surfaces bugs with reproduction steps.

- Designed **17 assertion types across 5 categories** (string, structural,
  semantic, LLM-based, performance) plus **7 pre-built LLM-judge
  templates** (hallucination, instruction-adherence, tone, safety,
  relevance, completeness, conciseness) — users write YAML test cases,
  no prompt engineering.
- Built **autonomous QA scan agent** using Playwright + vision LLM:
  explores pages, clicks buttons, submits forms, flags broken pages, JS
  errors, and UX regressions with screenshots and repro steps. Handles
  auth flows (cookie/session), ignore paths, and goal-based journeys
  (LLM evaluates whether a user flow was completed successfully).
- Shipped as **6-package pnpm + Turborepo monorepo** (CLI, core,
  llm-adapter, qa-agent, test-agent, github-action) with BYOK for 4 LLM
  providers (OpenAI, Anthropic, Google Gemini, Ollama local). GitHub
  Action posts PR comments, blocks merge on failure.

*Use for:* AI/ML platform, devtools, QA tooling, dev-infra, SRE/testing-
adjacent engineering roles.

---

### Financial Document Classifier
*Python, PyTorch, HuggingFace Transformers, FastAPI, PyMuPDF, Tesseract OCR, Docker*

End-to-end ML system for classifying financial documents (invoices,
purchase orders, bank statements, tax notices) with PDF/OCR support,
calibrated confidence, and production-ready API.

- Fine-tuned **DistilBERT** for 6-class financial document classification
  achieving **98% accuracy**, with stratified train/val/test splitting,
  K-fold cross-validation, and class-weight balancing to handle imbalanced
  document types.
- Built **uncertainty-aware inference pipeline** exposing calibrated
  probabilities, top-k predictions, and entropy/margin metrics —
  automatically flags low-confidence predictions for human review
  instead of silently committing errors.
- Shipped as a **FastAPI REST service** with PDF text extraction
  (PyMuPDF) and Tesseract OCR fallback for scanned images, packaged with
  docker-compose for deployment. API-key auth, rate limiting, structured
  JSON logging.

*Use for:* ML engineering, NLP, AI/finance, data engineering roles.

---

### Industrial Defect Inspection Platform
*Python, PyTorch, torchvision, FastAPI, ONNX, Prometheus, Docker*

Production-grade image inference API for real-time quality inspection in
manufacturing — combines supervised classification with unsupervised
anomaly detection and visual explainability.

- Built **dual-model inference pipeline**: supervised **ResNet18
  transfer learning** for labeled defect types plus an **autoencoder**
  for unsupervised anomaly detection (catches previously-unseen defect
  classes), with **Grad-CAM heatmaps** surfacing exactly where in the
  image the model is reacting.
- Shipped as a **versioned FastAPI service** (`/v1` endpoints) with
  Pydantic request/response validation, API-key auth, request-ID
  propagation, structured logging, and **Prometheus metrics**. Models
  exported to **ONNX** for edge deployment.
- Designed for **low-latency real-time inspection**: inference-service
  caching, GPU-aware preprocessing, docker-compose deployment with
  model-volume mounts for hot-swap without container rebuild.

*Use for:* ML engineering, CV, manufacturing/IoT, infra/platform roles.

---

### TalkTalk — Real-Time Chat + Video Platform
*MERN (MongoDB, Express, React, Node), Socket.io, WebRTC (freeice), Twilio, Redux Toolkit*

Full-stack real-time communication platform with text chat, video calls,
and SMS-based OTP authentication.

- Built **bidirectional WebSocket messaging** with Socket.io (server +
  client), supporting online-presence broadcasting, typing indicators,
  and multi-room chat. Redux Toolkit manages normalized conversation
  state across thousands of messages without re-render churn.
- Integrated **peer-to-peer WebRTC video** via freeice (ICE server
  negotiation), handling signalling over Socket.io and media streams
  directly between browsers — no media relay server needed.
- Added **SMS OTP auth** via Twilio, JWT session tokens stored in
  httpOnly cookies, and Jimp-based image processing for in-chat photo
  sharing.

*Use for:* real-time systems, communication infra, full-stack roles.

---

### Event-Driven Microservices Platform
*Node.js, Express, event-broker architecture, 6 independent services*

Distributed architecture exercise: an event-forum platform split into
6 bounded services (admin, event, forum, game-service, leader-board,
query) with inter-service HTTP and an event broker pattern.

- Designed **6-service bounded-context split** — admin, event, forum,
  gameservice, leader-board, and a dedicated **query service
  (CQRS-style read model)** that subscribes to domain events and
  materializes a denormalized view for low-latency reads, decoupled
  from write-side services.
- Implemented **event-driven communication**: each service publishes
  domain events, others subscribe — services can be added or removed
  without touching existing service code. Deployed as independent
  Express processes behind a gateway.
- Covered **operational concerns** across all 6 services: CORS, JSON
  body-parsing, request logging (morgan-style), nodemon hot-reload for
  dev, and consistent error-envelope format across service boundaries.

*Use for:* distributed systems, platform/infra, senior backend (stretch)
roles.

---

### MERN Social Platform (MentorNet + Socio)
*MongoDB, Express, React, Node, Redux Toolkit, Material UI, Mongoose, JWT, Multer*

Two full-stack social applications — mentorship matching network and a
public social feed — sharing a common architectural pattern.

- Built **auth flow end-to-end**: JWT session tokens with httpOnly
  cookies, bcrypt-hashed password storage, email-verification via
  Mongoose-driven user state machines, and protected routes enforced
  both client-side (React Router guards) and server-side (Express
  middleware).
- Implemented **feed + profile system** with image uploads via Multer
  (base64-compressed client-side with browser-image-compression before
  upload) and paginated cursor-based fetch, normalized into Redux with
  redux-persist for offline-first behaviour.
- Designed **MUI + styled-components theming** covering 4 breakpoints
  with Sass-based design tokens — responsive across mobile/tablet/
  desktop without media-query duplication.

*Use for:* generic full-stack, frontend-heavy, product-engineering roles.

---

### RW + ThriftStore — E-commerce Platforms with Stripe
*MERN, Stripe (Elements + checkout), SendGrid, Redux Toolkit, Material UI*

Two end-to-end e-commerce applications — product catalogue, cart, Stripe
checkout, order fulfillment, transactional emails.

- Integrated **Stripe Payments** (Elements for card input, Checkout for
  redirect flow) with server-side webhook handlers for payment
  confirmation, Redux Toolkit for cart state + redux-persist for
  multi-session cart retention.
- Built **transactional email pipeline** via SendGrid (@sendgrid/mail)
  — order confirmations, shipping notifications, abandoned-cart
  reminders — with JWT-secured unsubscribe links and templated
  handlebars content.
- Covered **auth + admin**: bcrypt-hashed user store, JWT session tokens
  with 7-day refresh, product CRUD behind admin-role middleware, Mongoose
  schemas with cascade-delete for product/order relationships.

*Use for:* fintech/payments, e-commerce, full-stack engineering roles.

---

### Referred — Referral Platform with Multi-Strategy Auth
*React, Redux Toolkit, Express, cookie-session, express-session, JWT, bcryptjs*

Referral-tracking application demonstrating three concurrent auth
strategies (session, cookie, JWT) for different API surfaces.

- Implemented **three auth strategies side-by-side**: `express-session`
  for server-rendered flows, `cookie-session` for stateless API tokens,
  and JWT bearer for mobile-style SPA auth — same backend, three
  endpoints, with explicit boundary between them.
- Wired **Redux Toolkit + redux-persist** to survive page reloads
  without re-authenticating, and `js-cookie` for client-side session
  inspection without XHR overhead.

*Use for:* auth-heavy, security-adjacent, platform roles.

---

### Sked — Scheduling App with Firebase + Tailwind
*React, Firebase, Tailwind CSS, SendGrid, EmailJS*

Lightweight scheduling application demonstrating Firebase real-time DB
+ Tailwind-only styling + multi-provider email.

- Built **real-time availability board** on Firebase Realtime Database
  with optimistic client updates and server-authoritative conflict
  resolution for concurrent booking attempts.
- Styled entirely in **Tailwind CSS** (PostCSS + autoprefixer) — no
  CSS-in-JS, no component library — with a custom design-token palette
  compiled at build time for consistent visual rhythm.
- Dual-path email delivery: **SendGrid** for transactional confirmations
  (template-based, with unsubscribe), **EmailJS** for client-triggered
  contact-form messages (keeps the server off the happy path).

*Use for:* frontend-heavy, Firebase stack, startup product roles.

---

### Client-Server Messaging in C (Systems-Level Networking)
*C, POSIX sockets, TCP, pthread*

Low-level messaging client/server in raw C — manual socket lifecycle,
threaded connection handling, binary message framing.

- Implemented **multi-client TCP server** with `pthread`-based
  per-connection handlers, blocking `accept()` loop, and explicit
  shutdown sequence on SIGTERM. No libraries — `sys/socket.h` + `unistd.h`
  + `pthread.h` only.
- Designed **binary message framing** with length-prefix delimiters to
  cleanly segment messages on the TCP stream, handling partial-read
  reassembly on receive side.

*Use for:* systems, embedded, network-engineering, infra roles that
value low-level fundamentals.
