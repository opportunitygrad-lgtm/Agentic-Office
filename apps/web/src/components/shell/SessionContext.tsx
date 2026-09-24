"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MeDTO } from "@aibos/shared";

const SessionContext = createContext<MeDTO | null>(null);

export function SessionProvider({ me, children }: { me: MeDTO; children: ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useMe(): MeDTO | null {
  return useContext(SessionContext);
}

/**
 * UI-only permission hint (hide/disable controls). The API always re-checks;
 * never rely on this for security.
 */
export function hasPermission(
  me: MeDTO | null,
  permission: string,
  companyId?: string | null,
): boolean {
  if (!me) return false;
  if (me.globalPermissions.includes(permission)) return true;
  if (companyId) return me.companyPermissions[companyId]?.includes(permission) ?? false;
  return Object.values(me.companyPermissions).some((perms) => perms.includes(permission));
}

export function useCan(permission: string, companyId?: string | null): boolean {
  return hasPermission(useMe(), permission, companyId);
}
