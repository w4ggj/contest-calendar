# BUILD BRIEF — Front End

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Prerequisite:** read `HANDOVER.md` first
**Status:** **engine port DONE 2026-08-12.** `engine/` holds the TypeScript
engine, 152 mirrored tests green plus a cross-engine parity suite. Landing view,
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

`engine/` — `npm test` runs 152 mirrored tests and 13 parity tests. (116 at the
time of the port; 11 vocabulary tests were added on 2026-08-16, 25 CQ tests on
2026-08-16.)

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

*Shipped — see "Section 5 shipped: the iCal feed" below, including the horizon decision and
the one part of this that a local Worker cannot verify.*

### 6. Mobile

Build mobile-first, not responsive-after. The competition is desktop tables from 2003 and a
phone is where someone checks "what's on this weekend" from the couch.

*Shipped — see "Section 6 shipped: the mobile pass" below, including what was measured, the
five things it found, and what could not be tested without a phone in hand.*

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

### Section 5 shipped: the iCal feed

`worker/src/ics.ts` builds it, `handleIcs` in `worker/src/api.ts` chooses the window, and
`worker/tests/ics.worker.test.ts` proves it by **parsing the feed back** with an
RFC 5545 reader written from the spec rather than imported from the generator. A generator
checked with regexes against its own output tests that it does what it does; unfolding and
unescaping the stream into properties tests that a client can *read* it — which is the only
property that matters for a file nobody opens again after subscribing.

Served at `/api/ics` and at `/contests.ics`, same handler, and it accepts every parameter
the landing view does — `mode`, `band`, `duration`, `sponsor`, `q`, `entity`, `range`,
`from`/`to`, `year`. So the address bar is the subscription URL, which is what makes
"Subscribe to this view" a link rather than a feature.

#### The horizon: 30 days back, 365 days forward

Measured, not guessed. The whole feed runs ~651 bytes per event; the old two-year window
was **875 KB and 1,344 events**, and 395 days is ~700 events and ~455 KB.

Twelve months is where the feed becomes complete and stops becoming *more* complete. Every
contest in the catalog runs at least once a year, so a twelve-month horizon contains all 84
of them; a thirteenth month adds only second runnings of contests already present, at
roughly 100% of the size again. And the short windows fail the other way: a 90-day feed
hides CQ WW for nine months of the year, which breaks the one thing a subscriber wanted it
for. The 30 days of backfill exist so a contest you just worked is still there to look up.

Two window kinds, deliberately distinct:

- **Rolling** — no dated parameter, or a `?range=` preset. The subscription never expires;
  it moves with the clock. Cached one hour. A preset gets **no** backfill, or a feed
  labelled "Next 7 days" would carry five weeks of history and contradict its own name.
- **Snapshot** — `?year=`, or `?from=`/`?to=`. A fixed span: a download, not a
  subscription. Cached a day, since it only changes when the catalog does.

`X-WR-CALDESC` states which one you got, so two subscriptions in the same client are still
distinguishable six months later. `x-ics-window` and `x-ics-events` report it on the
response for anyone debugging without parsing the body.

#### What the three clients disagree about, and what we do instead

- **Expanded UTC instants, never `RRULE`.** "Fourth full weekend of June" is not an RRULE,
  and the nearest expressible thing (`BYDAY=SA;BYSETPOS=4`) is wrong in the 17 months
  across 2026–2035 where a month ends on a Saturday. Even where a rule *does* map, clients
  expand it themselves and disagree at the edges. Expanding here means the interpretation
  happens in the implementation that has a parity suite behind it, not in three that don't.
- **`Z` instants only — no `VTIMEZONE`, no floating times.** The clients disagree about
  VTIMEZONE; they agree about `Z`. A `local_rolling` contest has no UTC instant and is
  skipped rather than invented.
- **No `METHOD`.** It is an iTIP property (RFC 5546) belonging to scheduling messages. A
  subscription feed that declares one asks clients to treat contests as invitations from an
  organiser. The first version sent `METHOD:PUBLISH`.
