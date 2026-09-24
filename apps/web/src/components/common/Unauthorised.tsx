import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/** Shown when the signed-in user lacks access. Never reveals whether a resource exists. */
export function Unauthorised({
  title = "You don't have access",
  message = "Your role doesn't include access to this area or company. Ask an administrator if you need it.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div
      role="alert"
      className="mx-auto mt-10 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center shadow-panel"
    >
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1.5 text-[13.5px] text-fg-muted">{message}</p>
      <Link
        href="/"
        className="focus-ring mt-5 inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-strong"
      >
        Back to Command Centre
      </Link>
    </div>
  );
}
