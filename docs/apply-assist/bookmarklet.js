// Apply Assist bookmarklet. Loaded into whatever page the user is on when
// they click the bookmark. Single-shot: fills what it can, shows a panel,
// exits. Re-click to re-run (e.g., on a new page of a multi-step form).
//
// Flow:
//   1. Open hidden iframe to the setup page with ?credrequest=1
//   2. Setup page posts credentials + profile via postMessage
//   3. This script queries Notion for current URL, reads Prefill Data
//   4. Fills every matchable field (profile + prefill_answers map)
//   5. Renders floating panel with download / copy / mark-applied / tailor

(function () {
  "use strict";

  // Guard against double-fire when user clicks twice in quick succession.
  if (window.__jrApplyAssistRunning) return;
  window.__jrApplyAssistRunning = true;

  const SETUP_ORIGIN = "https://arsh398.github.io";
  const SETUP_URL = "https://arsh398.github.io/job-radar/apply-assist/";
  const NOTION_VERSION = "2022-06-28";

  // ---------- credentials ----------
  //
  // Credentials come from the personalized bookmarklet URL itself: the
  // loader sets `window.__jrApplyCreds = { t, d, g, r, p }`. Storage
  // partitioning (Canary, Brave, strict privacy) broke the old iframe
  // postMessage approach, so we bake creds into the URL you drag. Change
  // creds → re-drag the link from the setup page.

  function getCreds() {
    const c = window.__jrApplyCreds;
    if (!c) return null;
    return {
      notionToken: c.t || "",
      notionDatabaseId: c.d || "",
      githubToken: c.g || "",
      githubRepo: c.r || "",
      profile: c.p || null,
    };
  }

  // ---------- Notion API ----------

  async function notionFetch(token, path, init = {}) {
    const res = await fetch("https://api.notion.com/v1" + path, {
      ...init,
      headers: {
        Authorization: "Bearer " + token,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const json = await res.json();
    if (!res.ok) throw new Error("Notion " + res.status + ": " + (json.message || JSON.stringify(json)));
    return json;
  }

  function normalizeUrl(u) {
    try {
      const url = new URL(u);
      url.hash = "";
      if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
      return url.toString();
    } catch { return u; }
  }

  async function findRow(token, dbId, url) {
    const db = dbId.replace(/-/g, "");
    const normalized = normalizeUrl(url);
    // Try exact match first
    try {
      const r = await notionFetch(token, "/databases/" + db + "/query", {
        method: "POST",
        body: JSON.stringify({
          filter: { property: "JD URL", url: { equals: normalized } },
          page_size: 1,
        }),
      });
      if (r.results && r.results[0]) return r.results[0];
    } catch (err) { console.warn("[apply-assist] exact match failed:", err.message); }
    // Fuzzy: pathname contains
    try {
      const path = new URL(normalized).pathname.replace(/^\/+/, "");
      if (path.length > 6) {
        const r = await notionFetch(token, "/databases/" + db + "/query", {
          method: "POST",
          body: JSON.stringify({
            filter: { property: "JD URL", url: { contains: path } },
            page_size: 1,
          }),
        });
        if (r.results && r.results[0]) return r.results[0];
      }
    } catch {}
    return null;
  }

  function readProperties(page) {
    const p = page.properties || {};
    const getText = (prop) => {
      if (!prop) return "";
      if (prop.rich_text) return prop.rich_text.map((t) => t.plain_text).join("");
      if (prop.title) return prop.title.map((t) => t.plain_text).join("");
      return "";
    };
    const getSelect = (prop) => (prop && prop.select) ? prop.select.name : "";
    const getNumber = (prop) => (prop && prop.number != null) ? prop.number : null;
    const getUrl = (prop) => (prop && prop.url) ? prop.url : "";
    const getFiles = (prop) => (prop && prop.files ? prop.files : []).map((f) => ({
      name: f.name,
      url: f.file ? f.file.url : (f.external ? f.external.url : ""),
    }));
    return {
      name: getText(p.Name),
      status: getSelect(p.Status) || "New",
      verdict: getSelect(p.Verdict) || "unknown",
      fit: getNumber(p.Fit),
      source: getSelect(p.Source),
      jdUrl: getUrl(p["JD URL"]),
      resumeFiles: getFiles(p.Resume),
      prefillData: getText(p["Prefill Data"]),
      qualityWarnings: getText(p["Quality Warnings"]),
    };
  }

  function parsePrefill(text) {
    if (!text) return { answers: {}, standard_hints: {} };
    try { return JSON.parse(text); } catch { return { answers: {}, standard_hints: {} }; }
  }

  // ---------- autofill ----------

  const FIELD_MAP = {
    first_name: {
      aliases: ["first_name","firstName","first-name","fname","givenName","given-name","given_name","_systemfield_firstname","firstname","candidate_first_name","job_application[first_name]"],
      labels: ["first name","given name","first"], type: null, key: "firstName",
    },
    last_name: {
      aliases: ["last_name","lastName","last-name","lname","familyName","family-name","family_name","surname","_systemfield_lastname","lastname","candidate_last_name","job_application[last_name]"],
      labels: ["last name","family name","surname"], type: null, key: "lastName",
    },
    full_name: {
      aliases: ["fullName","full_name","full-name","name","candidate_name","applicant_name","your_name","candidate[name]"],
      labels: ["full name","your name","name"], type: null, key: "fullName",
    },
    email: {
      aliases: ["email","emailAddress","email_address","e-mail","_systemfield_email","candidate_email","applicant_email","job_application[email]"],
      labels: ["email","e-mail","email address"], type: "email", key: "email",
    },
    phone: {
      aliases: ["phone","phoneNumber","phone_number","mobile","telephone","cell","cellular","_systemfield_phonenumber","job_application[phone]","candidate[phone]","phone_main"],
      labels: ["phone","phone number","mobile","mobile number","telephone"], type: "tel", key: "phone",
    },
    linkedin: {
      aliases: ["linkedin","linkedinUrl","linkedin_url","linkedin-url","linkedInUrl","urls[LinkedIn]","urls[linkedin]","_systemfield_linkedin","linkedin_profile"],
      labels: ["linkedin","linkedin profile","linkedin url","linkedin.com"], type: null, key: "linkedin",
    },
    github: {
      aliases: ["github","githubUrl","github_url","github-url","githubProfile","urls[GitHub]","urls[github]","_systemfield_github"],
      labels: ["github","github profile","github url","github.com"], type: null, key: "github",
    },
    portfolio: {
      aliases: ["portfolio","website","portfolio_url","personalSite","personalWebsite","urls[Portfolio]","urls[Website]","urls[website]","personal_website"],
      labels: ["portfolio","website","personal website","personal site"], type: null, key: "portfolio",
    },
    location: {
      aliases: ["location","city","currentLocation","current_location","_systemfield_location","candidate_location","current_city"],
      labels: ["location","current location","city","current city"], type: null, key: "location",
    },
    current_company: {
      aliases: ["org","company","currentCompany","current_company","employer","currentEmployer","current_employer"],
      labels: ["current company","current employer","company","employer"], type: null, key: "currentCompany",
    },
    current_title: {
      aliases: ["currentTitle","current_title","job_title","jobTitle","position","role"],
      labels: ["current title","current role","job title","position"], type: null, key: "currentTitle",
    },
    years_exp: {
      aliases: ["yearsOfExperience","years_of_experience","yoe","experience"],
      labels: ["years of experience","experience (years)","yoe","total experience"], type: null, key: "yearsOfExperience",
    },
    notice: {
      aliases: ["noticePeriod","notice_period","notice"],
      labels: ["notice period","notice","when can you start"], type: null, key: "noticePeriod",
    },
    earliest_start: {
      aliases: ["earliestStartDate","start_date","availableFrom"],
      labels: ["earliest start","start date","available from","when can you join"], type: null, key: "earliestStartDate",
    },
    expected_salary_inr: {
      aliases: ["expectedSalary","expected_salary","salaryExpectation","ctc","expected_ctc"],
      labels: ["expected salary","ctc","compensation","expected compensation"], type: null, key: "expectedSalaryINR",
    },
    expected_salary_usd: {
      aliases: ["expectedSalaryUSD"],
      labels: ["expected salary (usd)","expected salary usd","compensation (usd)"], type: null, key: "expectedSalaryUSD",
    },
    willing_relocate: {
      aliases: ["willingToRelocate","relocate","relocation"],
      labels: ["willing to relocate","relocate","relocation"], type: null, key: "willingToRelocate",
    },
    work_auth_us: {
      aliases: ["workAuthUS","authorized_to_work_us","us_work_authorization"],
      labels: ["authorized to work in the us","us work authorization","work in us","require sponsorship"], type: null, key: "workAuthUS",
    },
    sponsorship: {
      aliases: ["sponsorship","sponsorshipRequired","visaSponsorship","visa_sponsorship"],
      labels: ["visa sponsorship","sponsorship","require sponsorship"], type: null, key: "sponsorshipRequired",
    },
    gender: {
      aliases: ["gender","gender_identity"],
      labels: ["gender","gender identity"], type: null, key: "gender",
    },
    race: {
      aliases: ["race","ethnicity","raceEthnicity"],
      labels: ["race","ethnicity","race/ethnicity","race and ethnicity"], type: null, key: "raceEthnicity",
    },
    hispanic: {
      aliases: ["hispanic","hispanicLatino","latino"],
      labels: ["hispanic","latino","hispanic or latino"], type: null, key: "hispanicLatino",
    },
    veteran: {
      aliases: ["veteran","veteranStatus","military"],
      labels: ["veteran","veteran status","protected veteran","military service"], type: null, key: "veteranStatus",
    },
    disability: {
      aliases: ["disability","disabilityStatus","disability_status"],
      labels: ["disability","disability status"], type: null, key: "disabilityStatus",
    },
    orientation: {
      aliases: ["sexualOrientation","orientation"],
      labels: ["sexual orientation","orientation"], type: null, key: "sexualOrientation",
    },
    pronouns: {
      aliases: ["pronouns","preferredPronouns"],
      labels: ["pronouns","preferred pronouns"], type: null, key: "pronouns",
    },
    password: {
      aliases: ["password","pass","passwd","new_password","create_password"],
      labels: ["password","create password","new password"], type: "password", key: "defaultPassword",
    },
    password_confirm: {
      aliases: ["confirm_password","password_confirmation","confirmPassword","passwordConfirm","repeat_password"],
      labels: ["confirm password","re-enter password","repeat password","verify password"], type: "password", key: "defaultPassword",
    },
    security_answer: {
      aliases: ["security_answer","securityAnswer","secret_answer"],
      labels: ["security question","security answer","mother's maiden","pet's name","first pet"], type: null, key: "securityQuestionAnswer",
    },
    how_heard: {
      aliases: ["how_did_you_hear","howDidYouHear","referral_source","source"],
      labels: ["how did you hear","how you heard","referral source","source"], type: null, key: "howDidYouHear",
    },
    felony: {
      aliases: ["felony","felonyConviction","criminal_record"],
      labels: ["felony","criminal conviction","criminal record"], type: null, key: "felonyConviction",
    },
    accommodation: {
      aliases: ["accommodation","requireAccommodation"],
      labels: ["accommodation","disability accommodation","workplace accommodation"], type: null, key: "requireAccommodation",
    },
    noncompete: {
      aliases: ["nonCompete","non_compete","non-compete"],
      labels: ["non-compete","noncompete","non compete"], type: null, key: "nonCompete",
    },
  };

  // Prefill-answer textarea matching: map common question-title patterns
  // to PrefillAnswers keys from the Notion row's Prefill Data.
  const QA_LABEL_MAP = [
    { key: "why_company", patterns: ["why.*(this|our).*(company|organization|team)", "why.*work.*here", "why.*interested.*(us|this role)", "what attracts you"] },
    { key: "why_role", patterns: ["why.*this role", "why.*this position", "why.*this job", "what interests you about this"] },
    { key: "challenging_proj", patterns: ["challenging.*project", "most.*challenging", "difficult.*project", "hardest.*project"] },
    { key: "impactful_proj", patterns: ["impactful.*project", "most.*impactful", "biggest.*impact", "proudest.*project"] },
    { key: "failure_story", patterns: ["failure", "time.*(failed|failure)", "mistake.*you made"] },
    { key: "strengths", patterns: ["strengths", "your strengths", "what are your"] },
    { key: "why_leaving", patterns: ["why.*(leaving|looking for a change|want to leave)"] },
    { key: "ai_experience", patterns: ["ai.*experience", "llm.*experience", "machine learning experience", "gen.?ai experience"] },
  ];

  function setValue(el, value) {
    if (!el || value == null || value === "") return false;
    const tag = el.tagName;
    if (tag === "SELECT") return setSelect(el, value);
    const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function setSelect(el, value) {
    const target = String(value).toLowerCase();
    const opt = Array.from(el.options).find((o) =>
      o.value.toLowerCase() === target ||
      o.text.toLowerCase() === target ||
      o.text.toLowerCase().includes(target) ||
      target.includes(o.text.toLowerCase())
    );
    if (!opt) return false;
    el.value = opt.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function labelTextFor(el) {
    const parts = [];
    if (el.id) {
      try {
        const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl) parts.push(lbl.textContent || "");
      } catch {}
    }
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent || "");
    const aria = el.getAttribute("aria-labelledby");
    if (aria) {
      const ref = document.getElementById(aria);
      if (ref) parts.push(ref.textContent || "");
    }
    return parts.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function matchesField(el, spec) {
    const name = (el.name || "").toLowerCase();
    const id = (el.id || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const ph = (el.placeholder || "").toLowerCase();
    const autoc = (el.autocomplete || "").toLowerCase();
    const label = labelTextFor(el);
    const typeAttr = (el.type || "").toLowerCase();
    for (const a of spec.aliases) {
      const al = a.toLowerCase();
      if (name === al || id === al) return 3;
    }
    if (spec.type && typeAttr === spec.type) return 3;
    for (const a of spec.aliases) {
      if (autoc === a.toLowerCase()) return 3;
    }
    for (const l of spec.labels) {
      if (label && (label === l || label.includes(l))) return 2;
    }
    for (const l of spec.labels) {
      if (aria.includes(l) || ph.includes(l)) return 2;
    }
    for (const a of spec.aliases) {
      const al = a.toLowerCase();
      if ((name && name.includes(al)) || (id && id.includes(al))) return 1;
    }
    return 0;
  }

  function findField(spec, used) {
    const inputs = document.querySelectorAll("input, select, textarea");
    let best = null;
    let bestScore = 0;
    for (const el of inputs) {
      if (used.has(el)) continue;
      if (el.disabled || el.readOnly || (el.value && el.tagName !== "SELECT")) continue;
      const t = (el.type || "").toLowerCase();
      if (t === "hidden" || t === "submit" || t === "button" || t === "file" || t === "checkbox" || t === "radio") continue;
      const s = matchesField(el, spec);
      if (s > bestScore) { best = el; bestScore = s; if (s === 3) break; }
    }
    return best;
  }

  function fillStandardFields(profile) {
    if (!profile) return 0;
    const fullName = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    const enriched = Object.assign({}, profile, { fullName });
    let filled = 0;
    const used = new WeakSet();
    for (const spec of Object.values(FIELD_MAP)) {
      const value = enriched[spec.key];
      if (!value) continue;
      const el = findField(spec, used);
      if (el) {
        if (setValue(el, value)) { used.add(el); filled++; }
      }
    }
    return filled;
  }

  function fillPrefillAnswers(answers) {
    if (!answers) return 0;
    const textareas = document.querySelectorAll("textarea");
    let filled = 0;
    for (const ta of textareas) {
      if (ta.disabled || ta.readOnly || ta.value) continue;
      const label = labelTextFor(ta);
      const aria = (ta.getAttribute("aria-label") || "").toLowerCase();
      const ph = (ta.placeholder || "").toLowerCase();
      const hay = (label + " " + aria + " " + ph).toLowerCase();
      if (!hay.trim()) continue;
      for (const { key, patterns } of QA_LABEL_MAP) {
        const ans = answers[key];
        if (!ans || !ans.trim()) continue;
        if (patterns.some((p) => new RegExp(p, "i").test(hay))) {
          if (setValue(ta, ans)) filled++;
          break;
        }
      }
    }
    return filled;
  }

  // ---------- panel ----------

  function injectStyles() {
    if (document.getElementById("jr-aa-style")) return;
    const style = document.createElement("style");
    style.id = "jr-aa-style";
    style.textContent = `
      #jr-aa-panel { position:fixed;top:16px;right:16px;z-index:2147483647;width:340px;
        background:#0f172a;color:#e2e8f0;border-radius:10px;overflow:hidden;
        box-shadow:0 8px 24px rgba(0,0,0,.45);
        font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      #jr-aa-panel .jr-hdr { display:flex;justify-content:space-between;align-items:center;
        padding:10px 12px;background:#1e293b;border-bottom:1px solid #334155; }
      #jr-aa-panel .jr-title { font-weight:600; }
      #jr-aa-panel .jr-close { background:transparent;border:0;color:#94a3b8;
        font-size:18px;line-height:1;cursor:pointer;padding:0 4px; }
      #jr-aa-panel .jr-body { padding:12px;display:flex;flex-direction:column;gap:10px; }
      #jr-aa-panel .jr-pill { display:inline-block;padding:3px 8px;background:#064e3b;
        color:#a7f3d0;border-radius:12px;font-size:11px;font-weight:600;align-self:flex-start; }
      #jr-aa-panel .jr-pill-warn { background:#7c2d12;color:#fed7aa; }
      #jr-aa-panel .jr-name { font-weight:600;font-size:14px; }
      #jr-aa-panel .jr-muted { color:#94a3b8;font-size:12px; }
      #jr-aa-panel .jr-actions { display:flex;flex-direction:column;gap:6px; }
      #jr-aa-panel .jr-btn { display:block;width:100%;padding:8px 10px;background:#334155;
        color:#e2e8f0;border:0;border-radius:6px;cursor:pointer;font:inherit;text-align:left; }
      #jr-aa-panel .jr-btn:hover { background:#475569; }
      #jr-aa-panel .jr-primary { background:#2563eb;color:#fff;font-weight:600; }
      #jr-aa-panel .jr-primary:hover { background:#1d4ed8; }
      #jr-aa-panel .jr-status { color:#cbd5e1;font-size:12px;min-height:16px; }
    `;
    document.head.appendChild(style);
  }

  function buildPanel() {
    injectStyles();
    let panel = document.getElementById("jr-aa-panel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "jr-aa-panel";
    panel.innerHTML = `<div class="jr-hdr"><span class="jr-title">Apply Assist</span><button class="jr-close" title="Close">×</button></div><div class="jr-body"></div>`;
    document.documentElement.appendChild(panel);
    panel.querySelector(".jr-close").addEventListener("click", () => panel.remove());
    return panel;
  }

  function setPanel(html) {
    const p = buildPanel();
    p.querySelector(".jr-body").innerHTML = html;
    return p;
  }

  async function markApplied(creds, pageId) {
    return notionFetch(creds.notionToken, "/pages/" + pageId, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          Status: { select: { name: "Applied" } },
          "Applied At": { date: { start: new Date().toISOString() } },
        },
      }),
    });
  }

  async function triggerTailor(creds, url) {
    const [owner, repo] = creds.githubRepo.split("/");
    const res = await fetch(
      "https://api.github.com/repos/" + owner + "/" + repo + "/actions/workflows/tailor-ad-hoc.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + creds.githubToken,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main", inputs: { url } }),
      }
    );
    if (res.status !== 204) {
      const t = await res.text();
      throw new Error("GH dispatch " + res.status + ": " + t.slice(0, 200));
    }
  }

  function downloadPdf(fileUrl, name) {
    const a = document.createElement("a");
    a.href = fileUrl;
    a.download = name || "resume.pdf";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 500);
  }

  function copy(text, statusEl, label) {
    navigator.clipboard.writeText(text).then(
      () => { if (statusEl) statusEl.textContent = label + " copied."; },
      () => { if (statusEl) statusEl.textContent = "Copy failed."; }
    );
  }

  function renderMatched(creds, page, props, prefill, stdFilled, qaFilled) {
    const verdict = props.verdict || "unknown";
    const resumes = props.resumeFiles
      .map((f, i) => `<button class="jr-btn" data-act="dl" data-i="${i}">${escape(f.name || "Download resume")}</button>`)
      .join("");
    const cover = (prefill.standard_hints && prefill.standard_hints.cover_note) || "";
    const referral = (prefill.standard_hints && prefill.standard_hints.referral_draft) || "";
    const qwCount = (props.qualityWarnings || "").length > 0 ? (props.qualityWarnings.match(/\|/g) || []).length + 1 : 0;
    const qwPill = qwCount > 0 ? `<div class="jr-pill jr-pill-warn">⚠ ${qwCount} quality note(s) — check before sending</div>` : "";
    setPanel(`
      <div class="jr-pill">Matched · ${escape(verdict)} · ${props.fit ?? "–"}% fit</div>
      ${qwPill}
      <div class="jr-name">${escape(props.name || "")}</div>
      <div class="jr-muted">Filled ${stdFilled} standard + ${qaFilled} textarea answers</div>
      <div class="jr-actions">
        ${resumes || '<div class="jr-muted">No tailored PDF on file</div>'}
        ${cover ? '<button class="jr-btn" data-act="cover">Copy Cover Note</button>' : ""}
        ${referral ? '<button class="jr-btn" data-act="referral">Copy Referral DM</button>' : ""}
        <button class="jr-btn jr-primary" data-act="applied">Mark Applied</button>
      </div>
      <div class="jr-status"></div>
    `);
    const p = document.getElementById("jr-aa-panel");
    const st = p.querySelector(".jr-status");
    p.querySelectorAll(".jr-btn").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      try {
        if (act === "dl") {
          const f = props.resumeFiles[Number(b.dataset.i)];
          downloadPdf(f.url, f.name);
          st.textContent = "Downloaded — drag into the upload field.";
        } else if (act === "cover") copy(cover, st, "Cover note");
        else if (act === "referral") copy(referral, st, "Referral");
        else if (act === "applied") {
          st.textContent = "Marking…";
          await markApplied(creds, page.id);
          st.textContent = "Marked Applied ✓";
        }
      } catch (e) { st.textContent = "Error: " + e.message; }
    }));
  }

  function renderUnmatched(creds, stdFilled) {
    setPanel(`
      <div class="jr-pill jr-pill-warn">No Notion row for this URL</div>
      <div class="jr-muted">Filled ${stdFilled} standard fields from your profile</div>
      <div class="jr-actions">
        <button class="jr-btn jr-primary" data-act="tailor">Tailor for this URL</button>
      </div>
      <div class="jr-muted">Workflow runs on GitHub (~2-3 min). Re-click bookmark after it finishes to see matched panel.</div>
      <div class="jr-status"></div>
    `);
    const p = document.getElementById("jr-aa-panel");
    const st = p.querySelector(".jr-status");
    p.querySelector('[data-act="tailor"]').addEventListener("click", async () => {
      try {
        st.textContent = "Dispatching workflow…";
        await triggerTailor(creds, location.href);
        st.textContent = "Tailoring… re-click bookmark in 2-3 min.";
      } catch (e) { st.textContent = "Error: " + e.message; }
    });
  }

  function escape(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- main ----------

  (async () => {
    try {
      injectStyles();
      setPanel(`<div class="jr-muted">Loading profile…</div>`);
      const creds = getCreds();
      if (!creds || !creds.notionToken || !creds.profile) {
        setPanel(`<div class="jr-pill jr-pill-warn">Not configured</div><div class="jr-muted">Open <a href="${SETUP_URL}" target="_blank" style="color:#93c5fd">the setup page</a>, save your creds, then re-drag the 🎯 Apply Assist link to replace this bookmark. Credentials are baked into the URL — the old bookmark has no data.</div>`);
        return;
      }
      const stdFilled = fillStandardFields(creds.profile);

      let page = null;
      if (creds.notionDatabaseId) {
        try { page = await findRow(creds.notionToken, creds.notionDatabaseId, location.href); }
        catch (e) { console.warn("[apply-assist] Notion query failed:", e.message); }
      }
      if (page) {
        const props = readProperties(page);
        const prefill = parsePrefill(props.prefillData);
        const qaFilled = fillPrefillAnswers(prefill.answers || {});
        renderMatched(creds, page, props, prefill, stdFilled, qaFilled);
      } else {
        renderUnmatched(creds, stdFilled);
      }
    } catch (err) {
      setPanel(`<div class="jr-pill jr-pill-warn">Error</div><div class="jr-muted">${escape(err && err.message || String(err))}</div>`);
    } finally {
      setTimeout(() => { window.__jrApplyAssistRunning = false; }, 500);
    }
  })();
})();
