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

  const FIELD_MAP = {
    first_name: ["firstName", "first_name", "first-name", "fname", "givenName", "given-name"],
    last_name: ["lastName", "last_name", "last-name", "lname", "familyName", "family-name", "surname"],
    full_name: ["fullName", "full_name", "full-name", "name", "candidate_name", "applicant_name"],
    email: ["email", "emailAddress", "email_address", "candidate_email", "applicant_email"],
    phone: ["phone", "phoneNumber", "phone_number", "mobile", "telephone", "cell"],
    linkedin: ["linkedin", "linkedinUrl", "linkedin_url", "linkedin-url", "linkedInUrl"],
    github: ["github", "githubUrl", "github_url", "github-url", "githubProfile"],
    portfolio: ["portfolio", "website", "portfolio_url", "personalSite", "personalWebsite"],
    location: ["location", "city", "currentLocation", "current_location"],
  };

  function setValue(el, value) {
    if (!el || !value) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function findField(aliases) {
    for (const alias of aliases) {
      const el =
        document.querySelector(`input[name="${alias}"]`) ||
        document.querySelector(`input[id="${alias}"]`) ||
        document.querySelector(`input[name*="${alias}" i]`) ||
        document.querySelector(`input[id*="${alias}" i]`) ||
        document.querySelector(`input[aria-label*="${alias}" i]`) ||
        document.querySelector(`input[placeholder*="${alias}" i]`);
      if (el && !el.value) return el;
    }
    return null;
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
    };
    let filled = 0;
    for (const [key, aliases] of Object.entries(FIELD_MAP)) {
      const el = findField(aliases);
      if (el && values[key]) {
        if (setValue(el, values[key])) filled++;
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
