import Link from "next/link";
import { Ban } from "lucide-react";

export const metadata = { title: "Account disabled" };

export default function AccountDisabledPage() {
  return (
    <div className="text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
        <Ban className="size-7" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-[22px] font-semibold tracking-tight">Account disabled</h1>
      <p className="mt-2 text-[13.5px] text-fg-muted">
        This account has been suspended or disabled, and any active sessions were signed out. If you
        think this is a mistake, contact your administrator.
      </p>
      <Link
        href="/login"
        className="focus-ring mt-6 inline-flex h-10 items-center rounded-xl border border-line px-4 text-[13.5px] font-medium hover:bg-surface-2"
      >
        Back to sign in
      </Link>
    </div>
  );
}
