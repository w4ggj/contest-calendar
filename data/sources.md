# Source Log

Every contest record must trace to a sponsor's own rules page. Log each source here
when you verify it, so the catalog stays auditable as it grows.

## Verified

| Date | Sponsor | URL | Contests | Rule in sponsor's own words |
|---|---|---|---|---|
| 2026-08-11 | ARRL | arrl.org/contest-calendar | 21 | Generic calendar states each recurrence in plain language. All 21 validated against ARRL's own 2026 date table. |
| 2026-08-11 | RSGB Contest Committee | rsgbcc.org/hf/rules/2026/riota.shtml | 1 | "the contest always takes place over the last FULL weekend of July" |
| 2026-08-11 | CWops | cwops.org | 1 | "four one-hour QSO party-type tests on Wednesday 1300Z and 1900Z, Thursday 0300Z and 0700Z" |
| 2026-08-11 | K1USN Radio Club | k1usn.com/sst.html | 1 | "held twice weekly at 0000Z Mondays and 2000Z Fridays" |
| 2026-08-11 | Straight Key Century Club | skccgroup.com | 2 | WES: "1200 UTC on the 2nd Saturday of each month... ends at 2359 UTC on Sunday". SKS: "fourth Wednesday of each month starting at 0000 UTC" |
| 2026-08-11 | National Contest Journal | ncjweb.com/NAQP-Rules.pdf | 3 | CW: 2nd full wknd Jan, 1st full wknd Aug. SSB: 3rd full wknd Jan, 3rd full wknd Aug. RTTY: **starts last Saturday in February**, 3rd full wknd Jul |

## Corrections found during verification

- **CWops CWT had three sessions encoded; the correct number is four.** The Thursday
  0700Z session was missing, dropping ~52 sessions a year. Fixed and pinned by test.
- **"Last Saturday" and "last full weekend" are different rules.** NAQP RTTY starts on
  the last Saturday in February — Feb 28 in 2026, whose Sunday falls in March, so it is
  explicitly *not* the last full weekend (Feb 21). Required a new `composite` rule type.
  **This very likely resolves the CQ 160 SSB ambiguity below.**

## Pending verification

- **CQ Magazine** (8 contests) — cqww.com, cqwpx.com, cqwpxrtty.com, cqwwrtty.com, cq160.com
  - **CQ 160 SSB edge case.** Strict "last full weekend of February" yields Feb 20–22 for
    2026, but the contest is commonly listed Feb 27–Mar 1. Given the NAQP RTTY precedent,
    CQ's rule is probably "last Saturday" rather than "last full weekend" — but **read
    CQ's actual rules text before changing it.**
- **ARS Spartan Sprint** — no reachable sponsor URL found during research. Confirm the
  anchor (first Monday US local = Tuesday UTC?) and session times.
- **RSGB AFS CW** — guessed rules filename returned 404. Find the real page under
  rsgbcc.org/hf/ and set `rules_url_pattern`. Recurrence and eligibility unconfirmed.
- **SARL HF Phone** — sarl.org.za returned 503 (may be transient). Confirm recurrence and
  whether DX entries are accepted.
- **IRTS 80m Counties** — recurrence and entrant restrictions unconfirmed.
- **All eligibility tags except CWT / SST / SKCC / NAQP / IOTA** — inferred, not read.
  Confirm entrant clauses before shipping the eligibility filter.
