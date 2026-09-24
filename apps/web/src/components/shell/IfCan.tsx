"use client";

import type { ReactNode } from "react";
import { useCan } from "./SessionContext";

/** Renders children only when the signed-in user holds the permission (UI hint only). */
export function IfCan({
  permission,
  companyId,
  children,
}: {
  permission: string;
  companyId?: string | null;
  children: ReactNode;
}) {
  return useCan(permission, companyId) ? <>{children}</> : null;
}
