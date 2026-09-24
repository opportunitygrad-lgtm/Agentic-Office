import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";
import { requireEnv } from "./env";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const handle = createDb(url, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = requireEnv("DATABASE_URL");
  runMigrations(url)
    .then(() => console.log("✔ migrations applied"))
    .catch((err: unknown) => {
      console.error("✖ migration failed", err);
      process.exit(1);
    });
}
