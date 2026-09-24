"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@aibos/ui";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto mt-10 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center shadow-panel"
    >
      <AlertTriangle className="mx-auto size-8 text-amber-500" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-[13.5px] text-fg-muted">{error.message || "Unexpected error"}</p>
      <Button className="mt-5" variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
