// Apply Assist bookmarklet. Loaded into whatever page the user is on when
// they click the bookmark. Autofills common fields + Notion prefill data
// for the matched job, shows a floating panel with downloads / copies /
// mark-applied. Re-click to re-run on the same or next page.
//
// Supported input types:
//   - standard text / email / tel / url / number / password / textarea
//   - <select> native dropdowns (value-match then text-contains)
//   - role="combobox" / role="listbox" React dropdowns (click → pick → click)
//   - type="radio" groups (Yes/No and multi-option)
//   - type="checkbox" for specific Yes/No-as-checkbox patterns
// Skipped by design:
//   - type=file / hidden / submit / button
//   - type=date / datetime-local / month / week / time (no dates in profile)

(function () {
  "use strict";

  if (window.__jrApplyAssistRunning) return;
  window.__jrApplyAssistRunning = true;

  const SETUP_ORIGIN = "https://arsh398.github.io";
  const SETUP_URL = "https://arsh398.github.io/job-radar/apply-assist/";
  const NOTION_VERSION = "2022-06-28";
  const DEBUG = true;

  function log(...args) { if (DEBUG && window.console) console.log("[apply-assist]", ...args); }
  function warn(...args) { if (DEBUG && window.console) console.warn("[apply-assist]", ...args); }

  // ---------- credentials ----------

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
    try {
      const r = await notionFetch(token, "/databases/" + db + "/query", {
        method: "POST",
        body: JSON.stringify({
          filter: { property: "JD URL", url: { equals: normalized } },
          page_size: 1,
        }),
      });
      if (r.results && r.results[0]) return r.results[0];
    } catch (err) { warn("exact url match failed:", err.message); }
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

  // ---------- FIELD_MAP ----------

  const FIELD_MAP = {
    first_name: {
      aliases: ["first_name","firstName","first-name","fname","givenName","given-name","given_name","_systemfield_firstname","firstname","candidate_first_name","job_application[first_name]"],
      labels: ["first name","given name"], type: null, key: "firstName",
    },
    last_name: {
      aliases: ["last_name","lastName","last-name","lname","familyName","family-name","family_name","surname","_systemfield_lastname","lastname","candidate_last_name","job_application[last_name]"],
      labels: ["last name","family name","surname"], type: null, key: "lastName",
    },
    full_name: {
      aliases: ["fullName","full_name","full-name","candidate_name","applicant_name","your_name","candidate[name]"],
      labels: ["full name","your name"], type: null, key: "fullName",
    },
    email: {
      aliases: ["email","emailAddress","email_address","e-mail","_systemfield_email","candidate_email","applicant_email","job_application[email]"],
      labels: ["email","e-mail","email address"], type: "email", key: "email",
    },
    phone: {
      aliases: ["phone","phoneNumber","phone_number","mobile","telephone","cell","_systemfield_phonenumber","job_application[phone]","candidate[phone]"],
      labels: ["phone number","mobile number","telephone","phone"], type: "tel", key: "phone",
    },
    linkedin: {
      aliases: ["linkedin","linkedinUrl","linkedin_url","linkedin-url","linkedInUrl","urls[LinkedIn]","urls[linkedin]","_systemfield_linkedin","linkedin_profile"],
      labels: ["linkedin profile","linkedin url","linkedin.com","linkedin"], type: null, key: "linkedin",
    },
    github: {
      aliases: ["github","githubUrl","github_url","github-url","githubProfile","urls[GitHub]","urls[github]","_systemfield_github"],
      labels: ["github profile","github url","github.com","github"], type: null, key: "github",
    },
    portfolio: {
      aliases: ["portfolio","portfolio_url","personalSite","personalWebsite","urls[Portfolio]","urls[Website]","urls[website]","personal_website"],
      labels: ["personal website","portfolio website","personal site","website url","portfolio"], type: null, key: "portfolio",
    },
    location: {
      aliases: ["location","currentLocation","current_location","_systemfield_location","candidate_location","current_city"],
      labels: ["current location","current city"], type: null, key: "location",
    },
    city: {
      aliases: ["city"],
      labels: ["city"], type: null, key: "city",
    },
    country: {
      aliases: ["country"],
      labels: ["country"], type: null, key: "country",
    },
    current_company: {
      aliases: ["org","currentCompany","current_company","currentEmployer","current_employer"],
      labels: ["current company","current employer","company where you currently work"], type: null, key: "currentCompany",
    },
    current_title: {
      aliases: ["currentTitle","current_title"],
      labels: ["current title","current role","current job title"], type: null, key: "currentTitle",
    },
    years_exp: {
      aliases: ["yearsOfExperience","years_of_experience","yoe"],
      labels: ["years of experience","total experience","years of total experience"], type: null, key: "yearsOfExperience",
    },
    notice: {
      aliases: ["noticePeriod","notice_period"],
      labels: ["notice period"], type: null, key: "noticePeriod",
    },
    earliest_start: {
      aliases: ["earliestStartDate","earliestStart","availableFrom","available_from"],
      labels: ["earliest start","available from","when can you join","when can you start","earliest you can start"],
      type: null, key: "earliestStartDate",
    },
    expected_salary_inr: {
      aliases: ["expectedSalary","expected_salary","salaryExpectation","ctc","expected_ctc"],
      labels: ["expected salary","ctc","expected compensation","salary expectation"], type: null, key: "expectedSalaryINR",
    },
    expected_salary_usd: {
      aliases: ["expectedSalaryUSD"],
      labels: ["expected salary (usd)","expected salary usd","compensation (usd)"], type: null, key: "expectedSalaryUSD",
    },
    willing_relocate: {
      aliases: ["willingToRelocate","relocate","relocation"],
      labels: ["willing to relocate","open to relocation"], type: null, key: "willingToRelocate",
    },
    work_auth_us: {
      aliases: ["workAuthUS","authorized_to_work_us","us_work_authorization"],
      labels: ["authorized to work in the us","us work authorization","require sponsorship","authorized to work in the united states"], type: null, key: "workAuthUS",
    },
    sponsorship: {
      aliases: ["sponsorship","sponsorshipRequired","visaSponsorship","visa_sponsorship"],
      labels: ["visa sponsorship","require sponsorship","need sponsorship"], type: null, key: "sponsorshipRequired",
    },
    gender: {
      aliases: ["gender","gender_identity"],
      labels: ["gender identity","gender"], type: null, key: "gender",
    },
    race: {
      aliases: ["race","ethnicity","raceEthnicity"],
      labels: ["race/ethnicity","race and ethnicity","race","ethnicity"], type: null, key: "raceEthnicity",
    },
    hispanic: {
      aliases: ["hispanic","hispanicLatino","latino"],
      labels: ["hispanic or latino","hispanic/latino","hispanic","latino"], type: null, key: "hispanicLatino",
    },
    veteran: {
      aliases: ["veteran","veteranStatus"],
      labels: ["veteran status","protected veteran","military service status"], type: null, key: "veteranStatus",
    },
    disability: {
      aliases: ["disability","disabilityStatus","disability_status"],
      labels: ["disability status","do you have a disability"], type: null, key: "disabilityStatus",
    },
    orientation: {
      aliases: ["sexualOrientation"],
      labels: ["sexual orientation"], type: null, key: "sexualOrientation",
    },
    pronouns: {
      aliases: ["pronouns","preferredPronouns"],
      labels: ["pronouns","preferred pronouns"], type: null, key: "pronouns",
    },
    password: {
      aliases: ["password","new_password","create_password"],
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
      aliases: ["how_did_you_hear","howDidYouHear","referral_source"],
      labels: ["how did you hear","how you heard about"], type: null, key: "howDidYouHear",
    },
    felony: {
      aliases: ["felony","felonyConviction","criminal_record"],
      labels: ["felony","criminal conviction","criminal record"], type: null, key: "felonyConviction",
    },
    accommodation: {
      aliases: ["accommodation","requireAccommodation"],
      labels: ["disability accommodation","workplace accommodation","require accommodation"], type: null, key: "requireAccommodation",
    },
    noncompete: {
      aliases: ["nonCompete","non_compete","non-compete"],
      labels: ["non-compete","noncompete","non compete agreement"], type: null, key: "nonCompete",
    },
  };

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

  // ---------- label detection ----------

  // Find the human-readable label for an input. Checks in order:
  //   1. <label for="id">
  //   2. ancestor <label>
  //   3. aria-labelledby / aria-label
  //   4. preceding sibling text (common in React forms)
  //   5. parent's immediate text content (stripping the input's own text)
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
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const ref = document.getElementById(id);
        if (ref) parts.push(ref.textContent || "");
      }
    }
    const aria = el.getAttribute("aria-label");
    if (aria) parts.push(aria);
    // Proximity: look at the preceding sibling's text, or a labeled wrapper
    // div. Common React pattern: <div class="field-label">Email</div><input>.
    let node = el.previousElementSibling;
    let tries = 0;
    while (node && tries < 3) {
      const txt = (node.textContent || "").trim();
      if (txt && txt.length < 120) { parts.push(txt); break; }
      node = node.previousElementSibling;
      tries++;
    }
    // Ancestor with a short text header
    let anc = el.parentElement;
    let depth = 0;
    while (anc && depth < 3) {
      const first = anc.firstChild;
      if (first && first.nodeType === 3) {
        const t = (first.textContent || "").trim();
        if (t && t.length < 80 && !t.includes(el.value || "__x__")) { parts.push(t); break; }
      }
      anc = anc.parentElement;
      depth++;
    }
    return parts.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // ---------- match scoring ----------

  function matchesField(el, spec) {
    const name = (el.name || "").toLowerCase();
    const id = (el.id || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const ph = (el.placeholder || "").toLowerCase();
    const autoc = (el.autocomplete || "").toLowerCase();
    const label = labelTextFor(el);
    const typeAttr = (el.type || "").toLowerCase();

    // Exact name/id alias match — strongest
    for (const a of spec.aliases) {
      const al = a.toLowerCase();
      if (name === al || id === al) return 4;
    }
    // autocomplete attribute match — standards-compliant, very reliable
    for (const a of spec.aliases) {
      if (autoc && autoc === a.toLowerCase()) return 4;
    }
    // Input type match (email, tel) — strong but only for types we specified
    if (spec.type && typeAttr === spec.type) return 3;
    // Label exact/contains match
    for (const l of spec.labels) {
      if (label === l) return 3;
    }
    for (const l of spec.labels) {
      if (label && label.includes(l)) return 2;
    }
    // Aria / placeholder
    for (const l of spec.labels) {
      if (aria.includes(l) || ph.includes(l)) return 2;
    }
    // Name/id substring — weakest, high false-positive risk
    for (const a of spec.aliases) {
      const al = a.toLowerCase();
      if (al.length < 4) continue; // "org" too short for substring
      if ((name && name.includes(al)) || (id && id.includes(al))) return 1;
    }
    return 0;
  }

  // ---------- value setters ----------

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function fireInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setTextValue(el, value) {
    setNativeValue(el, value);
    fireInputEvents(el);
  }

  function setSelectValue(el, value) {
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

  // Match a radio/checkbox group by label. For a group keyed by `name`,
  // find the specific option whose label matches `value`.
  function setRadioGroup(name, value) {
    if (!name) return false;
    const radios = Array.from(document.querySelectorAll(
      'input[type="radio"][name="' + CSS.escape(name) + '"], input[type="checkbox"][name="' + CSS.escape(name) + '"]'
    ));
    if (!radios.length) return false;
    const target = String(value).toLowerCase();
    const pick = radios.find((r) => {
      const lbl = labelTextFor(r).toLowerCase();
      const rv = (r.value || "").toLowerCase();
      if (rv === target || lbl === target) return true;
      if (target.length > 2 && (lbl.includes(target) || target.includes(lbl))) return true;
      if (rv && (target.includes(rv) || rv.includes(target))) return true;
      return false;
    });
    if (!pick) return false;
    if (!pick.checked) {
      pick.checked = true;
      pick.dispatchEvent(new Event("click", { bubbles: true }));
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  // React-custom dropdown: role="combobox" / role="listbox" / similar.
  // Strategy: click trigger to open, wait for options to appear, find
  // matching option text, click it.
  async function setCustomDropdown(trigger, value) {
    const target = String(value).toLowerCase();
    // Open
    trigger.click();
    await sleep(180);
    // Options can be siblings, descendants, or in a portal elsewhere in DOM
    let options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, [role="listbox"] [role="menuitem"]'));
    // Filter to only those visible (width+height > 0)
    options = options.filter((o) => {
      const r = o.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!options.length) return false;
    const pick = options.find((o) => {
      const t = (o.textContent || "").trim().toLowerCase();
      return t === target || t.includes(target) || target.includes(t);
    });
    if (!pick) {
      // Close dropdown cleanly
      trigger.click();
      return false;
    }
    pick.click();
    await sleep(80);
    return true;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---------- visual feedback ----------

  const HIGHLIGHT = "outline: 2px solid #16a34a !important; outline-offset: 2px; transition: outline 0.2s;";
  const HIGHLIGHT_MISS = "outline: 2px dashed #f59e0b !important; outline-offset: 2px;";

  function markFilled(el) {
    const prev = el.getAttribute("style") || "";
    el.setAttribute("style", prev + ";" + HIGHLIGHT);
    setTimeout(() => {
      try { el.setAttribute("style", prev); } catch {}
    }, 8000);
  }

  function markMiss(el) {
    const prev = el.getAttribute("style") || "";
    el.setAttribute("style", prev + ";" + HIGHLIGHT_MISS);
  }

  // ---------- main fill algorithm ----------

  function elIsFillable(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    const t = (el.type || "").toLowerCase();
    if (["hidden","submit","button","file","date","datetime-local","month","week","time"].includes(t)) return false;
    return true;
  }

  function buildEnriched(profile) {
    const fullName = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    return Object.assign({}, profile, { fullName });
  }

  // Per-input best-match. For each input, pick the spec with highest score.
  // Sort by score desc, fill one value per spec key. Overwrite even if the
  // input is already filled (e.g. by Chrome Autofill) when our match is
  // strong (score >= 3).
  async function fillStandardFields(profile) {
    if (!profile) return { filled: 0, detail: [], missed: [] };
    const enriched = buildEnriched(profile);
    const specEntries = Object.entries(FIELD_MAP);
    const seen = new WeakSet();
    const candidates = [];

    // Gather text/textarea/select candidates
    const inputs = document.querySelectorAll("input, select, textarea, [role='combobox']");
    for (const el of inputs) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.tagName === "INPUT") {
        const t = (el.type || "").toLowerCase();
        if (t === "radio" || t === "checkbox") continue; // handled separately
      }
      if (!elIsFillable(el)) continue;
      let bestKey = null, bestScore = 0;
      for (const [k, spec] of specEntries) {
        const s = matchesField(el, spec);
        if (s > bestScore) { bestKey = k; bestScore = s; }
      }
      if (bestKey && bestScore > 0) candidates.push({ el, specKey: bestKey, score: bestScore });
    }
    candidates.sort((a, b) => b.score - a.score);

    const usedSpecKeys = new Set();
    const MULTI_FILL = new Set(["password_confirm"]);
    const detail = [];
    const missed = [];
    let filled = 0;

    for (const { el, specKey, score } of candidates) {
      const spec = FIELD_MAP[specKey];
      const value = enriched[spec.key];
      if (!value) continue;
      if (usedSpecKeys.has(specKey) && !MULTI_FILL.has(specKey)) continue;
      // Skip pre-filled inputs UNLESS our match is strong (score >= 3).
      // Chrome Autofill often pre-fills with saved values that may or may
      // not match our profile — if we have a definitive match, overwrite.
      if (el.value && el.tagName !== "SELECT" && score < 3) continue;

      let ok = false;
      try {
        if (el.tagName === "SELECT") {
          ok = setSelectValue(el, value);
        } else if (el.getAttribute("role") === "combobox") {
          ok = await setCustomDropdown(el, value);
        } else {
          setTextValue(el, value);
          ok = true;
        }
      } catch (err) {
        warn("set failed", specKey, err.message);
      }

      if (ok) {
        usedSpecKeys.add(specKey);
        filled++;
        markFilled(el);
        detail.push({ spec: specKey, score, value: String(value).slice(0, 60), field: (el.name || el.id || "(unnamed)").slice(0, 60) });
      } else {
        markMiss(el);
        missed.push({ spec: specKey, reason: "couldn't set value", field: (el.name || el.id || "(unnamed)").slice(0, 60) });
      }
    }

    // Radio/checkbox groups — match by name attr
    const radioNames = new Set();
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((r) => {
      if (r.name && !r.disabled) radioNames.add(r.name);
    });
    for (const name of radioNames) {
      if (usedSpecKeys.has("radio:" + name)) continue;
      // Find best spec for this group by label text of any member
      const firstRadio = document.querySelector('input[type="radio"][name="' + CSS.escape(name) + '"]');
      if (!firstRadio) continue;
      // Use the radio's fieldset legend, wrapping div label, or input name
      // to find the question text
      const fieldset = firstRadio.closest("fieldset");
      let groupLabel = "";
      if (fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend) groupLabel = legend.textContent || "";
      }
      if (!groupLabel) groupLabel = labelTextFor(firstRadio);
      if (!groupLabel) groupLabel = name;
      groupLabel = groupLabel.toLowerCase();

      let bestKey = null, bestScore = 0;
      for (const [k, spec] of specEntries) {
        let s = 0;
        for (const l of spec.labels) {
          if (groupLabel.includes(l)) { s = Math.max(s, 2); }
        }
        for (const a of spec.aliases) {
          if (name.toLowerCase() === a.toLowerCase()) { s = Math.max(s, 3); }
          else if (name.toLowerCase().includes(a.toLowerCase()) && a.length >= 4) { s = Math.max(s, 1); }
        }
        if (s > bestScore) { bestKey = k; bestScore = s; }
      }
      if (bestKey && bestScore > 0) {
        const value = enriched[FIELD_MAP[bestKey].key];
        if (value) {
          const ok = setRadioGroup(name, value);
          if (ok) {
            usedSpecKeys.add("radio:" + name);
            filled++;
            const picked = document.querySelector('input[type="radio"][name="' + CSS.escape(name) + '"]:checked, input[type="checkbox"][name="' + CSS.escape(name) + '"]:checked');
            if (picked) markFilled(picked);
            detail.push({ spec: bestKey, score: bestScore, value: String(value).slice(0, 40), field: "radio:" + name });
          } else {
            missed.push({ spec: bestKey, reason: "no radio option matched value", field: "radio:" + name });
          }
        }
      }
    }

    if (detail.length && window.console && console.table) {
      console.log("%c[apply-assist] filled:", "color:#16a34a;font-weight:bold");
      console.table(detail);
    }
    if (missed.length && window.console && console.table) {
      console.log("%c[apply-assist] missed:", "color:#f59e0b;font-weight:bold");
      console.table(missed);
    }
    return { filled, detail, missed };
  }

  // ---------- Prefill-answer matching ----------

  async function fillPrefillAnswers(answers) {
    if (!answers) return { filled: 0 };
    const candidates = Array.from(document.querySelectorAll('textarea, input[type="text"][maxlength]:not([maxlength="1"]):not([maxlength="2"]):not([maxlength="3"])'));
    let filled = 0;
    for (const ta of candidates) {
      if (!elIsFillable(ta)) continue;
      if (ta.value) continue;
      const hay = (labelTextFor(ta) + " " + (ta.getAttribute("aria-label") || "") + " " + (ta.placeholder || "")).toLowerCase();
      if (!hay.trim()) continue;
      for (const { key, patterns } of QA_LABEL_MAP) {
        const ans = answers[key];
        if (!ans || !ans.trim()) continue;
        if (patterns.some((p) => new RegExp(p, "i").test(hay))) {
          setTextValue(ta, ans);
          markFilled(ta);
          filled++;
          break;
        }
      }
    }
    return { filled };
  }

  // ---------- panel UI ----------

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
      #jr-aa-panel .jr-count { font-size:12px; color:#cbd5e1; }
      #jr-aa-panel .jr-count strong { color:#a7f3d0; }
      #jr-aa-panel .jr-count em { color:#fed7aa; font-style:normal; }
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

  function countText({ filled, detail, missed }, qaFilled) {
    const parts = [`<strong>${filled}</strong> filled`];
    if (qaFilled) parts.push(`<strong>${qaFilled}</strong> answers`);
    if (missed && missed.length) parts.push(`<em>${missed.length} missed</em>`);
    return parts.join(" · ");
  }

  function renderMatched(creds, page, props, prefill, standardResult, qaResult) {
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
      <div class="jr-count">${countText(standardResult, qaResult.filled)}</div>
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

  function renderUnmatched(creds, standardResult) {
    setPanel(`
      <div class="jr-pill jr-pill-warn">No Notion row for this URL</div>
      <div class="jr-count">${countText(standardResult, 0)}</div>
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
        setPanel(`<div class="jr-pill jr-pill-warn">Not configured</div><div class="jr-muted">Open <a href="${SETUP_URL}" target="_blank" style="color:#93c5fd">the setup page</a>, save creds, then re-drag the 🎯 link to replace this bookmark.</div>`);
        return;
      }

      // First pass
      let standardResult = await fillStandardFields(creds.profile);

      // Retry on late-loading forms (React hydration). Set up a MutationObserver
      // that re-runs fill if new form inputs appear within 4 sec.
      const observer = new MutationObserver(async (muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && (node.tagName === "INPUT" || node.tagName === "SELECT" || node.tagName === "TEXTAREA" || (node.querySelectorAll && node.querySelectorAll("input,select,textarea").length))) {
              const more = await fillStandardFields(creds.profile);
              standardResult.filled += more.filled;
              standardResult.detail.push(...more.detail);
              standardResult.missed.push(...more.missed);
              return;
            }
          }
        }
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 4000);

      let page = null;
      if (creds.notionDatabaseId) {
        try { page = await findRow(creds.notionToken, creds.notionDatabaseId, location.href); }
        catch (e) { warn("Notion query failed:", e.message); }
      }
      if (page) {
        const props = readProperties(page);
        const prefill = parsePrefill(props.prefillData);
        const qaResult = await fillPrefillAnswers(prefill.answers || {});
        renderMatched(creds, page, props, prefill, standardResult, qaResult);
      } else {
        renderUnmatched(creds, standardResult);
      }
    } catch (err) {
      setPanel(`<div class="jr-pill jr-pill-warn">Error</div><div class="jr-muted">${escape(err && err.message || String(err))}</div>`);
    } finally {
      setTimeout(() => { window.__jrApplyAssistRunning = false; }, 500);
    }
  })();
})();