- **`REFRESH-INTERVAL` *and* `X-PUBLISHED-TTL`**, both `PT12H` — the RFC 7986 spelling and
  Microsoft's older one, because clients honour one or the other.
- **`TRANSP:TRANSPARENT`.** A contest is not an appointment; opaque would make a subscriber
  look busy to their colleagues for 48 hours every November.

Three generator bugs fell out of writing the parser. `CATEGORIES` was being escaped as one
value, so a CW/SSB contest arrived as a single category literally named `CW\,SSB` — the
separator in a multi-value property is a **bare** comma. Folding counts octets, not
characters, because AGCW's names carry umlauts. And `handleIcs` had been ignoring every
range parameter: `?year=2026` was accepted and discarded, and the old test passed only
because today's date happened to sit inside the fixed window. Same failure the brief
already names for `?mode=` — a param that behaves like no filter.

#### Provenance travels with the event

The subscriber never sees the page, so an unverified date that looks identical to a
verified one is a confident wrong answer. `STATUS:TENTATIVE` and an `(unverified)` suffix
on the summary carry `verified: false` into the calendar's own vocabulary, and the
description spells it out. Same rule for the two fields that are commonly unrecorded:
`Bands: not yet read off the sponsor's own rules` and `Exchange: not recorded yet` — an
absent line reads as "no bands" and "nothing to send", which are different claims from "we
have not read it". 24 of 84 records carry no exchange today.

Each event's description carries sponsor, modes (with free-text `submodes`), bands (with
`bands_note`), duration, exchange, log deadline, and the sponsor's rules URL — which is
also a `URL` property, for clients that render a link button.

#### Subscribed for real: Google verified, Apple and Outlook still open

Every requirement those three clients place on the bytes is pinned by test and traceable to
a spec clause — folding and CRLF (§3.1), required properties (§3.6), TEXT escaping (§3.3.11),
UTC-form DATE-TIME (§3.3.5) — so a client disagreeing with this feed is that client's bug
rather than ours. But conformance is an argument, and the point of the check was to stop
arguing.

Deployed 2026-08-16 and subscribed in **Google Calendar**, then read back through the
Calendar API and compared with the bytes the Worker serves: instants, `STATUS`, `TRANSP`,
the escaped comma, the multi-line description, the calendar name and `X-WR-TIMEZONE:UTC`
all arrived intact across 699 events. **Apple Calendar and Outlook remain unchecked** —
both want an account signed in, which needs the person who owns the account.

It was worth doing, and the reason is the defect it found: durations were printing as
`Duration: 47.983333333333334h`. Every test passed, because every test asserted the feed
said what the generator computed, and it did. Nothing short of reading the rendered event
was going to catch that the number was unreadable. The feed now shares the page's
`humanDuration`, which also stops the two surfaces describing one contest two ways.

Second finding, for whoever debugs this next: **Google re-polls on its own schedule and
ignores `REFRESH-INTERVAL`.** Twenty minutes after the fix was deployed Google was still
serving the old description. Diagnose the generator by fetching the feed, never by looking
at a client.

---

### Design direction shipped: the panadapter

The palette this replaced was a cream `#F2F0EA` with a warm-brown accent, which is the first
of the three looks the `frontend-design` skill names as a default rather than a choice. It
was not chosen for band charts; it was the house style, and it read that way.

What replaced it takes one idea from the subject's own instruments and spends the whole
design on it: **the seven-day rail is a waterfall**. In dark mode the page is a receiver's
noise floor — `#050B12` blue-black, amber for time, cyan for anything you can operate — and
contests are traces on it. In light mode it is the same chart printed on paper: a cool
`#EDF1F6` band-plan white with a single-ink density ramp. Both are declared from one `LIGHT`
constant, interpolated into the two selectors that need it, with a test that the two copies
are byte-identical, because two hand-kept palettes drift on the first edit.

Three colour roles, and each one carries data rather than decorating:

- **Amber is time** — the UTC readout, the elapsed hatch, the countdowns.
- **Cyan is interactive** — anything the reader can operate, and nothing else.
- **The ramp is length** — `--d1`…`--d4` across the four duration buckets.

