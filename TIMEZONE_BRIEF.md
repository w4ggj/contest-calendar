# BUILD BRIEF — Timezone and Local-Time Handling

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Prerequisite:** read `HANDOVER.md` first
**Status:** **DONE 2026-08-12.** Everything below was implemented as written, with one
correction to the brief's own premise — see "What changed against this brief" at the end.

---

## The problem

`local_time: true` is currently doing double duty for two problems that need **opposite**
handling. Every record carrying that flag is either storing a wrong UTC instant or storing
a UTC instant that shouldn't exist at all.

### Case A — sponsor-anchored local time

4SQRP Second Sunday Sprint and ARS Spartan Sprint run at a specific **US clock time**.
There *is* exactly one correct UTC instant per occurrence; it just moves with DST.

A 19:00 America/Chicago anchor resolves to:

```
Jan 05 19:00 America/Chicago  ->  Jan 06 0100Z   (UTC-6, CST)
Jul 06 19:00 America/Chicago  ->  Jul 07 0000Z   (UTC-5, CDT)
```

One hour apart. Whichever we hardcoded is wrong for roughly half the year.

### Case B — operator-anchored local time

ARRL 10 GHz and Up starts at **6:00 AM wherever the operator is**. There is no single UTC
instant. The contest is a rolling window sweeping the globe as local dawn moves west.

Converting this to UTC at all is a category error. We currently store `0600Z`, which is
correct only for operators actually on UTC — not for EL87, and not for most participants.

**These are different bugs. One flag cannot fix both.**

---

## The fix

Retire `local_time`. Replace with two explicit fields.

### Case A → `timezone`

Add an IANA timezone plus a `wall_clock` marker on the time spec:

```json
{
  "id": "ars-spartan-sprint",
  "timezone": "America/Chicago",
  "start": { "day_offset": 0, "time": "1900", "wall_clock": true },
  "end":   { "day_offset": 0, "time": "2100", "wall_clock": true }
}
```

`_apply_offset()` builds a naive datetime, attaches the zone, then converts to UTC. DST is
handled for free.

`zoneinfo` is **stdlib since Python 3.9**, so this preserves the zero-dependency promise —
important for the TypeScript port. On Windows the IANA database may not be present; add
`tzdata` to `requirements.txt` and document why (Linux and macOS ship the database, Windows
does not).

### Case B → `local_rolling`

```json
{
  "id": "arrl-10ghz-leg1",
  "local_rolling": true,
  "start": { "day_offset": 0, "time": "0600" },
  "end":   { "day_offset": 1, "time": "2359" }
}
```

The engine must **not** convert these. Emit the wall-clock time with a marker so the UI can
render "06:00 your local time". An `Occurrence` for a rolling contest should expose the
wall time and explicitly not claim a UTC instant.

Consider making `Occurrence.start` `None` for rolling contests and adding
`start_wall: "0600"` — a hard failure at the type level beats a plausible-looking wrong
timestamp that silently propagates into the iCal feed.

---

## Implementation order

1. **Add `timezone` + `wall_clock` resolution** to `_apply_offset()` in
   `contestcal/recurrence.py`. Keep `local_time` working so nothing breaks mid-migration.
