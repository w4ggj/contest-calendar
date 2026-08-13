# HANDOVER — World Contest Calendar

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Owner:** Joe Leone, W4GGJ (Gulf Coast Contest Club, EL87PT)
**Date:** 2026-08-11

---

## Read first

1. `README.md` — provenance rules and architecture
2. `BUILD_BRIEF.md` — full phased plan
3. `data/sources.md` — what's verified, what's pending, corrections found so far

## Verify the repo is healthy

```powershell
python scripts\validate.py     # expect: 21/21 match
python -m pytest -q            # expect: 102 passed
python scripts\check_links.py  # expect: 83 live, 1 broken (sarl-hf-phone, see sources.md)
```

If those three pass, nothing is broken and you can start on the tasks below.

---

## What this project is

A world amateur radio contest calendar built as a **recurrence rules engine**. Contests
are stored as scheduling rules sourced from each sponsor's own published rules; dates for
any year are computed on demand.

**Current state:** 84 contest definitions → **648 occurrences for 2026**. 69 verified at
source. Validated against fourteen independent sponsors on three continents.

## The one rule that cannot be broken

> **Never populate a contest record from an aggregator.** Only from the sponsoring
> organisation's own published rules page.

This is not caution for its own sake. WA7BNM's Terms of Use prohibit automated access and
republication, and — critically — **ARRL's Contest Corral PDF is generated from WA7BNM's
data**, so it is downstream too. Same for SM3CER and DXZone. `data/sources.registry.json`
lists these under `known_derived_sources`; a test asserts that list stays populated.

Sponsors' rules *text* is copyrighted by the sponsors. Store **facts** (dates, times,
bands, modes, exchange, power limits, log deadlines) plus **your own summary**, and link
out via `rules_url` for the authoritative text.

When you verify a contest, record the recurrence rule **in the sponsor's own wording** in
`source_note`, set `verified: true`, and set `rules_url_checked` to today's date. Then add
a row to `data/sources.md`.

---

## Next tasks, in priority order

### 1. Tier 4 high-frequency clubs — DONE except QRP ARCI

Verified against each sponsor's own rules page: CWops CWT, K1USN SST, SKCC WES, SKCC SKS,
NAQP CW/SSB/RTTY, NCJ Sprint CW/RTTY, NCCC NS CW/RTTY/FT4, 4SQRP SSS, ARS Spartan Sprint,
all ten PODXS 070 contests, all ten AGCW contests, all four BARTG contests, both SARTG
contests, all three 10-10 QSO Parties, and the eight FISTS sprints.

**Only QRP ARCI is left, and it is blocked at source.** qrparci.org publishes no rules
pages at all — the contests page is prose, the event calendar renders nothing, and the
site's page list has no per-contest pages. Their rules appear to live in the members'
magazine *QRP Quarterly*. `qrpcontest.com` is a third-party logging service, **not** the
sponsor, so it is not a valid source. Contact the club or find a QRP Quarterly issue they
publish themselves. Details in `data/sources.md`.

Corrections found while doing this work are logged in `data/sources.md`; the ones that
change what you should believe about the registry:

- NCJ **no longer runs an SSB/Phone Sprint**. Only CW and RTTY.
- 10-10 runs **three** QSO Parties, not four. There is no Fall party.
- **FISTS sprints are suspended from 2026** by the club's own announcement, and are
  recorded with `active_until: 2025`.
- AGCW's **"Goldene Taste" is an award, not a contest.** Do not add it.
- The NCCC Sprint is **NCCC's**, not NCJ's, and its rules live at ncccsprint.com.

**Two engine gaps got much more important.** Local-time contests are no longer an edge
case — 4SQRP SSS and ARS Spartan Sprint both publish local times only and their UTC
instants are an hour wrong for part of the year. Both carry `local_time: true` and spell
out the consequence in `note`. Closing that gap is now the highest-value engine work.

### 2. Resolve the CQ contests (8 records, currently unverified)

Read the actual rules text at cqww.com, cqwpx.com, cqwpxrtty.com, cqwwrtty.com, cq160.com.

**Pay attention to CQ 160 SSB.** Strict "last full weekend of February" gives Feb 20–22
for 2026, but it's commonly listed Feb 27–Mar 1. The NAQP RTTY precedent — which *is*
verified — shows sponsors do use "last Saturday" as distinct from "last full weekend."
CQ's rule is probably the former. **Read their text; don't infer from the pattern.**

### 3. Verify eligibility tags

Everything except CWT, SST, SKCC, NAQP and IOTA is inferred. Read each sponsor's entrant
clause. Wrongly hiding a contest someone could have entered is this product's worst
failure mode, so do not ship the eligibility filter on guessed data.

### 4. Fix the remaining broken link

- `sarl-hf-phone` — sarl.org.za still unreachable. Retry, or set `rules_url_archived`.

`ars-spartan-sprint` is fixed (ars-qrp.com). `rsgb-afs-cw` now resolves in the link
checker, but its *recurrence* is still unconfirmed — a live URL is not verification.

### 5. Then Tiers 1–3, then Tier 5

Work `data/sources.registry.json` top-down. Scope estimate is ~310 contests, ~50 hours.

---

## Engine reference

`contestcal/recurrence.py`, seven rule types:

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

**Sessions.** A contest with several runnings off one anchor uses `sessions`, each with
its own `start`/`end` offsets. CWT anchors Wednesday and has four sessions (offsets 0, 0,
+1, +1). SST anchors Monday with sessions at offset 0 and +4 (Friday).

**Offsets.** `start`/`end` are `{day_offset, time}` relative to the anchor, so a contest
opening 2200 UTC Friday before a Saturday anchor is `day_offset: -1`.

### The subtlety that breaks naive implementations

A **full weekend** is a Sat/Sun pair with *both days inside the month*. When a month ends
on a Saturday, that Saturday does not begin a full weekend. This affects **17 months
across 2026–2035**. Tests pin it — do not remove them.

---

## Working agreements

- **Every contest you add needs a test** asserting its generated dates match dates the
  sponsor published independently. That's what proves this is an independent compilation.
- **Run `pytest -q` before every commit.** 52 tests currently pass.
- **Never delete non-US contests.** Eligibility is a display-time filter, not an ingest
  filter — a contest you can't enter is still worth working, and the open dataset's value
  depends on being global.
- **When a rule looks ambiguous, flag it rather than guessing.** `verified: false` plus a
  clear `note` is always better than a confident wrong date. The CQ 160 SSB record is the
  model for how to write one.
- Commit messages: state what was verified and against which sponsor source.

## Phase 2+ (not yet started)

Port the engine to TypeScript (it's dependency-free stdlib date math — a direct
translation), then Cloudflare Worker + D1 API with an iCal feed, then the Astro front end.
`BUILD_BRIEF.md` has the detail, including the LogStats cross-link — "you worked 412 QSOs
in this contest last year" — which is the feature nobody else can build.
