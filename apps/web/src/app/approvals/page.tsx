import type { ApprovalDTO } from "@aibos/shared";
import { Panel } from "@aibos/ui";
import { ApiOffline } from "@/components/common/ApiOffline";
import { PageHeader } from "@/components/common/PageHeader";
import { ApprovalCard, ApprovalList } from "@/components/dashboard/ApprovalList";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const company = await companyParam(searchParams);
  let approvals: ApprovalDTO[];
  try {
    approvals = (await apiGet<{ data: ApprovalDTO[] }>("/v1/approvals", { company })).data;
  } catch (e) {
    return <ApiOffline detail={e instanceof Error ? e.message : undefined} />;
  }
  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="Governance"
        title="Approval centre"
        description="Agents request human approval before sensitive actions — sending email, spending money, launching ads, deploying or anything destructive. Decisions are enabled with the approval engine (Stage 33)."
        devData={approvals.some((a) => a.origin === "dev_seed")}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start">
        <Panel className="xl:col-span-8" title="Pending" eyebrow={`${pending.length} waiting`}>
          {pending.length ? (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {pending.map((a) => (
                <li key={a.id}>
                  <ApprovalCard approval={a} />
                </li>
              ))}
            </ul>
          ) : (
            <ApprovalList approvals={[]} />
          )}
        </Panel>
        <Panel className="xl:col-span-4" title="Recently decided" eyebrow="History">
          {decided.length ? (
            <ul className="space-y-2.5">
              {decided.map((a) => (
                <li key={a.id}>
                  <ApprovalCard approval={a} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-faint">No decisions yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
