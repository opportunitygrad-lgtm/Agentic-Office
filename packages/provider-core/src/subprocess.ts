import { spawn, type ChildProcess } from "node:child_process";
import type { ProviderType } from "@aibos/shared";
import { ProviderError } from "./types";

/**
 * Shared child-process plumbing for CLI subscription transports (Claude Code,
 * Codex CLI, …): a tracked-process registry so nothing is ever orphaned, a
 * concurrency semaphore (subscription capacity is finite) and a small
 * argument-array command runner for local CLI checks. No provider-specific
 * logic lives here.
 */

const KILL_GRACE_MS = 3_000;

interface Tracked {
  child: ChildProcess;
  provider: ProviderType;
}
const liveChildren = new Set<Tracked>();
let exitHookInstalled = false;

export function trackChild(child: ChildProcess, provider: ProviderType): void {
  const entry: Tracked = { child, provider };
  liveChildren.add(entry);
  child.once("exit", () => liveChildren.delete(entry));
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // If the worker process exits, no CLI subprocess may keep running on its own.
    process.once("exit", () => {
      for (const t of liveChildren) t.child.kill("SIGKILL");
    });
  }
}

export function alive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Graceful stop: `signal` first (SIGTERM by default; Codex treats SIGINT as
 * an interrupt request and finishes the turn as failed/interrupted rather
 * than dying mid-write), then SIGKILL after a grace period.
 */
export function terminate(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!alive(child)) return;
  child.kill(signal);
  const t = setTimeout(() => {
    if (alive(child)) child.kill("SIGKILL");
  }, KILL_GRACE_MS);
  t.unref();
  child.once("exit", () => clearTimeout(t));
}

/** Stops every tracked subprocess for one provider (worker shutdown). */
export function killAllChildrenFor(provider: ProviderType): number {
  const matching = [...liveChildren].filter((t) => t.provider === provider);
  for (const t of matching) terminate(t.child);
  return matching.length;
}

/** Stops every tracked subprocess for every provider (full worker shutdown). */
export function killAllProviderChildren(): number {
  const all = [...liveChildren];
  for (const t of all) terminate(t.child);
  return all.length;
}

export function activeChildrenFor(provider: ProviderType): number {
  let n = 0;
  for (const t of liveChildren) if (t.provider === provider) n++;
  return n;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  missing: boolean;
  timedOut: boolean;
}

/** Runs a short local CLI command with an argument array — never a shell. */
export function runCommand(
  provider: ProviderType,
  binary: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn(binary, args, { env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return resolve({ code: null, stdout, stderr, missing: true, timedOut });
    }
    trackChild(child, provider);
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < 256 * 1024) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < 8 * 1024) stderr += d.toString("utf8");
    });
    child.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, missing: err.code === "ENOENT", timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, missing: false, timedOut });
    });
  });
}

/** Subscription capacity is finite: at most N concurrent CLI runs; others queue. */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(
    private readonly max: number,
    private readonly provider: ProviderType,
  ) {}
  get inUse() {
    return this.active;
  }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.active >= this.max)
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const i = this.waiters.indexOf(go);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new ProviderError("CANCELLED", "Request cancelled", { provider: this.provider }));
        };
        const go = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
        this.waiters.push(go);
      });
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiters.shift()?.();
    };
  }
}

export function toIso(epoch: unknown): string | null {
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return null;
  return new Date(epoch < 1e12 ? epoch * 1000 : epoch).toISOString();
}
