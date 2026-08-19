# BUILD BRIEF — Source Monitor

**For:** Claude Code
**Repo:** `C:\GitHub Repositories\contest-calendar`
**Prerequisite:** read `HANDOVER.md` first
**Status:** not started

---

## What this is

A monthly cron Worker that watches every sponsor's rules page and reports what changed.
One email a month, listing what needs a human to look at it.

## What this is explicitly NOT

**It does not update the catalog.** It flags; a person decides.

That boundary is the point, not caution. Every correction this project has produced came
from a person reading a sponsor's page:

- ARRL 10 GHz moved from local time to UTC, with an explicit note saying so. Recognising
  that as a model change rather than a time edit required understanding what "operator-
  anchored" meant.
- "Third full weekend of August and September" reads as a typo until you realise it's one
  rule covering two rounds.
- RTTY Roundup carried `["RTTY", "Digital"]` while ARRL's text says RTTY only. Catching
  that meant comparing a claim to a permission.
- NAQP RTTY's "last Saturday in February" is a different rule from "last full weekend" and
  only diverges some years.

An LLM asked to apply those changes automatically would produce plausible, wrong records —
and `verified: true` would stop meaning "a person read the sponsor's page," which is the
only thing that flag has ever meant. Do not add an auto-apply path. Do not have the monitor
write to `contests.seed.json`.

---

## What it checks

### 1. Content change

Fetch each distinct `rules_url` / resolved `rules_url_pattern`, hash the extracted text,
compare to the stored hash. Report changed pages.

Hash extracted text, not raw bytes — session IDs, ad slots, "last updated" stamps and CSRF
tokens will otherwise mark every page changed every month and the report becomes noise
nobody reads. Strip scripts, styles and comments; normalise whitespace. Expect to iterate
on this: a monitor that cries wolf gets ignored, which is the same failure as a test that
can't fail.

Store the previous extract alongside the hash so the report can include a short diff. "This
page changed" sends you re-reading the whole thing; "this page changed, here are the lines"
is a ten-second triage.

### 2. Link rot

Fold in `scripts/check_links.py`'s logic. Same per-host throttling — you're hitting ~60
volunteer-run servers and a burst of concurrent requests returns 503s that look exactly like
dead links.

### 3. Stale verification

Flag any record whose `rules_url_checked` is more than 12 months old. This is the cheapest
defence against silent staleness — a rule that changed while nobody was looking.

### 4. Long-unchanged pages

A page unchanged in 3+ years is either a stable contest or an abandoned site. Worth a quiet
list, not an alert. Cross-reference with link rot: unchanged *and* erroring is a strong
signal the contest is gone.

### 5. Unverified backlog

Count of `verified: false` records, so the number stays visible rather than drifting.

---

## Delivery

Resend, same as your other properties. One email a month.

Lead with counts, then detail:

```
6 sponsor pages changed
3 links broken
12 records not verified in over a year
9 records still unverified
```

Changed pages get the diff. Nothing changed, no email — or a one-line all-clear, your call,
but silence should mean silence rather than a failed cron.

**Report cron failures too.** A monitor that stops running looks exactly like a monitor
reporting nothing wrong, and that's the failure mode that matters most.

---

## Implementation notes

Separate Worker with its own cron trigger — don't attach it to the site Worker. Different
lifecycle, different failure modes, and you don't want a monitor bug taking the calendar
down.

Storage: KV is the right fit here, unlike the year-caching case. Small values, infrequent
writes, no precision concerns — hashes and text extracts, not `Date` objects.

Be a good citizen: throttle per host, set a descriptive User-Agent identifying the project
and a contact, and spread the fetches rather than hitting 60 servers at once. These are
volunteer-run sites doing us a favour by publishing rules at all.

Reuse the catalog as the source of truth for what to check — the monitor should have no list
of its own, or the two drift.

## Tests

- Extraction is stable across cosmetic markup changes and detects real content changes.
- A record over 12 months stale is flagged; one under is not.
- Per-host throttling holds.
- **The monitor cannot write to `data/contests.seed.json`** — assert this. It's the whole
  boundary, so pin it rather than trusting it.

## Definition of done

Monthly cron running, one email with the five sections, diffs on changed pages, cron
failures reported. No write path to the catalog.
