/** Small, dependency-free helpers shared by API and UI. */

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function formatUsd(value: number, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.compact || Math.abs(value) >= 100 ? 0 : 2,
    minimumFractionDigits: opts.compact || Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bCro\b/, "CRO")
    .replace(/\bCto\b/, "CTO")
    .replace(/\bSeo\b/, "SEO");
}
