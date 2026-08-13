# HANDOVER — World Contest Calendar

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Owner:** Joe Leone, W4GGJ (Gulf Coast Contest Club, EL87PT)
**Updated:** 2026-08-12 — after Tier 4 completion

---

## Read first

1. `README.md` — provenance rules and architecture
2. `data/sources.md` — what's verified, what's pending, corrections found so far
3. `TIMEZONE_BRIEF.md` — the top-priority engine fix
4. `BUILD_BRIEF.md` — full phased plan

## Verify the repo is healthy

First `pip install -r requirements.txt`. On Windows that pulls in `tzdata`; without it
`zoneinfo` raises `ZoneInfoNotFoundError` and the suite fails.

```powershell
python scripts\validate.py     # expect: 21/21 match
python -m pytest -q            # expect: 115 passed
python scripts\check_links.py  # expect: 1 broken (known, see sources.md)
```

If those pass, start on the tasks below.

---

## What this project is

A world amateur radio contest calendar built as a **recurrence rules engine**. Contests are
stored as scheduling rules sourced from each sponsor's own published rules; dates for any
year are computed on demand.

**Current state:** 84 contest definitions → **648 occurrences for 2026**. 115 tests.
Validated against sponsors across North America, Europe and beyond.

## The one rule that cannot be broken

> **Never populate a contest record from an aggregator.** Only from the sponsoring
> organisation's own published rules page.

WA7BNM's Terms of Use prohibit automated access and republication, and **ARRL's Contest
Corral is generated from WA7BNM's data**, so it is downstream too. Same for SM3CER and
DXZone. `data/sources.registry.json` lists these under `known_derived_sources`; a test
asserts that list stays populated.

This rule has already cost real coverage and held anyway — see QRP ARCI below. That was the
right call. A record nobody can defend is worse than a gap you documented.

Sponsors' rules *text* is copyrighted by the sponsors. Store **facts** plus **your own
summary**, and link out via `rules_url`.

When you verify a contest: record the rule **in the sponsor's own wording** in
`source_note`, set `verified: true`, set `rules_url_checked` to today, add a row to
`data/sources.md`, and add a test asserting the generated dates match dates the sponsor
published independently.

---

## Next tasks, in priority order

### 1. Local-time handling — DONE, see `TIMEZONE_BRIEF.md`

`local_time` is retired. Sponsor-anchored contests (4SQRP SSS, ARS Spartan Sprint) carry an
IANA `timezone` plus `wall_clock` time specs resolved through stdlib `zoneinfo`, so the UTC
instant moves correctly with DST. Operator-anchored contests carry `local_rolling` and
expose no UTC instant at all. Both DST edges are pinned by test.

**The brief's Case B example was out of date.** ARRL moved 10 GHz and Up off local time to
fixed UTC — *"Each weekend begins 0900 UTC Saturday and runs through 0759 UTC Monday …
This is a change from the previous start and end times in local time."* Both rounds are now
plain UTC records, verified, and the old "obvious typo" flag on Round 2 is resolved: ARRL's
rule is *"Third full weekend of August **and September**"*, one rule covering both.

So **no catalog record is operator-anchored today.** `local_rolling` is implemented and
tested against a synthetic definition rather than a fabricated record, so the capability is
proven for the next one found.

`tzdata` is now in `requirements.txt`, Windows-only — install it or `zoneinfo` raises
`ZoneInfoNotFoundError` and the suite fails.

### 2. Resolve the CQ contests (8 records, still unverified)

Read the actual rules at cqww.com, cqwpx.com, cqwpxrtty.com, cqwwrtty.com, cq160.com.

**CQ 160 SSB remains the open question.** Strict "last full weekend of February" gives
Feb 20–22 for 2026, but it's commonly listed Feb 27–Mar 1. The verified NAQP RTTY precedent
shows sponsors do use "last Saturday" as genuinely distinct from "last full weekend," and
CQ's rule is probably the former — but **read their text rather than inferring from the
pattern.**

These 8 are the largest remaining block of unverified records and they're the most-entered
contests in the catalog. Highest credibility-per-hour available.

### 3. QRP ARCI — blocked at source, needs a human

qrparci.org publishes no rules pages: the contests page is prose, the event calendar needs
JS, and the WordPress page list has no per-contest pages. Rules appear to live in the
members' magazine *QRP Quarterly*. qrpcontest.com is a third-party logging service, not the
sponsor, so it's unusable under the sourcing rule.

**Next step:** email the QRP ARCI contest manager and ask them to confirm recurrence rules.
Clubs that publish only in a members' magazine will usually answer, and that reply is
itself a citable primary source — record it in `data/sources.md` with the date and who
replied.

### 4. Verify remaining eligibility tags

Confirm each sponsor's entrant clause. Wrongly hiding a contest someone could have entered
is this product's worst failure mode, so don't ship the eligibility filter on inferred data.

### 5. Reconcile the registry against what was actually found

`data/sources.registry.json` contains counts and assumptions that Tier 4 disproved:

- NCJ Sprint is **CW/RTTY only** — no SSB Sprint exists as of 2026
- 10-10 runs **three** QSO Parties, not four
- AGCW's "Goldene Taste" is an **award**, not a contest
- NCCC Sprint is **NCCC's**, not NCJ's
- FISTS sprints are **suspended from 2026** (`active_until: 2025`)

Fix these so the registry stops misleading the next pass, and treat its remaining counts as
estimates rather than targets.

### 6. Then Tiers 1–3, then Tier 5

Work `data/sources.registry.json` top-down.

---

## Open flags — deliberately unresolved

These were flagged rather than guessed. Leave them flagged until a sponsor settles them.

- **AGCW ZAP Merit Contest** — `verified: false`; AGCW publishes no closing time. The stored
  end is a labelled placeholder.
- **PODXS Great Pumpkin** — close time differs by one minute between the rules page and the
  club calendar. Recorded in `note`, not silently reconciled.
- **CQ 160 SSB** — see task 2. This record is the model for how to write an honest flag.

---

## Engine reference

`contestcal/recurrence.py`:

| type | fields | example |
|---|---|---|
| `nth_full_weekend` | `month`, `n` (−1 = last) | Field Day = 4th full weekend of June |
| `nth_weekday` | `month`, `n`, `weekday` | NAQP RTTY winter = last Saturday of Feb |
| `fixed_date` | `month`, `day` | Straight Key Night = Jan 1 |
| `monthly_nth_weekday` | `n`, `weekday`, optional `months` | SKCC WES = 2nd Saturday monthly |
| `weekly` | `weekday` | CWT anchors on Wednesday |
| `multi_weekend` | `weekends: [{month, n}]` | NAQP CW = Jan #2 + Aug #1 |
| `composite` | `rules: [...]` | NAQP RTTY = last-Sat-Feb + 3rd-full-wknd-Jul |

`weekday`: 0 = Monday … 6 = Sunday. `n = -1` means last.

**Sessions.** Several runnings off one anchor use `sessions`, each with its own start/end
offsets. CWT anchors Wednesday with four sessions (offsets 0, 0, +1, +1). SST anchors
Monday with sessions at offset 0 and +4.

**Offsets.** `start`/`end` are `{day_offset, time}` relative to the anchor. A contest
opening 2200 UTC Friday before a Saturday anchor is `day_offset: -1`.

**Time zones.** Times are UTC unless the record says otherwise:

| field | meaning | `Occurrence.start` |
|---|---|---|
| *(none)* | sponsor states UTC | the UTC instant |
| `timezone` + `wall_clock` on each spec | sponsor's own clock (4SQRP = `America/Chicago`) | DST-resolved UTC instant |
| `local_rolling` | the operator's clock, sweeping the globe | **`None`** — no such instant exists |

The two are mutually exclusive and `expand()` raises if a record sets both, or if a spec is
marked `wall_clock` without a `timezone`. For rolling contests use `start_wall`/`end_wall`
and never `start`. `sort_key` exists only so a mixed schedule can be ordered — it is not a
claim about when anything happens.

### Rule shapes worth knowing about

- **Full weekend** = a Sat/Sun pair with *both days inside the month*. When a month ends on
  a Saturday, that Saturday does not begin a full weekend. Affects **17 months across
  2026–2035**. Tests pin it — don't remove them.
- **"First Saturday after Jan 1"** skips a week when the 1st is itself a Saturday. Reuses
  `exclude_dates`.
- **"First weekend ending in June"** anchors on June's first Sunday and counts back, so it
  **opens in May** in 2030 and 2031. This looks like a bug and isn't. It needs an explicit
  test naming those two years so nobody "fixes" it later.

---

## Working agreements

- **Every contest needs a test** asserting its dates match dates the sponsor published
  independently. That's what proves this is an independent compilation, not a copy.
- **Run `pytest -q` before every commit.**
- **Never delete non-US contests.** Eligibility is a display-time filter, not an ingest
  filter — a contest you can't enter is still worth working, and the open dataset's value
  depends on being global.
- **Flag ambiguity, don't resolve it silently.** `verified: false` plus a clear `note`
  always beats a confident wrong date. A one-minute discrepancy between two sponsor pages
  gets recorded, not averaged.
- **When a source is unusable, say so and stop.** Document the blocker and the next step
  rather than reaching for a third-party site.
- Commit messages: state what was verified and against which sponsor source.

---

## Phase 2+ (not started)

Port the engine to TypeScript — dependency-free stdlib date math, a direct translation.
Use `Temporal.ZonedDateTime` if available; **never** the `Date` constructor with local-time
strings, which silently applies the runtime's zone and works fine on the developer's machine
while being wrong everywhere else.

Then Cloudflare Worker + D1 API with an iCal feed, then the Astro front end. `BUILD_BRIEF.md`
has the detail, including the LogStats cross-link — "you worked 412 QSOs in this contest last
year" — which is the feature nobody else can build.
