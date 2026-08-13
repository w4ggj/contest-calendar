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

## Why this is worth doing before the front end

The iCal feed is the headline feature — subscribe once, contests appear in your phone
calendar forever. A feed that puts a contest an hour off for half the year is worse than no
feed, because the user trusts it and stops checking. Fix the model before anything consumes
it.
