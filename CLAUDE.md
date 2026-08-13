# CLAUDE.md

Working notes for Claude Code in this repo. Read `HANDOVER.md` before making changes —
it carries the project's non-negotiable sourcing rule.

## Environment

Python is stdlib-only at runtime; the venv exists for `pytest` and for `tzdata`, which
Windows needs because it does not ship the IANA database.

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Activate the venv **before** running the TypeScript suite too — see below.

## Both test suites

```powershell
# Python -- the reference engine
python -m pytest -q            # expect: 116 passed
python scripts\validate.py     # expect: ARRL 2026 rule-engine validation: 21/21 match
python scripts\check_links.py  # sponsor rules URLs still resolve

# TypeScript -- what actually serves the site
cd engine
npm install                    # node_modules is gitignored; needed on a fresh clone
npm test                       # expect: 129 passed (116 mirrored + 13 parity)
npm run typecheck
```

`engine/tests/parity.test.ts` shells out to `python scripts/dump_occurrences.py` and
compares full serialised output. It uses whatever `python` is first on PATH, so **the venv
must be active or `npm test` fails** on Windows — `zoneinfo` raises without `tzdata`. It
fails rather than skipping, deliberately: a parity check that skips looks green while
proving nothing.

## The engines change together

> `contestcal/recurrence.py` and `engine/src/recurrence.ts` are one implementation kept in
> two languages. **Change one and you change the other, in the same commit.**

`parity.test.ts` compares every field of every occurrence for 2026, 2027, 2030 and 2032
against the Python engine's output. A one-minute divergence anywhere fails it. This is not
a style rule — it is what makes two implementations of contest dates safe to have at all.

Practically:

- Rule-logic edits go to both files, and to both `tests/test_recurrence.py` and
  `engine/tests/recurrence.test.ts` (mirrored one-for-one: same names, same assertions).
- Catalog edits go to `data/` only. Both engines read the same JSON — never fork it.
- Run **both** suites before committing. Green Python alone proves nothing about what ships.

## Time zones

`engine/src/zones.ts` has two wall-clock → UTC resolvers held to each other by the parity
suite. The Worker pins `intlResolver` and does not touch `Temporal`; the reasoning is in
`TIMEZONE_BRIEF.md` under "Decision — the Worker uses the Intl path". Never use
`new Date("2026-03-08T02:30")` — a local-time string makes the runtime apply its own zone.

## The four briefs

| File | What it covers |
| --- | --- |
| `HANDOVER.md` | Current state, health checks, the sourcing rule. **Start here.** |
| `BUILD_BRIEF.md` | Overall plan and provenance model for the whole project. |
| `FRONTEND_BRIEF.md` | The current phase — UI, Worker, iCal feed. Engine port is done. |
| `TIMEZONE_BRIEF.md` | Wall-clock vs rolling time handling. Done; includes the Worker resolver decision. |

`README.md` is the public-facing description of provenance and architecture;
`data/sources.md` records what has been verified against which sponsor page.
