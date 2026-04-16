async function getJsonOnce<T>(
  url: string,
  init: (RequestInit & { timeoutMs?: number }) | undefined,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent":
          "job-radar/0.1 (+https://github.com/; personal job discovery bot)",
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getJson<T = unknown>(
  url: string,
  init?: RequestInit & { timeoutMs?: number; retries?: number }
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 20_000;
  const retries = init?.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getJsonOnce<T>(url, init, timeoutMs);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Don't retry client errors (4xx); retry network/abort/5xx.
      if (/^HTTP 4\d\d/.test(msg)) throw err;
      if (attempt < retries) {
        const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "user-agent":
          "job-radar/0.1 (+https://github.com/; personal job discovery bot)",
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}
