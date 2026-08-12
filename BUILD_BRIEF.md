# BUILD_BRIEF.md — World Contest Calendar (working name: `contests.tavaone.com`)

**Scope: every amateur radio contest worldwide, not just ARRL.**

## What this is

A modern amateur radio contest calendar built as a **recurrence rules engine**, not a
scraped table. Each contest is stored as a scheduling rule sourced from its sponsor's
own published rules. Dates for any year are computed on demand.

## Provenance — read this first

This project does **not** derive data from contestcalendar.com (WA7BNM). Their Terms of
Use prohibit both automated access and republication of their pages, and their
compilation is their work product. We respect that completely.

What we build instead is an **independent compilation from primary sources**: the
sponsors' own rules pages. Contest dates and times are facts owned by the sponsors, and
each sponsor publishes them. Every record in our catalog carries a `rules_url` pointing
at the sponsor, plus a `verified` flag and a `source_note` recording where the rule came
from.

**Hard rule for this project: never populate a record from a third-party aggregator.**
If we can't find it on the sponsor's own site, it stays `verified: false` and does not
ship to the public view. Non-negotiable — it's both the legal position and the reason
our data will be trustworthy.

WA7BNM remains the reference standard in this hobby. Link to it in the footer as a
courtesy. We are not trying to replace it; we're building a different, rules-driven
thing that happens to have a better UI.

## Why rules beat rows

- **Any year, instantly.** WA7BNM's perpetual calendar stops at 2035. Ours has no
  horizon.
- **Self-correcting.** When a sponsor changes a rule, one record changes and every
  future year is right.
- **Auditable.** Each date traces back to a rule that traces back to a sponsor URL.
- **Small.** The entire catalog is one JSON file, not a 500-row-per-year table.
- **Genuinely hard to get right**, which is the moat. See the "full weekend" note below.

### The full-weekend subtlety

A "full weekend" is a Sat/Sun pair with **both days inside the month**. When a month
ends on a Saturday, that Saturday does not begin a full weekend. This shifts dates in
**17 months across 2026–2035**. A naive "first Saturday of the month" implementation
generates wrong dates roughly twice a year and nobody notices until a contester misses
a contest. `recurrence.py` handles this; keep the test that proves it.

## Critical sourcing finding

**The ARRL Contest Corral is not an independent source.** ARRL states in the Corral
itself that the data is maintained on the WA7BNM Contest Calendar and extracted for
publication in QST. Same for SM3CER, DXZone, and club news reposts — all downstream.

There is no independent aggregate of world contests. WA7BNM is the upstream for the
entire hobby, ARRL included. That is why building globally means going society by
society, sponsor by sponsor. See `sources.registry.json`, which lists known-derived
sources explicitly under `known_derived_sources` so nobody reintroduces them later.

## Current state (delivered)

| File | Status |
|---|---|
| `recurrence.py` | Rules engine. Seven rule types: `nth_full_weekend`, `nth_weekday`, `fixed_date`, `monthly_nth_weekday`, `weekly`, `multi_weekend`, `manual`. Multi-session support. Computed log deadlines. |
| `contests.seed.json` | 32 definitions → **198 scheduled occurrences in 2026**. 22 verified at source (21 ARRL + RSGB IOTA). |
| `sources.registry.json` | **Global sponsor registry, 5 tiers.** ~60 organizations across Europe, Asia-Pacific, Americas, Africa. Scope estimate: ~310 contests, ~50 hours. |
| `validate.py` | **21/21 ARRL contests generate correctly from rules alone.** RSGB IOTA independently confirmed at Jul 25–26 2026. |
| `check_links.py` | Sponsor link checker. Per-host throttling, dedupe, retry on rate limiting. **30/32 links live**; the 2 failures are unsourced demo records. |

## Eligibility: tag, never delete

The catalog stores **every** contest worldwide and filters at display time. It does not
drop non-US contests at ingest. Three reasons:

1. A contest you can't *enter* is often still worth *working* — it puts activity on the
   band, and the other side wants your multiplier. Hiding RSGB AFS entirely means you
   never learn why 80m is busy on a January Saturday.
2. The open dataset's value depends on being global. A US-only catalog is far less
   useful to publish and nobody outside W/VE will contribute to it.
