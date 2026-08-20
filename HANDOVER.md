# HANDOVER — World Contest Calendar

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Owner:** Joe Leone, W4GGJ
**Updated:** 2026-08-19 — after Tier 2 Europe, and after the contest detail view closed the
front-end build list

---

## What this is

A public web calendar of every amateur radio contest. One job: **help an operator find a
contest to enter.** Modern, fast, usable on a phone.

Built as a **recurrence rules engine** rather than a maintained list. Contests are stored as
scheduling rules taken from each sponsor's own published rules; dates for any year are
computed on demand. That means no year horizon, one-line fixes when a sponsor changes a
rule, and every date traceable to a source.

**Current state:** 219 contest definitions → 842 occurrences for 2026. 387 Python tests,
400 TypeScript tests, 147 Worker tests. Engine complete in both languages — no known
structural gaps. **Deployed** at <https://contest-calendar.jleone0.workers.dev>: the API,
the Now / next-7-days landing view, filters and search, the iCal feed, and — since
2026-08-19 — the contest detail view at `/contest/:id`. `modes` and `bands` are controlled
vocabularies. The page has a three-state theme switch and has been through a measured
narrow-viewport pass. **The front-end build list is closed**; what remains is sourcing.

Deployed 2026-08-19, version `239f81ce`, and verified on the fleet: `/api/health` reports
`ok` with `resolver: intl`, `pinned: true` and the DST self-check passing, and the detail
routes answer 200 / 404 / 400 as they do locally.

**Where it is thin:** **South America — three records**, and still the largest gap. The
2026-08-19 pass found why, and it is not a reading problem: most South American societies
publish no contest rules on the web at all. See `data/sources.md`, "South America, and what
it actually publishes". It needs letters to societies, like QRP ARCI, not more searching. Africa went 1 → 34 on 2026-08-19: SARL had moved rather than died, and nine more contests
come from nine South African clubs that publish through SARL's Contest Manual. Every region has something: Asia, Oceania and South America came off
zero on 2026-08-17, and Europe went 19 → 59 records on 2026-08-18 with the Tier 2 societies
and DARC, then to 85 on 2026-08-19 with the last twelve. Europe is now 49.7% of the catalog
and North America 36.3%, down from 71% in July. All eight tier-1 orgs are done and **tier 2 is
21 of 21** — REP closed it on 2026-08-19, and NRAU encodes nothing because it is blocked at
source. Measured rather than assumed: run
`python scripts\coverage.py --check`.

## Read first

0. `SESSION_HANDOVER.md` — **only if you are setting up a new machine**: what is not in
   git, how to verify you arrived, and the one link check that is expected to fail today
1. `README.md` — provenance and architecture
2. `data/sources.md` — verified, pending, and corrections found
3. `FRONTEND_BRIEF.md` — **the current phase**
4. `BUILD_BRIEF.md` — overall plan

## Verify the repo is healthy

```powershell
pip install -r requirements.txt   # REQUIRED on Windows -- tzdata
python scripts\validate.py        # expect: 21/21 match
python -m pytest -q               # expect: 387 passed
python scripts\check_links.py
python scripts\coverage.py --check # expect: Registry coverage is current.

cd engine; npm install; npm test   # expect: 400 passed (387 mirrored + 13 parity)
cd ..\worker; npm install; npm test # expect: 147 passed (parity inside workerd, the API, filters, iCal, theme, pages, detail, icon)
```

Both TypeScript suites shell out to Python for their parity checks, so run
`pip install -r requirements.txt` before `npm test` or they fail loudly. That is
deliberate — a parity check that skips looks green while proving nothing.

`engine` runs in Node. `worker` runs the same field-for-field comparison **inside workerd**,
because that is what serves requests and its `Temporal`/`Intl` surface is not Node's. It
also asserts the timezone resolver actually in use is the pinned one, and that
`/api/health` says so. Green in Node alone proves nothing about production.

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

## Next: sourcing

**The front end is done and deployed.** `FRONTEND_BRIEF.md` records every section and what
it cost; all six are shipped and the definition of done is met. What is left is sourcing:
**Africa and South America** — REP closed Tier 2 on 2026-08-19.

Building it against the catalog as it stood was the right call and it paid the way the brief
predicted: the detail view surfaced four plain-language rule bugs that had been shipping in
the API for a month, invisible because nothing displayed the field. See `FRONTEND_BRIEF.md`,
"Section 4 shipped: the contest detail view".

