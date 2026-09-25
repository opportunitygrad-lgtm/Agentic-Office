"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import type { AgentRunDTO } from "@aibos/shared";
import { EmptyState } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { LiveRunMini, stopRun } from "./LiveRun";
import { useRunStream } from "./useRunStream";

function StreamingMini({ run, onStop }: { run: AgentRunDTO; onStop: () => void }) {
  const { run: live, output } = useRunStream(run.id);
  return <LiveRunMini run={live ?? run} output={output} onStop={onStop} />;
}

/** Real agent runs in progress (text agents — no simulated browser). */
export function ActiveRuns({ company }: { company?: string }) {
  const [runs, setRuns] = useState<AgentRunDTO[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () =>
      void clientApi<{ data: AgentRunDTO[] }>("/v1/runs", {
        params: { active: "true", company },
      }).then((r) => {
        if (live && r.ok) setRuns(r.data.data);
      });
    load();
    const t = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [company, version]);

  if (runs === null) return null;
  if (!runs.length)
    return (
      <EmptyState
        icon={<Activity className="size-5" />}
        title="No agent runs in progress"
        description="Runs appear here while an agent is actually working on a task or reply."
      />
    );
  return (
    <ul
      className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3"
      aria-label="Active agent runs"
    >
      {runs.map((r) => (
        <li key={r.id}>
          <StreamingMini
            run={r}
            onStop={() => void stopRun(r.id).then(() => setVersion((v) => v + 1))}
          />
        </li>
      ))}
    </ul>
  );
}
