# BUILD BRIEF — Front End

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Prerequisite:** read `HANDOVER.md` first
**Status:** **engine port DONE 2026-08-12.** `engine/` holds the TypeScript
engine, 127 mirrored tests green plus a cross-engine parity suite. Landing view,
filters and search shipped 2026-08-16 — see "Worker: what shipped" and "Section 3
shipped: filters and search" below. Contest detail and the iCal feed are next.

---

## What we're building

A public web calendar of every amateur radio contest. One job: **help an operator find a
contest to enter.** Modern, fast, usable on a phone.

The catalog already holds 84 contests → 648 occurrences for 2026, every date computed from
a rules engine and traceable to the sponsor. None of that is visible to anyone yet. That's
the gap this closes.

**Build the UI against the catalog as it stands.** Do not wait for more sourcing.
Remaining contests get added behind a UI that already works, and building will surface data
model gaps faster than another 200 records would.

---

## Stack

Astro + Cloudflare Pages, matching the rest of the stack. Cloudflare Worker + D1 for the
API, KV for caching generated years.

> **Superseded.** One Worker server-renders the HTML and serves the API; no Astro, no
> Pages, no D1, no KV. Reasoning in **"Deviation: Worker-rendered HTML, not Astro + Pages"**
> below.

The engine is currently Python. **Port `contestcal/recurrence.py` to TypeScript first** —
it's dependency-free stdlib date math, so this is a direct translation, not a rewrite.
Bring `tests/test_recurrence.py` across as a Vitest suite. All 115 tests must pass in TS
before any UI work starts; that suite is the only thing guaranteeing dates stay correct.

Timezone handling in TS: use `Temporal.ZonedDateTime` where available, otherwise
`Intl.DateTimeFormat` with an explicit `timeZone`.

> **Amended.** "Where available" is the problem, not the solution: availability differs
> between local workerd and the deployed fleet, so it decides the answer by environment.
> The Worker pins `intlResolver` unconditionally. See `TIMEZONE_BRIEF.md`,
> "Measured, not assumed".

**Never** the `Date` constructor with a local-time string — it silently applies the runtime's zone, which is the bug
`TIMEZONE_BRIEF.md` just removed, and it works fine on the developer's machine.

---

## Port: what shipped

`engine/` — `npm test` runs 127 mirrored tests and 13 parity tests. (116 at the
time of the port; 11 vocabulary tests were added on 2026-08-16.)

- **116, not 115.** Porting surfaced a real bug in the Python engine: `expand()`
  caught every `ValueError` from anchor resolution, so a **typo'd rule type
  silently produced an empty schedule** — the contest would vanish from every
  calendar with no error anywhere. Both engines now distinguish
  `NoAnchorsThisYear` (legitimate: a fifth-Saturday rule in a four-Saturday
  month, or a `manual` record for an unpublished year) from a malformed rule,
  which throws. One test added to each suite; both are 116.
- **Parity is checked directly, not just by shared assertions.** Two engines can
  pass identical tests and still disagree on the fields nobody asserted on.
  `engine/tests/parity.test.ts` compares every field of every occurrence for
  2026, 2027, 2030 and 2032 against `scripts/dump_occurrences.py`. Verified
  non-vacuous by deliberately shifting the TS engine one minute — all four years
  fail. Counts agree exactly: 648 / 648 / 644 / 648.
- **Both TS zone resolvers are held to each other**, across seven zones
  (including a half-hour offset and the southern hemisphere) and both DST
  transitions. `Temporal`'s default `'compatible'` disambiguation matches
  Python's `zoneinfo` on both edges, which is what lets the engines share
  expectations at all; the `Intl` fallback resolves them explicitly to the same
  answers so a runtime without `Temporal` cannot silently shift a contest.
- **The catalog is not duplicated.** Both engines read the same JSON in `data/`.

Left deliberately undone: no Astro app, no Worker, no D1/KV, no iCal. This was
the gate the brief set, and everything past it is UI work against a now-trusted
engine.

## API

```
GET /api/contests?from=&to=           occurrences in a date range
GET /api/contests?year=2027           whole year
GET /api/contests/:id                 one contest + its rule + next occurrences
GET /api/ics                          iCal feed, filterable via query params
GET /api/search?q=                    name and sponsor search
```

Generation is deterministic, so cache years hard in KV and invalidate only when the catalog
changes.

