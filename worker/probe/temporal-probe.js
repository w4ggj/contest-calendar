/**
 * Runtime probe -- answers "is Temporal available in workerd, and is it sound?"
 *
 * Deliberately a standalone Worker with no imports. It is run by
 * `scripts/probe-runtime.mjs` against several compatibility dates so the answer
 * is an observation of the runtime rather than a reading of the docs.
 *
 * The interesting question is NOT "does the global exist". workerd issue #6907
 * reports a `Temporal` whose clock is frozen at epoch 0 -- present, and wrong.
 * `activeResolver()` selects on `typeof Temporal !== "undefined"`, so a probe
 * that only reports presence would reproduce the exact mistake this exists to
 * catch. It therefore also exercises the clock and the conversion path.
 */

export default {
  async fetch() {
    const report = {
      compatibilityDate: null, // filled in by the runner; workerd cannot read it
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      temporal: { present: typeof Temporal !== "undefined" },
      intl: {},
    };

    // --- Intl path: what the Worker actually pins ------------------------
    try {
      const f = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      report.intl.available = true;
      // 2026-07-06 19:00 America/Chicago is 2026-07-07T00:00Z (CDT, UTC-5).
      report.intl.sampleFormat = f.format(new Date("2026-07-07T00:00:00Z"));
      report.intl.resolvedTimeZone = f.resolvedOptions().timeZone;
    } catch (err) {
      report.intl.available = false;
      report.intl.error = String(err);
    }

    if (!report.temporal.present) return json(report);

    // --- Is the clock sound? (#6907) ------------------------------------
    try {
      const now = Temporal.Now.instant();
      report.temporal.nowEpochMs = now.epochMilliseconds;
      report.temporal.nowIso = now.toString();
      // A clock reporting the Unix epoch as "now" is a partial implementation.
      report.temporal.clockFrozenAtEpoch = now.epochMilliseconds === 0;
    } catch (err) {
      report.temporal.clockError = String(err);
    }

    // --- Does the conversion path we would rely on work at all? ---------
    // Each case is a wall reading the engine must resolve, with the answer
    // Python's zoneinfo gives. Same expectations as engine/tests.
    const cases = [
      // [label, fields, zone, expected UTC ISO]
      ["CST winter", { year: 2026, month: 1, day: 5, hour: 19, minute: 0 }, "America/Chicago", "2026-01-06T01:00:00Z"],
      ["CDT summer", { year: 2026, month: 7, day: 6, hour: 19, minute: 0 }, "America/Chicago", "2026-07-07T00:00:00Z"],
      ["spring-forward gap", { year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/Chicago", "2026-03-08T08:30:00Z"],
      ["fall-back ambiguous", { year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/Chicago", "2026-11-01T06:30:00Z"],
    ];

    report.temporal.conversions = [];
    for (const [label, fields, zone, expected] of cases) {
      try {
        const ms = Temporal.PlainDateTime.from(fields)
          .toZonedDateTime(zone)
          .toInstant().epochMilliseconds;
        const got = new Date(ms).toISOString().replace(".000", "");
        report.temporal.conversions.push({
          label,
          got,
          expected,
          match: got === expected,
        });
      } catch (err) {
        report.temporal.conversions.push({ label, expected, error: String(err) });
      }
    }

    return json(report);
  },
};

function json(body) {
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json" },
  });
}
