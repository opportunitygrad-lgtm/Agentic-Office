import { createDb } from "../client";
import { requireEnv } from "../env";
import { syncReferenceData } from "./reference";
import { seedDev } from "./dev/seed-dev";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_SEED !== "true") {
    throw new Error("Refusing to load development seed data in production");
  }
  const handle = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  try {
    await syncReferenceData(handle.db);
    console.log("✔ reference data synced (departments, agent templates, integration catalog)");
    const counts = await seedDev(handle.db);
    console.log("✔ development seed loaded (origin = dev_seed)", counts);
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error("✖ seed failed", err);
  process.exit(1);
});
