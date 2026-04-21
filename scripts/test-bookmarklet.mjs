// Smoke tests for docs/apply-assist/bookmarklet.js.
//
// Loads the bookmarklet into jsdom with a mocked window.__jrApplyCreds
// and a synthetic form fixture. Asserts that expected fields get filled
// with expected values.
//
// Run:   node scripts/test-bookmarklet.mjs
// Exit 0 if all pass, 1 if any fail.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOKMARKLET_PATH = resolve(__dirname, "..", "docs/apply-assist/bookmarklet.js");
const BOOKMARKLET_SRC = readFileSync(BOOKMARKLET_PATH, "utf8");

// Test profile — compact version of real profile
const TEST_PROFILE = {
  firstName: "Mohammed Arsh",
  lastName: "Khan",
  fullName: "Mohammed Arsh Khan",
  email: "mdarshkhan9898@gmail.com",
  phone: "9131110480",
  linkedin: "https://www.linkedin.com/in/mohammed-arsh-khan-03900121a/",
  github: "https://github.com/arsh398",
  location: "Bangalore, India",
  city: "Bangalore",
  country: "India",
  workAuthUS: "No",
  sponsorshipRequired: "Yes",
  currentCompany: "Juspay",
  currentTitle: "Product Engineer",
  yearsOfExperience: "2",
  noticePeriod: "60 days",
  expectedSalaryINR: "25 LPA",
  willingToRelocate: "Yes",
  gender: "Male",
  raceEthnicity: "Asian",
  hispanicLatino: "No",
  veteranStatus: "I am not a protected veteran",
  disabilityStatus: "No, I do not have a disability",
  felonyConviction: "No",
  defaultPassword: "Arsh@123",
  howDidYouHear: "LinkedIn",
};

// ---------- fixtures ----------

const FIXTURE_GREENHOUSE = `
<!DOCTYPE html>
<html><body>
  <form id="app">
    <label for="first_name">First Name *</label>
    <input id="first_name" name="job_application[first_name]" type="text" />

    <label for="last_name">Last Name *</label>
    <input id="last_name" name="job_application[last_name]" type="text" />

    <label for="email">Email *</label>
    <input id="email" name="job_application[email]" type="email" />

    <label for="phone">Phone</label>
    <input id="phone" name="job_application[phone]" type="tel" />

    <label for="urls_linkedin">LinkedIn Profile</label>
    <input id="urls_linkedin" name="job_application[urls][LinkedIn]" type="url" />

    <label for="company">Current Company</label>
    <input id="company" name="job_application[experience][0][company_name]" type="text" />

    <label for="start_date">Work History Start Date</label>
    <input id="start_date" name="job_application[experience][0][start_date]" type="date" />
  </form>
</body></html>`;

const FIXTURE_LEVER = `
<!DOCTYPE html>
<html><body>
  <form id="app">
    <label>Full Name *<input name="name" type="text" /></label>
    <label>Email *<input name="email" type="email" /></label>
    <label>Phone<input name="phone" type="tel" /></label>
    <label>Current Company<input name="org" type="text" /></label>
    <label>LinkedIn URL<input name="urls[LinkedIn]" type="url" /></label>
    <label>GitHub URL<input name="urls[GitHub]" type="url" /></label>

    <fieldset>
      <legend>Are you authorized to work in the US?</legend>
      <label><input type="radio" name="work_auth_us" value="Yes" /> Yes</label>
      <label><input type="radio" name="work_auth_us" value="No" /> No</label>
    </fieldset>
  </form>
</body></html>`;

const FIXTURE_ASHBY = `
<!DOCTYPE html>
<html><body>
  <form>
    <div><div class="label">First Name</div><input name="_systemfield_firstname" type="text" /></div>
    <div><div class="label">Last Name</div><input name="_systemfield_lastname" type="text" /></div>
    <div><div class="label">Email</div><input name="_systemfield_email" type="email" /></div>
    <div><div class="label">Phone</div><input name="_systemfield_phonenumber" type="tel" /></div>
    <div><div class="label">LinkedIn</div><input name="_systemfield_linkedin" type="url" /></div>
  </form>
</body></html>`;

