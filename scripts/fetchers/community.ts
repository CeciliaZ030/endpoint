import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Endpoint } from "../../src/lib/types";

const seed = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "seed", "community.json");

// Reviewed PR submissions live in a durable seed; generated catalog files are
// replaced by the daily fetch and must not be edited for manual listings.
export async function fetchCommunity(): Promise<Endpoint[]> {
  const entries = JSON.parse(await readFile(seed, "utf8")) as Endpoint[];
  return entries.map((entry) => ({ ...entry, source: ["community"] }));
}
