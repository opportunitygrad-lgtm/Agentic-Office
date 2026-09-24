"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Lock, X } from "lucide-react";
import type { ApprovalDTO } from "@aibos/shared";
import { Button } from "@aibos/ui";
import { Dialog } from "../common/Dialog";

/**
 * Approve / reject controls. Enabled only when the API reports the viewer has
 * the required authority — and the API re-checks on submit regardless.
 */
export function ApprovalActions({ approval }: { approval: ApprovalDTO }) {
  const router = useRouter();
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (approval.status !== "pending") return null;
  const allowed = approval.viewerCanDecide === true;
  const missing = approval.viewerMissingPermissions ?? [];

  async function submit() {
    if (!decision) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/approvals/${approval.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Decision failed");
        return;
      }
      setDecision(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (!allowed) {
    return (
      <p
        className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-[11.5px] text-fg-muted"
        title={`Requires: ${missing.join(", ")}`}
      >
        <Lock className="size-3.5" aria-hidden="true" />
        <span>
          Needs{" "}
          <span className="font-mono text-[11px]">
            {missing.join(", ") || "approval authority"}
          </span>
        </span>
      </p>
    );
  }

  return (
    <>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          icon={<X className="size-3.5" />}
          onClick={() => setDecision("reject")}
        >
          Reject
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Check className="size-3.5" />}
          onClick={() => setDecision("approve")}
        >
          Approve
        </Button>
      </div>
      <Dialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === "approve" ? "Approve request" : "Reject request"}
        description={approval.requestedAction}
      >
        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium">
              Decision notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <p className="text-[12px] text-fg-faint">
            Your decision is recorded in the audit log with your identity.
          </p>
          {error && (
            <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === "approve" ? "primary" : "danger"}
              onClick={submit}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {decision === "approve" ? "Confirm approval" : "Confirm rejection"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
