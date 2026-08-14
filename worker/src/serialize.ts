/**
 * Occurrence -> JSON for the API.
 *
 * Built on `Occurrence.toDict()`, which is the engine's canonical serialisation
 * and the exact shape the Python reference emits. The API adds fields on top
 * rather than reshaping, so an API response and a parity dump stay diffable
 * against each other field for field.
 */

import type { Occurrence } from "../../engine/src/recurrence.js";
import {
  bandFamilies,
  durationBucketOf,
  modeFamilies,
} from "./schedule.js";

export interface OccurrenceJson extends Record<string, unknown> {
  uid: string;
  start_date: string;
  mode_families: string[];
  band_families: string[];
  duration_bucket: string;
}

/**
 * Stable identity for one running of one contest.
 *
 * Must not change between deploys: calendar clients treat a changed UID as a
 * different event, so an unstable one turns every subscriber's calendar into
 * duplicates. Built from contest id + start instant, both of which are
 * deterministic functions of the catalog.
 */
export function occurrenceUid(o: Occurrence): string {
  const stamp = (o.start ?? o.start_wall)!
    .toISOString()
    .slice(0, 16)
    .replace(/[-:]/g, "");
  return `${o.contest_id}-${stamp}@contestcal`;
}

export function occurrenceToJson(o: Occurrence): OccurrenceJson {
  return {
    ...o.toDict(),
    uid: occurrenceUid(o),
    start_date: o.start_date,
    mode_families: modeFamilies(o.modes),
    band_families: bandFamilies(o.bands),
    duration_bucket: durationBucketOf(o.duration_hours),
  } as OccurrenceJson;
}
