import type { LiveSessionDTO } from "@aibos/shared";
import { Panel } from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { LiveAgentScreen } from "@/components/live/LiveAgentScreen";
import { LiveSessionSwitcher } from "@/components/live/LiveSessionSwitcher";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

export const metadata = { title: "Live sessions" };

export default async function LivePage({ searchParams }: { searchParams: SearchParams }) {
  const company = await companyParam(searchParams);
  let sessions: LiveSessionDTO[];
  try {
    sessions = (await apiGet<{ data: LiveSessionDTO[] }>("/v1/live-sessions", { company })).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="Operations"
        title="Live sessions"
        description="Near-live view of what each agent is doing. This is the Stage 01 placeholder: sessions are simulated from agent and task state; real browser streaming and human takeover arrive in Stages 29–32."
        devData
      />
      <Panel title="Focused session" eyebrow="Viewer">
        <LiveSessionSwitcher sessions={sessions} />
      </Panel>
      {sessions.length > 1 && (
        <section aria-labelledby="wall-title" className="mt-6">
          <h2 id="wall-title" className="eyebrow mb-3">
            Session wall
          </h2>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {sessions.map((s) => (
              <li key={s.id}>
                <LiveAgentScreen session={s} variant="compact" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
