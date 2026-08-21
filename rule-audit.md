# Rule Audit — stored recurrences vs sponsors' wording

**For:** Joe Leone, W4GGJ
**Date:** 2026-08-21
**Against:** `data/contests.seed.json` at commit `3d5f3bb` — **230 contests, 222 verified**
**Brief:** `CONTESTCLOCK_GAP_AUDIT.md` §4
**Companion:** `gap-report.md`

---

## Headline

**No incorrectly encoded recurrence rule was found.** Across 230 records I found zero cases
where the stored rule contradicts the sponsor's own wording.

That is a real result rather than a shrug, because the audit was built to find exactly the bug
the brief predicted and it looked in the places where that bug would hide.

It found two other things instead, and the second is worse than the one the brief sent me
looking for:

1. A **provenance** defect in twenty records — rules that are correct but whose stored evidence
   does not show it (§5). Worth fixing because the next person to doubt one has to redo the work
   I just did.
2. An **expiry cliff**: **26 contests stop producing any occurrence at all on 1 January 2027**,
   and two records are dark already (§7.1). Nothing in the data or the tests surfaces this. A
   wrong rule shows a contest on the wrong day; an expired one shows nothing, on a calendar that
   still looks complete.

---

## 1. Method, and why it is not 230 web fetches

Re-fetching every sponsor page would be the obvious approach and it would be the wrong one: it
costs 230 network round trips, it re-reads pages that were read days ago, and it spends the same
effort on a rule that cannot be wrong as on one that is a coin flip. So the audit runs in two
phases.

**Phase 1 — local, exhaustive, no network.** `scratchpad/audit1.py` ranks every record by how
*falsifiable* its rule is, plus three provenance checks:

- **A. Live ambiguity.** For each ordinal rule, compute whether it diverges from its nearest
  plausible mis-encoding within the next twelve years. "4th" vs "last" is the pair the brief
  names; "last full weekend" vs "last Saturday" is the pair that actually bites, and both are
  tested. A rule stored as `n: 4` in a month that never has five weekends is unfalsifiable and
  cannot be wrong in any year anyone will see; a rule that diverges in 2027 is a dated liability.
  **29 of 230 records have live ambiguity.** The other 201 cannot diverge before 2038.
- **B. Family asymmetry.** Sibling records — two legs of one contest, or two contests off one
  rules page — encoded with different rule types.
- **C. Hedged source, hard rule.** The sponsor's quoted wording hedges ("generally", "varies",
  "third or fourth") but the record stores an exact recurrence.
- **D. Thin provenance.** `verified: true` with a `source_note` too short to contain a quoted
  rule, or with no `rules_url_checked`.

**Phase 2 — targeted verification** of what phase 1 flagged, at sponsors' own sites.

**Coverage, stated honestly.** The ARRL family (13 records) was re-verified against ARRL's own
page today. The 29 live-ambiguity records were each audited against their recorded provenance,
and five were read in full. The remaining ~190 records rest on the `source_note` written when
they were encoded; this audit did not re-fetch them, and does not claim to have.

---

## 2. The ARRL family — 13 of 13 correct

The brief's §4 gives ARRL as a rule family to check ("ordinal, never 'last'"). I fetched ARRL's
own **Generic ARRL Contest Calendar**, which states each event's recurrence in words, and
compared it mechanically against every stored rule.

> The Contest Corral on the same page was **not** used. ARRL states it is generated from
> WA7BNM's data, so it is a derived source and the registry lists it as such. The generic
> calendar is ARRL describing its own contests, which is primary.

| Contest | ARRL's own wording | Stored | |
|---|---|---|---|
| Field Day | *"Fourth full weekend in June"* | `nth_full_weekend n=4` | ✅ |
| RTTY Roundup | *"First full weekend of January, but never on January 1"* | `n=1` + `exclude_dates [[1,1]]` | ✅ |
| International DX CW | *"Third full weekend in February"* | `n=3` | ✅ |
| International DX Phone | *"First full weekend in March"* | `n=1` | ✅ |
| International Digital | *"First full weekend in June"* | `n=1` | ✅ |
| June VHF | *"Second full weekend in June"* | `n=2` | ✅ |
| September VHF | *"Second full weekend of September"* | `n=2` | ✅ |
| IARU HF | *"The second full weekend of July"* | `n=2` | ✅ |
| Sweepstakes CW | *"First full weekend in November"* | `n=1` | ✅ |
| Sweepstakes Phone | *"Third full weekend in November"* | `n=3` | ✅ |
| 10 Meter | *"Second full weekend in December"* | `n=2` | ✅ |
| 160 Meter | *"First full weekend in December"* | `n=1` | ✅ |
| Kids Day (June) | *"Third Saturday in June"* | `nth_weekday n=3 wd=5` | ✅ |

**Zero mismatches**, including the two the brief singles out: Field Day is `n: 4`, not "last",
and RTTY Roundup carries the never-January-1 exclusion ARRL states in words.

