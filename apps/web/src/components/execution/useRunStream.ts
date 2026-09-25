"use client";

import { useEffect, useRef, useState } from "react";
import {
  FINAL_RUN_STATUSES,
  RUN_PHASE_LABELS,
  type AgentRunDetailDTO,
  type RunStreamMessage,
} from "@aibos/shared";
import { clientApi } from "@/lib/client-api";

export interface RunStreamState {
  run: AgentRunDetailDTO | null;
  /** Visible output streamed so far (final text once complete). */
  output: string;
  error: string | null;
  live: boolean;
}

/**
 * Follows a run: Server-Sent Events from the API (worker → Redis → API),
 * falling back to polling if the stream is unavailable. Shows only
 * observable system events and visible output — never hidden reasoning.
 */
export function useRunStream(
  runId: string | null,
  opts: { onFinal?: (run: AgentRunDetailDTO) => void } = {},
): RunStreamState {
  const [state, setState] = useState<RunStreamState>({
    run: null,
    output: "",
    error: null,
    live: false,
  });
  const onFinal = useRef(opts.onFinal);
  useEffect(() => {
    onFinal.current = opts.onFinal;
  }, [opts.onFinal]);

  useEffect(() => {
    if (!runId) return;
    let closed = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;
    const finish = (run: AgentRunDetailDTO) => {
      es?.close();
      if (poll) clearInterval(poll);
      onFinal.current?.(run);
    };
    const startPolling = () => {
      if (poll || closed) return;
      poll = setInterval(async () => {
        const r = await clientApi<{ data: AgentRunDetailDTO }>(`/v1/runs/${runId}`);
        if (closed) return;
        if (!r.ok) {
          setState((s) => ({ ...s, error: r.message, live: false }));
          return;
        }
        setState({ run: r.data.data, output: r.data.data.outputText, error: null, live: false });
        if (FINAL_RUN_STATUSES.includes(r.data.data.status)) finish(r.data.data);
      }, 1500);
    };
    if (typeof EventSource === "undefined") startPolling();
    else {
      es = new EventSource(`/api/v1/runs/${runId}/stream`);
      es.onmessage = (e) => {
        const m = JSON.parse(e.data) as RunStreamMessage;
        setState((s) => {
          if (m.kind === "snapshot")
            return {
              run: m.run,
              output: m.run.outputText,
              error: null,
              live: !FINAL_RUN_STATUSES.includes(m.run.status),
            };
          if (!s.run) return s;
          if (m.kind === "chunk") return { ...s, output: s.output + m.text };
          if (m.kind === "event")
            return {
              ...s,
              run: {
                ...s.run,
                events: [...s.run.events.filter((x) => x.seq !== m.event.seq), m.event],
                phase: RUN_PHASE_LABELS[m.event.type] ?? s.run.phase,
              },
            };
          return { ...s, run: { ...s.run, status: m.status } };
        });
        if (m.kind === "snapshot" && FINAL_RUN_STATUSES.includes(m.run.status)) finish(m.run);
      };
      es.onerror = () => {
        es?.close();
        startPolling();
      };
    }
    return () => {
      closed = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [runId]);

  return state;
}
