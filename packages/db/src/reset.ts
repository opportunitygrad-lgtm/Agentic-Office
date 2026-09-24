import postgres from "postgres";
import { requireEnv } from "./env";

/** DEVELOPMENT ONLY: drops and recreates the public schema. */
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("db:reset is disabled in production");
  const sql = postgres(requireEnv("DATABASE_URL"), { max: 1, onnotice: () => {} });
  await sql.unsafe(
    "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
  );
  await sql.end();
  console.log("✔ database reset");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
