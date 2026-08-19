# CLAUDE.md

Don't chain cd into compound bash commands. Use absolute paths or run commands from the repo root, so each command can be checked independently.

Working notes for Claude Code in this repo. Read `HANDOVER.md` before making changes —
it carries the project's non-negotiable sourcing rule.

## Environment

Python is stdlib-only at runtime; the venv exists for `pytest` and for `tzdata`, which
Windows needs because it does not ship the IANA database.

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Activate the venv **before** running the TypeScript suite too — see below.

## Three test suites

```powershell
# Python -- the reference engine
python -m pytest -q            # expect: 353 passed
python scripts\validate.py     # expect: ARRL 2026 rule-engine validation: 21/21 match
python scripts\check_links.py  # sponsor rules URLs still resolve
python scripts\coverage.py     # regenerate the registry's coverage block
python scripts\coverage.py --check   # ...or just report where the catalog is thin

# TypeScript -- what actually serves the site
cd engine
npm install                    # node_modules is gitignored; needed on a fresh clone
npm test                       # expect: 366 passed (353 mirrored + 13 parity)
npm run typecheck
```

```powershell
# Worker -- the API and the landing view, tested inside workerd
cd worker
npm install
npm test                       # expect: 141 passed
npm run typecheck              # two projects: workerd sources, then the Node-side setup
npm run dev                    # wrangler dev on :8787
npm run probe                  # re-measure Temporal/Intl across compatibility dates
```

Both parity suites shell out to `python scripts/dump_occurrences.py` and compare full
serialised output, using whatever `python` is first on PATH — so **the venv must be active
or they fail** on Windows, where `zoneinfo` raises without `tzdata`. They fail rather than
skipping, deliberately: a parity check that skips looks green while proving nothing.

The `engine` suite runs in Node; the `worker` suite runs the same comparison **inside
workerd** via `@cloudflare/vitest-pool-workers`, because that is the runtime that serves
requests and its `Temporal`/`Intl` surface is not Node's. Green in Node is not evidence
about production. `worker/tests/global-setup.ts` runs Python on the Node side and writes a
gitignored fixture, since workerd has no child processes.

## The engines change together

> `contestcal/recurrence.py` and `engine/src/recurrence.ts` are one implementation kept in
> two languages. **Change one and you change the other, in the same commit.**

`parity.test.ts` compares every field of every occurrence for 2026, 2027, 2030 and 2032
against the Python engine's output. A one-minute divergence anywhere fails it. This is not
a style rule — it is what makes two implementations of contest dates safe to have at all.

Practically:

- Rule-logic edits go to both files, and to both `tests/test_recurrence.py` and
  `engine/tests/recurrence.test.ts` (mirrored one-for-one: same names, same assertions).
- Catalog edits go to `data/` only. Both engines read the same JSON — never fork it.
- `CATALOG_MODES` and `CATALOG_BANDS` are declared in **both** engines and are held equal by
  a test that parses the Python source. Adding a token means editing both, same commit.
- Run **both** suites before committing. Green Python alone proves nothing about what ships.

## The registry counts itself

`data/sources.registry.json` mixes two kinds of number and they must not be confused.
`estimated_total` is a guess written **before** any of that sponsor's pages were read — not
a target, not a denominator; verification has moved it in both directions. Everything that
states how much of the catalog actually exists — each org's `encoded` / `encoded_verified`
and the whole `coverage` block — is **generated** by `scripts/coverage.py` from
`data/contests.seed.json`.

`test_registry_coverage_is_current` recomputes all of it independently in both engines and
fails on any drift; it deliberately does not import `coverage.py`, so the generator never
grades its own homework. So: **add a contest and run `python scripts/coverage.py` in the
same commit.** A new sponsor also needs its `catalog_sponsors` entry and its `country` in
`region_map`, or the same test fails — that join is the only thing making an unregistered
sponsor detectable.

`coverage.thin` is the point of the exercise, not a footnote: it names the regions with
**zero** contests. A region nobody has sourced is invisible to every operator living in it,
which is a worse failure than an unverified record. Read it before planning a sourcing pass.

