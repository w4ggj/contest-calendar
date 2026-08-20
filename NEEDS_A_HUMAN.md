# NEEDS A HUMAN

**For:** Joe Leone, W4GGJ
**Updated:** 2026-08-20

Everything in this file is blocked on **you** rather than on more work. It is deliberately
short: anything Claude can do — reading sponsor pages, encoding records, writing tests,
deploying — is not here. If an item appears here, it is because it needs your credentials,
your hardware, your callsign on an email, or a reply that only a sponsor can give.

Roughly ordered by value. **The letters are the biggest single lever** — seven of them would
unblock about sixteen contests and settle seven flagged records.

---

## 1. Two things only you can do

### 1.1 Verify the iCal feed in Apple Calendar and Outlook

**Why you:** both require an account signed in, and handing credentials around is not something
to do on anyone's behalf.

Google Calendar was verified end to end on 2026-08-16 — 699 events, instants, `STATUS`,
`TRANSP`, the escaped comma and the multi-line description all intact. Apple and Outlook are
the two remaining clients, and they are the two that historically disagree about `VTIMEZONE`
and `RRULE` — which is exactly why the feed emits neither.

**To do:** subscribe to `https://contest-calendar.jleone0.workers.dev/api/ics`

- **Apple Calendar:** Calendar → File → New Calendar Subscription
- **Outlook:** Add calendar → Subscribe from web

Then open `CQ Worldwide DX Contest, CW` on 28 November 2026 and check five things:

| What | Expected |
|---|---|
| Start / end | 28 Nov 00:00 UTC → 29 Nov 23:59 UTC, not shifted into local time |
| Status | Tentative *only* if the row says "unverified" — CQ WW is verified, so it should be busy/confirmed |
| Free/busy | Shows as **free**, not busy — a contest is not an appointment |
| Summary | Reads `CQ Worldwide DX Contest, CW` with **one** comma, no backslash |
| Duration line | `47h 59m`, not a raw decimal |

**Worth doing because:** the identical check on Google found a real bug — durations printing as
`Duration: 47.983333333333334h` — that every test passed over, because the tests asserted the
feed said what the generator computed, and it did.

**If something is wrong:** fetch the feed and read the bytes; never diagnose the generator from
what a client displays. Google re-polls on its own schedule and ignores `REFRESH-INTERVAL`, so
allow a day before concluding a fix did not take.

### 1.2 Open the site on an iPhone

**Why you:** needs the hardware. The Android pass on 2026-08-19 closed everything that is not
browser-specific — dynamic viewport, thumb reach, how the touch sizing feels — and the detail
view came through clean.

Three iOS Safari behaviours remain, and about two minutes settles all three:

1. **Does it zoom when you tap a filter input?** Check this first. The inputs are `1rem`, which
   should clear Safari's 16px threshold — but "should" is the word, and a page that zooms on
   focus has thrown away your place in the schedule.
2. **Rubber-band scroll** at the top and bottom of the schedule.
3. **Tap highlight** on the contest links — the grey flash Safari paints on tap.

---

## 2. Six letters

A club officer's reply **is** a citable primary source in this project, on exactly the same
footing as a rules page — provided it is recorded with **the person's name and the date**. That
is the whole reason these are worth writing.

### 2.1 QRP ARCI — sent 2026-08-19, awaiting reply ⏳

**To:** Larry Makowski, W2LJ — `contest@qrparci.org`
**Unblocks:** 8 contests. The largest single gap in the catalog that is not a whole continent.

Their rules exist only in *QRP Quarterly*, the members' magazine. `qrpcontest.com` has all of
it laid out beautifully and is an aggregator that links WA7BNM, so it cannot be used.

**When the reply comes:** hand it over and it is about an hour's work. It gets recorded in each
`source_note` with W2LJ's name and the reply date. **Do not send a second one.**

### 2.2 South America — three societies, and the highest-value letters after QRP ARCI

**Unblocks:** the thinnest region in the catalog, at 3 records.

The 2026-08-19 pass established that this is not a reading problem. Three national societies
are live, well-maintained and simply **do not publish contest rules on the web**:

- **Radio Club Uruguayo** — `cx1aa.org` (publishes awards and activity programmes, no contests)
- **Liga Colombiana de Radioaficionados** — `lcra.org.co`
- **Radio Club de Chile** — `ce3aa.cl`

