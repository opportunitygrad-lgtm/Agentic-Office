import "server-only";
import type { ApiErrorBody } from "@aibos/shared";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

/** Server-side fetch against the API service. Never cached: this is live ops data. */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(path, API_URL);
  for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new ApiUnavailableError(`API unreachable at ${API_URL}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error.message ?? `API ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
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
