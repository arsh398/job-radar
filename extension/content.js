// Runs on every matched job/apply page. Three responsibilities:
//   1. Auto-fill common profile fields (name/email/phone/LinkedIn/GitHub)
//      on any recognizable form, no Notion lookup required.
//   2. Query Notion for a row matching window.location.href. If found,
//      show the panel with tailored resume + cover note + mark-applied.
//   3. If no match, offer a "Tailor for this URL" button that dispatches
//      the GitHub workflow, then polls Notion until the row appears.

(() => {
  if (window.__jobRadarAssistLoaded) return;
  window.__jobRadarAssistLoaded = true;

  function send(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => resolve(res));
    });
  }

  // ---------- Autofill ----------
  //
  // Real-world ATS field naming conventions, verified against:
  //   - Greenhouse public API schema (first_name/last_name/email/phone/resume
  //     and custom answers via question_X + urls[LinkedIn] / urls[GitHub])
  //   - Lever React form (name = full, urls[LinkedIn], urls[GitHub], org)
  //   - Ashby (_systemfield_X prefix)
  //   - SmartRecruiters UI (firstName/lastName camelCase + spoken labels)
  //   - Workable (firstname/lastname lowercase)
  //   - Workday (obfuscated IDs — we rely on aria-label + nearby labels)
  //
  // Matching strategy (in order): exact name/id, input type, label-for,
  // aria-label, placeholder, name/id substring. First match wins.

  const FIELD_MAP = {
    first_name: {
      aliases: [
        "first_name", "firstName", "first-name", "fname", "givenName",
        "given-name", "given_name", "_systemfield_firstname", "firstname",
        "candidate_first_name", "job_application[first_name]",
      ],
      labels: ["first name", "given name", "first"],
      type: null,
    },
    last_name: {
      aliases: [
        "last_name", "lastName", "last-name", "lname", "familyName",
        "family-name", "family_name", "surname", "_systemfield_lastname",
        "lastname", "candidate_last_name", "job_application[last_name]",
      ],
      labels: ["last name", "family name", "surname"],
      type: null,
    },
    full_name: {
      aliases: [
        "fullName", "full_name", "full-name", "name", "candidate_name",
        "applicant_name", "your_name", "candidate[name]",
      ],
      labels: ["full name", "your name", "name"],
      type: null,
    },
    email: {
      aliases: [
        "email", "emailAddress", "email_address", "e-mail", "_systemfield_email",
        "candidate_email", "applicant_email", "job_application[email]",
        "candidate[email]",
      ],
      labels: ["email", "e-mail", "email address"],
      type: "email",
    },
    phone: {
      aliases: [
        "phone", "phoneNumber", "phone_number", "mobile", "telephone", "cell",
        "cellular", "_systemfield_phonenumber", "job_application[phone]",
        "candidate[phone]", "phone_main",
      ],
      labels: ["phone", "phone number", "mobile", "mobile number", "telephone"],
      type: "tel",
    },
    linkedin: {
      aliases: [
        "linkedin", "linkedinUrl", "linkedin_url", "linkedin-url", "linkedInUrl",
        "urls[LinkedIn]", "urls[linkedin]", "_systemfield_linkedin",
        "linkedin_profile",
      ],
      labels: ["linkedin", "linkedin profile", "linkedin url", "linkedin.com"],
      type: null,
    },
    github: {
      aliases: [
        "github", "githubUrl", "github_url", "github-url", "githubProfile",
        "urls[GitHub]", "urls[github]", "_systemfield_github",
      ],
      labels: ["github", "github profile", "github url", "github.com"],
      type: null,
    },
    portfolio: {
      aliases: [
        "portfolio", "website", "portfolio_url", "personalSite", "personalWebsite",
        "urls[Portfolio]", "urls[Website]", "urls[website]", "personal_website",
      ],
      labels: ["portfolio", "website", "personal website", "personal site"],
      type: null,
    },
    location: {
      aliases: [
        "location", "city", "currentLocation", "current_location",
        "_systemfield_location", "candidate_location", "current_city",
      ],
      labels: ["location", "current location", "city", "current city"],
      type: null,
    },
    current_company: {
      aliases: [
        "org", "company", "currentCompany", "current_company", "employer",
        "currentEmployer", "current_employer",
      ],
      labels: ["current company", "current employer", "company", "employer"],
      type: null,
    },
  };

  function setValue(el, value) {
    if (!el || !value) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function labelTextFor(el) {
    const parts = [];
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) parts.push(lbl.textContent || "");
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

    // 1. Exact name/id match on any alias (strongest signal).
    for (const a of spec.aliases) {
      const al = a.toLowerCase();
      if (name === al || id === al) return 3;
    }
    // 2. Type-based match (email/tel). Very reliable when true.
    if (spec.type && typeAttr === spec.type) return 3;
    // 3. autocomplete attribute (given-name, family-name, email, tel, etc).
    //    Spec-defined, filled reliably by modern forms.
    for (const a of spec.aliases) {
      if (autoc === a.toLowerCase()) return 3;
    }
    // 4. Label text exact or contains match.
    for (const l of spec.labels) {
      if (label && (label === l || label.includes(l))) return 2;
    }
    // 5. Aria-label / placeholder contains label keyword.
    for (const l of spec.labels) {
      if (aria.includes(l) || ph.includes(l)) return 2;
    }
    // 6. Name/id substring match on aliases (weakest).
    for (const a of spec.aliases) {
      const al = a.toLowerCase();
      if ((name && name.includes(al)) || (id && id.includes(al))) return 1;
    }
    return 0;
  }

  function findField(spec) {
    const inputs = document.querySelectorAll("input, textarea");
    let best = null;
    let bestScore = 0;
    for (const el of inputs) {
      if (el.disabled || el.readOnly || el.value) continue;
      if (el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
      if (el.type === "file" || el.type === "checkbox" || el.type === "radio") continue;
      const s = matchesField(el, spec);
      if (s > bestScore) {
        best = el;
        bestScore = s;
        if (s === 3) break; // strongest match, stop
      }
    }
    return best;
  }

  function autofillCommon(profile) {
    if (!profile) return 0;
    const fullName = profile.fullName ||
      [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    const values = {
      first_name: profile.firstName,
      last_name: profile.lastName,
      full_name: fullName,
      email: profile.email,
      phone: profile.phone,
      linkedin: profile.linkedin,
      github: profile.github,
      portfolio: profile.portfolio,
      location: profile.location,
      current_company: profile.currentCompany,
    };
    let filled = 0;
    const usedEls = new WeakSet();
    for (const [key, spec] of Object.entries(FIELD_MAP)) {
      if (!values[key]) continue;
      const el = findField(spec);
      if (el && !usedEls.has(el)) {
        if (setValue(el, values[key])) {
          usedEls.add(el);
          filled++;
        }
      }
    }
    return filled;
  }

  // ---------- Notion row parsing ----------

  function readProperties(page) {
    const p = page.properties || {};
    const getText = (prop) => {
      if (!prop) return "";
      if (prop.rich_text?.length) return prop.rich_text.map((t) => t.plain_text).join("");
      if (prop.title?.length) return prop.title.map((t) => t.plain_text).join("");
      return "";
    };
    const getSelect = (prop) => prop?.select?.name ?? "";
    const getNumber = (prop) => prop?.number ?? null;
    const getUrl = (prop) => prop?.url ?? "";
    const getFiles = (prop) =>
      (prop?.files ?? []).map((f) => ({
        name: f.name,
        url: f.file?.url || f.external?.url,
      }));
    return {
      name: getText(p["Name"]) || "",
      status: getSelect(p["Status"]) || "New",
      verdict: getSelect(p["Verdict"]) || "unknown",
      fit: getNumber(p["Fit"]),
      source: getSelect(p["Source"]) || "",
      jdUrl: getUrl(p["JD URL"]) || "",
      resumeFiles: getFiles(p["Resume"]),
    };
  }

  // Extract cover note + referral draft from page body blocks. Schema writes
  // these as code blocks under H2 headings ("Referral DM", "Cover Note").
  function extractTextSections(blocks) {
    const sections = { cover: "", referral: "", missingKeywords: [] };
    let currentHeading = "";
    for (const b of blocks) {
      if (b.type === "heading_2") {
        currentHeading = (b.heading_2?.rich_text || [])
          .map((t) => t.plain_text).join("").toLowerCase();
      } else if (b.type === "code") {
        const text = (b.code?.rich_text || []).map((t) => t.plain_text).join("");
        if (currentHeading.includes("cover")) sections.cover = text;
        if (currentHeading.includes("referral")) sections.referral = text;
      } else if (b.type === "bulleted_list_item" && currentHeading.includes("missing")) {
        const text = (b.bulleted_list_item?.rich_text || [])
          .map((t) => t.plain_text).join("");
        if (text) sections.missingKeywords.push(text);
      }
    }
    return sections;
  }

  // ---------- Panel UI ----------

  function buildPanel() {
    let panel = document.getElementById("jr-apply-assist-panel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "jr-apply-assist-panel";
    panel.innerHTML = `
      <div class="jr-hdr">
        <span class="jr-title">Apply Assist</span>
        <button class="jr-close" title="Hide">×</button>
      </div>
      <div class="jr-body"></div>
    `;
    document.documentElement.appendChild(panel);
    panel.querySelector(".jr-close").addEventListener("click", () => {
      panel.style.display = "none";
    });
    return panel;
  }

  function setBody(html) {
    const panel = buildPanel();
    panel.querySelector(".jr-body").innerHTML = html;
    panel.style.display = "block";
  }

  function renderMatched(page, props, sections, filledCount) {
    const resumes = props.resumeFiles
      .map((f, i) => `<button class="jr-btn" data-act="dl" data-i="${i}">${f.name || "Download resume"}</button>`)
      .join("");
    setBody(`
      <div class="jr-pill">Matched · ${props.verdict} · ${props.fit ?? "–"}% fit</div>
      <div class="jr-name">${props.name}</div>
      <div class="jr-actions">
        ${resumes || '<div class="jr-muted">No tailored PDF on file</div>'}
        ${sections.cover ? '<button class="jr-btn" data-act="cover">Copy Cover Note</button>' : ""}
        ${sections.referral ? '<button class="jr-btn" data-act="referral">Copy Referral DM</button>' : ""}
        <button class="jr-btn jr-primary" data-act="applied">Mark Applied</button>
      </div>
      <div class="jr-muted">Filled ${filledCount} common fields</div>
      <div class="jr-status"></div>
    `);
    const panel = buildPanel();
    const statusEl = panel.querySelector(".jr-status");
    panel.querySelectorAll(".jr-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        if (act === "dl") {
          const f = props.resumeFiles[Number(btn.dataset.i)];
          statusEl.textContent = "Downloading…";
          const res = await send("download", { url: f.url, filename: f.name });
          statusEl.textContent = res?.ok ? "Downloaded. Drag into the upload field." : `Error: ${res?.error}`;
        } else if (act === "cover") {
          await navigator.clipboard.writeText(sections.cover);
          statusEl.textContent = "Cover note copied.";
        } else if (act === "referral") {
          await navigator.clipboard.writeText(sections.referral);
          statusEl.textContent = "Referral DM copied.";
        } else if (act === "applied") {
          statusEl.textContent = "Marking…";
          const res = await send("markApplied", { pageId: page.id });
          statusEl.textContent = res?.ok ? "Marked Applied ✓" : `Error: ${res?.error}`;
        }
      });
    });
  }

  function renderUnmatched(filledCount) {
    setBody(`
      <div class="jr-pill jr-pill-warn">No Notion row for this URL</div>
      <div class="jr-actions">
        <button class="jr-btn jr-primary" data-act="tailor">Tailor for this URL</button>
      </div>
      <div class="jr-muted">Filled ${filledCount} common fields · Tailoring takes 2–3 min (GH Actions). The panel will update when the resume is ready.</div>
      <div class="jr-status"></div>
    `);
    const panel = buildPanel();
    const statusEl = panel.querySelector(".jr-status");
    panel.querySelector('[data-act="tailor"]').addEventListener("click", async () => {
      statusEl.textContent = "Dispatching workflow…";
      const res = await send("triggerTailor", { url: window.location.href });
      if (!res?.ok) {
        statusEl.textContent = `Error: ${res?.error}`;
        return;
      }
      statusEl.textContent = "Tailoring… (2–3 min)";
      pollForRow(statusEl);
    });
  }

  async function pollForRow(statusEl) {
    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15000));
      const res = await send("findRowByUrl", { url: window.location.href });
      if (res?.ok && res.data) {
        statusEl.textContent = "Ready. Refreshing panel…";
        await run(); // re-render with matched state
        return;
      }
      statusEl.textContent = "Still tailoring…";
    }
    statusEl.textContent = "Timed out. Check GitHub Actions run log.";
  }

  // ---------- Main ----------

  async function run() {
    const cfg = await send("getConfig");
    if (!cfg?.ok || !cfg.data.notionToken) {
      // Extension not configured. Autofill from profile anyway if available.
      if (cfg?.data?.profile) autofillCommon(cfg.data.profile);
      return;
    }
    const { profile } = cfg.data;
    const filledCount = autofillCommon(profile);

    const res = await send("findRowByUrl", { url: window.location.href });
    if (res?.ok && res.data) {
      const page = res.data;
      const props = readProperties(page);
      const blocksRes = await send("getPageBlocks", { pageId: page.id });
      const sections = blocksRes?.ok ? extractTextSections(blocksRes.data) : { cover: "", referral: "", missingKeywords: [] };
      renderMatched(page, props, sections, filledCount);
    } else {
      renderUnmatched(filledCount);
    }
  }

  // Run once initially, then again after a short delay for SPA pages that
  // hydrate content after first paint.
  run();
  setTimeout(run, 2500);
})();