Serve the catalog itself under CC BY at a stable URL. No open contest dataset exists;
publishing one is worth more than keeping it behind the UI.

---

## Views, in build order

### 1. Now / next 7 days — the landing view

Not a year grid. The question people arrive with is "what can I work this weekend."

- Anything live right now, pinned at top with a running countdown
- Then the next 7 days
- Then "later this month"
- Each row: name, start/end in the user's local time, duration, mode, bands, sponsor
- Live contests visually distinct enough to spot without reading

### 2. Local time by default

Every existing calendar is UTC-only and every operator converts in their head. Detect the
browser zone, show local, offer a UTC toggle that persists.

For `local_rolling` contests (none in the catalog today, but the model supports them),
render the wall-clock time with a marker — "06:00 your local time" — and do not convert.

### 3. Filters and search

Persist in the URL so views are shareable and survive reload.

- **Mode** — CW, SSB, RTTY, Digital, FT8/FT4, Mixed
- **Band** — 160 through 6m, plus VHF+
- **Duration** — under 2h / 2–12h / 12–24h / 24h+
- **Date range**
- **Sponsor**
- **Search** across contest name and sponsor

Duration matters more than it looks: "I have two hours free tonight" is a real and
currently unanswerable question on every other calendar.

### 4. Contest detail

Everything the catalog holds: full schedule, next occurrences, exchange, bands, modes,
power categories, log deadline and format, and a prominent link to the sponsor's own rules.

Show the recurrence rule in plain language — "Fourth full weekend of June" — because it's
genuinely useful and it's the thing no other calendar can show.

Where `verified: false`, say so plainly and link the sponsor. Don't hide it; a calendar
that admits uncertainty is more trustworthy than one that doesn't.

### 5. iCal feed

The feature that makes people keep it. Subscribe once, contests appear in their phone
calendar forever.

Filterable by the same params as the UI, so someone can subscribe to CW-only, or 20m-only,
or everything. Include the sponsor rules URL in the event description. Test against Google
Calendar, Apple Calendar, and Outlook — they disagree about recurrence and timezone fields.

### 6. Mobile

Build mobile-first, not responsive-after. The competition is desktop tables from 2003 and a
phone is where someone checks "what's on this weekend" from the couch.

---

## Design direction

Use the `frontend-design` skill before starting, and treat this as a real design brief
rather than a component-assembly job.

The subject has its own visual world worth drawing on: waterfall displays, band plans,
S-meters, propagation maps, Cabrillo logs, grid squares, the aesthetic of a rig's front
panel. There is a distinctive design here that isn't "generic SaaS dashboard with a dark
mode." Find it.

Non-negotiables regardless of direction:

- **Dark mode**, and it should be good — contesters operate at 3am
- Dense information without feeling cramped; this is a data product and operators are
  comfortable with data
- Fast. No spinner on the landing view. Pre-render what you can at build time
- Keyboard accessible, visible focus states, reduced motion respected
- Legible at arm's length on a phone in a park

Avoid: hero sections with a big number and a gradient, generic card grids, marketing copy.
Nobody is being sold anything — they want to know what's on.

---

## Copy

Plain and specific. "Starts in 3 hours" not "Upcoming event." Name things the way operators
do — "20m", "CW", "1800Z" — because the audience knows the vocabulary and dumbing it down
insults them.

Empty states are directions, not apologies: "No CW contests in the next 7 days. Try widening
the date range."

---

## Worker: what shipped

**2026-08-13.** `worker/` — one Cloudflare Worker serving both the API and the landing
view. Runs on the same `data/` catalog and the same `engine/src/recurrence.ts` as the
Python reference; nothing is forked or copied.

### Deviation: Worker-rendered HTML, not Astro + Pages

The brief's stack line says Astro + Cloudflare Pages with a separate Worker for the API.
**We shipped one Worker that server-renders the HTML instead.** Chosen deliberately:

- The landing view's entire content is *what is true right now*. Astro would either
  pre-render it (immediately stale) or defer to the client (a spinner, which the brief
  rules out). Rendering at request time in the Worker is neither.
- One deployable, one router, one place where `now` is read. The API and the page cannot
  disagree about what is live, because they call the same `buildNowView`.