3. You travel and operate portable, and GCCC members run DXpeditions. Entity is a
   *view*, not a property of the data.

`eligibility_for(contest, my_entity)` returns a structured result, not a boolean,
because contests restrict participation in genuinely different ways:

| scope | meaning | example |
|---|---|---|
| `worldwide` | anyone may enter | CQ WW, RSGB IOTA |
| `entity_list` | only listed entities may enter | Sweepstakes (K/VE), RSGB AFS (G), SARL (ZS) |
| `two_sided` | all enter, each side works only the other | ARRL DX — W/VE work DX, DX works W/VE |

Plus a `practical` field for contests that are open but unrewarding from a given
location — IARU R1 VHF from Florida, 10 GHz microwave with no local activity. That's
advice, not a filter, and the UI should present it that way.

**The UI should default to "enterable from my entity" with a visible toggle**, and when
something is filtered, say *why*. `eligibility_reason` carries text like "Entry limited
to G. K stations may be worked but cannot submit an entry." Silently hiding contests is
how users lose trust in a calendar.

All eligibility tags are currently `verified: false` except RSGB IOTA. Entrant clauses
must be read off each sponsor's rules page during Phase 1 — do not ship the filter on
guessed data, because wrongly hiding a contest someone could have entered is the worst
failure this product can have.

## Rules links are the product, not a footnote

Every contest deep-links to the sponsor's own rules page. This is explicitly fine —
sponsors want the traffic, ARRL and RSGB both link out freely — and it's the right
architecture: we store the **facts** needed for filtering and scheduling, the sponsor's
page stays authoritative for the full rules, and nobody maintains 500 summaries in sync.

**Two sponsor URL styles, and getting this wrong rots half your links every January:**

- *Stable slugs* — ARRL keeps one URL per contest forever (`arrl.org/field-day`).
  Use `rules_url`.
- *Year-versioned paths* — RSGB publishes each season separately
  (`rsgbcc.org/hf/rules/2026/riota.shtml`). Use `rules_url_pattern` with a `{year}`
  placeholder; `resolve_rules_url()` fills it at render time so links stay live as
  years roll over.

Prefer the pattern whenever a sponsor versions by year. Also carry `rules_url_checked`
(last verification date) and `rules_url_archived` (Wayback snapshot) as a fallback for
sponsors that go dark.

**Run `check_links.py` monthly in CI.** You'll be pointing at ~60 volunteer-run society
sites; domains lapse and committees restructure. A dead rules link is the one failure
that makes the calendar worse than just reading the sponsor's site, so treat breakage as
a data-quality bug. Note the checker throttles per host — hitting one small server with
8 concurrent requests returns 503s that look exactly like broken links but aren't.

## Proven twice, on two continents

ARRL and RSGB both publish their recurrence rules in plain language and both publish
concrete dates. Encode the rule, generate the date, check it against their table:

- ARRL — 21/21 exact match against their 2026 date table
- RSGB IOTA — "the contest always takes place over the last FULL weekend of July"
  generates Jul 25–26 1200Z, matching RSGB's published 2026 dates

Two independent sponsors on two continents validating from rules alone is strong
evidence the model generalises. Every society in `sources.registry.json` publishes the
same way.

## Why the weekly/monthly rule types matter most

32 definitions produce 198 occurrences because CWops CWT alone is 156 (three sessions
every Wednesday). A large share of WA7BNM's ~500 entries are high-frequency recurring
events — CWT, SKCC Sprint, Spartan Sprint, NCCC Sprint, 4SQRP Second Sunday, K1USN SST.
**Encoding ~20 of these covers hundreds of calendar slots.** Do these before the long
tail of once-a-year regional contests; the coverage-per-hour is an order of magnitude
better.

## Phase 1 — Data foundation

1. **Port `recurrence.py` to TypeScript.** The engine is ~120 lines of date math with
   no dependencies. Keep `validate.py`'s test cases as a Vitest suite — that validation
   is the project's backbone, don't lose it.
2. **Verify the 8 CQ contests** against cqww.com, cqwpx.com, cq160.com, cqwwrtty.com.
   Flip `verified` to true and record the exact rule wording in `source_note`.