**The Worker is deployed.** <https://contest-calendar.jleone0.workers.dev> — one Worker
server-rendering `/` and serving `/api/*` from the same catalog and the same engine.
Locally: `npm run dev` in `worker/`, then <http://127.0.0.1:8787>. The landing view answers
"what is on the air now" and "what is on this week", and filters and search are on it — a
plain GET form that works with scripting off, with the state in the URL. **The iCal feed is
on it too**, at `/api/ics` and `/contests.ics`, taking the same query params — so the
address bar is the subscription URL and "Subscribe to this view" is that fact made visible.
**The contest detail view is at `/contest/:id`** — the rule in plain language, the clock the
sponsor wrote, the next runnings, what you send, and the sentence each record was read from.
Every contest name on the schedule links to it, carrying the reader's filters in the query.

Deploy with `npx wrangler deploy` in `worker/`. **Probe more than once afterwards**: the
first request after a deploy can land on a colo still running the old script, which returned
a 404 for a route that had just been added and a 200 for the same URL seconds later. A single
probe straight after deploying can mislead in either direction.

There is still no KV and no D1 — a year of
occurrences costs **4.44 ms** to expand cold inside workerd and is already memoised per
isolate in `schedule.ts`, while the same data is 533 KB serialised. A KV read would be a
network round trip and a `JSON.parse` to avoid 4.44 ms of arithmetic, and it would put a
serialise/deserialise boundary through `Date` values in a project whose entire warrant is
that the times are exact. Measured, not assumed; revisit if the catalog grows an order of
magnitude.

Two things worth knowing before you touch it:

- The timezone resolver is **pinned** in `worker/src/runtime.ts`, and the probe that
  settled it is `npm run probe`. `activeResolver()` picks on `typeof Temporal`, so without
  the pin the runtime's own feature detection would decide how wall-clock contest times get
  resolved. Measured 2026-08-16: `Temporal` is absent in local workerd **and** absent on the
  deployed fleet, so today the pin and detection agree — which is not a reason to remove it,
  since the fleet's answer already moved once (workerd#6907). Production `/api/health`
  reports `resolver: intl`, `pinned: true`, `wouldSelectWithoutPin: intl`, and the DST
  self-check passing 8/8. See `TIMEZONE_BRIEF.md`, "Measured on the fleet".
- `modes` and `bands` **are** controlled vocabularies, declared in both engines and asserted
  by all three suites. `modes` is one or more of CW · SSB · FM · RTTY · Digital ·
  FT8/FT4 · Mixed; `bands` is a per-contest list off the 160m…3cm ladder. Free-text `submodes` and
  `bands_note` carry the specifics — displayed, never filtered on. **Empty `bands` means
  unrecorded, not unbanded**, so every band filter excludes such a record and the page says
  so out loud rather than letting it vanish. Reasoning and the FT8/FT4-under-Digital
  decision: `FRONTEND_BRIEF.md`, "Vocabulary: modes and bands".

**The engine port is done.** `engine/` holds the TypeScript engine: 311 tests mirroring the
Python suite one-for-one, plus a parity suite that compares every field of every occurrence
for four years against the Python reference.

Porting found a real bug, which is why both suites are now 116 rather than 115: `expand()`
swallowed every `ValueError` from anchor resolution, so **a typo'd rule type silently
produced an empty schedule** — the contest would disappear from every calendar with nothing
logged. Both engines now separate `NoAnchorsThisYear` (legitimate) from a malformed rule
(throws).

## The look, and the phone

Both closed 2026-08-16. Full reasoning in `FRONTEND_BRIEF.md` under "Design direction
shipped: the panadapter" and "Section 6 shipped: the mobile pass"; the rules that must not
be broken are summarised in `CLAUDE.md` under "Colour carries data".

The palette was cream-and-warm-brown, which is the exact default the `frontend-design` skill
warns about. It is now a panadapter: a near-black `#050B12` field with amber and cyan, read
off waterfall displays and rig front panels. **Colour is a mapping, not a mood** — amber is
time, cyan is interactive, and `--d1`…`--d4` are the four `DURATION_BUCKETS`. That last one
exists because the rail's bar width saturates: on a seven-day window a two-hour sprint and a
four-hour one are both the 3px floor, so length gets a second channel. A bar's `data-d` comes
from `durationBucketOf(duration_hours)` and **never from the drawn geometry**, which is
clamped to the window — the colour states the contest, the width states the part of it you
can see. Add a bucket and you add a stop, same commit; `theme.worker.test.ts` fails otherwise.

