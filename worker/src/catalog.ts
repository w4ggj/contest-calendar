/**
 * The catalog, bundled into the Worker.
 *
 * engine/src/catalog.ts reads data/ with node:fs, which does not exist in
 * workerd. This imports the SAME JSON file instead, so the bundler inlines it
 * at build time and the Worker still reads the one source of truth. The catalog
 * is never copied -- two copies drift, and a drifted catalog is the exact class
 * of bug this project exists to avoid.
 */

import seed from "../../data/contests.seed.json";
import type { Contest } from "../../engine/src/recurrence.js";

interface Seed {
  schema_version?: unknown;
  generated_from?: unknown;
  contests: Contest[];
}

export const CATALOG: Contest[] = (seed as unknown as Seed).contests;

const BY_ID = new Map<string, Contest>(CATALOG.map((c) => [c.id, c]));

export function contestById(id: string): Contest | undefined {
  return BY_ID.get(id);
}

/**
 * A build-time fingerprint of the catalog, for cache keys and /api/health.
 *
 * Generation is deterministic, so a response may be cached until the catalog
 * changes -- and this is what "changes" means. Cheap non-cryptographic hash;
 * it only needs to differ when the bytes differ.
 */
export const CATALOG_VERSION: string = (() => {
  const text = JSON.stringify(seed);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
})();

export const CATALOG_SIZE = CATALOG.length;
