export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const BASE = "/api";

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const b = body as { error?: string; code?: string } | null;
    if (res.status === 401 && b?.code === "unauthorized") window.dispatchEvent(new Event("margin:unauthorized"));
    throw new ApiError(res.status, b?.error ?? `Request failed (${res.status})`, b?.code);
  }
  return body as T;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-margin-client": "1" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Can't reach the Margin server. Check your connection and try again.", "network");
  }
  return handle<T>(res);
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const del = <T>(path: string, body?: unknown) => api<T>("DELETE", path, body);

/** POST that streams Server-Sent Events back; resolves when the stream ends. */
export async function postStream(
  path: string,
  body: unknown,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "x-margin-client": "1", "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  if (!res.ok || !res.body) {
    await handle(res);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) {
        try {
          onEvent(event, JSON.parse(data.join("\n")));
        } catch {
          /* ignore malformed event */
        }
      }
    }
  }
}

export async function uploadFiles(files: File[], fields: Record<string, string | null | undefined> = {}) {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
  return api<{ results: { document?: import("./types").DocumentSummary; duplicate?: boolean; filename: string; error?: string }[] }>(
    "POST",
    "/documents",
    form,
  );
}
