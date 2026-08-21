# Handover Brief — contestclock.com Contest Gap Audit

**Owner:** Joe Leone / W4GGJ
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Stack:** Cloudflare Worker + D1, Python/TypeScript recurrence-rules engine, iCal feed
**Date:** 2026-08-21
**Shell:** PowerShell on Windows

---

## 1. Why this task exists

contestclock currently holds **145 contests** (138 verified at source). A spot check
found that the **World Wide Digi DX Contest (WW Digi)** is missing entirely — a major
FT4/FT8 contest running since 2019, and squarely in the operator's primary mode.

The likely cause is a **seeding bias**: the original 145 were curated primarily from
ARRL and CQ sources. Contests sponsored by other bodies (WWROF, SCC, national
societies, regional clubs, digital-mode specialist groups) were never in the input set,
so they were never candidates for verification. The 138/145 verification rate measures
the accuracy of what got included — it says nothing about what was never listed.

For scale: the WA7BNM Contest Calendar tracks **500+ contests**. contestclock has 145.
The gap is the deliverable.

There is also a **second, separate bug class** described in section 4.

---

## 2. Primary task — find what's missing

### Authoritative sources, in priority order

1. **WA7BNM Contest Calendar** — `https://www.contestcalendar.com/`
   The canonical superset. Has an annual list view and per-contest detail pages with
   sponsor links. This is the master reference to diff against.
2. **ARRL Contest Calendar** — `https://www.arrl.org/contest-calendar`
   Includes a "Generic ARRL Contest Calendar" section stating each event's recurrence
   rule in words. Use this for rule verification, not just dates.
3. **CQ family sites** — `cqww.com`, `cqwpx.com`, `cqwwrtty.com`, `cqwpxrtty.com`,
   `cq160.com`, `cqww-vhf.com`
4. **WWROF / SCC** — `https://ww-digi.com/` (the known miss)
5. **Digital / RTTY specialist calendars** — RTTY contest calendars and the DXZone
   digital-contest listings, for events the big two never carry.
6. **National society calendars** — already flagged as outstanding work
   ("Tier 2 Europe societies").

### Method

1. Read the existing D1 schema **before** writing any query — do not assume column
   names. Dump it first:
   ```powershell
   cd "C:\GitHub Repositories\contest-calendar"
   npx wrangler d1 execute <db-name> --remote --command "SELECT sql FROM sqlite_master WHERE type='table'"
   ```
2. Export the current 145 as a normalised list (name, sponsor, mode, rule, months).
3. Scrape/collect the WA7BNM annual list into a comparable structure.
4. Diff on **normalised names** — strip punctuation, expand abbreviations, and match
   on aliases. WW Digi appears variously as "WW Digi", "World Wide Digi DX Contest",
   and "WWDIGI". A naive string diff will produce false positives.
5. Produce a candidate gap list, then verify each candidate **at the sponsor's own
   site**, never at an aggregator (see section 4 for why).

---

## 3. Scope — what belongs on this list

**contestclock.com is a public resource. The dataset must be mode-agnostic and as
complete as the authoritative sources allow.**

- **Include CW-only contests.** Include SSB-only, RTTY, digital-only, and mixed-mode.
  No mode is excluded.
- For contests with separate legs (ARRL International DX, CQ WW, CQ WPX, ARRL
  Sweepstakes), **include every leg** as its own entry — CW, phone, and digital alike.
- Include HF, VHF/UHF, microwave, QRP, sprints, and QSO parties.
- Include regional and national-society contests, not just US-sponsored events.
  "Tier 2 Europe societies" is already flagged as outstanding work in the repo.
- The only reason to exclude a candidate is that it is defunct, is a duplicate of an
  existing entry under a different name, or cannot be verified at a sponsor source.

Completeness is the goal. Do not filter on operator preference — see section 5.

---

## 4. Secondary task — recurrence rule-type audit

This is a distinct bug class from missing contests, and arguably more dangerous
because it fails silently on a calendar that looks complete.

Two rule types produce **identical output most years and diverge occasionally**:

- `last full weekend of <month>`
- `<n>th full weekend of <month>`

They differ only when the month has five weekends. Known real-world examples:

