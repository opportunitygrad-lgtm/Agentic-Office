"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import type { ConversationDTO, ConversationMessageDTO } from "@aibos/shared";
import { Button, EmptyState, Panel, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";

/**
 * Conversation foundation only (Stage 04): messages are stored and audited,
 * but agents do not reply yet — a system placeholder explains why.
 */
export function AgentChatShell({
  agentId,
  companies,
}: {
  agentId: string;
  companies: { id: string; name: string }[];
}) {
  const [list, setList] = useState<ConversationDTO[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessageDTO[]>([]);
  const [draft, setDraft] = useState("");
  const [company, setCompany] = useState(companies[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

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
    void clientApi<{ data: ConversationMessageDTO[] }>(`/v1/conversations/${active}/messages`).then(
      (r) => {
        if (r.ok) setMessages(r.data.data);
      },
    );
  }, [active]);

  async function start() {
    setError(null);
    const r = await clientApi<{ data: { id: string } }>("/v1/conversations", {
      method: "POST",
      body: { agentId, companyId: company },
    });
    if (!r.ok) return setError(r.message);
    reload();
    setActive(r.data.data.id);
  }

  async function send() {
    if (!active || !draft.trim()) return;
    const r = await clientApi<{ data: ConversationMessageDTO[] }>(
      `/v1/conversations/${active}/messages`,
      {
        method: "POST",
        body: { content: draft },
      },
    );
    if (!r.ok) return setError(r.message);
    setDraft("");
    setMessages(r.data.data);
    reload();
  }

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
                  onClick={() => setActive(c.id)}
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
        eyebrow="Agents do not reply yet — AI providers connect in a later stage"
        bodyClassName="flex min-h-[320px] flex-col p-0"
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
              aria-live="polite"
            >
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-[13px]",
                    m.role === "human"
                      ? "ml-auto bg-accent text-white"
                      : "bg-surface-2 text-fg-muted",
                  )}
                >
                  <p className="text-[10.5px] font-medium opacity-80">{m.author}</p>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </li>
              ))}
            </ol>
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="chat-draft">
                Message
              </label>
              <input
                id="chat-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a message"
                className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px]"
              />
              <Button
                type="submit"
                variant="primary"
                icon={<Send className="size-4" aria-hidden="true" />}
                disabled={!draft.trim()}
              >
                Send
              </Button>
            </form>
          </>
        )}
        {error && (
          <p role="alert" className="px-4 pb-3 text-[12.5px] text-rose-600">
            {error}
          </p>
        )}
      </Panel>
    </div>
  );
}
