import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { AuthHeading } from "@/components/auth/AuthForm";
import { AcceptInvitationForm } from "@/components/auth/PasswordFlows";
import { apiPostTry } from "@/lib/api";

export const metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = /^[A-Za-z0-9_-]{32,128}$/.test(token)
    ? await apiPostTry<{ email: string; firstName: string | null; lastName: string | null }>(
        "/v1/auth/invitations/lookup",
        { token },
      )
    : null;
  if (!invite) {
    return (
      <div className="text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <LinkIcon className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight">
          Invitation invalid or expired
        </h1>
        <p className="mt-2 text-[13.5px] text-fg-muted">
          Invitation links work once and expire after 7 days. Ask the person who invited you to send
          a new one.
        </p>
        <Link
          href="/login"
          className="focus-ring mt-6 inline-flex h-10 items-center rounded-xl border border-line px-4 text-[13.5px] font-medium hover:bg-surface-2"
        >
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <>
      <AuthHeading
        title="Join AI Business OS"
        subtitle="Set up your account to accept the invitation."
      />
      <AcceptInvitationForm token={token} {...invite} />
    </>
  );
}
