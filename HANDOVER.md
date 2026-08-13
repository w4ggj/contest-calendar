# HANDOVER — World Contest Calendar

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Owner:** Joe Leone, W4GGJ
**Updated:** 2026-08-12 — after timezone work

---

## What this is

A public web calendar of every amateur radio contest. One job: **help an operator find a
contest to enter.** Modern, fast, usable on a phone.

Built as a **recurrence rules engine** rather than a maintained list. Contests are stored as
scheduling rules taken from each sponsor's own published rules; dates for any year are
computed on demand. That means no year horizon, one-line fixes when a sponsor changes a
rule, and every date traceable to a source.

**Current state:** 84 contest definitions → 648 occurrences for 2026. 116 Python tests,
129 TypeScript tests. Engine complete in both languages — no known structural gaps.

## Read first

1. `README.md` — provenance and architecture
2. `data/sources.md` — verified, pending, and corrections found
3. `FRONTEND_BRIEF.md` — **the current phase**
4. `BUILD_BRIEF.md` — overall plan

## Verify the repo is healthy

```powershell
pip install -r requirements.txt   # REQUIRED on Windows -- tzdata
python scripts\validate.py        # expect: 21/21 match
python -m pytest -q               # expect: 116 passed
python scripts\check_links.py

cd engine; npm install; npm test   # expect: 129 passed (116 mirrored + 13 parity)
```

The TypeScript suite shells out to Python for its parity check, so run
`pip install -r requirements.txt` before `npm test` or it fails loudly. That is
deliberate — a parity check that skips looks green while proving nothing.

`tzdata` is the single exception to the stdlib-only runtime. Linux and macOS ship the IANA
database; Windows doesn't, and without it `zoneinfo` raises and the whole suite fails. The
comment in `requirements.txt` explains why — don't strip it to restore the invariant.

---

## The one rule that cannot be broken

> **Never populate a contest record from an aggregator.** Only from the sponsoring
> organisation's own published rules page.

WA7BNM's Terms of Use prohibit automated access and republication, and **ARRL's Contest
Corral is generated from WA7BNM's data**, so it is downstream too. Same for SM3CER and
DXZone. `data/sources.registry.json` lists these under `known_derived_sources`; a test keeps
that list populated.

This rule has already cost coverage and held anyway — QRP ARCI below. That was correct. A
record nobody can defend is worse than a documented gap.

It has also caught stale assumptions in briefs written by Claude, not just in third-party
sources. **ARRL 10 GHz was described in two separate briefs as an operator-anchored
local-time contest; ARRL's current rules say 0900 UTC Saturday to 0759 UTC Monday, with an
explicit note that this changed from the previous local-time definition.** Check the
sponsor, including when this handover sounds confident.

Sponsors' rules *text* is copyrighted by the sponsors. Store **facts** plus **your own
summary**, and link out via `rules_url`.

When you verify a contest: record the rule in the sponsor's own wording in `source_note`,
set `verified: true`, set `rules_url_checked`, add a row to `data/sources.md`, and add a
test asserting generated dates match dates the sponsor published independently.

---

## Next: build the front end

**See `FRONTEND_BRIEF.md`.** This is the current phase.

The catalog already covers every contest a normal operator would enter in a year, and none
of it is visible to anyone. Build the UI against the data as it stands — remaining sourcing
becomes background work that appears in a UI that already exists, and building will surface
data model gaps faster than another 200 records would.

**The engine port is done.** `engine/` holds the TypeScript engine: 116 tests mirroring the
Python suite one-for-one, plus a parity suite that compares every field of every occurrence
for four years against the Python reference. UI work is unblocked and not started.

Porting found a real bug, which is why both suites are now 116 rather than 115: `expand()`
swallowed every `ValueError` from anchor resolution, so **a typo'd rule type silently
produced an empty schedule** — the contest would disappear from every calendar with nothing
logged. Both engines now separate `NoAnchorsThisYear` (legitimate) from a malformed rule
(throws).

## Sourcing work, as background

1. **CQ contests (8, unverified)** — largest remaining block, most-entered contests in the
   catalog. CQ 160 SSB is the open question: strict "last full weekend of February" gives
   Feb 20–22 for 2026 but it's commonly listed Feb 27–Mar 1. The verified NAQP RTTY
   precedent shows "last Saturday" is a genuinely distinct rule. **Read CQ's text; don't
   infer from the pattern.**
2. **QRP ARCI** — blocked at source, needs a human. qrparci.org publishes no rules pages;
   rules appear to live in the members' magazine *QRP Quarterly*. qrpcontest.com is a
   third-party logging service, not the sponsor, so it's unusable. Email the contest
   manager; their reply is a citable primary source. Record it with date and name.
