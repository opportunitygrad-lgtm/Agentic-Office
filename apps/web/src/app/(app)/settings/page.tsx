import Link from "next/link";
import { KeyRound, Lock, ShieldCheck, UserCog } from "lucide-react";
import { Panel } from "@aibos/ui";
import { PageHeader } from "@/components/common/PageHeader";

export const metadata = { title: "Settings" };

const SECRETS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Platform configuration, access control and security posture."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Users, roles & permissions" eyebrow="Access">
          <div className="flex gap-3">
            <UserCog className="size-5 shrink-0 text-fg-faint" aria-hidden="true" />
            <p className="text-[13px] text-fg-muted">
              People sign in with email and password. Company memberships and roles decide what each
              person can see and do; manage them in{" "}
              <Link href="/settings/users" className="font-medium text-accent hover:underline">
                Users &amp; Access
              </Link>{" "}
              and{" "}
              <Link href="/settings/roles" className="font-medium text-accent hover:underline">
                Roles &amp; Permissions
              </Link>
              .
            </p>
          </div>
        </Panel>
        <Panel title="Security posture" eyebrow="Foundation">
          <ul className="space-y-2 text-[13px] text-fg-muted">
            <li className="flex gap-2">
              <ShieldCheck
                className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />{" "}
              Secrets load from environment only — never from the database or code.
            </li>
            <li className="flex gap-2">
              <ShieldCheck
                className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />{" "}
              All input validated with shared Zod schemas at the API boundary.
            </li>
            <li className="flex gap-2">
              <ShieldCheck
                className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />{" "}
              Mutations write append-only audit events with request metadata.
            </li>
            <li className="flex gap-2">
              <ShieldCheck
                className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />{" "}
              Server-side sessions in HttpOnly cookies; every API route checks permissions and
              company isolation.
            </li>
            <li className="flex gap-2">
              <Lock className="size-4 shrink-0 text-fg-faint" aria-hidden="true" /> Live
              integrations and AI providers remain disabled until their build stages.
            </li>
          </ul>
        </Panel>
        <Panel title="Secret slots" eyebrow="Environment" className="lg:col-span-2">
          <p className="mb-3 text-[13px] text-fg-muted">
            Declared in <code className="font-mono text-[12px]">.env.example</code>. Values are
            never displayed by the application. See{" "}
            <code className="font-mono text-[12px]">docs/SECURITY.md</code>.
          </p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {SECRETS.map((s) => (
              <li
                key={s}
                className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[11.5px] text-fg-muted"
              >
                <KeyRound className="size-3.5 text-fg-faint" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
