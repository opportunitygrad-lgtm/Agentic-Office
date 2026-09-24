import { redirect } from "next/navigation";
import type { MeDTO, ShellDTO, SystemHealthDTO } from "@aibos/shared";
import { ApiOffline } from "@/components/common/ApiOffline";
import { AppShell } from "@/components/shell/AppShell";
import { SessionProvider } from "@/components/shell/SessionContext";
import { ApiError, apiGet, apiTry } from "@/lib/api";

export const dynamic = "force-dynamic";

async function loadSession(): Promise<{ me: MeDTO | null; failure: unknown }> {
  try {
    return { me: await apiGet<MeDTO>("/v1/auth/me"), failure: null };
  } catch (failure) {
    return { me: null, failure };
  }
}

/** Every page in this group requires an authenticated, active user. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, failure } = await loadSession();
  if (!me) {
    if (failure instanceof ApiError && failure.status === 401) {
      redirect(failure.code === "account_disabled" ? "/account-disabled" : "/login?expired=1");
    }
    return <ApiOffline detail={failure instanceof Error ? failure.message : undefined} />;
  }
  const [shell, health] = await Promise.all([
    apiTry<ShellDTO>("/v1/shell"),
    apiTry<SystemHealthDTO>("/v1/system/health"),
  ]);
  return (
    <SessionProvider me={me}>
      <AppShell shell={shell} health={health}>
        {children}
      </AppShell>
    </SessionProvider>
  );
}
