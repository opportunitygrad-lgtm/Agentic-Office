"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { PASSWORD_MIN_LENGTH } from "@aibos/shared";
import { Button } from "@aibos/ui";
import { AuthField, FormAlert, PasswordStrength } from "./AuthForm";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; issues?: { message: string }[] };
  } | null;
  return { res, json };
}

function validatePasswords(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password !== confirm) return "Passwords don't match.";
  return null;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { res } = await post("/api/v1/auth/password-reset/request", { email });
      if (res.status === 429) setError("Too many requests. Please try again later.");
      else if (res.status === 400) setError("Enter a valid email address.");
      else setSent(true);
    } catch {
      setError("Can't reach the server.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center" role="status">
        <MailCheck className="mx-auto size-8 text-accent" aria-hidden="true" />
        <p className="mt-3 text-[14px] font-semibold">Check your inbox</p>
        <p className="mt-1 text-[13px] text-fg-muted">
          If an account exists for {email}, a reset link is on its way. It expires in 60 minutes.
        </p>
        <Link
          href="/login"
          className="focus-ring mt-4 inline-block rounded text-[13px] font-medium text-accent hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Request password reset">
      {error && <FormAlert>{error}</FormAlert>}
      <AuthField
        label="Email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoFocus
      />
      <Button
        type="submit"
        variant="primary"
        className="h-11 w-full rounded-xl"
        disabled={pending || !email}
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Send reset link
      </Button>
      <p className="text-center text-[13px]">
        <Link href="/login" className="focus-ring rounded font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validatePasswords(password, confirm);
    if (invalid) return setError(invalid);
    setPending(true);
    setError(null);
    try {
      const { res, json } = await post("/api/v1/auth/password-reset/confirm", { token, password });
      if (res.ok) setDone(true);
      else if (json?.error?.code === "invalid_token")
        setError("This reset link is invalid or has expired. Request a new one.");
      else
        setError(
          json?.error?.issues?.[0]?.message ?? json?.error?.message ?? "Could not reset password.",
        );
    } catch {
      setError("Can't reach the server.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center" role="status">
        <CheckCircle2 className="mx-auto size-8 text-emerald-500" aria-hidden="true" />
        <p className="mt-3 text-[14px] font-semibold">Password updated</p>
        <p className="mt-1 text-[13px] text-fg-muted">All previous sessions were signed out.</p>
        <Link
          href="/login"
          className="focus-ring mt-4 inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13.5px] font-medium text-white"
        >
          Sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Choose a new password">
      {error && (
        <FormAlert>
          {error}{" "}
          {error.includes("expired") && (
            <Link href="/forgot-password" className="font-semibold underline">
              Request a new link
            </Link>
          )}
        </FormAlert>
      )}
      <div>
        <AuthField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A passphrase works well.`}
        />
        <PasswordStrength value={password} />
      </div>
      <AuthField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <Button type="submit" variant="primary" className="h-11 w-full rounded-xl" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Update password
      </Button>
    </form>
  );
}

export function AcceptInvitationForm({
  token,
  email,
  firstName,
  lastName,
}: {
  token: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}) {
  const router = useRouter();
  const [first, setFirst] = useState(firstName ?? "");
  const [last, setLast] = useState(lastName ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validatePasswords(password, confirm);
    if (invalid) return setError(invalid);
    setPending(true);
    setError(null);
    try {
      const { res, json } = await post("/api/v1/auth/invitations/accept", {
        token,
        password,
        firstName: first || undefined,
        lastName: last || undefined,
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError(
        json?.error?.code === "invalid_token"
          ? "This invitation is invalid or has expired."
          : (json?.error?.issues?.[0]?.message ?? "Could not accept invitation."),
      );
    } catch {
      setError("Can't reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Accept invitation">
      <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[13px]">
        <span className="text-fg-faint">Signing in as </span>
        <span className="font-medium">{email}</span>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="grid grid-cols-2 gap-3">
        <AuthField
          label="First name"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          autoComplete="given-name"
        />
        <AuthField
          label="Last name"
          value={last}
          onChange={(e) => setLast(e.target.value)}
          autoComplete="family-name"
        />
      </div>
      <div>
        <AuthField
          label="Create password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <PasswordStrength value={password} />
      </div>
      <AuthField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <Button type="submit" variant="primary" className="h-11 w-full rounded-xl" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Activate account
      </Button>
    </form>
  );
}
