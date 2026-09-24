import type { ReactNode } from "react";
import { MockBadge } from "@aibos/ui";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  devData,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  devData?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5 flex items-center gap-2">{eyebrow}</div>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {devData && <MockBadge label="Dev seed data" />}
        </div>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
