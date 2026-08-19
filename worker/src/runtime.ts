/**
 * Zone-resolver pin, startup log, and a self-check the health endpoint serves.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `activeResolver()` in engine/src/zones.ts is
 *
 *     override ?? temporalResolver ?? intlResolver
 *
 * and `temporalResolver` is non-null whenever `typeof Temporal !== "undefined"`.
 * That is a PRESENCE check standing in for a CORRECTNESS check, and the two
 * environments this Worker runs in disagree about presence:
 *
 *   local workerd 1.20260814.1   Temporal absent   -> intlResolver
 *   deployed fleet (since        Temporal present  -> temporalResolver
 *   2026-07-30, workerd#6907)    but clock frozen
 *                                at epoch 0
 *
 * Probed, not assumed: `npm run probe` drives probe/temporal-probe.js inside
 * real workerd at four compatibility dates. See TIMEZONE_BRIEF.md.
 *
 * An unpinned Worker would therefore resolve sponsor-anchored contest times
 * through a different implementation in production than the one every test
 * covers -- and the failure mode is one contest an hour off, in one
 * environment, silently. So:
 *
 *   1. `setZoneResolver(intlResolver)` runs ONCE at module scope, below, before
 *      any expansion can happen. Not per request: a request that beats the
 *      override would get the other resolver.
 *   2. The pin is VERIFIED rather than trusted. `resolverSelfCheck()` resolves
 *      wall-clock readings whose correct answers come from Python's zoneinfo,
 *      including both DST edges. /api/health serves the result and returns 503
 *      if it fails, so a silent fallback becomes a loud unhealthy signal.
 */

import {
  intlResolver,
  resolveWallClock,
  setZoneResolver,
  type WallFields,
} from "../../engine/src/zones.js";

// ---------------------------------------------------------------------------
// The pin. Module scope, exactly once, before anything expands a contest.
// ---------------------------------------------------------------------------

setZoneResolver(intlResolver);

export const PINNED_RESOLVER = "intl" as const;

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

interface Vector {
  label: string;
  zone: string;
  fields: WallFields;
  /** Correct answer, from Python's zoneinfo. See TIMEZONE_BRIEF.md. */
  expected: number;
}

/**
 * Wall-clock readings with known-correct resolutions.
 *
 * Chosen so that a wrong resolver cannot pass by luck. The two stable cases
 * differ by an hour from each other (that IS the DST bug this project removed);
 * the gap cases name a wall time that does not exist; the ambiguous case names
 * one that happens twice. A resolver that silently defaults to UTC, or picks
 * the other side of a transition, fails at least one of these.
 *
 * Adelaide is included because it is +10:30/+09:30 -- a half-hour offset breaks
 * naive whole-hour offset arithmetic, and nothing else here would catch that.
 */
