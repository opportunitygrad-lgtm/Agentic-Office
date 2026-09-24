import { prepareTestDatabase } from "./helpers";

export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}