The ramp is the one that earns its place. Width alone already encodes duration on the rail,
but width *saturates*: a two-hour sprint across a seven-day rail is 1.2% wide, which is the
3px floor, and indistinguishable from a four-hour one. Colour is a second channel that does
not saturate, so a sprint and a weekend contest stay distinguishable at any zoom. The
duration filter chips carry the same four colours, which makes the filter the rail's legend
without a legend.

Two things this is *not* allowed to become. **The colour states the contest, not the bar.**
The rail's geometry is clamped to the seven-day window, so a 48-hour contest starting on the
last day draws as a 12-hour sliver; `data-d` comes from `durationBucketOf(duration_hours)`
and never from the drawn width, or the rail would tell the reader a 48-hour contest is a
12-hour one — the same overstatement the catalog rules forbid in `modes`. And **every bucket
must have a stop**: a fifth bucket added to `DURATION_BUCKETS` without a colour would inherit
the `--d2` default and silently mislabel itself, so `theme.worker.test.ts` fails the build
instead. That is the `CATALOG_MODES` lesson applied to colour.

Type stays on the system stack. The CSS and JS are inlined and the page has no round trip to
make; a webfont would add the one network dependency the design does not have, to a page
whose whole argument is that it is correct before anything loads.

#### Dark mode is three states, not a switch

`prefers-color-scheme` is honoured with no stored choice; Light and Dark override it; **Auto
gives control back**. A two-state toggle is a trap — flip it once and the page stops
following the system forever with no way back — so Auto is stored by *removing* the key,
because auto is the absence of a choice rather than a third value.

The media query is `:root:not([data-theme])`, not a bare `:root`. With a bare `:root` the
system's light preference and the reader's explicit dark choice sit at equal specificity and
source order decides, so on a light phone the Dark button does nothing — the switch appears
broken exactly where someone at 0300Z needs it. There is a test for this.

The stored choice is applied by a 160-byte synchronous script in `<head>`, not by the
deferred bundle at the end of `<body>`. A theme applied after first paint is a white flash at
0300Z, which is the thing the reader picked dark to avoid. The switch itself ships `hidden`
and is revealed by script, on the same rule as the UTC/local toggle: with no JavaScript
`prefers-color-scheme` is already being honoured, and an inert control would be the only
broken thing on a page that otherwise works completely.

---

### Section 6 shipped: the mobile pass

Audited at 320, 360 and 390 CSS px with the filter panel open: no horizontal scroll at any
width, no element crossing the viewport edge, and no control under 44×44 once touch sizing
applies. Five things it found, none of which were visible at desktop width:

1. **Every rail day label was clipped.** Eight labels across ~328px gives each 41px; "Today
   16" needs 58. Every label was being cut off, including the one naming today. Fixed by
   labelling alternate cells and letting each spill into its blank neighbour — the gridlines
   still mark all eight days, so nothing is lost but ink.
2. **The contest name was the smallest target on the page** — 25 per screenful at 21px tall,
   each one the link to the sponsor's rules this project exists to point at. Padding inline
   links out to 44px would space the schedule like a list of buttons and cost a row of
   contests per screen, so the hit area grows and the box does not: a 44px `::after`, centred,
   bounded horizontally by the link. Confirmed by hit-testing rather than by reading the CSS.
3. **Targets were tall enough and still too small**, because a target is an area: "UTC" came
   out 41.8px wide and the "CW" chip 35.7px. `min-height` alone was the wrong assertion.
4. **The elapsed reading sat on the hatch.** The label is right-aligned over the whole meter,
   so past ~75% elapsed the fill runs underneath it. A 730px desktop meter hides this; a
   343px phone made "74% elapsed" unreadable.
5. **The tally broke either way.** As a flex row the three counts measured 341px against
   313px of room, so "13 later this month" dropped to a line of its own and read as a
   separate fact; closing the gap until they fit ran the labels together into "ON THE AIR
   NEXT 7 DAYS LATER THIS MONTH". Three columns fixes both.

Touch sizing keys on `(pointer: coarse)`, not on width. A 13" laptop with a touchscreen needs
44px and a desktop at a narrow window does not, and width cannot tell them apart.