## Modes and bands are controlled sets

```
modes       CW · SSB · RTTY · Digital · FT8/FT4 · Mixed
bands       160m 80m 60m 40m 30m 20m 17m 15m 12m 10m 6m 2m 1.25m 70cm 33cm 23cm 13cm 3cm
```

Free text lives in `submodes` ("PSK31", "RTTY 75 baud") and `bands_note`, which are
displayed and **never filtered on** — a free-text field cannot be a filter, which is the
point of separating them. `modes` keeps the sponsor's own order (`CW/SSB`), not the
vocabulary's.

**Empty `bands` means unrecorded, not unbanded.** Every band filter therefore excludes such
a record, so anything that filters has to say so: `filterWithNotes()` tallies them and the
landing view prints a `.caveat` naming them. Dropping a contest silently because we could
not read its source is the failure this project exists to avoid.

The record says exactly what it is; **the filter is what widens.** `Digital` matches
Digital, RTTY, FT8/FT4 and Mixed; `FT8/FT4` matches FT8/FT4 and Mixed; every specific mode
also matches Mixed, and `Mixed` matches only Mixed. Never inflate the record — a row that
prints "RTTY/Digital" for an RTTY-only contest overstates what the sponsor permits. The
table is in `worker/src/schedule.ts` (`MODE_SUBSUMES`) and asserted in
`worker/tests/filters.worker.test.ts`; the reasoning is in `FRONTEND_BRIEF.md` under
"Vocabulary: modes and bands".

## Colour carries data, so it is a controlled set too

`worker/src/render/theme.ts` is the whole stylesheet as one `String.raw` template — **no
backticks anywhere inside it**, not even in a comment, because they terminate the string.

Three roles, and each one is a mapping rather than a decoration: **amber is time**, **cyan is
interactive**, **`--d1`…`--d4` are the four `DURATION_BUCKETS`**. The ramp exists because
width saturates — a two-hour sprint on a seven-day rail is the 3px floor and so is a
four-hour one. Adding a bucket means adding its colour in the same commit; `theme.worker.test.ts`
fails the build otherwise, on the same reasoning as `CATALOG_MODES`.

A bar's `data-d` comes from `durationBucketOf(o.duration_hours)`, **never from the drawn
geometry**, which is clamped to the seven-day window. Colour states the contest; width states
the part of it you can see.

Both palettes come from the one `LIGHT` constant interpolated twice, held byte-identical by
test. The theme switch is three-state (auto/light/dark), the media query is
`:root:not([data-theme])` so an explicit choice cannot be overridden by the system, and the
stored choice is applied by `THEME_BOOT` — a synchronous script in `<head>`, which is why
`landing.ts` puts it there and not in the deferred bundle.

Touch sizing keys on `(pointer: coarse)`, never on width: a touchscreen laptop needs 44px and
a narrow desktop window does not. Reasoning and the measured findings are in
`FRONTEND_BRIEF.md` under "Design direction shipped" and "Section 6 shipped".

## Time zones

`engine/src/zones.ts` has two wall-clock → UTC resolvers held to each other by the parity
suite. The Worker pins `intlResolver` and does not touch `Temporal`; the reasoning is in
`TIMEZONE_BRIEF.md` under "Decision — the Worker uses the Intl path". Never use
`new Date("2026-03-08T02:30")` — a local-time string makes the runtime apply its own zone.

The pin lives in `worker/src/runtime.ts`, at module scope, and self-checks against eight
DST vectors before a request is served. **`worker/src/index.ts` imports it first, for its
side effects** — do not reorder those imports, and do not import anything above it that
touches the engine. `/api/health` reports both the active resolver and the one the runtime
*would* have chosen; when they differ, the pin is what is keeping contests on the hour.

## The Worker

`worker/` is one deployable: it server-renders `/` and serves `/api/*`. It reads the same
`data/contests.seed.json` as everything else, imported as a module so the bundler inlines
it — `engine/src/catalog.ts` uses `node:fs` and is excluded from the Worker's tsconfig for
exactly that reason. There is no D1, no KV, and no Astro; the reasoning is in
`FRONTEND_BRIEF.md` under "Deviation: Worker-rendered HTML, not Astro + Pages".

