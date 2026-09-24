import type { MeDTO } from "@aibos/shared";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { KnowledgeLibrary } from "@/components/knowledge/KnowledgeLibrary";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Global knowledge" };

export default async function GlobalKnowledgePage() {
  try {
    await apiGet<MeDTO>("/v1/auth/me");
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1480px]">
      <PageHeader
        eyebrow="Settings"
        title="Global knowledge"
        description="Operating policies shared by every company (scope GLOBAL). Only platform administrators can create or approve them; company knowledge never appears here."
      />
      <KnowledgeLibrary company={null} departments={[]} />
    </div>
  );
}