| Contest | Correct rule | Common wrong encoding |
|---|---|---|
| WW Digi | **last** full weekend of August | "fourth weekend" — DXZone gets this wrong, giving Aug 22 instead of the correct **Aug 29–30, 2026** |
| ARRL Field Day | **fourth** full weekend of June | "last full weekend" — wrong whenever June has five weekends |

Rule families for reference:

- **CQ family — "last full weekend":** WW Digi (Aug), CQ WW RTTY (Sep),
  CQ WW SSB (Oct), CQ WW CW (Nov), CQ WPX SSB (Mar), CQ WPX CW (May),
  CQ 160 (last full weekends of Jan and Feb).
- **ARRL family — ordinal, never "last":** RTTY Roundup (first full weekend of Jan,
  never Jan 1), International DX Phone (first full weekend Mar), International Digital
  (first full weekend Jun), June VHF (second full weekend), IARU HF (second full
  weekend Jul), Field Day (**fourth** full weekend Jun), Sweepstakes SSB (third full
  weekend Nov).

### What to do

1. Grep the engine for how rule types are represented. If `last_full_weekend` and
   ordinal rules collapse into a single code path, that is the bug.
   ```powershell
   cd "C:\GitHub Repositories\contest-calendar"
   Get-ChildItem -Recurse -Include *.py,*.ts,*.json |
     Select-String -Pattern "last_full|full_weekend|nth_weekend|ordinal"
   ```
2. For every one of the 145, confirm the stored rule matches the **sponsor's own
   wording**. Aggregators paraphrase, and that paraphrase is exactly how the WW Digi
   error propagates.
3. Generate dates for **2027 and 2028** and compare against sponsor-published future
   dates where available. ww-digi.com, for instance, publishes 2027–2029 explicitly.
   Any mismatch is a rule-encoding bug, not a data-entry bug.

---

## 5. Separate concern — the personal chase list

This is **not** part of the dataset and must not influence section 3.

The site is for everybody. Separately, the operator wants to flag a small number of
contests he personally intends to enter, so they stand out among the ~145+ in his
subscribed feed. That is a presentation/notification layer, not a data filter.

Constraint discovered: events arriving from a subscribed iCal feed are **read-only** in
Google Calendar — per-event reminders cannot be attached to them. So the options are:

- **(a)** Add a `chasing` boolean to the contest records and emit a second iCal feed
  (e.g. `/feed/chasing.ics`) that the operator subscribes to separately, with its own
  colour and notification defaults. Single source of truth, dates roll forward with the
  rules engine.
- **(b)** Hand-created reminder events on the primary calendar for the handful of events
  he actually enters each year. Zero code, but drifts if a sponsor moves a date.

If implementing (a), the flag is per-user metadata and belongs alongside the contest
record, not inside it — the public dataset and feed must be unaffected.

Do not action this without direction; it is noted here so the schema work in section 2
doesn't foreclose it.

---

## 6. Deliverables

1. **`gap-report.md`** — contests present in authoritative sources but absent from D1.
   Columns: name, sponsor, mode(s), recurrence rule (sponsor's exact wording), bands,
   source URL, and a verification status. Recommend exclusion only on the narrow
   grounds in section 3 (defunct, duplicate, unverifiable).
2. **`rule-audit.md`** — every existing contest whose stored rule does not match the
   sponsor's wording, with the divergent years called out.
3. **A seed/migration file** for approved additions, matching the existing schema and
   seed-file conventions already in the repo. Do not invent a new format.
4. **Do not write to production D1 without approval.** Produce the migration, show the
   diff, wait for sign-off.

---

## 7. Immediate item, independent of this audit

**WW Digi 2026 runs 1200 UTC Sat Aug 29 → 1159 UTC Sun Aug 30, 2026** — eight days out.
FT4/FT8 on 160/80/40/20/15/10m. Distance-based scoring, grid fields as multipliers.
Rules: `https://ww-digi.com/rules/`

Two rule changes this year worth surfacing to the operator:
- **Autonomous operation is prohibited** — relevant, as this station runs unattended FT8.
- 48-hour log submission deadline.

Add this contest regardless of what the wider audit finds.
