/**
 * Wall-clock -> UTC resolution for sponsor-anchored contests.
 *
 * This is the one part of the port that is not a direct translation, because
 * Python has `zoneinfo` in the stdlib and JavaScript's equivalent depends on
 * the runtime. Two resolvers are provided and they must agree exactly:
 *
 *   - `temporalResolver` uses `Temporal.ZonedDateTime`. Preferred where the
 *     runtime has it. Its default `'compatible'` disambiguation happens to
 *     match Python's `zoneinfo` on both DST edges, which is the whole reason
 *     the two engines can be held to identical expectations.
 *   - `intlResolver` uses `Intl.DateTimeFormat` with an explicit `timeZone`.
 *     Works on every runtime that ships the IANA database, which in practice
 *     is all of them. Resolves the DST edges explicitly rather than relying on
 *     a library default.
 *
 * NEVER use `new Date("2026-03-08T02:30")` here. A local-time string makes the
 * runtime silently apply *its own* zone, which is exactly the bug the Python
 * side removed, and it works fine on a developer's machine in the right zone.
 */

export interface WallFields {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Resolve a wall-clock reading in `timeZone` to an epoch-millisecond instant. */
export type ZoneResolver = (fields: WallFields, timeZone: string) => number;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Intl-based resolver -- the portable path
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** The wall clock reading an observer in `timeZone` sees at instant `utcMs`. */
function wallFieldsAt(utcMs: number, timeZone: string): WallFields {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function asIfUtc(f: WallFields): number {
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute);
}

/** Zone offset in milliseconds at `utcMs`; positive east of Greenwich. */
function offsetAt(utcMs: number, timeZone: string): number {
  return asIfUtc(wallFieldsAt(utcMs, timeZone)) - utcMs;
}

export const intlResolver: ZoneResolver = (fields, timeZone) => {
  const target = asIfUtc(fields);

  // Offsets a day either side bracket any transition in between, so these two
  // are the only candidate interpretations of the reading.
  const before = offsetAt(target - DAY_MS, timeZone);
  const after = offsetAt(target + DAY_MS, timeZone);

  const candidates = [...new Set([target - before, target - after])];
  const valid = candidates.filter(
    (c) => asIfUtc(wallFieldsAt(c, timeZone)) === target,
  );

  if (valid.length > 0) {
    // Ambiguous readings (the repeated hour when clocks go back) resolve to the
    // FIRST pass -- matching Python's default `fold=0`. Unambiguous readings
    // have exactly one valid candidate, so the min is simply that one.
    return Math.min(...valid);
  }

  // No valid candidate means the reading never happens: the gap when clocks go
  // forward. Interpret with the pre-transition offset, which pushes the result
  // an hour later in wall terms. Python's zoneinfo does the same silently.
  return target - before;
};

// ---------------------------------------------------------------------------
// Temporal-based resolver -- preferred where available
// ---------------------------------------------------------------------------

declare const Temporal: any;

export const temporalResolver: ZoneResolver | null =
  typeof Temporal !== "undefined"
    ? (fields, timeZone) =>
        Temporal.PlainDateTime.from(fields)
          .toZonedDateTime(timeZone)
          .toInstant().epochMilliseconds
    : null;

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let override: ZoneResolver | null = null;

/**
 * Force a resolver, or pass null to restore automatic selection.
 * Exists so the test suite can hold BOTH implementations to the same
 * expectations -- if they ever diverge, dates silently differ by an hour
 * depending on which runtime served the request.
 */
export function setZoneResolver(resolver: ZoneResolver | null): void {
  override = resolver;
}

export function activeResolver(): ZoneResolver {
  return override ?? temporalResolver ?? intlResolver;
}

export function resolveWallClock(fields: WallFields, timeZone: string): number {
  return activeResolver()(fields, timeZone);
}