3. **Reconcile `data/sources.registry.json`** — Tier 4 disproved several of its assumptions:
   NCJ Sprint is CW/RTTY only, 10-10 runs three QSO Parties not four, AGCW's "Goldene Taste"
   is an award not a contest, NCCC Sprint is NCCC's not NCJ's, FISTS sprints are suspended
   from 2026. Fix these so the registry stops misleading the next pass; treat its remaining
   counts as estimates, not targets.
4. **Then Tiers 1–3, region by region** rather than sponsor by sponsor, so coverage fills
   evenly. The catalog is currently North America–heavy, which a world calendar can't be.

---

## Open flags — deliberately unresolved

Flagged rather than guessed. Leave them until a sponsor settles them.

- **AGCW ZAP Merit Contest** — `verified: false`; AGCW publishes no closing time. Stored end
  is a labelled placeholder.
- **PODXS Great Pumpkin** — close time differs by one minute between the rules page and the
  club calendar. Recorded in `note`, not silently reconciled.
- **CQ 160 SSB** — see above. This record is the model for an honest flag.

---

## Engine reference

Two implementations, held identical by test: `contestcal/recurrence.py` is the reference,
`engine/src/recurrence.ts` serves the site. Change one and you must change the other —
`engine/tests/parity.test.ts` compares every field of every occurrence across four years and
will fail on a one-minute drift. Both read the same JSON under `data/`; the catalog is never
duplicated.

| type | fields | example |
|---|---|---|
| `nth_full_weekend` | `month`, `n` (−1 = last) | Field Day = 4th full weekend of June |
| `nth_weekday` | `month`, `n`, `weekday` | NAQP RTTY winter = last Saturday of Feb |
| `fixed_date` | `month`, `day` | Straight Key Night = Jan 1 |
| `monthly_nth_weekday` | `n`, `weekday`, optional `months` | SKCC WES = 2nd Saturday monthly |
| `weekly` | `weekday` | CWT anchors on Wednesday |
| `multi_weekend` | `weekends: [{month, n}]` | NAQP CW = Jan #2 + Aug #1 |
| `composite` | `rules: [...]` | NAQP RTTY = last-Sat-Feb + 3rd-full-wknd-Jul |
| `manual` | `dates: {year: [...]}` | sponsor sets annually, no derivable rule |

`weekday`: 0 = Monday … 6 = Sunday. `n = -1` means last.

**Sessions.** Several runnings off one anchor use `sessions`, each with its own start/end
offsets. CWT anchors Wednesday with four sessions (offsets 0, 0, +1, +1). SST anchors Monday
with sessions at offset 0 and +4.

**Offsets.** `start`/`end` are `{day_offset, time}` relative to the anchor. A contest opening
2200 UTC Friday before a Saturday anchor is `day_offset: -1`.

### Time handling

| field | meaning | `Occurrence.start` |
|---|---|---|
| *(none)* | sponsor states UTC | the UTC instant |
| `timezone` + `wall_clock` | sponsor's own clock | DST-resolved UTC instant |
| `local_rolling` | the operator's clock | `None` — no such instant exists |

Guards: `_apply_offset` raises if a spec is marked `wall_clock` with no `timezone`, and a
test asserts every `timezone` record marks all its specs. Both close paths that would
otherwise fail silently.

DST edges are pinned by test: spring-forward 02:30 → 0830Z via the pre-transition offset;
fall-back 01:30 → 0630Z on `fold=0`. `zoneinfo` resolves both silently rather than raising,
so these are decisions, not defaults.

No catalog record is `local_rolling` today. The path is implemented and tested against a
synthetic definition — the distinction is real and will recur.

### Rule shapes worth knowing

- **Full weekend** = a Sat/Sun pair with *both days inside the month*. When a month ends on a
  Saturday, that Saturday doesn't begin a full weekend. Affects 17 months across 2026–2035.
  Tests pin it; don't remove them.
- **"First Saturday after Jan 1"** skips a week when the 1st is itself a Saturday. Reuses
  `exclude_dates`.
- **"First weekend ending in June"** anchors on June's first Sunday and counts back, so it
  **opens in May** in 2030 and 2031. Looks like a bug, isn't. A test names those years.

---

## Working agreements

- **Every contest needs a test** asserting its dates match dates the sponsor published
  independently. That's what proves this is an independent compilation, not a copy.
- **Run `pytest -q` before every commit.**
- **Store every contest worldwide.** Eligibility is a display-time filter, never an ingest
  filter — a contest you can't enter is still worth working, and the catalog's value depends
  on being global.
- **Flag ambiguity, don't resolve it silently.** `verified: false` plus a clear `note` beats
  a confident wrong date. A one-minute discrepancy between two sponsor pages gets recorded,
  not averaged.
- **When a source is unusable, say so and stop.** Document the blocker and the next step
  rather than reaching for a third-party site.
- Commit messages: state what was verified and against which sponsor source.

## Scope

Not a club site, not a logging tool, not a scores database, not a social feature. One job:
find a contest to enter. Anything that doesn't serve that gets cut.
