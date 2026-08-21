# Gap Report — contests missing from the catalog

**For:** Joe Leone, W4GGJ
**Date:** 2026-08-21
**Against:** `data/contests.seed.json` at commit `d4b31f1` — **229 contests, 221 verified**
**Brief:** `CONTESTCLOCK_GAP_AUDIT.md`, with §3 superseded — see §1.

---

## 0. Four premises in the brief that did not survive contact with the repo

Stated before anything else, because two of them change what the deliverables can be.

**There is no D1, and no database of any kind.** The brief's first method step is to dump the
D1 schema. I checked `worker/wrangler.toml`, every config file and every source file: the only
mention of D1 anywhere in this repository is inside the brief itself. There is no
`d1_databases` binding, no `D1Database` type, no migrations directory. The Worker imports
`data/contests.seed.json` as a module and the bundler inlines it; `CLAUDE.md` states this
outright — *"There is no D1, no KV, and no Astro."* So there is no production database to avoid
writing to. **The equivalent risk is `data/contests.seed.json`**, which is the deployed data,
and I have not modified it. See §7.

**The catalog holds 229 contests, not 145.** And 221 are verified, not 138. Whatever produced
"145 (138 verified)" is not this repo in its current state — the last four days added Africa,
Asia, Oceania, South America and eleven RSGB contests. The gap is real but it is smaller than
the brief assumes, and the shape of it is different.

**WA7BNM cannot be scraped, and the brief's method step 3 says to scrape it.** Two independent
reasons. WA7BNM's Terms of Use prohibit automated access and republication. And this project's
one non-negotiable rule, in `HANDOVER.md`, is *"Never populate a contest record from an
aggregator. Only from the sponsoring organisation's own published rules page."* The registry
already lists WA7BNM, ARRL's Contest Corral (which ARRL states is generated from WA7BNM data),
SM3CER, DXZone and qrpcontest.com under `known_derived_sources`. The brief's own §2.5 agrees —
verify at the sponsor, never the aggregator — so this affects **how the candidate list was
built**, not what gets recorded. Everything below was built from sponsor-side knowledge and
verified at sponsors' own sites. No aggregator was read.

**The predicted engine bug does not exist.** §4 hypothesises that `last full weekend` and
`nth full weekend` "collapse into a single code path". They do not. `nth_full_weekend` takes a
signed `n`, where `n = -1` means last and `n = -2` the one before it, and the ordinal and
last-relative forms are the same well-tested path with different indices. Spot-checking the
brief's own reference table against the catalog: ARRL Field Day is `n: 4` (correct per the
brief), and CQ WW SSB/CW/RTTY, CQ WPX SSB/CW and CQ 160 CW are all `n: -1` (correct). The
brief's table also contains one error of its own — see §5. Whether every one of the 229 stored
rules matches its sponsor's wording is the separate question the rule audit answers, and I have
not started it.

---

## 1. Scope: mode-agnostic

The brief's §3 filtered on operator preference — exclude CW-only, phone/digital leg only. **That
is superseded.** The dataset is a public resource and must be mode-agnostic: CW-only contests
are in, and every leg of a split-mode event is its own entry.