const FIXTURE_DEMOGRAPHICS = `
<!DOCTYPE html>
<html><body>
  <form>
    <label>Gender
      <select name="gender">
        <option value="">Select</option>
        <option value="M">Male</option>
        <option value="F">Female</option>
        <option value="X">Non-binary</option>
      </select>
    </label>

    <label>Race/Ethnicity
      <select name="race">
        <option value="">Select</option>
        <option value="asian">Asian</option>
        <option value="white">White</option>
        <option value="black">Black or African American</option>
      </select>
    </label>

    <fieldset>
      <legend>Veteran Status</legend>
      <label><input type="radio" name="veteran" value="I am a protected veteran" /> I am a protected veteran</label>
      <label><input type="radio" name="veteran" value="I am not a protected veteran" /> I am not a protected veteran</label>
      <label><input type="radio" name="veteran" value="I decline to answer" /> I decline to answer</label>
    </fieldset>

    <fieldset>
      <legend>Disability Status</legend>
      <label><input type="radio" name="disability" value="Yes, I have a disability" /> Yes</label>
      <label><input type="radio" name="disability" value="No, I do not have a disability" /> No</label>
    </fieldset>
  </form>
</body></html>`;

const FIXTURE_CHROME_AUTOFILLED = `
<!DOCTYPE html>
<html><body>
  <form>
    <label for="first_name">First Name</label>
    <input id="first_name" name="first_name" type="text" value="Mohammed Arsh" />

    <label for="email">Email</label>
    <input id="email" name="email" type="email" value="mdarshkhan9898@gmail.com" />

    <label for="phone">Phone</label>
    <input id="phone" name="phone" type="tel" value="" />

    <label for="linkedin">LinkedIn</label>
    <input id="linkedin" name="linkedin" type="url" value="" />
  </form>
</body></html>`;

// ---------- harness ----------

async function runFixture(name, html) {
  const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
  const w = dom.window;
  // Capture console output for debugging
  const logs = [];
  w.console = {
    log: (...args) => logs.push("log: " + args.map(String).join(" ")),
    warn: (...args) => logs.push("warn: " + args.map(String).join(" ")),
    error: (...args) => logs.push("error: " + args.map(String).join(" ")),
    table: (x) => logs.push("table: " + JSON.stringify(x)),
  };
  w.__capturedLogs = logs;
  // Mock Notion API + chrome.runtime since bookmarklet may check them
  // Provide a truthy token so the bookmarklet's "Not configured" guard
  // doesn't short-circuit before it reaches the autofill step. We mock
  // Notion fetch below so the actual API isn't hit.
  w.__jrApplyCreds = {
    p: TEST_PROFILE,
    t: "secret_test_token",
    d: "",
    g: "ghp_test",
    r: "arsh398/job-radar",
  };
  // Mock fetch: always return "no row found"-like response so we land
  // in the renderUnmatched path after the fill has run.
  w.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results: [], has_more: false }),
    text: async () => "",
  });
  w.navigator.clipboard = { writeText: async () => {} };
  // Provide CSS.escape polyfill (jsdom supports it but be safe)
  if (!w.CSS) w.CSS = {};
  if (!w.CSS.escape) w.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");

  // Inject and run
  const scriptEl = w.document.createElement("script");
  scriptEl.textContent = BOOKMARKLET_SRC;
  w.document.documentElement.appendChild(scriptEl);

  // Wait for async main() to run its first fillStandardFields pass
  await new Promise((r) => setTimeout(r, 600));
  // Expose captured logs for debugging
  if (process.env.DEBUG_TESTS) {
    console.log("  -- logs for", name, "--");
    for (const l of w.__capturedLogs.slice(0, 20)) console.log("    ", l);
    // Also show panel content
    const panel = w.document.getElementById("jr-aa-panel");
    if (panel) console.log("    panel:", panel.textContent.trim().slice(0, 200));
  }
  return w;
}

function val(w, selector) {
  const el = w.document.querySelector(selector);
  return el ? el.value : "(missing element)";
}

function radioChecked(w, name) {
  const el = w.document.querySelector('input[type="radio"][name="' + name + '"]:checked');
  return el ? el.value : "(none checked)";
}

function selectChosen(w, selector) {
  const el = w.document.querySelector(selector);
  return el ? el.options[el.selectedIndex]?.text : "(missing)";
}

