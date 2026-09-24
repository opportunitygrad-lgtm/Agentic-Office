"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@aibos/ui";
import { AuthField, FormAlert, safeNext } from "./AuthForm";

export function LoginForm({
  next,
  expired,
  bootstrapRequired,
}: {
  next?: string;
  expired?: boolean;
  bootstrapRequired?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace(safeNext(next));
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      if (res.status === 403 && body?.error?.code === "account_disabled") {
        router.push("/account-disabled");
        return;
      }
      setError(
        res.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : "Invalid email or password.",
      );
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Sign in">
      {expired && <FormAlert tone="info">Your session has ended. Please sign in again.</FormAlert>}
      {bootstrapRequired && (
        <FormAlert tone="info">
          No administrator exists yet. Run{" "}
          <code className="font-mono text-[12px]">pnpm auth:bootstrap</code> on the server to create
          the first Platform Owner.
        </FormAlert>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <AuthField
        label="Email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        required
        autoFocus
      />
      <AuthField
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        trailing={
          <Link
            href="/forgot-password"
            className="focus-ring rounded text-[12px] font-medium text-accent hover:underline"
          >
            Forgot password?
          </Link>
        }
      />
      <Button
        type="submit"
        variant="primary"
        className="h-11 w-full rounded-xl text-[14px]"
        disabled={pending}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Signing in…" : "Sign in"}
        {!pending && <ArrowRight className="size-4" aria-hidden="true" />}
      </Button>
    </form>
  );
}