What that changed in this report. Nothing was ever dropped from collection *reporting* — I read
the original filter as governing what to add, never as licence to remove the 88 existing CW-only
records from a public site. But it did narrow two entries to their phone legs, and it did stop
me pursuing CW-only candidates. Both are now corrected: **SAC CW and JIDX CW are promoted from
flagged to recommended** (their sponsors' wording was already in hand), and collection was
re-run across the CW-only field, which added **Stew Perry** and **CWops CW Open** below.

The only exclusion criteria now in force are the three you named: **defunct, duplicate, or
unverifiable at a sponsor source.** §3 and §4 are what those criteria caught.

**Split-mode legs are already complete.** I checked all four families the correction names, and
every leg is present as its own record: `arrl-dx-cw` / `arrl-dx-ssb`; `cq-ww-cw` / `cq-ww-ssb` /
`cq-ww-rtty`; `cq-wpx-cw` / `cq-wpx-ssb` / `cq-wpx-rtty`; `arrl-sweepstakes-cw` /
`arrl-sweepstakes-ssb`. No additions needed, and adding any would be a duplicate.

---

## 2. Verified additions — recommended

Every row was read at the sponsor's own site today. "Sponsor's wording" is quoted from the
sponsor's page, which is what makes these encodable under this project's rules.

| # | Contest | Sponsor | Modes | Sponsor's own recurrence wording | Bands | Source |
|---|---|---|---|---|---|---|
| 1 | **World Wide Digi DX Contest** | WWROF + Slovenia CC | FT4/FT8 | *"Contest is always the last full weekend of August."* | 160·80·40·20·15·10 | [ww-digi.com](https://ww-digi.com/rules/) |
| 2 | **Florida QSO Party** | Florida Contest Group | SSB, CW | *"Starts the last Saturday of April."* | 40·20·15·10 | [floridaqsoparty.org](https://www.floridaqsoparty.org/rules/) |
| 3 | **FT Roundup** | rttycontesting.com | FT4/FT8 | *"First full weekend of December."* | 80·40·20·15·10 | [rttycontesting.com](https://www.rttycontesting.com/ft-roundup/rules/) |
| 4 | **Winter Field Day** | Winter Field Day Association | SSB, CW, digital | *"the 4th full weekend of January"* | HF/VHF/UHF | [winterfieldday.org](http://winterfieldday.org/) |
| 5 | **Scandinavian Activity Contest, SSB** | NRAU | SSB | *"2nd full weekend of October each year"* | 80·40·20·15·10 | [sactest.net](https://www.sactest.net/blog/rules/) |
| 6 | **Scandinavian Activity Contest, CW** | NRAU | CW | *"3rd full weekend of September each year"* | 80·40·20·15·10 | [sactest.net](https://www.sactest.net/blog/rules/) |
| 7 | **Japan International DX, Phone** | JIDX Contest Committee | SSB | *"2nd full weekend of November"* | 160·80·40·20·15·10 | [jidx.org](https://jidx.org/jidxrule-e.html) |
| 8 | **Japan International DX, CW** | JIDX Contest Committee | CW | *"2nd full weekend of April"* | 160·80·40·20·15·10 | [jidx.org](https://jidx.org/jidxrule-e.html) |
| 9 | **ARRL Kids Day (January)** | ARRL | SSB | *"Generally the first Saturday in January, and the third Saturday in June"* | 80·40·20·17·15·12·10 | [arrl.org/kids-day](http://www.arrl.org/kids-day) |
| 10 | **Stew Perry Topband Challenge** | Boring Amateur Radio Club | CW | **none published** — four dated runnings a year | 160 | [kkn.net/stew](https://www.kkn.net/stew/stew_rules.html) |
| 11 | **CWops CW Open** | CWops | CW | 2026 date published; recurrence **not** quoted | 160·80·40·20·15·10 | [cwops.org](https://cwops.org/cwops-tests/cw-open/) |

### Which of these the project already knew about

This matters for how you read the list, so it is stated up front rather than buried. I checked
every row against `data/sources.registry.json`.

**Six are genuinely untracked** — absent from the registry entirely, no entry, no note, not
counted in any `estimated_total`: **WW Digi** (WWROF appears nowhere), **FT Roundup**, **Winter
Field Day**, **JIDX** (both legs), **SAC** (both legs), and **Kids Day January**. These are the
seeding-bias gap the brief predicted, and they are the real find.

**Four were already tracked as known gaps**, and presenting them as discoveries would be false:
the **Florida QSO Party** is named in `tier_5_qso_parties` as local priority for GCCC;
**Stew Perry** has its own tier-4 entry at `status: not-started` with a note that it "runs
multiple times per year, so it needs either multiple records or a legs array"; and **CW Open** is
covered by the CWops entry's "CW Open not started". Their value here is that they now have
sponsor-verified rules attached, which they did not before.

### Notes that matter per row

**1 — WW Digi.** The one the spot check found, and the highest priority: **it runs in eight
days, 1200 UTC Sat 29 August → 1159 UTC Sun 30 August 2026.** Two things about it are worth
your attention independently of this audit, both confirmed against the sponsor's current rules:
*"A human operator must initiate calling each QSO partner. Autonomous systems or robots that
emulate this action are prohibited"* — relevant to an unattended FT8 station — and the log
deadline is now **48 hours**, *"no later than 2359 UTC September 1, 2026"*. That deadline is a
change: the sponsor's own 2024 rules PDF said *"WITHIN FIVE (5) DAYS."*

**2 — Florida QSO Party.** Sponsor's wording is **"last Saturday of April"** — a
last-*Saturday* rule, not a last-full-weekend one. It is also **not a digital contest**: *"No
digital QSOs are allowed in the FQP."* Two sessions, not one block — Sat 1600Z–Sun 0159Z and
Sun 1200Z–2159Z — so it needs the `sessions` array.

**3 — FT Roundup.** One data-quality caveat: the rules page **names no sponsoring
organisation**, and this catalog requires a `sponsor`. The page also still shows 2023 dates
against a general recurrence sentence, so it wants a re-read nearer December.

**5, 6 — SAC, and a discovery worth more than the two contests.**
`data/sources.registry.json` records **NRAU as `blocked`, with nothing encoded**, on the basis
that `nrau.net` says its contest information is "under revision". That is true of `nrau.net` —
and NRAU's flagship contest publishes complete rules at a different domain, `sactest.net`,
including standing recurrence wording for both legs. The blocked status was reached by looking
at the right organisation's wrong URL. The page I read is headed SAC 2023, so the current-year
page should be confirmed before encoding, but the recurrence sentences are stated as standing
rules ("each year").

**9 — Kids Day.** The catalog has `arrl-kids-day-jun` and no January record, from a sponsor
whose own page says the event is held twice a year. Note ARRL's hedge — *"Generally"* — which
the existing June record does not carry; that belongs in the rule audit, not here.

**10 — Stew Perry, and why it cannot be an ordinal.** Four runnings a year, 160 m CW, each
1500z for 24 hours, grid-square exchange. The rules page publishes **explicit dates and no
recurrence wording at all** — March 14, June 20, October 17, December 26. All four are
Saturdays but no single ordinal describes them, so under this project's discipline this is a
`manual` record holding exactly what the club published, the same treatment the NCJ Sprints
already get. It needs a second year of the club's own dates before any rule could be claimed.

**11 — CW Open.** Three separate 4-hour sessions on one day (0000–0359z, 1200–1559z,
2000–2359z), which is what the `sessions` array is for. The sponsor publishes the 2026 date
(September 5) but I did not find a quoted recurrence sentence on the page, so this needs either
a second sponsor-published year or a `manual` encoding. Do not fit "first Saturday of September"
to one date.

---

## 3. Excluded — defunct

**North American Sprint, SSB.** The catalog has the CW and RTTY Sprints and no SSB one, which
looks exactly like a gap. It is not. NCJ's current rules document is titled *"Rules: 2026 North
American Sprint (CW/RTTY)"* and the most recent SSB Sprint results on NCJ's own site are from
**2011**.

I verified this independently and then found the project had already established it: the NCJ
registry entry reads *"CORRECTION: NCJ NO LONGER RUNS AN SSB/PHONE SPRINT."* So this is a
confirmation, not a finding — but it is still the clearest illustration in this report of why
the sponsor-first rule earns its cost. A name-based diff against any aggregator's historical
list produces this as a confident false positive, and would put a contest on the calendar that
has not run in fifteen years.

## 4. Excluded — duplicate

Nothing. The four split-mode families named in the correction were checked and are already
complete at leg level (§1).

---

## 5. One error in the brief's own reference table

§4 lists **"CQ 160 (last full weekends of Jan and Feb)"**. That is wrong for the SSB leg, and
the catalog already knows why in detail.

`cq-160-ssb` is stored as `nth_weekday, month 2, n 4, weekday 5` — the **fourth Saturday of
February** — and its `source_note` records that eleven archived CQ 160 rules pages from 2016 to
2026 were read and **none of them contains any recurrence wording at all**; CQ publishes dates,
not rules. CQ's own 2026 announcement is *"SSB: 2200Z February 27 to 2200Z March 1"*. The last
full weekend of February 2026 is the 20th–21st. Encoding CQ 160 SSB the way the brief's table
describes would put it **a week early in 2026**.

So the bug class §4 warns about is real, and this catalog has already been bitten by it and
already fixed it — in the opposite direction from the one the brief predicts.

One genuine inconsistency did fall out of looking: the **CW** leg is stored as
`nth_full_weekend, n: -1` while the SSB leg is stored as a weekday ordinal, and the source_note
saying CQ publishes no recurrence applies to both legs equally. Either the CW leg has evidence
the SSB leg does not, or it is an ordinal fitted to dates. **That is a rule-audit item and I
have not touched it.**

---

## 6. The category-level finding, which is bigger than the list above

The brief's hypothesis is a seeding bias toward ARRL and CQ. The evidence supports something
more specific, and in three directions.

**There are zero US or Canadian state/province QSO parties in 229 records — and that is a
decision, not an oversight.** `tier_5_qso_parties` exists in the registry at
`status: not-started`, `estimated_total: 50`, names the Florida QSO Party first under
`local_priority`, and records the reasoning: *"this tier is 50 more US contests. The catalog is
already 71% North American, so working tier 5 before tiers 2 and 3 would make the imbalance
worse, not better."* It even carries `index_for_discovery_only` pointing at stateqsoparty.com
with a note that it is an aggregator.

So the largest empty category in the catalog is empty **on purpose**, and the brief's
seeding-bias hypothesis does not explain it. If you want the Florida QSO Party specifically —
your home state, and already flagged as local priority — that is a one-record decision you can
take now without reopening the sequencing question. Taking the whole tier is the thing the
registry argues against, and I would want that argued explicitly rather than absorbed into a
gap-closing pass.

**The bias is not only across sponsors — it is within them.** Kids Day January is missing from a
sponsor with 21 encoded records. That is not a "non-ARRL/non-CQ sponsor was never in the input
set" failure; it is an incomplete read of a sponsor that *was*. Worth a targeted pass over the
worked sponsors asking "what else is on this page", which is cheap because the pages are known.

**And one `blocked` entry is blocked for the right reason about the wrong scope.** The NRAU
entry is accurate as far as it goes: `nrau.net` really does say its contest information is under
revision, and its `estimated_total: 3` covers NRAU-Baltic and the Nordic Activity Contests, none
of which publish rules. But NRAU also organises the **Scandinavian Activity Contest**, which
publishes complete rules with standing recurrence wording at `sactest.net` — and SAC appears
**nowhere** in the registry, not in NRAU's estimate and not as an entry of its own. The failure
was not mis-reading the block; it was that a blocked organisation stopped being asked what else
it runs. The other blocked and deferred entries deserve the same question: CRAC, SRS, FRR, IARC
Holyland.

---

## 7. Candidates identified but **not** verified

Listed so they are not lost, and marked clearly because none has been read at its sponsor's
site. **Nothing here is encodable as it stands.**

EU HF Championship · UK/EI DX Contest (both legs) · Ukrainian DX Contest · YOTA Contest ·
International FT Challenge · FT8 Activity Days · CDXA FT8 · Makrothen RTTY · Volta WW RTTY ·
TARA contests · Feld Hell Club sprints · ANARTS WW RTTY · CQ WW VHF · ARI Marconi Memorial HF ·
FOC Marathon · NAQCC sprints · OK1WC Memorial · the ~45 state QSO parties above.

---

## 8. Proposed migration — prepared, not applied

Per your instruction, nothing has been written to the deployed data. `data/contests.seed.json`
is unmodified and the working tree is clean apart from this report.

The migration is a script following the same pattern as every sourcing pass in this repo
(`scratchpad/add_rsgb.py` and its siblings): it appends records, then `scripts/coverage.py`
regenerates the registry's counts and the mirrored tests are added in the same commit. It is
**ready for WW Digi only** — the one you said to add regardless — and the diff is in the chat
message accompanying this report.

The remaining ten need a decision from you before I write them, because five carry open
questions: FT Roundup has no named sponsor, SAC needs its current-year page, Winter Field Day's
UTC times were not on the page I read, and Stew Perry and CW Open both need a second
sponsor-published year before their recurrences can be anything but `manual`.

**Nothing is committed and nothing is deployed.**
