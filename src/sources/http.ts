export async function getJson<T = unknown>(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 20_000;
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
