import type { CompanyRef } from "@aibos/shared";

export function CompanyChip({ company, global }: { company: CompanyRef | null; global?: boolean }) {
  if (!company) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted">
        <span className="size-2 rounded-[3px] border border-fg-faint" aria-hidden="true" />
        {global === false ? "—" : "Group"}
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-fg-muted">
      <span
        className="size-2 shrink-0 rounded-[3px]"
        style={{ background: company.accentColor ?? "#64748b" }}
        aria-hidden="true"
      />
      <span className="truncate">{company.name}</span>
    </span>
  );
}