`arrl-january-vhf` is the one ARRL record with a hedged rule — ARRL writes *"The third or fourth
weekend in January"* — and the catalog already handles it correctly: stored as `n: 3` with
`verified: false` and a note saying ARRL states third **or** fourth. A hedge in the source is
being carried as a hedge in the record, which is the right behaviour.

---

## 3. The 29 ambiguous records — 26 show their working

For each record whose rule can diverge from a rival encoding before 2038, I checked whether its
own prose engages with the rival reading and cites sponsor-published dates. Twenty-six do, and
several are better evidenced than anything this audit could have added. Representative:

- **`cq-wpx-cw`** quotes CQ's 2016 rules PDF verbatim — *"CW is the last full weekend of May"* —
  notes that CQ dropped the sentence after 2016 and now publishes only dates, and records that
  the rule still reproduces **eleven** CQ-published runnings 2016–2026, including 2025 (May
  24–25, *not* the May 31 last Saturday).
- **`uba-dx-ssb`** is stored as last **Saturday**, not last full weekend, because UBA writes
  *"starts every year on the last Saturday of January"* — and 2026 proves it: UBA published
  31 January–1 February, which only the last-Saturday reading produces.
- **`frr-yo-dx-hf`** quotes FRR in both English and Romanian (*"the fourth full weekend of
  August"* / *"Al patrulea weekend intreg al lunii August"*) and notes that August 2026 has five
  full weekends, so fourth and last differ — and FRR's own announcement says the fourth.
- **`podxs-pskfest`** and **`podxs-40m-firecracker`** encode *"1st Saturday following January
  1st"* / *"after July 1st"* with `exclude_dates`, cross-checked against the club's own projected
  date table for 2026–2035 — which covers 2028, the exact year the encodings diverge.
- **`ure-rey-de-espana-ssb`** quotes URE's *"4rd full weekend of June"* — reproducing URE's own
  typo as written — and resolves the ordinal against the date URE prints beside it.

The three that did not clear the bar are `arrl-field-day`, `arrl-rtty-roundup` and `rsgb-iota`,
and all three are §5's provenance problem rather than rule problems: Field Day and RTTY Roundup
were re-verified against ARRL today, and `rsgb-iota` quotes RSGB rule 2 correctly
(*"the contest always takes place over the last FULL weekend of July"*) in a note that is merely
short.

---

## 4. Family asymmetries — all three are correct, and two are deliberate

| Family | Asymmetry | Verdict |
|---|---|---|
| CQ 160 | CW is `nth_full_weekend n=-1`; SSB is `nth_weekday n=4` | **Correct.** See below. |
| NAQP | CW/SSB are `multi_weekend`; RTTY is `composite` | **Correct and documented** — the registry calls NAQP RTTY "the catalog's proof that 'last Saturday' and 'last full weekend' are different rules". |
| RSGB | SSB Field Day is `nth_weekday`; FT4 Activity Day is `manual` | **Correct** — different contests, and the FT4 day has no derivable ordinal. |

**I flagged the CQ 160 asymmetry as a possible bug in the gap report. It is not, and I retract
that.** CQ publishes dates and no recurrence wording for *either* leg — eleven archived rules
pages 2016–2026 were read and none contains a rule. Each leg was therefore independently fitted
to CQ's published dates, and the two legs genuinely follow different patterns: the CW leg
reproduces as last full weekend of January (including 2026's Jan 24–25, not the Jan 31 last
Saturday whose Sunday falls in February), and the SSB leg as the fourth Saturday of February
(2026: Feb 27, which is neither the last full weekend nor the last Saturday). Both records say
so in their notes. The asymmetry is the finding, correctly recorded.

---

## 5. The actual defect: twenty records verified on provenance that proves nothing

This is what the audit found instead of rule errors, and it is the thing worth acting on.

### 5.1 Seventeen ARRL records carry a ~30-character `source_note`

Every ARRL record seeded in the first pass has a `source_note` reading essentially **"ARRL
generic contest calendar"** — 28 to 72 characters, no quoted rule, no quoted times. They are all
marked `verified: true` and `rules_url_checked: 2026-08-11`.

The rules are right; I checked all thirteen rule-bearing ones against ARRL today (§2). But
"verified" is supposed to mean *the sponsor's wording is recorded in the record*, per
`HANDOVER.md`: *"record the rule in the sponsor's own wording in `source_note`"*. These records
assert the conclusion without the evidence, which means the next person to doubt one has to redo
the fetch — as I just did.

Affected: `arrl-straight-key-night`, `arrl-rtty-roundup`, `arrl-dx-cw`, `arrl-dx-ssb`,
`arrl-rookie-roundup-ssb`, `arrl-digital`, `arrl-june-vhf`, `arrl-kids-day-jun`,
`arrl-field-day`, `arrl-iaru-hf`, `arrl-rookie-roundup-rtty`, `arrl-september-vhf`,
`arrl-sweepstakes-cw`, `arrl-sweepstakes-ssb`, `arrl-160m`, `arrl-10m`,
`arrl-rookie-roundup-cw`.

**This is the audit's strongest support for the brief's own framing.** The 222-of-230
verification rate is not measuring what it appears to measure for these seventeen: it records
that someone looked, not what they saw.

### 5.2 Three SARL club records have an **empty** `source_note` and `verified: true`

`sarl-club-80m`, `sarl-club-40m`, `sarl-club-20m`. Zero characters of provenance, yet verified.
Their sibling SARL records all cite the 2026 SARL Contest Manual properly, so this looks like
three records that lost their note rather than three that never had one — but as they stand
there is nothing in them to check a rule against.

This is a stricter defect than §5.1: an empty string is not thin evidence, it is no evidence,
and a test could reasonably refuse to let `verified: true` coexist with it.

---

## 6. Two things I flagged earlier and now withdraw

Recorded because a retracted flag left standing becomes folklore.

1. **CQ 160 CW/SSB asymmetry** — withdrawn, §4.
2. **ARRL Kids Day "Generally"** — I flagged that ARRL's `/kids-day` page hedges with
   *"Generally the first Saturday in January, and the third Saturday in June"* while the record
   stores an exact rule. ARRL's generic contest calendar states it without the hedge —
   *"Third Saturday in June"* — so the stored June rule matches ARRL's own unhedged wording.
   The hedge is still worth knowing for the **January** record proposed in `gap-report.md`,
   where the generic calendar lists no January running at all.

---

## 7. Not audited, and what would close it

- **~190 records were not re-fetched.** They rest on their existing `source_note`. On the
  evidence of the 40 that were examined closely, the ones written in the last week are
  substantially better sourced than the original seed — the defect in §5 is concentrated in the
  earliest pass, which is what you would expect.
- **2027/2028 sponsor-published dates**, which the brief asks for, were used where the sponsor
  publishes them (WW Digi 2027–2029, PODXS 2026–2035). Most sponsors do not publish beyond the
  current year, so for those the check is against the sponsor's stated *rule* plus back-years.
- **Non-ordinal rule types** — `composite`, `multi_weekend`, `sessions` — were not systematically
  audited. They are less prone to the "4th vs last" class by construction.

### 7.1 The expiry cliff — a second bug class, and it is already live

`manual` records carry a risk the brief does not anticipate and this audit was not looking for:
they produce **nothing** for a year not in their `dates` map, and nothing about a record's face
says when it runs out. Measured across the whole catalog:

| | Records producing occurrences |
|---|---|
| 2026 | **220** of 230 |
| 2027 | **194** of 230 |

**Twenty-six contests go dark on 1 January 2027.** Twenty-five `manual` records hold 2026 dates
only — the four UBA Spring legs, the four UBA ON legs, both NCJ Sprints, all five ARSI records,
all four UARL records, `ure-eartty`, `erau-es-ll-kv`, `lrmd-wal`, `sarl-top-band-qso`,
`rca-nacional-80m` and `rsgb-ft4-activity-day` — plus `rac-canada-winter` and `uba-bma`, whose
date maps end at 2026.

This is not a mis-encoding. Every one of those records is *correct*: the sponsor published one
year and the record holds exactly that, which is this project's discipline working as designed.
The defect is that correctness has an expiry date and nothing surfaces it.

**Two records are already dark and nothing says so:**

- **`rca-nacional-40m`** holds dates for **2025 only**, with no `active_until`. It produces zero
  occurrences in 2026 and zero in 2027. It is on a public calendar showing nothing, and no field
  distinguishes "this contest ended" from "nobody has added this year's date".
- **`srr-russian-dx`** holds **2027 only**. It is invisible for the whole of 2026.

`NEEDS_A_HUMAN.md` §4 already tracks "RDXC, UARL, RCA, REP FT4, ORARI YB DX RTTY" as annual
one-line additions, so the *practice* is known — but it is tracked as a chore, not as a dated
liability, and the number attached to it is 26, not five.

**Suggested, not done:** a test that fails when a `manual` record's latest date falls in the
current year and `active_until` is unset. That converts a silent disappearance into a build
failure in the year before it matters, which is the same move `test_registry_coverage_is_current`
already makes for the coverage block.

---

## 8. Proposed fix — prepared, not applied

`scratchpad/fix_arrl_provenance.py` upgrades the seventeen `source_note` fields in §5.1 to quote
ARRL's own wording, with `rules_url_checked` moved to 2026-08-21. It changes **no rules** — every
recurrence stays exactly as it is, because every one of them is right. The diff is a
provenance-only change and the test suites should be unaffected.

The three empty SARL notes in §5.2 need the contest manual re-read and are not in that script.

**Nothing has been applied. `data/contests.seed.json` is unchanged since the WW Digi commit.**
