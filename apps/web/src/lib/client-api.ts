"use client";

/** Result of a browser → API call through the same-origin /api rewrite. */
export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; issues?: { path: string; message: string }[] };

/** JSON fetch for client components. The session cookie is sent automatically (HttpOnly). */
export async function clientApi<T>(
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string | undefined> } = {},
): Promise<ClientResult<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(init.params ?? {})) if (v) qs.set(k, v);
  const url = `/api${path}${qs.size ? `?${qs.toString()}` : ""}`;
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      cache: "no-store",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 204) return { ok: true, data: undefined as T };
    const json = (await res.json().catch(() => null)) as
      (T & { error?: { message?: string; issues?: { path: string; message: string }[] } }) | null;
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        message:
          res.status === 403
            ? (json?.error?.message ?? "You don't have permission to do that.")
            : (json?.error?.message ?? `Request failed (${res.status})`),
        issues: json?.error?.issues,
      };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, message: "The API is unreachable." };
  }
}
