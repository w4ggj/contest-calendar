/**
 * Catalog loading -- the TypeScript twin of contestcal/__init__.py.
 *
 * The JSON files under data/ are the single source of truth for BOTH engines.
 * They are not duplicated here, and they must never be: two copies of a catalog
 * drift, and a drifted catalog is exactly the class of bug this project exists
 * to avoid.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Contest } from "./recurrence.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo-root data directory, shared with the Python engine. */
export const DATA_DIR = resolve(HERE, "..", "..", "data");
export const CATALOG_PATH = join(DATA_DIR, "contests.seed.json");
export const REGISTRY_PATH = join(DATA_DIR, "sources.registry.json");

export interface Registry {
  known_derived_sources: { name: string; url?: string; reason?: string }[];
  [key: string]: unknown;
}

/** Load the contest catalog from data/contests.seed.json. */
export function loadCatalog(path: string = CATALOG_PATH): Contest[] {
  return JSON.parse(readFileSync(path, "utf-8")).contests as Contest[];
}

/** Load the global sponsor sourcing registry. */
export function loadRegistry(path: string = REGISTRY_PATH): Registry {
  return JSON.parse(readFileSync(path, "utf-8")) as Registry;
}