Dark mode is **three states, not a switch**: auto, light, dark, stored the same way the
UTC/local toggle is, with auto stored by removing the key. Inside the media query the
selector is `:root:not([data-theme])`, not bare `:root` — with bare `:root` an explicit
choice loses to the system on specificity. A 160-byte synchronous script in `<head>`
applies the stored choice before first paint, because a white flash at 0300Z is the whole
problem the feature exists to solve. Both switches ship `hidden` and are revealed by script:
never offer a control whose state cannot be remembered.

The mobile pass was measured at 320 / 360 / 390 CSS px with the filter panel open: no
horizontal overflow, no undersized control. It found five real things — a masthead wrapping
to three lines with dangling separators, the tally's third count orphaned onto its own line,
`74% elapsed` unreadable where the meter fill ran under it, `UTC` and `CW` tall enough to hit
but only ~36–42px wide, and contest-name links one line tall. Touch sizing keys on
`(pointer: coarse)`, **never on width** — a touchscreen laptop needs 44px and a narrow
desktop window does not. Inline links get a 44px `::after` hit area rather than a 44px box,
so the schedule does not space out like a list of buttons.

## Partly-closed check — the phone: closed on Android, open on iOS

**Verified on hardware 2026-08-19, on Android.** The owner read the schedule and a contest
detail page (`/contest/cq-ww-cw`) on an Android handset and found nothing wrong. Before that
the pass had rendered the deployed page's own bytes in a same-origin iframe at exact phone
widths — a real viewport, with `(max-width: 599px)` genuinely applying and the
`(pointer: coarse)` rules exercised by re-injecting the page's own `CSSMediaRule` text — but
not a phone.

That closes browser chrome and dynamic viewport units under a collapsing URL bar, whether a
measured 44px is within thumb reach one-handed, and how the coarse sizing feels rather than
measures. It also covers the contest detail view, which shipped after the original pass and
had never been on a phone.

**Still open, and only an iPhone can close it:** iOS Safari's rubber-band scroll, its tap
highlight, and the ≥16px rule that stops it zooming when an input takes focus. The filter
inputs are `1rem`, so that last one should hold — check it first, because a page that zooms
on focus has thrown away the reader's place in the schedule.

Note the live CSP is `default-src 'none'` with `frame-ancestors 'none'` and no `connect-src`.
That blocks framing the live URL and blocks page-origin `fetch()`, which is why the harness
served the fetched bytes locally. **Do not weaken the CSP to make testing easier.**

## Sourcing work, as background

1. **CQ contests — done 2026-08-16, all eight verified.** Read the method in
   `data/sources.md`, "CQ publishes dates, not rules", before touching these records: CQ
   states no recurrence anywhere except one 2016 WPX sentence, so seven of the eight rules
   are held to CQ's own published dates and log deadlines rather than to CQ's prose. **CQ 160
   SSB turned out to be the fourth Saturday of February** — CQ's dates rule out "last
   Saturday" in 2020 exactly as they rule out "last full weekend" in 2026. One open item:
   CQ has not published 2026 CQ WW rules, so CQ WW's `log_deadline_days` is still the 5 days
   the 2025 rules state while the other three CQ contests moved to 48 hours for 2026.
2. **QRP ARCI** — blocked at source, needs a human. qrparci.org publishes no rules pages;
   rules appear to live in the members' magazine *QRP Quarterly*. qrpcontest.com is a
   third-party logging service, not the sponsor, so it's unusable. Email the contest
   manager; their reply is a citable primary source. Record it with date and name.
3. **Registry reconciled — done 2026-08-16.** Eight stale assumptions corrected (NCJ has no
   SSB Sprint, 10-10 runs three QSO Parties, "Goldene Taste" is an award, NCCC Sprint is
   NCCC's, FISTS is suspended, QRP ARCI and SARL are `blocked` not pending, Tier 4 and CQ
   complete); the method and the two catalog errors it surfaced are in `data/sources.md`,
   "The registry was reconciled against what verification found". **Counts are now
   generated**: `estimated_total` is labelled a pre-research guess, and everything describing
   what the catalog holds comes from `python scripts/coverage.py`, re-derived by a test in
   both engines. Run it in the same commit as any catalog change.
