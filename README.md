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

```
42 passed
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
tests/                       42 tests
BUILD_BRIEF.md               full architecture and phased plan
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

Weekly and monthly types matter most for coverage: **35 definitions currently produce
201 occurrences**, because CWT alone is ~156. Encoding ~20 high-frequency club contests
fills hundreds of calendar slots — far better coverage-per-hour than once-a-year regional
events.

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

---

## Status

35 contest definitions → 201 occurrences for 2026. 22 verified at source. All eligibility
tags except RSGB IOTA are inferred and **must be confirmed against sponsor rules before
the filter ships** — wrongly hiding a contest someone could have entered is this
product's worst failure mode.

Next: Tier 4 high-frequency clubs (CWops, SKCC, NCJ, ARS, 4SQRP, K1USN). See
`BUILD_BRIEF.md`.

## License

Code: MIT. Catalog data (`data/`): CC BY 4.0 — it's a compilation of public facts and
should stay open. Sponsors' rules text remains the sponsors' property; we link, never
copy.
