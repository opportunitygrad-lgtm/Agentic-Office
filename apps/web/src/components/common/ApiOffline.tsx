import { ServerOff } from "lucide-react";

export function ApiOffline({ detail }: { detail?: string }) {
  return (
    <div
      role="alert"
      className="mx-auto mt-10 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center shadow-panel"
    >
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
        <ServerOff className="size-6" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-semibold">API service is not reachable</h1>
      <p className="mt-1.5 text-[13.5px] text-fg-muted">
        The command centre needs the API. Start infrastructure and services, then refresh.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-2 p-3 text-left font-mono text-[12px] text-fg-muted">
        pnpm infra:up{"\n"}pnpm dev
      </pre>
      {detail && <p className="mt-3 text-[12px] text-fg-faint">{detail}</p>}
    </div>
  );
}