const VECTORS: Vector[] = [
  {
    label: "CST winter (stable)",
    zone: "America/Chicago",
    fields: { year: 2026, month: 1, day: 5, hour: 19, minute: 0 },
    expected: 1767661200000, // 2026-01-06T01:00:00Z
  },
  {
    label: "CDT summer (stable, one hour off winter)",
    zone: "America/Chicago",
    fields: { year: 2026, month: 7, day: 6, hour: 19, minute: 0 },
    expected: 1783382400000, // 2026-07-07T00:00:00Z
  },
  {
    label: "US spring-forward gap (02:30 never happens)",
    zone: "America/Chicago",
    fields: { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
    expected: 1772958600000, // 2026-03-08T08:30:00Z
  },
  {
    label: "US fall-back ambiguity (01:30 happens twice; first pass)",
    zone: "America/Chicago",
    fields: { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
    expected: 1793514600000, // 2026-11-01T06:30:00Z
  },
  {
    label: "UK spring-forward gap",
    zone: "Europe/London",
    fields: { year: 2026, month: 3, day: 29, hour: 1, minute: 30 },
    expected: 1774747800000, // 2026-03-29T01:30:00Z
  },
  {
    label: "Adelaide fall-back ambiguity (half-hour offset)",
    zone: "Australia/Adelaide",
    fields: { year: 2026, month: 4, day: 5, hour: 2, minute: 30 },
    expected: 1775318400000, // 2026-04-04T16:00:00Z
  },
  {
    label: "Kolkata stable (+05:30, no DST)",
    zone: "Asia/Kolkata",
    fields: { year: 2026, month: 6, day: 15, hour: 9, minute: 30 },
    expected: 1781496000000, // 2026-06-15T04:00:00Z
  },
  {
    label: "Auckland spring-forward gap (southern hemisphere)",
    zone: "Pacific/Auckland",
    fields: { year: 2026, month: 9, day: 27, hour: 2, minute: 30 },
    expected: 1790433000000, // 2026-09-26T14:30:00Z
  },
];

export interface SelfCheckResult {
  pass: boolean;
  checked: number;
  failures: {
    label: string;
    zone: string;
    expected: string;
    got: string;
    offBy: string;
  }[];
}

/**
 * Resolve every vector through whatever resolver is actually installed.
 *
 * Deliberately calls `resolveWallClock`, the same entry point the engine uses,
 * rather than `intlResolver` directly. Calling the resolver we hope is active
 * would prove only that the resolver works, not that it is the one serving
 * requests -- which is the entire question.
 */
export function resolverSelfCheck(): SelfCheckResult {
  const failures: SelfCheckResult["failures"] = [];

  for (const v of VECTORS) {
    let got: number;
    try {
      got = resolveWallClock(v.fields, v.zone);
    } catch (err) {
      failures.push({
        label: v.label,
        zone: v.zone,
        expected: new Date(v.expected).toISOString(),
        got: `threw: ${String(err)}`,
        offBy: "n/a",
      });
      continue;
    }
    if (got !== v.expected) {
      const minutes = (got - v.expected) / 60_000;
      failures.push({
        label: v.label,
        zone: v.zone,
        expected: new Date(v.expected).toISOString(),
        got: Number.isFinite(got) ? new Date(got).toISOString() : String(got),
        offBy: `${minutes > 0 ? "+" : ""}${minutes} min`,
      });
    }
  }

  return { pass: failures.length === 0, checked: VECTORS.length, failures };
}

// ---------------------------------------------------------------------------
// What the runtime looks like from inside
// ---------------------------------------------------------------------------

declare const Temporal: any;

export interface RuntimeReport {
  resolver: string;
  pinned: boolean;
  /** Why the pin exists, in the payload, so an operator reading /api/health
   *  does not have to find this file to understand it. */
  pinReason: string;
  temporalPresent: boolean;
  /** Null when absent. False is the #6907 signature: present but clock at 0. */
  temporalClockSane: boolean | null;
  /** What `activeResolver()` WOULD have chosen with no pin. The whole point:
   *  when this reads "temporal" the pin is the only thing keeping production on
   *  the tested path. */
  wouldSelectWithoutPin: string;
  intlAvailable: boolean;
  userAgent: string | null;
  compatibilityDate: string;
}

/** The compat date in wrangler.toml. workerd cannot read its own, so it is
 *  restated here and a test asserts the two agree. */
export const COMPATIBILITY_DATE = "2026-08-13";

export function runtimeReport(): RuntimeReport {
  const temporalPresent = typeof Temporal !== "undefined";

  let temporalClockSane: boolean | null = null;
  if (temporalPresent) {
    try {
      // A clock reporting the Unix epoch as "now" is a partial implementation.
      // Anything before 2020 is not a clock we would trust either way.
      temporalClockSane =
        Temporal.Now.instant().epochMilliseconds > 1_577_836_800_000;
    } catch {
      temporalClockSane = false;
    }
  }

  let intlAvailable = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago" }).format(
      new Date(0),
    );
    intlAvailable = true;
  } catch {
    intlAvailable = false;
  }

  return {
    resolver: PINNED_RESOLVER,
    pinned: true,
    pinReason:
      "engine/src/zones.ts selects a resolver by `typeof Temporal`, which is a " +
      "presence check, not a correctness check. The deployed Workers fleet has " +
      "exposed an undocumented Temporal with a clock frozen at epoch 0 since " +
      "2026-07-30 (workerd#6907) while local workerd exposes none, so an " +
      "unpinned build would resolve contest times through different code in " +
      "production than in test. See TIMEZONE_BRIEF.md.",
    temporalPresent,
    temporalClockSane,
    wouldSelectWithoutPin: temporalPresent ? "temporal" : "intl",
    intlAvailable,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    compatibilityDate: COMPATIBILITY_DATE,
  };
}

// ---------------------------------------------------------------------------
// Startup log -- emitted once per isolate, at module evaluation
// ---------------------------------------------------------------------------

const startup = runtimeReport();
const startupCheck = resolverSelfCheck();

// One structured line. Cloudflare's log pipeline keeps JSON as JSON, and this
// is the record that says which resolver served a given isolate's requests.
console.log(
  JSON.stringify({
    event: "runtime.startup",
    resolver: startup.resolver,
    pinned: startup.pinned,
    wouldSelectWithoutPin: startup.wouldSelectWithoutPin,
    temporalPresent: startup.temporalPresent,
    temporalClockSane: startup.temporalClockSane,
    intlAvailable: startup.intlAvailable,
    compatibilityDate: startup.compatibilityDate,
    selfCheck: startupCheck.pass ? "pass" : "FAIL",
    selfCheckFailures: startupCheck.failures,
  }),
);

if (!startupCheck.pass) {
  // Loud, and separate from the line above, because this means dates are wrong
  // right now -- not that they might be.
  console.error(
    `runtime.startup: zone resolver self-check FAILED ` +
      `(${startupCheck.failures.length}/${startupCheck.checked} vectors). ` +
      `Contest start times are WRONG in this isolate. ` +
      `/api/health will report 503.`,
  );
}

if (startup.temporalPresent && startup.wouldSelectWithoutPin === "temporal") {
  console.warn(
    `runtime.startup: Temporal is present in this runtime ` +
      `(clockSane=${startup.temporalClockSane}). The pin in src/runtime.ts is ` +
      `what is keeping this isolate on the tested Intl path.`,
  );
}