3. **Resolve the CQ 160 SSB edge case.** Strict "last full weekend of February" gives
   Feb 20–22 for 2026, but the contest is commonly listed as Feb 27–Mar 1. February's
   length makes the rule ambiguous. Read CQ's actual rules text and either fix our rule
   or add a `last_weekend_loose` rule type meaning "last Saturday in month" rather than
   "last full weekend." **Do not guess — this is exactly the kind of error that
   destroys trust in a calendar.**
4. **Expand the catalog globally**, working `sources.registry.json` top-down:
   - **Tier 4 high-frequency clubs first** — best coverage-per-hour by far (see above)
   - **Tier 1** majors: CQ's 8, RSGB's remaining ~24, DARC, JARL, WIA, RAC
   - **Tier 2** European societies: REF, UBA, VERON, SP, OK/OM, ARI, URE, and the rest
   - **Tier 3** rest of world: SARL, NZART, ORARI, LABRE, GACW, TRAC
   - **Tier 5** QSO parties, Florida first (GCCC relevance)

   Per contest: open the sponsor's rules page, extract dates/times/bands/modes/exchange/
   power categories/log deadline, record the recurrence rule *in the sponsor's own
   wording* in `source_note`, set `verified: true`. Write your OWN summary — never paste
   the sponsor's rules text. ~5-10 min each.

   `rsgb-iota` in the seed is the reference record showing every field populated.

5. **Add a `sources.md`** logging every sponsor URL consulted and the date checked.

## Phase 2 — API

Cloudflare Worker + D1, consistent with the rest of the stack.

```
GET /api/contests?year=2027              full year, chronological
GET /api/contests?from=&to=              arbitrary date range
GET /api/contests/:id                    single contest + its rule
GET /api/contests/:id/occurrences?n=10   next N occurrences
GET /api/ics?filter=...                  iCal feed (this is the killer feature)
```

Cache generated years in KV — the computation is deterministic, so cache aggressively
and invalidate only when the catalog changes.

Serve the whole catalog under an open license (CC BY 4.0 works) and publish the repo.
Nobody has built an open contest dataset; several searches confirm the gap. That's a
genuine contribution to the hobby and a much better outcome than another closed silo.

## Phase 3 — Front end

Astro + Cloudflare Pages. What makes it better than what exists:

- **Local time by default**, UTC toggle. The single biggest usability win. Every
  existing calendar is UTC-only and every operator does the mental conversion manually.
- **"What's on now / next 7 days"** as the landing view, not a wall of twelve months.
- **Filters that persist**: mode, band, duration, sponsor, contest size.
- **Personal subscription** → generated iCal feed URL. Set once, contests appear in your
  phone calendar forever.
- **Mobile first.** The existing options are desktop tables from 2003.
- **Countdown timers** on active and imminent contests.
- **Dark mode**, because contesters operate at 3am.
- Deep-link every contest to the **sponsor's own rules page**.

## Phase 4 — Integrations

- Feed GCCC's site (`gulfcoastcontestclub.org`) — a club calendar widget off our own API
  with no third-party terms to worry about.
- Cross-link LogStats (`stats.tavaone.com`): "you worked 412 QSOs in this contest last
  year" next to each entry. **This is the thing nobody else can do** — the combination
  of calendar and personal log history is genuinely novel and it's the reason to build
  this rather than just using WA7BNM.

## Open questions

- Domain: `contests.tavaone.com` vs. standalone? Leaning subdomain for now.
- Do we ever want to accept community submissions for the long tail? Adds moderation
  burden but is the only realistic path to 500 contests.
- Should the open dataset live under TavaOne Education's nonprofit umbrella? Fits the
  educational mission and makes the CC BY license a natural fit.

## Definition of done for Phase 1

Rules engine ported with tests green, all CQ entries verified or resolved, Tier 4
high-frequency clubs encoded, Tier 1 complete, GCCC's target list covered,
`sources.md` complete, catalog published under CC BY.

## Running note on rules text

Sponsors' rules are copyrighted by the sponsors — ARRL's site states reproduction
without written permission is prohibited, and CQ, RSGB and DARC are equivalent. So the
catalog stores **facts** (dates, times, bands, modes, exchange, power limits, log
deadlines) and **our own summaries**, with `rules_url` linking to the sponsor for the
authoritative text. This is both the correct legal posture and the better product:
structured fields are filterable and searchable in ways prose never is.
