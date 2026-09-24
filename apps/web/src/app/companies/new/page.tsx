import { ONBOARDING_AGENT_TEMPLATES, type AgentTemplateDTO } from "@aibos/shared";
import { PageHeader } from "@/components/common/PageHeader";
import { ApiOffline } from "@/components/common/ApiOffline";
import { AddCompanyWizard } from "@/components/wizard/AddCompanyWizard";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Add company" };

export default async function AddCompanyPage() {
  let templates: AgentTemplateDTO[];
  try {
    templates = (await apiGet<{ data: AgentTemplateDTO[] }>("/v1/agent-templates")).data;
  } catch (e) {
    return <ApiOffline detail={e instanceof Error ? e.message : undefined} />;
  }
  const onboarding = ONBOARDING_AGENT_TEMPLATES.map((k) =>
    templates.find((t) => t.key === k),
  ).filter((t): t is AgentTemplateDTO => !!t);
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        eyebrow="Companies"
        title="Add new company"
        description="Onboard a business into the operating system. Everything here can be refined later; budgets and approvals take effect immediately."
      />
      <AddCompanyWizard
        templates={onboarding.map((t) => ({
          key: t.key,
          name: t.name,
          description: t.description,
          department: t.department,
        }))}
      />
    </div>
  );
}
