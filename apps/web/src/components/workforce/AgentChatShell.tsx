"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, RotateCcw, Send, Square } from "lucide-react";
import type { ConversationDTO, ConversationMessageDTO } from "@aibos/shared";
import { Button, EmptyState, Panel, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { clockTime, relativeTime } from "@/lib/format";
import { useRunStream } from "../execution/useRunStream";
import { hasPermission, useMe } from "../shell/SessionContext";

const MODEL_LABEL: Record<string, string> = {
  sonnet: "Claude Sonnet",
  opus: "Claude Opus",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-5-5": "Claude Opus 5.5",
};

/**
 * Direct agent chat (part of the Agent Detail page). Messages are answered by
 * a real agent run in the worker and streamed back; the agent uses only its
 * company context and has no external tools.
 */
export function AgentChatShell({
  agentId,
  companies,
}: {
  agentId: string;
  companies: { id: string; name: string }[];
}) {
  const me = useMe();
  const [list, setList] = useState<ConversationDTO[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessageDTO[]>([]);
  const [draft, setDraft] = useState("");
  const [company, setCompany] = useState(companies[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    void clientApi<{ data: ConversationDTO[] }>("/v1/conversations", {
      params: { agent: agentId },
    }).then((r) => {
      if (live && r.ok) setList(r.data.data);
    });
    return () => {
      live = false;
    };
  }, [agentId, version]);

  useEffect(() => {
    if (!active) return;
    let live = true;
    void Promise.all([
      clientApi<{ data: ConversationMessageDTO[] }>(`/v1/conversations/${active}/messages`),
      clientApi<{ data: { runId: string | null } }>(`/v1/conversations/${active}/active-run`),
    ]).then(([m, r]) => {
      if (!live) return;
      if (m.ok) setMessages(m.data.data);
      if (r.ok) setRunId(r.data.data.runId);
    });
    return () => {
      live = false;
    };
  }, [active, version]);

  const stream = useRunStream(runId, {
    onFinal: () => {
      setRunId(null);
      reload();
    },
  });
  const conversation = list.find((c) => c.id === active) ?? null;
  const canChat = conversation ? hasPermission(me, "agent.chat", conversation.company.id) : false;

  async function start() {
    setError(null);
    const r = await clientApi<{ data: { id: string } }>("/v1/conversations", {
      method: "POST",
      body: { agentId, companyId: company },
    });
    if (!r.ok) return setError(r.message);
    setActive(r.data.data.id);
    reload();
  }

  async function send(content: string) {
    if (!active || !content.trim()) return;
    setError(null);
    const r = await clientApi<{ data: { runId: string; messages: ConversationMessageDTO[] } }>(
      `/v1/conversations/${active}/messages`,
      {
        method: "POST",
        body: { content, idempotencyKey: `${active}-${Date.now()}` },
      },
    );
    if (!r.ok) return setError(r.message);
    setDraft("");
    setMessages(r.data.data.messages);
    setRunId(r.data.data.runId);
  }

  const last = messages.at(-1);
  const lastHuman = [...messages].reverse().find((m) => m.role === "human");
  const failed = !runId && last?.role === "system" && lastHuman;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Panel title="Conversations" bodyClassName="p-3">
        {companies.length > 0 ? (
          <div className="mb-3 flex gap-2">
            {companies.length > 1 && (
              <select
                aria-label="Conversation company"
                className="focus-ring h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[12.5px]"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" variant="primary" onClick={() => void start()}>
              New conversation
            </Button>
          </div>
        ) : (
          <p className="mb-3 text-[12px] text-fg-muted">
            You cannot start conversations for this agent.
          </p>
        )}
        {list.length === 0 ? (
          <p className="text-[12.5px] text-fg-faint">No conversations yet.</p>
        ) : (
          <ul className="space-y-1">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setActive(c.id);
                    setRunId(null);
                  }}
                  aria-current={active === c.id}
                  className={cn(
                    "focus-ring w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-surface-2",
                    active === c.id && "bg-accent-soft text-accent",
                  )}
                >
                  <span className="block truncate font-medium">
                    {c.title ?? `${c.company.name} conversation`}
                  </span>
                  <span className="text-[11px] text-fg-faint">
                    {c.messageCount} messages · {relativeTime(c.lastMessageAt ?? c.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        title="Chat"
        eyebrow={
          conversation
            ? `Company: ${conversation.company.name} · context from this company only`
            : "Select a conversation"
        }
        bodyClassName="flex min-h-[360px] flex-col p-0"
      >
        {!active ? (
          <EmptyState
            className="m-4 flex-1"
            icon={<MessageSquare className="size-5" />}
            title="Select or start a conversation"
          />
        ) : (
          <>
            <ol
              className="flex-1 space-y-2 overflow-y-auto p-4"
              aria-label="Messages"
              data-testid="chat-messages"
            >
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-[13px]",
                    m.role === "human"
                      ? "ml-auto bg-accent text-white"
                      : m.role === "agent"
                        ? "bg-surface-2"
                        : "mx-auto bg-transparent text-center text-[12px] text-fg-muted",
                  )}
                >
                  <p className="flex items-center gap-2 text-[10.5px] font-medium opacity-80">
                    {m.author} · {clockTime(m.createdAt)}
                    {m.role === "agent" && m.model && (
                      <span className="rounded bg-surface px-1 ring-1 ring-inset ring-line">
                        {MODEL_LABEL[m.model] ?? m.model}
                      </span>
                    )}
                  </p>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </li>
              ))}
              {runId && (
                <li
                  className="max-w-[85%] rounded-xl bg-surface-2 px-3 py-2 text-[13px]"
                  aria-live="polite"
                  data-testid="chat-streaming"
                >
                  <p className="flex items-center gap-2 text-[10.5px] font-medium opacity-80">
                    Agent ·{" "}
                    {stream.run
                      ? stream.run.modelLabel.replace(" (mock)", "") +
                        (stream.run.isMock ? " · mock" : "")
                      : "…"}
                  </p>
                  <p className="whitespace-pre-wrap">
                    {stream.output || (
                      <span className="text-fg-muted">{stream.run?.phase ?? "Queued"}…</span>
                    )}
                    <span className="animate-pulse">▍</span>
                  </p>
                </li>
              )}
            </ol>
            {error && (
              <p role="alert" className="px-4 pb-2 text-[12.5px] text-rose-600">
                {error}
              </p>
            )}
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              {runId ? (
                <Button
                  variant="danger"
                  icon={<Square className="size-4" aria-hidden="true" />}
                  onClick={() =>
                    void clientApi(`/v1/runs/${runId}/cancel`, { method: "POST", body: {} })
                  }
                >
                  Stop generating
                </Button>
              ) : failed ? (
                <Button
                  icon={<RotateCcw className="size-4" aria-hidden="true" />}
                  onClick={() => void send(lastHuman!.content)}
                  disabled={!canChat}
                >
                  Retry
                </Button>
              ) : null}
              <label className="sr-only" htmlFor="chat-draft">
                Message
              </label>
              <input
                id="chat-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  canChat ? "Write a message" : "You don't have permission to chat with this agent"
                }
                disabled={!canChat || !!runId}
                className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] disabled:opacity-60"
              />
              <Button
                type="submit"
                variant="primary"
                icon={<Send className="size-4" aria-hidden="true" />}
                disabled={!draft.trim() || !canChat || !!runId}
              >
                Send
              </Button>
            </form>
          </>
        )}
      </Panel>
    </div>
  );
}
