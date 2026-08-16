# HANDOVER — World Contest Calendar

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Owner:** Joe Leone, W4GGJ
**Updated:** 2026-08-16 — after the deploy, the palette, and the mobile pass

---

## What this is

A public web calendar of every amateur radio contest. One job: **help an operator find a
contest to enter.** Modern, fast, usable on a phone.

Built as a **recurrence rules engine** rather than a maintained list. Contests are stored as
scheduling rules taken from each sponsor's own published rules; dates for any year are
computed on demand. That means no year horizon, one-line fixes when a sponsor changes a
rule, and every date traceable to a source.

**Current state:** 84 contest definitions → 648 occurrences for 2026. 127 Python tests,
140 TypeScript tests, 100 Worker tests. Engine complete in both languages — no known
structural gaps. **Deployed** at <https://contest-calendar.jleone0.workers.dev>: the API,
the Now / next-7-days landing view, filters and search, and the iCal feed. `modes` and
`bands` are controlled vocabularies. The page has a three-state theme switch and has been
through a measured narrow-viewport pass. The contest detail view is not built.

## Read first

1. `README.md` — provenance and architecture
2. `data/sources.md` — verified, pending, and corrections found
3. `FRONTEND_BRIEF.md` — **the current phase**
4. `BUILD_BRIEF.md` — overall plan

## Verify the repo is healthy

```powershell
pip install -r requirements.txt   # REQUIRED on Windows -- tzdata
python scripts\validate.py        # expect: 21/21 match
python -m pytest -q               # expect: 127 passed
python scripts\check_links.py

cd engine; npm install; npm test   # expect: 140 passed (127 mirrored + 13 parity)
cd ..\worker; npm install; npm test # expect: 100 passed (parity inside workerd, the API, filters, iCal, theme)
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

## Next: build the front end

**See `FRONTEND_BRIEF.md`.** This is the current phase.

The catalog already covers every contest a normal operator would enter in a year, and none
of it is visible to anyone. Build the UI against the data as it stands — remaining sourcing
becomes background work that appears in a UI that already exists, and building will surface
data model gaps faster than another 200 records would.

**The Worker is deployed.** <https://contest-calendar.jleone0.workers.dev> — one Worker
server-rendering `/` and serving `/api/*` from the same catalog and the same engine.
Locally: `npm run dev` in `worker/`, then <http://127.0.0.1:8787>. The landing view answers
"what is on the air now" and "what is on this week", and filters and search are on it — a
plain GET form that works with scripting off, with the state in the URL. **The iCal feed is
on it too**, at `/api/ics` and `/contests.ics`, taking the same query params — so the
address bar is the subscription URL and "Subscribe to this view" is that fact made visible.
Still to build: the contest detail view.

Deploy with `npx wrangler deploy` in `worker/`. There is still no KV and no D1 — a year of
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
  by all three suites. `modes` is one or more of CW · SSB · RTTY · Digital · FT8/FT4 ·
  Mixed; `bands` is a per-contest list off the 160m…3cm ladder. Free-text `submodes` and
  `bands_note` carry the specifics — displayed, never filtered on. **Empty `bands` means
  unrecorded, not unbanded**, so every band filter excludes such a record and the page says
  so out loud rather than letting it vanish. Reasoning and the FT8/FT4-under-Digital
  decision: `FRONTEND_BRIEF.md`, "Vocabulary: modes and bands".

**The engine port is done.** `engine/` holds the TypeScript engine: 127 tests mirroring the
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

## Partly-closed check — the phone

**Not verified on hardware.** No phone was available, so the pass rendered the deployed
page's own bytes in a same-origin iframe at exact phone widths. That is a real viewport —
`(max-width: 599px)` genuinely applied — and the `(pointer: coarse)` rules were exercised by
re-injecting the page's own `CSSMediaRule` text, not a hand-written approximation. It is
still not a phone.

What it cannot settle, and what a human with a handset should check in about two minutes:
browser chrome and dynamic viewport units under a collapsing URL bar; whether a measured 44px
is actually within thumb reach one-handed; iOS Safari's rubber-band scroll, tap highlight,
and the ≥16px rule that stops it zooming on focus (the filter inputs are `1rem`, so it should
hold — unconfirmed); and how the coarse sizing feels rather than measures.

Note the live CSP is `default-src 'none'` with `frame-ancestors 'none'` and no `connect-src`.
That blocks framing the live URL and blocks page-origin `fetch()`, which is why the harness
served the fetched bytes locally. **Do not weaken the CSP to make testing easier.**

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