**Ask each:** do you run contests, and where are the rules published? If they have none, that is
a useful answer too — it closes the region honestly rather than leaving it looking unworked.

### 2.3 GACW (Argentina) — ask for a text version

**Unblocks:** 1 contest (the WWSA CW DX Contest), and it is South America again.

Their WWSA rules are published as **scanned images with no text layer**. Ask for a text or
Word version, or for the rules pasted into an email.

### 2.4 SARL — three questions in one email

**To:** `contest@sarl.org.za` (the SARL Contest Working Group)
**Unblocks:** 1 contest, and upgrades two flagged records.

SARL's manual is the best-documented source in the catalog, and three things in it are
genuinely ambiguous:

1. **Does the Youth of the Air Contest still run?** Its only PDF on the site is the 2024
   edition and it appears nowhere in the 2026 Contest Manual — not the rules, not the date
   list, not the `.ics`. The evidence points at a contest you have stopped running, but that is
   an inference from an absence.
2. **Top Band QSO Contest — which reading of "the first full week of June"?** A
   Monday-to-Sunday week wholly inside June puts the 2027 running on Thursday **10** June; the
   first week containing the whole Thursday-to-Sunday block puts it on the **3rd**. They agree
   in 2026 and diverge next year. Also: the rules prose says the contest starts "22:01 UTC 4
   June (00:01 CAT) Thursday 4 June", but 22:01 UTC Thursday is 00:01 CAT **Friday** — the date
   table says Wednesday 3 June, which is self-consistent and is what the calendar follows.
3. **Who may enter the Club Contests?** The manual states no participation clause, but the
   exchange requires an Abbreviated Club Callsign derived from an **ICASA-issued** callsign, so
   a station outside South Africa appears to have no valid exchange to send. Those three
   records say ZS-only and flag it as our reading rather than yours.

### 2.5 TRAC (Turkey) — one question

**Unblocks:** upgrades the one Turkish record from `verified: false`.

TRAC states *"Temmuz ayının ilk hafta sonu"* — the first weekend of July. That reproduces their
published 2024, 2025 and 2026 dates but **not 2023**, when 1 July was itself a Saturday and
TRAC ran the contest a week later, on 8–9 July.

**Ask:** what happens when July opens on a Saturday? The calendar currently assumes the
contest moves a week, which fits all four of their published dates but is our inference. It
next matters in **2028**.

### 2.6 ARSI (India) — two questions

**Unblocks:** upgrades three records' eligibility from unverified.

1. **The 40M CQ VU contests contradict themselves.** Both pages say *"Any licensed ham can
   participate in the contest"* and then, four lines later, *"Though this contest is only for
   VU, any DX contacts in the log will get 2 QSO multiplier points."* The calendar assumes
   entry is VU and DX may be worked. Which is right?
2. **The VU Rookie Contest** states no participation clause at all — only that the objective is
   encouraging newly-licensed operators "in India". Open to all, or VU only?

### 2.7 RSGB — three questions in one email

**To:** the RSGB HF Contest Committee, via `rsgbcc.org`
**Unblocks:** 1 contest, upgrades 2 flagged records, and settles a rule.

Eleven RSGB contests are encoded and ten are verified. These three are what four years of
RSGB's own published dates could not settle:

1. **The Commonwealth Contest (BERU) — where is the list of Commonwealth Call Areas?** The
   rules restrict entry by *"the Commonwealth Call Area from which they are operating"* and do
   not enumerate the areas on that page. Everything else about the contest is clean — second
   weekend of March, Saturday 1000 to Sunday 1000 UTC, CW on 3.5/7/14/21/28 MHz, confirmed
   against 2023–2026. It is not encoded because writing an eligibility list would mean
   assembling one from elsewhere and attributing it to RSGB.
2. **The FT4 International Activity Day — is Easter the reason?** RSGB ran it on the first
   Saturday of April in 2023, 2024 and 2025 and on the **second** in 2026. Easter Sunday fell on
   5 April 2026, which would have put the first Saturday on Easter Saturday. If the contest
   avoids Easter, that is a rule with an exception and the record becomes a recurrence rather
   than a single stored date. If it does not, the record stays as it is, correctly.
3. **The Low Power Contest — may stations outside the UK&CD enter?** The rules say only that
   *"UK&CD entrants must be RSGB members"* and nothing about anyone else. RSGB's results archive
   separately lists an *"International Low Power Contest"*, which raises the question of whether
   this one is the domestic contest. The calendar currently records it as open to all and flags
   that as an absence of words rather than a statement.