**What was not tested, and it matters.** No phone was available, so this was measured in the
live page's own bytes rendered at exact phone widths, not on hardware. That settles layout,
overflow and geometry. It does not settle: browser chrome and the dynamic viewport (`100vh`
under a collapsing URL bar), real thumb reach as against a measured 44px, iOS Safari's own
behaviours (rubber-band scroll, tap highlight, the ≥16px rule that stops it zooming on focus
— the filter inputs are 1rem, so this should hold, but "should" is the word), and how the
`(pointer: coarse)` rules actually feel under a thumb. Those need someone with a phone.

One measured thing that is a judgement call rather than a defect: the first contest row sits
about **555px** down a 780–820px screen, behind the masthead, the UTC readout and the
controls. That is the hero doing what the brief asked for, and it costs a scroll to reach
what the reader came for. Worth revisiting with a real user; not changed unilaterally here.

---

### Shipped: outbound links and three standing pages

**The contest name now opens in a new tab** (`target="_blank" rel="noopener external"`).
The reasoning is not politeness about leaving the site — it is that the reader's filters
live in the URL. Someone who narrowed to CW on 20m in October built that view by hand, and
navigating away in place discards it; coming back means rebuilding it or trusting the back
button to restore a form state it often does not. The `rel` is not optional either:
`_blank` alone leaves the sponsor's page a live `window.opener` handle on ours, which is the
best-known bug in the shape and invisible unless someone reads the markup — hence a test.

**`/about`, `/data`, `/contact` — pages, not a site.** Three questions get asked of a
calendar like this and none of them fit on a footer line: where do the dates come from, may
I use the data, and how do I report one that is wrong. Answering them on the landing view
would push the schedule below the fold, which is the one trade the design will not make.

They are deliberately **not** a nav bar. Someone arriving to find out what is on the air
right now should never land on prose, so `/` keeps the page to itself; the pages hang off
the footer and off each other, and each one carries a link back to the schedule. On a page,
its own entry stays in the list as plain text with `aria-current="page"` rather than
vanishing — the set of pages should read the same wherever you are standing.

They reuse the same `CSS` and the same synchronous `THEME_BOOT` (a reader who chose Light
should not get a dark flash on the way to `/about`) and ship no client bundle at all: there
is no clock to tick and no countdown to update. Cached an hour rather than a minute, because
nothing on them is a function of `now`. Their live numbers — records, verified, sponsors —
are read from the catalog at render time, so the prose cannot drift from the data.

`pages.worker.test.ts` pins both halves: that the pages exist and carry their own titles and
descriptions, and that they stay out of the way — the masthead links none of them, and none
of them grows a masthead of its own.

**The site now says what it is.** `<title>` was "… · Contest Calendar", which is the name of
roughly a dozen unrelated things; a title has no page around it to supply the context, and
it is what a search result, a bookmark and a pasted link all show. It is now
`SITE_NAME = "Amateur Radio Contest Calendar"` on every route including the 404, with the
live count still in front of it on the schedule, because a tab reading "3 contests on the
air now" is the one useful thing this page can say from the tab strip.

The masthead did **not** get the long name. The heading stayed two words and the subject
moved to a line beneath it — a heading that has to explain itself is doing the tagline's job
badly, and it is the element that wraps first on a phone. That line is also the page's only
`<h1>`, which it had been missing entirely.

Measured at 320 and 360: the full tagline wrapped to two lines and put 20px back on top of
the hero that the mobile pass had just taken off. Below 600px the provenance clause is
dropped and "Amateur radio contests" is what remains — the footer states the provenance again
on every page, and the half that survives is the half that says who the site is for. The
strip now sits at two lines on a phone, one fewer than before this change.

---

## Definition of done

Engine ported to TS with all tests green. Landing view, filters, search, contest detail and
iCal feed working. Deployed to Cloudflare — one Worker, not Pages; see the deviation above.
Usable one-handed on a phone. Catalog
published under CC BY.

---

## What this is not

Not a club site, not a logging tool, not a scores database, not a social feature. One job:
find a contest to enter. Anything that doesn't serve that gets cut.
