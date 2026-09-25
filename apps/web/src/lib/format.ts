export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = Math.round((now - Date.parse(iso)) / 1000);
  const abs = Math.abs(diff);
  const fmt = (n: number, unit: string) => (diff >= 0 ? `${n}${unit} ago` : `in ${n}${unit}`);
  if (abs < 45) return diff >= 0 ? "just now" : "in a moment";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86_400) return fmt(Math.round(abs / 3600), "h");
  return fmt(Math.round(abs / 86_400), "d");
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function withCompany(href: string, company?: string | null): string {
  if (!company) return href;
  const [path, qs] = href.split("?");
  const params = new URLSearchParams(qs);
  params.set("company", company);
  return `${path}?${params.toString()}`;
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0;
}

/** Date and time for audit-style displays, e.g. "25 Sep 2026, 10:04". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
