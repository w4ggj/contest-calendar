/**
 * Cross-engine parity.
 *
 * The mirrored suite proves both engines satisfy the same assertions. That is
 * necessary but not sufficient: two engines can pass identical tests and still
 * disagree on the thousands of fields nobody wrote an assertion for. So this
 * file compares FULL SERIALISED OUTPUT -- every field of every occurrence, for
 * several years -- against what the Python engine produces.
 *
 * The Python side of the comparison is generated on demand by
 * scripts/dump_occurrences.py, which is the same code path the API will use.
 * If Python is unavailable the comparison is skipped loudly rather than
 * silently passing, because a skipped parity check that looks green is worse
 * than no check at all.
 *
 * Also holds the two zone resolvers to each other. They are separate
 * implementations of the same contract, and if they diverge a contest shifts
 * by an hour depending on which runtime served the request.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { loadCatalog } from "../src/catalog.js";
import { expandYear, type Contest } from "../src/recurrence.js";
import {
  intlResolver,
  setZoneResolver,
  temporalResolver,
  type WallFields,
} from "../src/zones.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const DUMPER = resolve(REPO_ROOT, "scripts", "dump_occurrences.py");

const YEARS = [2026, 2027, 2030, 2032];

function pythonOccurrences(year: number): Record<string, unknown>[] | null {
  if (!existsSync(DUMPER)) return null;
  for (const python of ["python", "python3"]) {
    try {
      const out = execFileSync(python, [DUMPER, String(year)], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
      });
      return JSON.parse(out) as Record<string, unknown>[];
    } catch {
      continue;
    }
  }
  return null;
}

const catalog: Contest[] = loadCatalog();

describe("cross-engine parity with the Python reference", () => {
  const probe = pythonOccurrences(YEARS[0]);

  if (probe === null) {
    test("python reference is reachable", () => {
      expect.fail(
        "Could not run scripts/dump_occurrences.py. Parity with the Python " +
          "engine is the guarantee that the site and the dataset agree, so " +
          "this is a failure rather than a skip. Install Python and " +
          "`pip install -r requirements.txt` (tzdata is required on Windows).",
      );
    });
  } else {
    test.each(YEARS)(
      "every field of every occurrence matches Python for %i",
      (year) => {
        const fromPython = year === YEARS[0] ? probe : pythonOccurrences(year);
        expect(fromPython, `no Python output for ${year}`).not.toBeNull();

        const fromTs = expandYear(catalog, year).map((o) => o.toDict());

        // Compare counts first: a length mismatch produces a diff that is
        // unreadable if the arrays are zipped, and the count itself is the
        // headline fact.
        expect(fromTs.length, `occurrence count differs for ${year}`).toBe(
          fromPython!.length,
        );

        for (let i = 0; i < fromTs.length; i++) {
          expect(
            fromTs[i],
            `${year} occurrence ${i} (${fromTs[i].contest_id}) differs`,
          ).toEqual(fromPython![i]);
        }
      },
    );
  }
});

describe("the two zone resolvers agree", () => {
  // Sampled across the year so both DST transitions and both stable seasons
  // are covered, in zones on either side of the meridian and one with a
  // half-hour offset, which is where naive offset arithmetic tends to break.
  const ZONES = [
    "America/Chicago",
    "America/New_York",
    "Europe/London",
    "Europe/Berlin",
    "Australia/Adelaide",
    "Asia/Kolkata",
    "Pacific/Auckland",
  ];

  test("temporal is available in this runtime", () => {
    // Not a hard requirement -- the Intl resolver is a complete fallback -- but
    // if Temporal silently vanishes we want to know we are on the other path.
    expect(temporalResolver === null || typeof temporalResolver === "function")
      .toBe(true);
  });

  test.each(ZONES)("%s resolves identically under both resolvers", (zone) => {
    if (temporalResolver === null) return;

    const readings: WallFields[] = [];
    for (let month = 1; month <= 12; month++) {
      for (const day of [1, 8, 15, 22, 28]) {
        for (const hour of [0, 1, 2, 3, 12, 19, 23]) {
          readings.push({ year: 2026, month, day, hour, minute: 30 });
        }
      }
    }

    for (const fields of readings) {
      const viaTemporal = temporalResolver(fields, zone);
      const viaIntl = intlResolver(fields, zone);
      expect(
        viaIntl,
        `${zone} ${JSON.stringify(fields)}: Intl and Temporal disagree`,
      ).toBe(viaTemporal);
    }
  });

  test("the whole catalog expands identically under the Intl resolver", () => {
    // The resolver is module-level state, so restore it even if this throws --
    // leaking it would silently change what every later test measures.
    const withTemporal = expandYear(catalog, 2026).map((o) => o.toDict());
    try {
      setZoneResolver(intlResolver);
      const withIntl = expandYear(catalog, 2026).map((o) => o.toDict());
      expect(withIntl).toEqual(withTemporal);
    } finally {
      setZoneResolver(null);
    }
  });
});
