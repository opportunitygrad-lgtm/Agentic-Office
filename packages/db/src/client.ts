import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { requireEnv } from "./env";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
  ping: () => Promise<boolean>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return {
    db,
    close: () => client.end({ timeout: 5 }),
    ping: async () => {
      try {
        await client`select 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
}

let shared: DbHandle | undefined;

/** Process-wide connection pool using DATABASE_URL. */
export function getDb(): DbHandle {
  shared ??= createDb(requireEnv("DATABASE_URL"));
  return shared;
}