- No framework, no hydration, no bundle. The page is correct and complete with JavaScript
  off — every time carries a UTC `datetime` attribute — and the client script only
  converts to local time and ticks countdowns. That is the brief's "local time by default,
  progressive enhancement" requirement satisfied by construction rather than by care.

D1 and KV are not used and are not needed yet: the catalog is 84 records inlined into the
bundle at build time, and expansion is memoised per year in the isolate. Revisit if the
catalog grows an order of magnitude or gains per-user state.

### What exists

| Route | What it serves |
| --- | --- |
| `/` | The Now / next-7-days landing view, server-rendered |
| `/api/health` | Active zone resolver, its self-check, catalog version. **503** if the self-check fails |
| `/api/meta` | Filter vocabularies and sponsor list |
| `/api/contests` | `?year=` or `?from=&to=`, with filters |
| `/api/contests/:id` | One contest: record, plain-language rule, next runnings |
| `/api/search?q=` | Name / sponsor / mode search |
| `/api/ics` | RFC 5545 feed, UTC instants only |

Still to build from the list above: filters and search **in the UI** (the API supports
both), the contest detail view, and deployment.

### The rail has one axis, declared once

The day ruler and the contest bars are separate boxes — a ruler, then a list of
rows — so the only thing holding a label above the bar it names is that both read
`--axis` in `theme.ts`. They did not, briefly: `.ruler` and `.row` each carried
their own `grid-template-columns`, a later `.ruler` rule won over the media query
at equal specificity, and the labels stretched across the whole card while the
bars stayed in the middle column. A contest at 2000Z Friday rendered under
Sunday's label — the chart was legible, confident and wrong by two days.

Three things keep it fixed, and all three matter: the template is declared in one
rule for both selectors; its lengths are fixed rather than content-sized, so two
grids reading it cannot resolve differently; and a test walks the stylesheet and
fails if `grid-template-columns` is ever set on `.ruler` or `.row` anywhere else.
Positions come from one exported `railFraction()`, which is asserted against the
percentages in the served markup — a chart drawn from a second copy of the
arithmetic is the same bug wearing different clothes.

**In Local mode the cells do not move; their names change.** The rail is sliced on
UTC midnights, and bars are instants, so switching zones must not shift anything —
but at 0304Z Friday a reader in New York is on Thursday, and a rail headed
"Today 14" names a day they have not reached. `dayCellLabel()` relabels each cell
with the local date it *begins* on; the client gets that exact function as source
rather than a second copy. Known residual: a cell labelled "Thu 13" in New York
actually spans 2000 Thursday to 2000 Friday local. Re-slicing the rail on local
midnights would fix it and would mean recomputing every bar client-side; not done,
and not obviously worth it.

### Two things building surfaced

- **The tests run inside workerd, not Node.** `worker/tests/parity.worker.test.ts` compares
  every field of every occurrence for 2026, 2027, 2030 and 2032 against the Python engine's
  output *in the runtime that serves requests*, and asserts the pinned resolver is the one
  actually active. The Python side is dumped by a Node-side `globalSetup`, since workerd has
  no child processes. It fails rather than skips when Python is unreachable, matching
  `engine/tests/parity.test.ts`.
- **`modes` in the catalog was not a controlled vocabulary.** Both `Digital` and `DIGITAL`
  appeared, alongside `PSK31`, `PSK63`, `RTTY75` and `FT4`; bands were free-text ranges
  like `160-10m` and `VHF+`, which nothing can filter on. **Fixed 2026-08-16** — see
  "Vocabulary: modes and bands" below.

### Vocabulary: modes and bands

Done 2026-08-16. Both fields are now controlled sets, declared once per engine and
asserted against the catalog by all three suites.

```
modes       CW · SSB · RTTY · Digital · FT8/FT4 · Mixed
bands       160m 80m 60m 40m 30m 20m 17m 15m 12m 10m 6m
            2m 1.25m 70cm 33cm 23cm 13cm 3cm
```

Two free-text companions carry what a controlled set deliberately cannot:

- **`submodes`** — "PSK31", "RTTY 75 baud". Displayed on the contest, never filtered on.
  A free-text field cannot be a filter; that is the whole reason it is separate.
- **`bands_note`** — a sponsor's own range or suggestion wording that a token list will not
  carry, e.g. "10 GHz through light".

