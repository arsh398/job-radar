// Background service worker. Routes all network calls through here so
// content scripts don't hit CORS walls. Handles three things:
//   1. Notion: query by URL, get page content, update Status
//   2. GitHub: workflow_dispatch to trigger tailor-ad-hoc
//   3. Download: stream a file URL as a browser download

const NOTION_VERSION = "2022-06-28";

async function cfg() {
  return await chrome.storage.sync.get([
    "notionToken",
    "notionDatabaseId",
    "githubToken",
    "githubRepo",
    "profile",
  ]);
}

async function notionFetch(path, init = {}) {
  const { notionToken } = await cfg();
  if (!notionToken) throw new Error("Notion token not configured. Open the options page.");
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${notionToken}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Notion ${res.status}: ${json.message || JSON.stringify(json)}`);
  }
  return json;
}

// Query Notion DB for a row whose "JD URL" property matches the current URL.
// Returns the page object (with properties) or null.
async function findRowByUrl(url) {
  const { notionDatabaseId } = await cfg();
  if (!notionDatabaseId) throw new Error("Notion database ID not configured.");
  const body = {
    filter: {
      property: "JD URL",
      url: { equals: url },
    },
    page_size: 1,
  };
  const data = await notionFetch(`/databases/${notionDatabaseId.replace(/-/g, "")}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.results?.[0] ?? null;
}

// Fetch a page's body blocks — we need these for the cover note / referral
// / Q&A text that the pipeline writes into children, not properties.
async function getPageBlocks(pageId) {
  const data = await notionFetch(`/blocks/${pageId}/children?page_size=100`);
  return data.results || [];
}

// Update a page's Status property to "Applied" with today's timestamp.
async function markApplied(pageId) {
  return notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        Status: { select: { name: "Applied" } },
        "Applied At": { date: { start: new Date().toISOString() } },
      },
    }),
  });
}

// Trigger tailor-ad-hoc.yml on GitHub with the given URL.
async function triggerTailor(url) {
  const { githubToken, githubRepo } = await cfg();
  if (!githubToken) throw new Error("GitHub token not configured.");
  if (!githubRepo) throw new Error("GitHub repo (owner/name) not configured.");
  const [owner, repo] = githubRepo.split("/");
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/tailor-ad-hoc.yml/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${githubToken}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { url } }),
    }
  );
  if (res.status !== 204) {
    const text = await res.text();
    throw new Error(`GitHub dispatch failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return { ok: true };
}

// Notion file_upload URLs are signed and expire. Trigger a browser
// download so the user can drag it into the apply form.
async function downloadFile(fileUrl, filename) {
  await chrome.downloads.download({ url: fileUrl, filename, saveAs: false });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "getConfig":
          sendResponse({ ok: true, data: await cfg() });
          return;
        case "findRowByUrl":
          sendResponse({ ok: true, data: await findRowByUrl(msg.url) });
          return;
        case "getPageBlocks":
          sendResponse({ ok: true, data: await getPageBlocks(msg.pageId) });
          return;
        case "markApplied":
          sendResponse({ ok: true, data: await markApplied(msg.pageId) });
          return;
        case "triggerTailor":
          sendResponse({ ok: true, data: await triggerTailor(msg.url) });
          return;
        case "download":
          sendResponse({ ok: true, data: await downloadFile(msg.url, msg.filename) });
          return;
        default:
          sendResponse({ ok: false, error: `unknown message type: ${msg.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