4. **Asia, Oceania and South America — done 2026-08-17, 21 records.** JARL, RAC, WIA, the
   Oceania DX Contest Committee, NZART, LABRE and ORARI. Method and every judgement call are
   in `data/sources.md`, "Asia, Oceania and South America stopped being empty". Two rule
   types were added to both engines to state what sponsors actually wrote: `nearest_weekday`
   (WIA Remembrance Day — "weekend in August closest to the 15th") and `weekly.months`
   (NZART sprints — "each Tuesday in April and August"). **RAC's Canada Winter Contest is
   `manual`**: eight annual PDFs give eight dates fitting no ordinal at all, so years RAC
   has not announced are simply absent. **GACW is blocked** — its WWSA rules PDFs are scanned
   imagery with no text layer; ask GACW for a text version, don't fill it from a calendar.
   JARL's Japanese-language contests were deferred there and were READ on 2026-08-19: ALL JA,
   6m AND DOWN, Field Day and ACAG are encoded, and JARL is complete at 8 of 8.
5. **DARC — done 2026-08-18, 8 records, and Tier 1 is finished.** WAE DX CW/SSB/RTTY, WAG,
   the 10m Contest, the Weihnachtswettbewerb and the quarterly FT4 and RTTY-Kurzcontest
   series. No engine change: every rule fits a type the engine already had. German pages,
   quoted in German with the translation after. The judgement calls — "zweites Wochenende"
   read as the second *full* weekend, the 10m rule taken from an Ausschreibung DARC has
   superseded but still publishes, and DARC's own contradiction about the WAE CW deadline —
   are in `data/sources.md`, "DARC, and Tier 1 is finished". Five more DARC HF contests
   (Ostercontest, Hell, HELL-Kurzcontest, and the two Ausbildungsconteste) have rules pages
   and were out of that pass's scope; DARC's UKW contests are a separate referat.
6b. **REP — done 2026-08-19, 3 records, and Tier 2 is finished 21 of 21.** Portugal Day HF
   (second full weekend of June), Portugal Day VHF/UHF and the REP 50 MHz contest. Two things
   to know before touching these. **REP publishes two live and contradictory VHF/UHF rules** —
   `concursos.rep.pt` says 10 June every year, `portugaldaycontest.rep.pt` still says the
   second Saturday — and the fixed date is encoded because REP's own logs-received post shows
   it ran on Tuesday 10 June 2025, not Saturday the 14th. **The REP FT4 contest is deferred,
   not missed**: three dated editions with two different clock windows and no recurrence,
   which a `manual` record's single `start`/`end` pair cannot state exactly. Both are in
   `data/sources.md`, "REP, and Tier 2 is finished".
7. **Tier 2 Europe — done 2026-08-19, 26 records from twelve societies.** USKA,
   ÖVSV, MRASZ, BFRA, FRR, SRS, HRS, LRAL, ERAU, LRMD, SRR and UARL, in eleven languages,
   each quoted in the sponsor's own wording with the translation after. One engine change:
   `nth` now counts backwards past "last", because BFRA states LZ DX as *"the weekend before
   the last full weekend of November"* — a rule with no forward ordinal. **NRAU is blocked
   at source** (nrau.net says its contest information is under revision, and the NAC pages
   state no modes), as are SRS's domestic contests and FRR's La Mulți Ani YO; what was read
   before each blocker is recorded in `data/sources.md`, "Europe finishes ahead".
   **REP (Portugal) is the one Tier 2 society never worked.**
8. **Then Africa and South America** — one record each, and the thinnest part of the
   catalog. Work region by region rather than sponsor by sponsor so coverage fills evenly;
   `coverage.thin` names the regions at zero. Tier 5 is 50 more US QSO parties, so it still
   comes last: adding 50 North American records now would undo the balance this year's
   sourcing bought.

---

## Open flags — deliberately unresolved

Flagged rather than guessed. Leave them until a sponsor settles them.

- **AGCW ZAP Merit Contest** — `verified: false`; AGCW publishes no closing time. Stored end
  is a labelled placeholder.
- **PODXS Great Pumpkin** — close time differs by one minute between the rules page and the
  club calendar. Recorded in `note`, not silently reconciled.