Every record's `modes` come from the set, in the order the *sponsor* writes them — `CW/SSB`,
not the vocabulary's order — because a row should read the way the rules page reads.

**Empty `bands` means unrecorded, not unbanded.** One record is in that state today
(`sarl-hf-phone`; SARL's rules page has an expired certificate — see `data/sources.md`).
Every band filter necessarily excludes it, so the landing view names it in a `.caveat`
line with a link that clears the band filter. Silently dropping a record because we could
not read its source is the exact failure this project exists to avoid.

#### FT8/FT4 filters as its own mode *and* under Digital

The question the brief asked: does someone filtering "Digital" expect FT8 results? Yes —
and someone filtering "FT8/FT4" asked a narrower question and should get a narrower answer.
Both are satisfiable at once, because **a record says exactly what it is and the *filter* is
what widens.**

| Filter token | Matches records whose mode is |
| --- | --- |
| `CW` | CW, Mixed |
| `SSB` | SSB, Mixed |
| `RTTY` | RTTY, Mixed |
| `Digital` | Digital, RTTY, FT8/FT4, Mixed |
| `FT8/FT4` | FT8/FT4, Mixed |
| `Mixed` | Mixed |

Mixed is subsumed by every specific mode and subsumes none: a Mixed contest genuinely
permits CW, so a CW operator wants to see it; a CW-only contest is not what someone asking
for Mixed meant. RTTY is under Digital because it is one — but Digital is not under RTTY.

This replaced an earlier `modeFamilies()` that *inflated the record* rather than the query,
so the ARRL RTTY Roundup rendered as "RTTY/Digital" when ARRL's own rules permit RTTY only.
A row that overstates what a sponsor allows is worse than no row. `worker/tests/filters.worker.test.ts`
asserts each direction of the table, and that the page never prints the widened view.

### Section 3 shipped: filters and search

`worker/src/render/filters.ts`. A plain `<form method="get" action="/">`, which satisfies
four of section 3's requirements at once and satisfies them **with scripting off**:
submitting writes the state into the URL, so the view is shareable; reloading re-reads it;
the back button walks the history the browser already kept; and none of it needs a script.

- Mode, band and duration are checkboxes styled as chips. The input stays in the DOM at
  `opacity: 0` over its label — never `display: none`, which would take the whole form away
  from the keyboard and from every screen reader on a page where this form *is* the UI.
- Date range is a radio group plus a `from`/`to` pair; `?from=`/`?to=` beat `?range=`.
  An unknown `range` is a 400, not a silent default — a typo'd param that behaves like no
  filter is how someone believes they are looking at a filtered view and is not.
- Every control's `name` is the API's own, so the address bar is already a valid
  `/api/contests` query and a valid `/api/ics` subscription. "Subscribe to this view" is
  that fact made visible.
- `client.ts` adds exactly two things: it drops empty controls before submitting so the
  shared URL is the query someone made rather than every field on the form, and it submits
  on change — and only hides the Apply button once `form.requestSubmit` is proven to exist.
- **CSP: `form-action 'self'`, not `'none'`.** That header is load-bearing for the no-JS
  path, and a test says so.

Colour discipline holds: **AMBER IS TIME, CYAN IS CONTESTS.** The date-range chips light
amber; everything that selects contests — mode, band, duration, sponsor, search — lights cyan.

#### Empty states

Directions, not apologies. "No RTTY contests matching “zzzqx” in the next 12 months." then
one link that is the cheapest change likely to help: widen the range first, else drop one
facet in the order sponsor → search → duration → band → mode. Every such link is built by
`relink()`, which keeps the rest of the reader's query — a suggestion that silently resets
their other filters is not a direction.

Two rules the tests hold:

- The sentence names the **window the reader asked about**, not the seven-day rail it sits
  in. Telling someone who asked about twelve months that there is nothing "in the next 7
  days" answers a narrower question and implies results further down that do not exist.
- When the week is empty but later is not, the page points **down the page** rather than
  offering to widen a range that already contains what they want.

---

## Definition of done

Engine ported to TS with all tests green. Landing view, filters, search, contest detail and
iCal feed working. Deployed to Cloudflare Pages. Usable one-handed on a phone. Catalog
published under CC BY.

---

## What this is not

Not a club site, not a logging tool, not a scores database, not a social feature. One job:
find a contest to enter. Anything that doesn't serve that gets cut.
