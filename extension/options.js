const fields = ["notionToken", "notionDatabaseId", "githubToken", "githubRepo"];

async function load() {
  const data = await chrome.storage.sync.get([...fields, "profile"]);
  for (const f of fields) {
    if (data[f]) document.getElementById(f).value = data[f];
  }
  if (data.profile) {
    document.getElementById("profile").value = JSON.stringify(data.profile, null, 2);
  }
}

async function save() {
  const payload = {};
  for (const f of fields) {
    payload[f] = document.getElementById(f).value.trim();
  }
  const raw = document.getElementById("profile").value.trim();
  const status = document.getElementById("status");
  if (raw) {
    try {
      payload.profile = JSON.parse(raw);
    } catch (err) {
      status.textContent = `Profile JSON invalid: ${err.message}`;
      status.style.color = "#dc2626";
      return;
    }
  } else {
    payload.profile = null;
  }
  await chrome.storage.sync.set(payload);
  status.textContent = "Saved ✓";
  status.style.color = "#16a34a";
  setTimeout(() => { status.textContent = ""; }, 2000);
}

document.getElementById("save").addEventListener("click", save);
load();
