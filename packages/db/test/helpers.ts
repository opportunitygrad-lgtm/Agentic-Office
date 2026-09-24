/**
 * Test utilities shared by @aibos/db and @aibos/api tests.
 * Tests always run against TEST_DATABASE_URL (a dedicated database).
 */
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "../src/client";
import { loadEnv } from "../src/env";
import { runMigrations } from "../src/migrate";
import { syncReferenceData } from "../src/seed/reference";

export function testDatabaseUrl(): string {
  loadEnv();
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set TEST_DATABASE_URL (see .env.example)");
  const u = new URL(base);
  u.pathname = "/aibos_test";
  return u.toString();
}

/** Creates the test database if needed and applies migrations + reference data. */
export async function prepareTestDatabase(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.includes("test")) {
    throw new Error(`Refusing to use "${dbName}" as a test database (name must contain "test")`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sqlc = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const exists = await sqlc`select 1 from pg_database where datname = ${dbName}`;
    if (!exists.length) await sqlc.unsafe(`create database ${dbName}`);
  } finally {
    await sqlc.end();
  }
  await runMigrations(url.toString());
  const handle = createDb(url.toString(), { max: 1 });
  try {
    await syncReferenceData(handle.db);
  } finally {
    await handle.close();
  }
}

export function createTestDb(): DbHandle {
  return createDb(testDatabaseUrl(), { max: 4 });
}

/**
 * Removes all operational rows. TRUNCATE ... CASCADE also clears tables that
 * reference companies (departments, integrations), so reference data is re-synced.
 */
export async function resetOperationalData(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`truncate table
    ai_usage_records, budget_policies, audit_events, approvals, tasks,
    agent_company_assignments, agents, companies, users, knowledge_items,
    brand_rules, commercial_rules, compliance_rules cascade`);
  await syncReferenceData(handle.db);
}

export const VALID_COMPANY = {
  name: "Test Aviation Ltd",
  industry: "Aviation training",
  primaryCountry: "IE",
  timezone: "Europe/Dublin",
  defaultCurrency: "EUR",
  dailyAiBudget: 20,
  monthlyAiBudget: 400,
  concurrencyLimit: 3,
} as const;