- **CQ WW SSB and CW log deadline** — CQ has not published 2026 rules (cqww.com serves the
  2025 set; the 2026 PDF is a 404). The record keeps the 5 days the 2025 rules state, while
  CQ WPX, CQ WPX RTTY and CQ WW RTTY all moved to 48 hours for 2026. Recheck, don't guess.
- **CQ 160 SSB is resolved** — it was the model for an honest flag, and reading CQ's own
  published dates settled it: fourth Saturday of February, not "last" anything. The two
  documentation errors found in CQ's own material are recorded in the records' `note` fields
  rather than silently corrected.
- **JARL All Asian DX log deadline** — JARL's "10 days after the event is over" and the date
  JARL prints disagree by a day, because JARL counts from the last contest *day* and this
  catalog stores a 24:00 UTC end *instant*. Both legs carry **no** `log_deadline_days` rather
  than a 9 JARL never wrote. JARL's WW RTTY states it as an instant, so that one is encoded.
- **RAC Canada Winter log deadline** — the 2026 PDF's parenthetical (January 11) is one day
  later than its own 14-day rule for a December 27 contest. The rule is encoded.
- **WIA Harry Angel 2027** — WIA's page states "the first Saturday in May" three times and
  then names a date that is a Monday. The calendar follows the rule, not the sentence.
- **JARL New Year QSO Party** — `verified: false` (JARL publishes the 79th party's dates, not
  a recurrence) and the catalog's second `bands: []` record: JARL states only "All bands and
  Modes permitted for JA amateur radio stations", so there is no band list to record.

## Partly-closed check — the iCal feed in a real client

The feed conforms to RFC 5545 clause by clause, proved by a parser that reads it back
(`worker/tests/ics.worker.test.ts`), and it avoids the two constructs Google, Apple and
Outlook genuinely implement differently — `VTIMEZONE` and `RRULE`.

**Google Calendar: verified 2026-08-16, end to end.** The deployed feed was subscribed in
the browser and then read back through the Calendar API and compared against the bytes the
Worker serves. `CQ Worldwide DX Contest, CW`, UID `cq-ww-cw-20261128T0000@contestcal`:
`DTSTART:20261128T000000Z` / `DTEND:20261129T235900Z` arrived as exactly those instants;
`STATUS:TENTATIVE` → `status: tentative`; `TRANSP:TRANSPARENT` → `transparency: transparent`
and `AVAILABILITY_FREE`; the escaped `\,` in the summary was unescaped correctly; the
multi-line description and its em-dash survived; `X-WR-CALNAME`, `X-WR-CALDESC` and
`X-WR-TIMEZONE:UTC` were all honoured. 699 events.

**Apple Calendar and Outlook: not verified.** Both require signing in to an account, which
is not something to do on the owner's behalf. They need a human with the credentials — the
feed URL is above and takes seconds to add.

Two things that check turned up, and would not have been found any other way:

- Durations rendered as raw floats (`Duration: 47.983333333333334h`). Fixed — the feed now
  shares the page's `humanDuration`, so both surfaces say `47h 59m`, with a test pinning it.
- **Google re-polls on its own schedule**, not on `REFRESH-INTERVAL`. Twenty minutes after
  the fix deployed, Google still served the old text. Allow up to a day before concluding a
  change did not take, and never diagnose the generator from what a client is showing —
  fetch the feed and read the bytes.

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
| `nearest_weekday` | `month`, `day`, `weekday` | WIA Remembrance Day = Saturday nearest Aug 15 |
| `monthly_nth_weekday` | `n`, `weekday`, optional `months` | SKCC WES = 2nd Saturday monthly |
| `weekly` | `weekday`, optional `months` | CWT anchors on Wednesday; NZART sprints run Tuesdays in April and August only |
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
- **NZART's field day exception is one `exclude_dates` entry, and that is exact.** NZART
  moves it "when February only has three full weekends". The last-full-weekend Saturday
  lands on February 21 *if and only if* February has 28 days and the 1st is a Sunday — which
  is precisely that case — so `[[2, 21]]` expresses the condition rather than approximating
  it. "Last Saturday in February" was tested as a simpler rule and rejected: it diverges in a
  leap year beginning on a Saturday.

---

## Working agreements

- **A rule the engine can expand but the page cannot say out loud is a half-built rule.**
  Adding a rule type means adding a case to `describeRule()` in `worker/src/schedule.ts` in
  the same commit. A catalog-wide test fails if any record's rule renders as its own type,
  which is what four rules did for a month while the field was only in JSON.
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