2. **Migrate Case A records:** `ars-spartan-sprint`, `4sqrp-sss`. Set the correct IANA zone
   from each sponsor's stated local time — check whether the sponsor means Central,
   Eastern, or "local to the operator" (if the last, it's Case B, not Case A).
3. **Add `local_rolling`** and migrate ARRL 10 GHz Rounds 1 and 2.
4. **Audit every remaining `local_time: true` record** and sort it into A or B. Do not
   assume; read the sponsor's wording.
5. **Delete `local_time`** from the engine and schema once nothing uses it.
6. **Update `README.md`** rule-type table and `HANDOVER.md` engine reference.

## Tests to add

- `test_no_record_has_both_timezone_and_local_rolling` — the two are mutually exclusive.
- `test_no_record_still_uses_legacy_local_time` — enforces the migration completed.
- `test_sponsor_anchored_shifts_with_dst` — a Case A contest resolves to different UTC
  hours in January vs July. Assert the actual one-hour delta; that's the whole point.
- `test_rolling_contest_exposes_no_utc_instant` — a Case B contest must not present a UTC
  start that would be wrong for most operators.
- `test_dst_spring_forward_hour` — a contest anchored in the 02:00–03:00 window on the US
  spring-forward date (2026-03-08). That wall time **does not exist**. Decide the policy
  (shift forward an hour is conventional) and pin it.
- `test_dst_fall_back_hour` — the 01:00–02:00 window on 2026-11-01 occurs **twice**.
  `zoneinfo` uses `fold` to disambiguate; default `fold=0` takes the first (DST) instance.
  Pin whichever you choose.

### Verified DST behaviour (America/Chicago, 2026)

`zoneinfo` does **not** raise on either edge — it resolves silently, so an unpinned choice
is an invisible one:

```
Spring forward 02:30 (a time that does not exist) -> 0830Z, offset -6
Fall back      01:30 fold=0 (CDT, first pass)     -> 0630Z, offset -5
Fall back      01:30 fold=1 (CST, second pass)    -> 0730Z, offset -6
```

The fall-back cases are a full hour apart and both are "valid". Default `fold=0` takes the
first pass; that's the conventional choice and probably right, but pin it in a test so it
is a decision rather than an accident.

The two DST-transition tests matter more than they look. No contest currently lands in
those windows, but sprints anchored at 0100–0300 local are common in this hobby and one
will eventually. Better to have decided the policy before it bites.

## Definition of done

`local_time` no longer exists. Every previously-flagged record is either `timezone`-based
with DST resolving correctly, or `local_rolling` with no UTC instant claimed. Full suite
green. `data/sources.md` records which sponsors state local vs UTC times, since that's a
sourcing fact worth keeping.

---

## Note for the TypeScript port

`Temporal.ZonedDateTime` handles both cases cleanly and is the right target if you can use
it. Otherwise `Intl.DateTimeFormat` with a `timeZone` option gets the same result with more
ceremony. **Do not** use the `Date` constructor with local-time strings — it silently
applies the *runtime's* zone, which is the exact bug this brief exists to remove, except
harder to spot because it works fine on the developer's machine.

> Superseded in part: see **"Decision — the Worker uses the Intl path"** below. Both
> resolvers were built and are held to each other, but the Worker pins `intlResolver` and
> never touches `Temporal`.

## What changed against this brief

**Case B has no instances.** The brief's Case B example — ARRL 10 GHz and Up — is no longer
an operator-anchored contest. ARRL's current rules read *"Each weekend begins 0900 UTC
Saturday and runs through 0759 UTC Monday"* and add *"NOTE: This is a change from the
previous start and end times in local time. Participants are reminded to log all contacts
in UTC time."* The stored record was wrong twice over: wrong hours **and** wrong model.

It is now a plain UTC record with no timezone fields at all, `verified: true` against
arrl.org's published 2026 dates. That also settled the separate "obvious typo" flag on
Round 2: ARRL's rule reads *"Third full weekend of August **and September**"*, one rule for
both rounds, so the September anchor was correct all along.

`local_rolling` was still implemented, because the brief asked for it and the failure mode
it prevents is real. With no catalog record needing it, it is exercised against a synthetic
contest definition in the test suite rather than a fabricated catalog entry — the capability
is there and proven for the next operator-anchored contest found, without inventing a record
to justify it.

Two additions beyond the brief, both closing silent-failure paths it implies:

- `_apply_offset` **raises** if a spec is marked `wall_clock` but the contest sets no
  `timezone`, instead of quietly falling back to UTC. That fallback is the exact bug this
  work removes.
- A test asserts every `timezone` record marks **all** its specs `wall_clock`, catching the
  half-migrated record where the zone looks handled but a spec is still read as UTC.

`Occurrence.start` is `None` for rolling contests, as the brief suggested. That required
`sort_key` (ordering only — explicitly not a claim about when something happens),
`start_date`, and a `duration_hours` that falls back to the wall-clock pair. `log_due`
returns `None` when there is no UTC end, since a deadline counted from a fictional end is
also fiction.

## Decision — the Worker uses the Intl path

**Decided 2026-08-13.** The Cloudflare Worker resolves wall-clock times with
`intlResolver` from `engine/src/zones.ts`. It does not use `Temporal`, and it does not let
the runtime choose.

### Why not Temporal

Cloudflare does not document `Temporal` as supported. There is no compat flag for it and no
entry in the runtime API docs, so anything we built on it would rest on undocumented
behaviour that can change under us without a compat date to pin it to.

It is nonetheless **present**, and not sound. workerd issue #6907 reports the deployed
fleet exposing a native `Temporal` global whose clock is frozen at epoch 0. A `Temporal`
that reports the Unix epoch as "now" is a partial implementation, and there is no way from
inside the isolate to tell a partial one from a complete one.

That breaks the selection logic in `activeResolver()`, which is

```ts
return override ?? temporalResolver ?? intlResolver;
```

and `temporalResolver` is non-null whenever `typeof Temporal !== "undefined"`. **That is a
presence check being used as a correctness check.** On the fleet it answers "yes, use
Temporal" for an implementation already known to be wrong about something as basic as the
current instant.

The narrow reading is that the frozen clock cannot hurt *this* code path:
`Temporal.PlainDateTime.from(fields).toZonedDateTime(zone)` reads no clock, only the tz
database, so today's dates would very likely come out right. That reading is not enough to
build on:

- The engine's whole warrant is that Python and TypeScript produce byte-identical
  occurrences. A resolver selected by feature detection makes the answer a property of
  *which runtime served the request*. Local vitest, `workerd` and the fleet can each pick
  differently, and the failure — one contest an hour off, in one environment — is exactly
  the class of bug this brief exists to remove.
- Parity is verified where `temporalResolver` is the healthy V8 one. The fleet's is not the
  one under test, so the guarantee does not extend to it.
- Deciding it is safe requires knowing which internals `Temporal` reaches for on a path we
  do not control, at each of Cloudflare's compat dates. Pinning one resolver costs nothing
  and requires knowing none of that.

So the objection is not "the frozen clock will corrupt our arithmetic." It is that
`typeof`-based detection cannot distinguish a healthy implementation from a degraded one,
and the fleet is proof that degraded ones ship. We avoid the API entirely rather than
reason about how much of it is trustworthy.

**None of this costs us anything.** `intlResolver` was built as a complete fallback, not a
degraded one, and the parity suite already holds it to the same expectations as Temporal
across seven zones and both DST edges plus the full catalog. The portable path was going to
be tested to this standard regardless; pinning it just means the tested path is also the
shipped one.

### What this means in code

- The Worker calls `setZoneResolver(intlResolver)` **once at module scope**, before any
  expansion. Not per request — a request that beats the override gets the other resolver.
- `intlResolver` needs only `Intl.DateTimeFormat` with a `timeZone` option, which workerd
  has always shipped with full ICU. No compat flag, no polyfill, no bundle cost.
- `temporalResolver` stays in the tree. It is not dead weight: the parity suite holds the
  two implementations to each other across seven zones and both DST edges, and that
  cross-check is what proves `intlResolver`'s hand-rolled disambiguation is right. Keeping
  it tested is the point; shipping it is not.
- `activeResolver()`'s fallback chain still prefers Temporal for anyone embedding the
  engine elsewhere. The Worker overrides rather than removes, so the pin is a deployment
  decision and stays visible as one line in the Worker's entry point.

### Measured, not assumed — probe of 2026-08-13

The paragraphs above were written from workerd issue #6907 and Cloudflare's docs. They have
since been checked against a real runtime. `worker/scripts/probe-runtime.mjs` starts
`wrangler dev` on `worker/probe/temporal-probe.js` and reports `typeof Temporal`,
`Temporal.Now.instant()`, and four DST conversions, at several compatibility dates.
Re-run it with `npm run probe` in `worker/`.

Result, on workerd `1.20260814.1`:

| Compatibility date | `Temporal` | `Intl` + `timeZone` |
| --- | --- | --- |
| 2024-01-01 | absent | present, correct |
| 2025-01-01 | absent | present, correct |
| 2026-01-01 | absent | present, correct |
| **2026-08-13 (ours)** | **absent** | present, correct |
| 2026-08-13 + `experimental` | absent | present, correct |
| 2026-08-13 + `nodejs_compat` | absent | present, correct |

**So "it is nonetheless present" is true of the deployed fleet, not of local workerd.** The
answer to "is Temporal available at our compatibility date?" is *it depends which machine
you ask*, and no compat flag changes that — which makes the situation worse than this brief
originally described, and the pin correspondingly more load-bearing.

Without the pin, `activeResolver()` would select `intlResolver` in `wrangler dev` and in the
vitest-pool-workers suite, and `temporalResolver` on the fleet. Every test we run would
exercise a code path production does not take. That is not a hypothetical: it is the exact
shape of "a silent fallback moves contests by an hour", with the fallback silent precisely
because the tests are green.

`worker/src/runtime.ts` therefore reports `wouldSelectWithoutPin` alongside `resolver`, and
`/api/health` surfaces both. When those two values differ, the pin is doing work; the
Worker logs a warning at startup saying so. Today, locally, they agree — and the same
endpoint on the fleet is how we will find out that they do not.

### Measured on the fleet — 2026-08-16

The Worker is deployed, so the sentence above is no longer a plan. Both the deployed
`/api/health` and the standalone probe run through `wrangler dev --remote` (a preview on
real Cloudflare infrastructure, not local workerd) were asked directly:

| Where | Compatibility date | `Temporal` | `Intl` + `timeZone` |
| --- | --- | --- | --- |
| Deployed Worker, `/api/health` | 2026-08-13 (ours) | **absent** | present, correct |
| Remote probe | 2026-08-13 (ours) | **absent** | present, correct |
| Remote probe | 2026-08-16 (newest) | **absent** | present, correct |

**The fleet does not currently expose `Temporal` either.** `wouldSelectWithoutPin` comes
back `"intl"` in production, so today the pin and feature detection agree, and the pin is
not currently changing which code runs.

Three things follow, and the third is the one that matters:

- The claim above that `Temporal` "is nonetheless present … true of the deployed fleet" was
  read out of workerd#6907 and never measured on the fleet. **It is not true of the fleet we
  deploy to, on this date.** Either the issue was resolved, or the exposure was always
  narrower than the report implied — this probe cannot tell which, and neither should we
  guess. The paragraphs above are left as written, because they are the reasoning that
  produced the pin and rewriting history would hide that the premise was inferred.
- Every DST vector still passes: `zoneResolverSelfCheck` reports 8/8 in production. That is
  the check that actually guarantees contest times, and it does not depend on this question.
- **This does not weaken the case for the pin; it is the case for the pin.** A resolver
  chosen by `typeof Temporal` is a resolver chosen by whatever the fleet shipped that week,
  and the answer has now demonstrably moved at least once. The pin's value is that the
  answer stopped mattering. Do not remove it on the strength of one green probe — that is
  the same presence-check-as-correctness-check reasoning, run in the opposite direction.

Re-check with `npm run probe`, or against a deployment with
`curl https://<worker>/api/health`.

### If this is ever revisited

Reversing it needs more than "#6907 is fixed". It needs the parity suite passing on the
same `workerd` build the fleet runs, pinned to the compat date in `wrangler.toml`, with the
`Temporal` path taken. Until that exists, the Intl path is the one with evidence behind it.

---

## Why this is worth doing before the front end

The iCal feed is the headline feature — subscribe once, contests appear in your phone
calendar forever. A feed that puts a contest an hour off for half the year is worse than no
feed, because the user trusts it and stops checking. Fix the model before anything consumes
it.
