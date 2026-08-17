# World Contest Calendar

A modern amateur radio contest calendar built as a **recurrence rules engine**, not a
scraped table. Each contest is stored as a scheduling rule sourced from its sponsor's own
published rules, so dates for any year are computed on demand.

Built by Joe Leone, **W4GGJ** — Gulf Coast Contest Club, EL87PT.

---

## Provenance

This project does **not** derive data from any third-party contest calendar.

The WA7BNM Contest Calendar (contestcalendar.com) is the definitive resource in this
hobby and its Terms of Use prohibit automated access and republication. We respect that
completely. Notably, ARRL's monthly *Contest Corral* PDF is itself generated from
WA7BNM's data, so it is **not** an independent source either — see
`known_derived_sources` in `data/sources.registry.json`.

What this repo builds instead is an **independent compilation from primary sources**:
each sponsor's own rules pages. Contest dates, times, bands, modes, exchanges and log
deadlines are facts published by the sponsors themselves. Every record carries:

- `rules_url` / `rules_url_pattern` — a deep link to the sponsor's own rules
- `source_note` — the recurrence rule **in the sponsor's own wording**
- `verified` — whether that rule was read directly off the sponsor's page
- `rules_url_checked` — when the link was last confirmed live

### The one hard rule

> **Never populate a contest record from an aggregator.** Only from the sponsoring
> organisation's own published rules. If the sponsor's page cannot be found, the record
> stays `verified: false` and does not ship.

Sponsors' rules *text* is copyrighted by the sponsors. This catalog stores **facts** and
**our own summaries**, and links out for the authoritative text. That is both the correct
legal posture and the better product — structured fields are filterable and searchable in
ways prose never is.

---

## Why rules beat rows

| | Static table | Rules engine |
|---|---|---|
| Year coverage | Fixed horizon | Any year, no horizon |
| Sponsor changes a rule | Re-enter every future row | Change one record |
| Auditability | Opaque | Every date traces to a sponsor URL |
| Size | ~500 rows × N years | One JSON file |

### The subtlety that makes it hard

A **full weekend** is a Sat/Sun pair with *both days inside the month*. When a month ends
on a Saturday, that Saturday does not begin a full weekend. This shifts dates in **17
months across 2026–2035**. A naive "first Saturday of the month" implementation is wrong
roughly twice a year, and nobody notices until someone misses a contest.

`tests/test_recurrence.py` pins this. Don't remove those tests.

---

## Validation

The engine is proved against two unrelated sponsors on two continents:

- **ARRL** — 21/21 contests generated from their published rules match their own
  independently published 2026 date table
- **RSGB** — "the contest always takes place over the last FULL weekend of July"
  generates IOTA at Jul 25–26 1200Z, matching RSGB's published 2026 dates

Plus CWops, K1USN, SKCC and NCJ — all generating dates that match each sponsor's own
published 2026 schedule.

```
152 passed
```

---

## Quickstart

```bash
git clone https://github.com/w4ggj/contest-calendar.git
cd contest-calendar
pip install -r requirements.txt

python scripts/validate.py          # regenerate + check against sponsor tables
python scripts/check_links.py       # verify every sponsor rules link is live
pytest -q                           # full suite
```

```python
from contestcal import load_catalog
from contestcal.recurrence import expand_year, filter_by_eligibility

catalog = load_catalog()
occ = expand_year(catalog, 2027, my_entity="K")
mine = filter_by_eligibility(occ, "K")

for o in mine[:5]:
    print(f"{o.start:%b %d %H%MZ}  {o.name}  ({o.works})")
```

---

## Layout

```
contestcal/recurrence.py     rules engine -- 7 rule types, eligibility, link resolution
data/contests.seed.json      the catalog
data/sources.registry.json   global sponsor registry, 5 tiers, ~60 organisations
scripts/validate.py          regenerate and check against sponsor date tables
scripts/check_links.py       sponsor link rot checker (run monthly in CI)
tests/                       152 tests
BUILD_BRIEF.md               full architecture and phased plan
HANDOVER.md                  start here if you're picking this up
```

## Rule types

| type | use | example |
|---|---|---|
| `nth_full_weekend` | most HF contests | Field Day = 4th full weekend of June |
| `nth_weekday` | single-day events | Rookie Roundup = 3rd Sunday |
| `fixed_date` | calendar-fixed | Straight Key Night = Jan 1 |
| `monthly_nth_weekday` | monthly sprints | Spartan Sprint = 1st Monday |
| `weekly` | weekly tests | CWops CWT = every Wednesday |
| `multi_weekend` | several sessions/yr | Stew Perry Topband |
| `manual` | sponsor sets annually | ARRL EME (lunar conditions) |
| `composite` | seasons with different rules | NAQP RTTY (last-Sat-Feb + 3rd-wknd-Jul) |

Weekly and monthly types matter most for coverage: **84 definitions currently produce
648 occurrences**, because CWT alone is 208. Encoding high-frequency club contests fills
hundreds of calendar slots — far better coverage-per-hour than once-a-year regional
events.

## Two engines, held identical

`contestcal/recurrence.py` is the reference implementation and built the catalog.
`engine/src/recurrence.ts` is a direct port and serves the site. Both read the same JSON
under `data/` — the catalog is never duplicated, because two copies drift.