### 2.8 Smaller ones, worth batching if you are writing anyway

| Who | Ask | Unblocks |
|---|---|---|
| **AGCW** — `zap-merit@agcw.de` | The ZAP Merit Contest publishes no **closing time**. What is the session length? | Upgrades a `verified: false` record whose stored end is a labelled placeholder |
| **CRK (Czech Republic)** | `okomdx.crk.cz` and `okrtty.crk.cz` serve a certificate issued for `default.web4u.cz`, so HTTPS fails. Please fix. | Lets three records move from `http://` to `https://`, and stops `check_links.py` reporting them |
| **Czech Radio Club** | Who organises the **OK DX RTTY Contest**? Neither the English nor the Czech rules page names a society; we inferred CRK from the hosting and the log address. | Confirms an attribution that is currently a guess |
| **CRAC (China)** | Who runs the **Worked All Provinces of China DX Contest**, and where are its rules? CRAC's own site has no contest section at all. | 2 contests, and Asia is thin |

---

## 3. One lookup you can do in a minute and Claude cannot

### 3.1 Two WIA band lists, trapped in PDFs

**Unblocks:** 2 contests — **Ross Hull Memorial (Marathon)** and the **VHF-UHF Field Days**.

Both recurrences are already known and confirmed against WIA's own printed dates:

- **Ross Hull** — the month of January, scored on the entrant's best seven days
- **VHF-UHF Field Days** — 1st full weekend of January, 3rd weekend of June, 3rd weekend of
  September, all 0100 UTC Saturday to 0059 UTC Sunday

Neither page carries a **band list**; both defer to a rules PDF, and those PDFs yield no text
to the extractor written for this project. That is a limitation of the tool, not of the source
— a PDF reader shows them immediately.

**To do:** open these two and copy out the bands (and the entry sections, if they are handy):

- `wia.org.au/members/contests/rosshull/` → "ROSS HULL CONTEST (MARATHON) RULES VER 1.1.pdf"
- `wia.org.au/members/contests/vhfuhf/` → "2026 Winter VHF-UHF Field Day Rules.pdf"

Paste them over and both records go in immediately. **They are deliberately not encoded with
guessed bands** — a VHF record with invented bands is worse than no record.

---

## 4. Watch and re-check, with dates

Nothing to do now. Each of these is a sponsor who publishes late or one edition at a time, and
each has a moment when checking is worthwhile.

| When | What | Why |
|---|---|---|
| **Feb–Mar 2027** | `iarc.org/holyland/` | IARC's Holyland page is a placeholder reading "The content of this page will be updated before Holyland contest". The contest runs in April, so it should be published by then. 1 contest. |
| **When CQ publishes 2026 rules** | `cqww.com/rules.htm` | Still serving the 2025 set; the 2026 PDF is a 404. CQ WW CW and SSB keep the 5-day log deadline the 2025 rules state, while CQ's other three contests moved to 48 hours. Recheck, do not guess. |
| **Each January** | DARC's 10 m Ausschreibung | The recurrence is quoted from a superseded document DARC still publishes. The two agree for 2026, but a future edition could change the rule without changing that retained text. |
| **Annually** | RDXC, UARL, RCA, REP FT4, ORARI YB DX RTTY | All publish one edition at a time. Their records hold exactly what was published and produce nothing beyond it, which is correct — but each new announcement is a one-line addition. |
| **Whenever** | NRAU | `nrau.net` says its contest information is "under revision". Nothing encoded. 3 contests when it returns. |
| **Whenever** | SRS domestic contests, FRR "La Mulți Ani YO" | Blocked the same way: a JavaScript-only page and a scanned PDF respectively. |

---

## 5. What is *not* here, on purpose

These are Claude's to do and need nothing from you — listed only so the boundary is clear:

- **More sourcing.** About 50 contests remain readable behind known-good sources: RSGB (14,
  down from 21 on 2026-08-20), SRR (7), MRASZ (6), DARC (5), IARU (5), IRTS (3), SKCC (3),
  and a dozen others.
- **Deploying.** `npx wrangler deploy` from `worker/`, already authorised and routine.
- **The REP FT4 schema question** — whether to add per-date times so a series with three
  editions at two different clock times can be one record. A design decision, not a human one.
- **Encoding whatever these letters bring back.**
