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

## Three test suites

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

```powershell
# Worker -- the API and the landing view, tested inside workerd
cd worker
npm install
npm test                       # expect: 31 passed
npm run typecheck              # two projects: workerd sources, then the Node-side setup
npm run dev                    # wrangler dev on :8787
npm run probe                  # re-measure Temporal/Intl across compatibility dates
```

Both parity suites shell out to `python scripts/dump_occurrences.py` and compare full
serialised output, using whatever `python` is first on PATH — so **the venv must be active
or they fail** on Windows, where `zoneinfo` raises without `tzdata`. They fail rather than
skipping, deliberately: a parity check that skips looks green while proving nothing.

The `engine` suite runs in Node; the `worker` suite runs the same comparison **inside
workerd** via `@cloudflare/vitest-pool-workers`, because that is the runtime that serves
requests and its `Temporal`/`Intl` surface is not Node's. Green in Node is not evidence
about production. `worker/tests/global-setup.ts` runs Python on the Node side and writes a
gitignored fixture, since workerd has no child processes.

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

The pin lives in `worker/src/runtime.ts`, at module scope, and self-checks against eight
DST vectors before a request is served. **`worker/src/index.ts` imports it first, for its
side effects** — do not reorder those imports, and do not import anything above it that
touches the engine. `/api/health` reports both the active resolver and the one the runtime
*would* have chosen; when they differ, the pin is what is keeping contests on the hour.

## The Worker

`worker/` is one deployable: it server-renders `/` and serves `/api/*`. It reads the same
`data/contests.seed.json` as everything else, imported as a module so the bundler inlines
it — `engine/src/catalog.ts` uses `node:fs` and is excluded from the Worker's tsconfig for
exactly that reason. There is no D1, no KV, and no Astro; the reasoning is in
`FRONTEND_BRIEF.md` under "Deviation: Worker-rendered HTML, not Astro + Pages".

The page must stay correct with JavaScript off. Server-render every time as UTC with a
machine-readable `datetime`; `render/client.ts` only converts to local and ticks
countdowns. Anything that renders blank without JS is a regression.

## The four briefs

| File | What it covers |
| --- | --- |
| `HANDOVER.md` | Current state, health checks, the sourcing rule. **Start here.** |
| `BUILD_BRIEF.md` | Overall plan and provenance model for the whole project. |
| `FRONTEND_BRIEF.md` | The current phase — UI, Worker, iCal feed. Engine port is done. |
| `TIMEZONE_BRIEF.md` | Wall-clock vs rolling time handling. Done; includes the Worker resolver decision. |

`README.md` is the public-facing description of provenance and architecture;
`data/sources.md` records what has been verified against which sponsor page.