Keeping them honest takes two layers:

- `engine/tests/recurrence.test.ts` mirrors `tests/test_recurrence.py` one-for-one — same
  names, same assertions, same sponsor-published tables. Both suites are 152 tests.
- `engine/tests/parity.test.ts` compares **every field of every occurrence** for four years
  against output from the Python engine. Shared assertions prove both engines satisfy the
  same rules; only a full diff proves they agree on the fields nobody asserted on.

If Python cannot be run, the parity suite fails rather than skipping.

## Time handling

Times are UTC unless a record says otherwise. Two kinds of contest say otherwise, and they
need **opposite** treatment — one flag for both was a real bug.

| field | meaning | resolution |
|---|---|---|
| *(none)* | sponsor states UTC | stored as given |
| `timezone` + `wall_clock` | sponsor runs it at a clock time in **their** zone | resolved through `zoneinfo`, so the UTC instant moves with DST |
| `local_rolling` | contest starts at a clock time wherever **you** are | not converted at all; `start`/`end` are `None` and the wall clock is emitted instead |

A sponsor-anchored contest has exactly one correct UTC instant per occurrence, an hour
apart across the DST boundary. 4SQRP spells the consequence out themselves: *"7 PM until
9 PM central time (CST or CDT, whichever is in effect at the time). If you use UTC, that
time changes when we switch from CST to CDT."* Hardcoding either value is wrong for half
the year.

An operator-anchored contest has **no** single UTC instant — it sweeps the globe as local
dawn moves west. Converting it is a category error, so `Occurrence.start` is `None` rather
than a plausible-looking timestamp that would leak into an iCal feed and be wrong for
almost everyone. Sorting such a record into the right category means reading the sponsor's
wording; some mean their own zone, some mean yours.

Both DST edges are pinned by test, because `zoneinfo` resolves them silently rather than
raising: a nonexistent spring-forward wall time uses the pre-transition offset, and an
ambiguous fall-back time takes the first pass (`fold=0`).

`zoneinfo` is stdlib, so the zero-dependency runtime promise holds. Windows alone lacks the
IANA database and needs the `tzdata` package — see `requirements.txt`.

## Eligibility

Stored globally, filtered at display time. **Never delete non-US contests at ingest** — a
contest you can't *enter* is often still worth *working*, and the open dataset's value
depends on being global.

| scope | meaning | example |
|---|---|---|
| `worldwide` | anyone may enter | CQ WW, RSGB IOTA |
| `entity_list` | only listed entities | Sweepstakes (K/VE), RSGB AFS (G) |
| `two_sided` | all enter, each side works the other | ARRL DX |

Plus `practical` for contests that are open but unrewarding from a given location. That's
advice, not a filter.

## Modes and bands

Both are controlled sets, so they can be filtered on. A field that is free text is a field
nothing can query.

```
modes   CW · SSB · RTTY · Digital · FT8/FT4 · Mixed
bands   160m 80m 60m 40m 30m 20m 17m 15m 12m 10m 6m 2m 1.25m 70cm 33cm 23cm 13cm 3cm
```

`modes` keeps the sponsor's own order — `CW/SSB`, not the vocabulary's. The specifics a
small set deliberately drops are kept beside it as free text and displayed, never filtered
on: `submodes` ("PSK31", "RTTY 75 baud") and `bands_note` ("10 GHz through light").

Filtering widens, records do not. A record says exactly what the sponsor permits;
**`Digital` as a *query* matches Digital, RTTY and FT8/FT4**, and every specific mode also
matches `Mixed`. So someone filtering "Digital" gets FT8 results without the ARRL RTTY
Roundup ever being described as anything but RTTY.

**Empty `bands` means unrecorded, not unbanded** — one record is in that state today,
because SARL's rules page has an expired certificate. Every band filter necessarily
excludes it, and every consumer that filters is expected to say so rather than let the
contest vanish. Same rule as `verified: false`: the gaps are published, not hidden.

---

## Status

**84 contest definitions → 648 occurrences for 2026. 78 verified at source**, with the
remaining 6 carrying a `note` that says what is unconfirmed and why.

Two corrections surfaced during verification, both now pinned by tests:

- **CWT had three sessions encoded; there are four.** The Thursday 0700Z session was
  missing, silently dropping ~52 sessions a year.
- **"Last Saturday" ≠ "last full weekend".** NAQP RTTY starts the last Saturday in
  February — Feb 28 in 2026, whose Sunday falls in March. Required a `composite` rule type.

A third correction came out of making `modes` a controlled set: **ARRL RTTY Roundup was
recorded as RTTY and Digital, and ARRL permits RTTY only** — *"Only contacts using
Radioteletype (RTTY) mode are allowed."* Free text hid it; a vocabulary surfaced it.

Next: resolve the 8 CQ records (bands are read at source, the recurrence rules are not),
then fill coverage outside North America. See `HANDOVER.md`.

## License

Code: MIT. Catalog data (`data/`): CC BY 4.0 — it's a compilation of public facts and
should stay open. Sponsors' rules text remains the sponsors' property; we link, never
copy.
