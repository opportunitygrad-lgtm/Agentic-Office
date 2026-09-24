/**
 * First-administrator bootstrap:  pnpm auth:bootstrap
 *
 * - Reads BOOTSTRAP_ADMIN_EMAIL from the environment.
 * - Prompts for the password (hidden) or reads it from stdin with
 *   --password-stdin (for automation). Never from source or env.
 * - Refuses if ANY user already exists; audited as SERVICE: bootstrap-cli.
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { emailSchema, passwordSchema } from "@aibos/shared";
import { createDb } from "../client";
import { requireEnv } from "../env";
import { bootstrapPlatformOwner } from "../repositories/auth";
import { countUsers } from "../repositories/identity";
import { syncReferenceData } from "../seed/reference";

async function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(prompt)) write.call(rl, prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

async function main() {
  const email = emailSchema.parse(requireEnv("BOOTSTRAP_ADMIN_EMAIL"));
  const handle = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  try {
    await syncReferenceData(handle.db);
    if ((await countUsers(handle.db)) > 0) {
      console.error(
        "✖ Bootstrap refused: users already exist. Manage people in Settings → Users & Access.",
      );
      process.exitCode = 1;
      return;
    }
    let password: string;
    if (process.argv.includes("--password-stdin")) {
      password = await readStdin();
    } else {
      password = await readHidden(`Password for ${email}: `);
      const confirm = await readHidden("Confirm password: ");
      if (password !== confirm) throw new Error("Passwords do not match");
    }
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid password");
    const user = await bootstrapPlatformOwner(handle.db, { email, password });
    console.log(`✔ Platform Owner created: ${user.email}. Sign in at /login.`);
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
