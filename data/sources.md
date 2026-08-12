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
| 2026-08-11 | National Contest Journal | ncjweb.com/Sprint-Rules.pdf | 2 | "CW: 0000 until 0359 UTC, February 8, 2026"; "RTTY: 0000 until 0359 UTC, March 15, 2026"; September, "(NOTE CW DATE SHIFT)", CW Sep 13 and RTTY Sep 20. "These four contests are entirely separate 4-hour Sprints." Eligibility: "Any amateur radio licensee may enter." |
| 2026-08-11 | Northern California Contest Club | ncccsprint.com/rules.html, /rttyns.html, /ft4ns.html | 3 | CW NS: "0230-0300 UTC Fridays (Thursday evening NA time, DST ignored)". RTTY NS: "RTTY NS time is always 0145-0215 UTC" and "practices are held each Thursday afternoon-evening". FT4 NS: "start time is 0100 UTC — 45 minutes BEFORE the regular RTTY NS begins" |
| 2026-08-11 | 4 States QRP Group | 4sqrp.com/SSS/sss_rules_revised_02_2026.pdf | 1 | "The SSS is held the second Sunday night of every month (local time). It runs for two (2) hours from 7 PM until 9 PM central time (CST or CDT, whichever is in effect at the time)." Eligibility: "Anyone can participate" |
| 2026-08-11 | Adventure Radio Society | ars-qrp.com/Spartan_Sprint/Spartan_Sprint.html | 1 | "Held on the first Monday of every month"; "EASTERN 8:00 p.m. to 10:00 p.m. Local"; "(Does not shift for DST — This event is always at these Local Times)"; "open to all QRP CW operators — there is no membership requirement" |

## Corrections found during verification

- **CWops CWT had three sessions encoded; the correct number is four.** The Thursday
  0700Z session was missing, dropping ~52 sessions a year. Fixed and pinned by test.
- **"Last Saturday" and "last full weekend" are different rules.** NAQP RTTY starts on
  the last Saturday in February — Feb 28 in 2026, whose Sunday falls in March, so it is
  explicitly *not* the last full weekend (Feb 21). Required a new `composite` rule type.
  **This very likely resolves the CQ 160 SSB ambiguity below.**
- **ARS Spartan Sprint was anchored on the wrong weekday.** It was encoded as the first
  *Tuesday* of the month. ARS's rule is the first *Monday* US local, which falls on
  Tuesday UTC — and those diverge by a full week whenever the 1st is a Tuesday. That is
  September and December 2026, both of which the old encoding placed a week early.
  Re-anchored on the first Monday with a +1 day offset; pinned by test.
- **NCJ no longer runs an SSB/Phone Sprint.** The handover listed the North American
  Sprint as CW/SSB/RTTY. NCJ's 2026 rules document is titled "Rules: 2026 North American
  Sprint (CW/RTTY)" and the Sprint page carries only CW and RTTY rules, team
  registration, log upload, results and records. Only CW and RTTY records were created;
  no SSB record was invented. NCJ's contests index does still carry the sentence "Each
  contest occurs in three flavors, CW, SSB and RTTY" — that is stale copy covering NAQP
  as well, and is contradicted by the Sprint materials themselves.
- **NCJ publishes Sprint dates, not a Sprint recurrence rule.** Rule 4 lists explicit
  dates and flags September 2026 with "(NOTE CW DATE SHIFT)". The 2026 dates land on the
  2nd Sunday (CW) and 3rd Sunday (RTTY), but that is an observation, not NCJ's rule, so
  both records use the `manual` rule type and generate nothing for years NCJ has not
  published. A test asserts that silence.
- **Two more local-time contests found.** 4SQRP SSS and ARS Spartan Sprint both publish
  US local times only. 4SQRP says outright that the UTC time moves with CST/CDT; ARS says
  the event "does not shift for DST", which has the same consequence. Both are flagged
  `local_time: true` with the UTC shift spelled out in `note`. This makes the local-time
  engine gap the highest-value remaining engine work, not an edge case.

## Pending verification

- **CQ Magazine** (8 contests) — cqww.com, cqwpx.com, cqwpxrtty.com, cqwwrtty.com, cq160.com
  - **CQ 160 SSB edge case.** Strict "last full weekend of February" yields Feb 20–22 for
    2026, but the contest is commonly listed Feb 27–Mar 1. Given the NAQP RTTY precedent,
    CQ's rule is probably "last Saturday" rather than "last full weekend" — but **read
    CQ's actual rules text before changing it.**
- **RSGB AFS CW** — guessed rules filename returned 404. Find the real page under
  rsgbcc.org/hf/ and set `rules_url_pattern`. Recurrence and eligibility unconfirmed.
- **SARL HF Phone** — sarl.org.za returned 503 (may be transient). Confirm recurrence and
  whether DX entries are accepted.
- **IRTS 80m Counties** — recurrence and entrant restrictions unconfirmed.
- **All eligibility tags except CWT / SST / SKCC / NAQP / IOTA** — inferred, not read.
  Confirm entrant clauses before shipping the eligibility filter.
