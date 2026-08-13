# @contestcal/engine

TypeScript port of `contestcal/recurrence.py`. Same rules, same dates, same
sponsor-published evidence.

```bash
npm install
npm test          # 116 mirrored tests + 13 parity tests
npm run typecheck
```

## Why two engines

Python built the catalog and stays the reference implementation. TypeScript
serves it — the Cloudflare Worker, the iCal feed and the Astro front end all run
this one. Two implementations of contest dates is a liability unless they are
provably identical, so:

- `tests/recurrence.test.ts` mirrors `tests/test_recurrence.py` one-for-one:
  same names, same assertions, same sponsor tables. Both suites are 116 tests.
- `tests/parity.test.ts` goes further and compares **every field of every
  occurrence** for four years against output from the Python engine, generated
  on demand by `scripts/dump_occurrences.py`. Passing the same assertions is not
  the same as agreeing; the fields nobody asserted on are where a port drifts.
  A one-minute shift anywhere fails it.

If Python cannot be run, the parity suite **fails** rather than skipping. A
green skip is worse than no check.

## The catalog is not duplicated

Both engines read the same JSON under `data/`. Two copies of a catalog drift,
and a drifted catalog is precisely the class of bug this project exists to
avoid.

## Time zones

`src/zones.ts` carries two resolvers for wall-clock → UTC, and a test holds them
to each other across seven zones and both DST transitions:

- **`temporalResolver`** — `Temporal.ZonedDateTime`. Preferred. Its default
  `'compatible'` disambiguation happens to match Python's `zoneinfo` exactly on
  both DST edges, which is what lets the two engines share expectations.
- **`intlResolver`** — `Intl.DateTimeFormat` with an explicit `timeZone`. Works
  on any runtime with the IANA database. Resolves the DST edges explicitly
  rather than trusting a library default: ambiguous readings take the first
  pass (matching Python's `fold=0`), nonexistent readings use the
  pre-transition offset.

`setZoneResolver()` forces one, which is how the parity test proves the whole
catalog expands identically under both.

**Never** use `new Date("2026-03-08T02:30")`. A local-time string makes the
runtime apply *its own* zone — the exact bug `TIMEZONE_BRIEF.md` removed, and it
works fine on a developer's machine in the right zone.
