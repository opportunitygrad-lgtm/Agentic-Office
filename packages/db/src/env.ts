import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

let loaded = false;

/**
 * Loads the repository-root `.env` (if present) into process.env without
 * overriding variables that are already set. Secrets never live in code.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate) && existsSync(join(dir, "pnpm-workspace.yaml"))) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const fallback = resolve(dir, ".env");
  if (existsSync(fallback)) process.loadEnvFile(fallback);
}

export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env (see docs/DEVELOPMENT.md).`,
    );
  }
  return value;
}
