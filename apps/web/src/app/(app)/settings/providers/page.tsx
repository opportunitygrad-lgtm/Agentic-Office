import type { ProviderStatusDTO } from "@aibos/shared";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { ProviderSettings } from "@/components/execution/ProviderSettings";
import { apiGet } from "@/lib/api";

export const metadata = { title: "AI providers" };

export default async function ProvidersPage() {
  let providers: ProviderStatusDTO[];
  let mode: string;
  try {
    const r = await apiGet<{ data: ProviderStatusDTO[]; mode: string }>("/v1/providers");
    providers = r.data;
    mode = r.mode;
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="Settings"
        title="AI providers"
        description="Provider connection, model policy and spend. Credentials are configured on the server and are never shown here."
        devData={mode === "mock"}
      />
      <ProviderSettings providers={providers} />
    </div>
  );
}