// ---------- test cases ----------

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("Greenhouse: fills first/last/email/phone/LinkedIn", async () => {
  const w = await runFixture("greenhouse", FIXTURE_GREENHOUSE);
  expect(val(w, "#first_name"), "Mohammed Arsh", "first_name");
  expect(val(w, "#last_name"), "Khan", "last_name");
  expect(val(w, "#email"), "mdarshkhan9898@gmail.com", "email");
  expect(val(w, "#phone"), "9131110480", "phone");
  expect(val(w, "#urls_linkedin"), TEST_PROFILE.linkedin, "linkedin");
});

test("Greenhouse: company_name field NOT filled with full name (bug fix)", async () => {
  const w = await runFixture("greenhouse", FIXTURE_GREENHOUSE);
  const v = val(w, "#company");
  if (v === "Mohammed Arsh Khan") throw new Error(`company field got filled with full name (bug!): '${v}'`);
  // Should either be empty (no strong current_company match since name is "experience[0][company_name]") or "Juspay"
  if (v && v !== "Juspay") throw new Error(`company field got unexpected value: '${v}'`);
});

test("Greenhouse: date field NOT filled", async () => {
  const w = await runFixture("greenhouse", FIXTURE_GREENHOUSE);
  const v = val(w, "#start_date");
  if (v && v !== "") throw new Error(`date field filled unexpectedly: '${v}'`);
});

test("Lever: fills name / email / phone / org (Current Company)", async () => {
  const w = await runFixture("lever", FIXTURE_LEVER);
  expect(val(w, 'input[name="name"]'), "Mohammed Arsh Khan", "name");
  expect(val(w, 'input[name="email"]'), "mdarshkhan9898@gmail.com", "email");
  expect(val(w, 'input[name="phone"]'), "9131110480", "phone");
  expect(val(w, 'input[name="org"]'), "Juspay", "org/company");
  expect(val(w, 'input[name="urls[LinkedIn]"]'), TEST_PROFILE.linkedin, "linkedin");
  expect(val(w, 'input[name="urls[GitHub]"]'), TEST_PROFILE.github, "github");
});

test("Lever: work auth radio gets 'No' selected", async () => {
  const w = await runFixture("lever", FIXTURE_LEVER);
  expect(radioChecked(w, "work_auth_us"), "No", "work_auth_us radio");
});

test("Ashby: fills _systemfield_* inputs (React-style forms)", async () => {
  const w = await runFixture("ashby", FIXTURE_ASHBY);
  expect(val(w, 'input[name="_systemfield_firstname"]'), "Mohammed Arsh", "first name");
  expect(val(w, 'input[name="_systemfield_lastname"]'), "Khan", "last name");
  expect(val(w, 'input[name="_systemfield_email"]'), "mdarshkhan9898@gmail.com", "email");
  expect(val(w, 'input[name="_systemfield_phonenumber"]'), "9131110480", "phone");
});

test("Demographics: select fills gender / race", async () => {
  const w = await runFixture("demographics", FIXTURE_DEMOGRAPHICS);
  expect(val(w, 'select[name="gender"]'), "M", "gender select value");
  expect(val(w, 'select[name="race"]'), "asian", "race select value");
});

test("Demographics: radios fill veteran / disability", async () => {
  const w = await runFixture("demographics", FIXTURE_DEMOGRAPHICS);
  expect(radioChecked(w, "veteran"), "I am not a protected veteran", "veteran");
  expect(radioChecked(w, "disability"), "No, I do not have a disability", "disability");
});

test("Chrome-Autofilled: overwrites pre-filled when strong match", async () => {
  const w = await runFixture("chrome-autofilled", FIXTURE_CHROME_AUTOFILLED);
  // The first_name field was pre-filled with "Mohammed Arsh" — our profile
  // value matches, so no change visible; phone and linkedin were empty,
  // should be filled now.
  expect(val(w, "#phone"), "9131110480", "phone (was empty)");
  expect(val(w, "#linkedin"), TEST_PROFILE.linkedin, "linkedin (was empty)");
});

function expect(actual, expected, fieldName) {
  if (actual !== expected) {
    throw new Error(`${fieldName}: expected '${expected}', got '${actual}'`);
  }
}

// ---------- run ----------

(async () => {
  let passed = 0, failed = 0;
  const failures = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
      failures.push({ name, err: err.message });
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