The iCal feed (`worker/src/ics.ts`, served at `/api/ics` and `/contests.ics`) takes the same
query params as the page. Three things there are not stylistic: it emits **expanded UTC
instants, never `RRULE` and never `VTIMEZONE`** — the three big clients disagree about both;
`occurrenceUid()` output must stay **stable across deploys**, because a changed UID turns
every subscriber's calendar into duplicates; and `CATEGORIES` is multi-value, so its comma
separators must not be escaped. `worker/tests/ics.worker.test.ts` parses the feed back with
its own RFC 5545 reader rather than regexing it — keep it that way, or the generator ends up
grading its own homework. The horizon decision is in `FRONTEND_BRIEF.md`, "Section 5 shipped".

`/contest/:id` is the detail view: the rule in plain language, the clock read off the
`start`/`end` offsets rather than off next year's dates, the next runnings, what you send,
and the sentence the record was read from. Two rules there. **A field the catalog has not
recorded is rendered saying so, never omitted** — an absent Exchange row reads as "nothing to
send", which is a claim about the contest rather than about our coverage; and **a rule the
engine can expand but `describeRule()` cannot say out loud is a half-built rule**, so adding
a rule type means adding its case in the same commit. `detail.worker.test.ts` walks the whole
catalog and fails if any record's rule renders as its own type — which is what
`nearest_weekday` did for a month, because the field only existed in JSON.

Contest names on the schedule link **here**, in place, carrying the reader's query
(`/contest/cq-ww-cw?mode=CW` comes back to `/?mode=CW`). The sponsor's rules link moved to
the top of this page; the row keeps exactly one link, because `.row-name a` has a 44px hit
area and a second inline link would overlap it. `id` is a real filter on all three surfaces —
`?id=` on `/`, `/api/contests` and `/api/ics` — and it exists because `q=` is a substring
match and five records contain another record's id or name, so a per-contest subscription
built on `q` would quietly carry a second contest.

`/about`, `/data` and `/contact` are three standing pages in `worker/src/render/pages.ts`
— **deliberately not a nav bar.** The calendar keeps `/` with nothing in front of it; the
pages are reachable from the footer and from each other, and each links back. They reuse
`CSS` and `THEME_BOOT` and ship no client bundle. `pages.worker.test.ts` asserts both halves
— that they exist, and that they stay out of the way.

**Every link that leaves this site carries `target="_blank"` with `rel="noopener external"`**
— the sponsor's rules, sponsor home pages, log submission. `_blank` because the reader's
filters live in the URL and leaving in place throws away the view they built; `noopener`
because `_blank` alone hands the opened page a handle on ours through `window.opener`. The
test walks `/`, a detail page and the standing pages, not just `/`: it used to check only the
schedule, which now has no outbound links at all, so pinning it there would have gone
vacuous the day the rules link moved to `/contest/:id`.

`SITE_NAME` (`render/html.ts`) is what every `<title>` ends with, including the 404's. The
masthead deliberately does **not** use it: the `<h1>` there stays two words and the subject
lives in the `.tag` line beneath it, whose provenance clause is dropped below 600px. Keep the
heading short — it is the first thing that wraps on a phone.

The page must stay correct with JavaScript off. Server-render every time as UTC with a
machine-readable `datetime`; `render/client.ts` only converts to local and ticks
countdowns. Anything that renders blank without JS is a regression.

## The four briefs

| File | What it covers |
| --- | --- |
| `HANDOVER.md` | Current state, health checks, the sourcing rule. **Start here.** |
| `BUILD_BRIEF.md` | Overall plan and provenance model for the whole project. |
| `FRONTEND_BRIEF.md` | The current phase — UI, Worker, iCal feed. Engine port is done. |
| `TIMEZONE_BRIEF.md` | Wall-clock vs rolling time handling. Done; includes the Worker resolver decision. |

`README.md` is the public-facing description of provenance and architecture;
`data/sources.md` records what has been verified against which sponsor page.
