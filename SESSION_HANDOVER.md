# SESSION_HANDOVER.md

**Purpose:** move this working session to another machine. Read this once, then read
`HANDOVER.md` — which is the project's own "start here" brief and is *not* this file.
Two different documents, deliberately:

| file | answers |
| --- | --- |
| `HANDOVER.md` | what the project is, where it stands, what to build next |
| `SESSION_HANDOVER.md` | how to get a second machine to the state the first one is in |

Written 2026-08-19, from the machine that produced commit `972330c`.

---

## Where the work stands

Branch **`worker-landing-view`**, at **`972330c`** — *"Finish Tier 2 Europe: twelve
societies, eleven languages, 26 contests"*. Pushed to
`https://github.com/w4ggj/contest-calendar.git`. `main` was 12 commits behind and 0 ahead;
this session merged `worker-landing-view` into `main` with a merge commit, so both refs now
carry the same tree.

**Nothing is half-finished.** The Tier 2 Europe pass is closed: engine change, catalog,
registry, both test suites, `data/sources.md` and the doc counts all landed in one commit,
and all six checks were green before it. There is no work-in-progress to reconstruct.

Catalog as of this commit:

```
171 contests encoded, 164 verified at source, 8 retired by sponsor
777 occurrences for 2026

Europe 85 (49.7%) · North America 62 (36.3%) · Oceania 13 · Asia 5
International 4 · Africa 1 · South America 1

tier_1  8/8 orgs worked      tier_2  19/21      tier_3  5/11      tier_4  13/15
```

---

## Bring a new machine up

```bash
git clone https://github.com/w4ggj/contest-calendar.git
cd contest-calendar
git checkout worker-landing-view      # or main -- same tree after the merge
```

Then three installs, none of which are in git:

```powershell
# 1. Python. Runtime is stdlib-only; the venv exists for pytest and for tzdata.
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 2. The engine's dev dependencies (node_modules is gitignored)
npm --prefix engine install

# 3. The Worker's
npm --prefix worker install
```

Built on **Python 3.12.8** and **Node v24.15.0**. Nothing depends on those exact versions,
but they are what the numbers below were measured against.

### Verify you actually arrived

Run all six. The expected values are exact, not approximate — every one of them is
asserted somewhere, so a mismatch means the machine is wrong, not that the numbers drifted.

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest -q                  # 311 passed
python scripts\validate.py           # ARRL 2026 rule-engine validation: 21/21 match
python scripts\coverage.py --check   # Registry coverage is current.
python scripts\check_links.py        # ~172 live, 1-3 broken -- see "In flight" below
npm --prefix engine test             # 324 passed (311 mirrored + 13 parity)
npm --prefix engine run typecheck    # silent
npm --prefix worker test             # 141 passed
npm --prefix worker run typecheck    # silent
```

**The venv must be active for the TypeScript suites too.** Both parity suites shell out to
`python scripts/dump_occurrences.py` using whatever `python` is first on PATH. On Windows a
bare system `python` has no `tzdata`, so `zoneinfo` raises and the suites fail — they fail
rather than skip, deliberately: a parity check that skips looks green while proving nothing.

---

## What does not come across in git

Everything here is either gitignored or local, and all of it regenerates:

- **`.venv/`** — recreate as above.
- **`engine/node_modules/`, `worker/node_modules/`** — `npm install` in each.
- **`worker/tests/fixtures/`** — gitignored on purpose. `worker/tests/global-setup.ts`
  regenerates it from the Python engine on every `npm test`, because workerd has no child
  processes and a committed copy could go stale against an engine that had since changed.
- **`.wrangler/`** — local dev state.
- **`worker/.claude/settings.json`** — this machine's tool-permission allowlist. Untracked,
  and `.claude/` is now in `.gitignore` so it stays that way. Nothing depends on it.
- **Wrangler auth.** `npm --prefix worker run dev` works offline, but `deploy` needs
  `npx wrangler login` on the new machine. The deployed site is
  <https://contest-calendar.jleone0.workers.dev>.
- **The sourcing scratchpad.** The 86 sponsor pages and PDFs downloaded during the Tier 2
  Europe pass lived in the session's temp scratchpad and are gone. They are not needed: every
  quote taken from them is in `data/sources.md` with its URL, which is the point of that file.
  Re-fetch from `rules_url` if a record needs re-reading.

---

## In flight, and deliberately not fixed

**`oceaniadxcontest.com` came back.** It stopped answering on 2026-08-19 and was live again
later the same day, so the two Oceania DX Contest records need nothing. They were left
unchanged throughout, which was right: a sponsor's server being down is not evidence its rule
changed.

**Only SARL fails consistently** — a long-standing expired-certificate blocker with its own
entry under "Pending verification". Everything else that `check_links.py` reports comes and
goes between runs: two consecutive runs on 2026-08-19 reported ARI's 40/80 page and then
ARRL's 10 GHz page, and `curl` got 200 from ARI seconds after the checker called it broken.

So: **1 broken is the expected result, and 2-3 is normal noise.** Before chasing a broken link,
run the checker twice and fetch the URL by hand — the checker's timeouts are short enough that
a slow sponsor host reads as an outage.

---

## What to pick up next

In the order `HANDOVER.md` argues for, which is region-by-region rather than sponsor-by-sponsor:

1. **Africa and South America — one record each**, and now the thinnest part of the catalog.
   `coverage.thin` names the regions still at zero.
2. **REP (Portugal)** — the one Tier 2 society never worked. NRAU is the other gap in that
   tier and is blocked at source: `nrau.net` says its contest information is under revision,
   and the NAC pages state no modes. What was read before that wall is written down under
   "Europe finishes ahead" so a future pass starts from evidence.
3. **The contest detail view** — the last unbuilt piece of the front end. See
   `FRONTEND_BRIEF.md`.
4. **`SOURCE_MONITOR_BRIEF.md`** — a monthly cron Worker that watches every sponsor's rules
   page and reports what changed. Not started; the brief is now committed rather than sitting
   untracked, which is how it would have been lost in this move.

Tier 5 is 50 more US QSO parties and still comes last: adding 50 North American records now
would undo the balance this year's sourcing bought.

---

## Working rules that bite on a new machine

These are in `CLAUDE.md` too; they are repeated here because each one has already cost a
debugging session.

- **Do not chain `cd` into compound shell commands.** Use absolute paths, or `npm --prefix`,
  so each command can be checked independently.
- **The two engines change together.** `contestcal/recurrence.py` and
  `engine/src/recurrence.ts` are one implementation in two languages; rule-logic edits go to
  both files *and* both test suites in the same commit. `parity.test.ts` compares every field
  of every occurrence for 2026, 2027, 2030 and 2032 — a one-minute divergence fails it.
  Catalog edits go to `data/` only; both engines read the same JSON.
- **Add a contest, run `python scripts/coverage.py` in the same commit.** The registry's
  counts are generated, and a test in both engines recomputes them independently and fails on
  drift.
- **Green Python alone proves nothing about what ships.** The Worker suite runs the same
  comparison inside workerd, whose `Temporal`/`Intl` surface is not Node's.
- **Line endings.** The repo is checked out with `core.autocrlf` behaviour on Windows; git
  will warn `LF will be replaced by CRLF` on the markdown and TypeScript files. Expected, not
  a problem.
- **Never populate a contest record from an aggregator** — only from the sponsoring
  organisation's own published rules. If the sponsor's page cannot be found, the record stays
  `verified: false` and does not ship. This is the project's one non-negotiable rule and the
  reason `data/sources.md` exists.
