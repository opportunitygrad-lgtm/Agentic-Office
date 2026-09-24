import { ONBOARDING_AGENT_TEMPLATES, type AgentTemplateDTO, type MeDTO } from "@aibos/shared";
import { Unauthorised } from "@/components/common/Unauthorised";
import { PageHeader } from "@/components/common/PageHeader";
import { PageError } from "@/components/common/PageError";
import { AddCompanyWizard } from "@/components/wizard/AddCompanyWizard";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Add company" };

export default async function AddCompanyPage() {
  let templates: AgentTemplateDTO[];
  let me: MeDTO;
  try {
    [templates, me] = await Promise.all([
      apiGet<{ data: AgentTemplateDTO[] }>("/v1/agent-templates").then((r) => r.data),
      apiGet<MeDTO>("/v1/auth/me"),
    ]);
  } catch (e) {
    return <PageError error={e} />;
  }
  if (!me.globalPermissions.includes("company.create")) {
    return (
      <Unauthorised message="Creating companies requires the company.create permission (Platform Owner or Group Admin)." />
    );
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
