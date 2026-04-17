// Thin Notion API wrapper. Auth via NOTION_API_KEY. Operates on the
// database identified by NOTION_DATABASE_ID. File uploads use Notion's
// /v1/file_uploads endpoint (public since late 2024) so PDFs can be
// attached directly to page properties without hosting them elsewhere.

const BASE = "https://api.notion.com/v1";
const API_VERSION = "2022-06-28";

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = process.env["NOTION_API_KEY"];
  if (!key) throw new Error("NOTION_API_KEY is not set");
  return {
    authorization: `Bearer ${key}`,
    "notion-version": API_VERSION,
    "content-type": "application/json",
    ...extra,
  };
}

type AnyRecord = Record<string, unknown>;

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 20_000
): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      ...init,
      signal: controller.signal,
      headers: { ...headers(), ...(init.headers as Record<string, string>) },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Notion ${res.status} ${res.statusText}: ${text.slice(0, 300)}`
      );
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(t);
  }
}

// ---------- Pages ----------

export type NotionCreatePageBody = {
  parent: { database_id: string };
  properties: AnyRecord;
  children?: AnyRecord[];
};

export async function createPage(
  body: NotionCreatePageBody
): Promise<{ id: string; url: string }> {
  return apiFetch<{ id: string; url: string }>("/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Query the database for a page matching a given Key property value.
// Used for dedup — skip creating a page we've already written.
export async function queryByKey(
  databaseId: string,
  key: string
): Promise<{ id: string } | null> {
  const resp = await apiFetch<{ results: { id: string }[] }>(
    `/databases/${databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: "Key",
          rich_text: { equals: key },
        },
        page_size: 1,
      }),
    }
  );
  return resp.results[0] ?? null;
}

// ---------- File uploads ----------

// Two-step: POST /v1/file_uploads to get an upload URL, then PUT the bytes
// to that URL. Returns the file_upload id usable as a "file_upload" ref
// in page property `files`.
export async function uploadFile(
  buffer: Uint8Array,
  filename: string,
  mimeType = "application/pdf"
): Promise<string> {
  const created = await apiFetch<{ id: string; upload_url: string }>(
    "/file_uploads",
    {
      method: "POST",
      body: JSON.stringify({ filename, content_type: mimeType }),
    }
  );

  const form = new FormData();
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  form.append("file", new Blob([ab], { type: mimeType }), filename);

  const res = await fetch(created.upload_url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env["NOTION_API_KEY"]}`,
      "notion-version": API_VERSION,
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Notion file upload ${res.status}: ${text.slice(0, 300)}`
    );
  }
  return created.id;
}
