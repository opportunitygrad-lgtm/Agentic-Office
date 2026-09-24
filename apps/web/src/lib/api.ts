import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, type ApiErrorBody } from "@aibos/shared";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Forwards the caller's session cookie (and nothing else) to the API. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? { cookie: `${SESSION_COOKIE}=${token}` } : {};
}

/** Server-side fetch against the API service. Never cached: this is live, per-user data. */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(path, API_URL);
  for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: await authHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ApiUnavailableError(`API unreachable at ${API_URL}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? "error",
      body?.error.message ?? `API ${res.status} for ${path}`,
    );
  }
  return (await res.json()) as T;
}

/** Unauthenticated POST used for token lookups (tokens stay out of URLs and logs). */
export async function apiPostTry<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(new URL(path, API_URL), {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function apiTry<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T | null> {
  try {
    return await apiGet<T>(path, params);
  } catch {
    return null;
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function companyParam(searchParams: SearchParams): Promise<string | undefined> {
  const sp = await searchParams;
  const v = sp.company;
  const s = Array.isArray(v) ? v[0] : v;
  return s && s !== "all" ? s : undefined;
}
