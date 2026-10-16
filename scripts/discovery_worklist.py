"""Diff the contest names a discovery index lists against the catalog.

THIS SCRIPT LOCATES; IT NEVER SOURCES. The only thing taken from the index is a
contest's *name* (and the index's own reference number, so a human can find the
row again). No date, band, mode, exchange or rule is read, stored or compared.
Every record that comes out of working this list is read from the sponsor's own
rules page, under the rule in HANDOVER.md -- the index is only how we learned
the contest exists.

    python scripts/discovery_worklist.py            # fetch, diff, merge into the worklist
    python scripts/discovery_worklist.py --offline PATH.html   # parse a saved copy
    python scripts/discovery_worklist.py --show 40  # print the next 40 todo items

Output: data/discovery_worklist.json. Re-running MERGES: a human's `status` and
`reason` on an existing entry survive, entries the catalog now covers flip to
`encoded`, and new names are appended as `todo`. Stdlib only.
"""

from __future__ import annotations

import argparse
import difflib
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "contests.seed.json"
OUT = ROOT / "data" / "discovery_worklist.json"
INDEX_URL = "https://www.contestcalendar.com/alphabetical.php"
UA = "contest-calendar-discovery/1.0 (names only; +https://github.com/w4ggj/contest-calendar)"

# Words that carry no identity. Dropped before comparing so "CQ WW DX Contest"
# and "CQ Worldwide DX Contest" meet.
STOP = {"the", "contest", "contests", "qso", "party", "annual", "international",
        "int", "of", "and", "a", "an", "in", "on", "for"}
ALIASES = {"ww": "worldwide", "wpx": "prefix", "digi": "digital", "phone": "ssb"}

DIGITAL = re.compile(r"\b(ft8|ft4|rtty|psk\d*|digi|digital|olivia|mfsk|js8|jt65|"
                     r"fsk|data|ofdm|packet|wsjt|baudot)\b", re.I)

# Name fragments that tell us a contest is American, so the non-US queue can
# put everything else first. A heuristic for ORDERING the worklist only --
# country of record still comes from the sponsor's own page.
US_HINT = re.compile(r"\b(arrl|ncj|naqp|k1usn|ten-?ten|10-10|state|county|texas|"
                     r"florida|ohio|california|michigan|new york|jersey|carolina|"
                     r"virginia|georgia|alabama|illinois|indiana|iowa|kansas|"
                     r"kentucky|louisiana|maine|maryland|massachusetts|minnesota|"
                     r"mississippi|missouri|montana|nebraska|nevada|oklahoma|"
                     r"oregon|tennessee|utah|vermont|washington|wisconsin|wyoming|"
                     r"arizona|arkansas|colorado|connecticut|delaware|hawaii|idaho|"
                     r"new mexico|north dakota|south dakota|pennsylvania|"
                     r"rhode island|west virginia|alaska|sweepstakes|field day)\b",
                     re.I)


def norm(name: str) -> str:
    s = html.unescape(name).lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = [ALIASES.get(t, t) for t in s.split() if t not in STOP]
    return " ".join(toks)


def fetch_index(offline: str | None) -> str:
    if offline:
        return Path(offline).read_text(encoding="utf-8", errors="replace")
    req = urllib.request.Request(INDEX_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", errors="replace")


CELL = re.compile(
    r'<a[^>]*href="contestdetails\.php\?ref=(\d+)"[^>]*>\+</a></span>\s*(.*?)</td>',
    re.S,
)


def parse_names(page: str) -> list[dict]:
    out, seen = [], set()
    for ref, raw in CELL.findall(page):
        name = html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()
        grey = "tgray" in raw
        if not name or ref in seen:
            continue
        seen.add(ref)
        out.append({"index_ref": int(ref), "name": name, "index_greyed": grey})
    return out


def catalog_keys() -> list[tuple[str, str]]:
    cs = json.loads(SEED.read_text(encoding="utf-8"))["contests"]
    keys = []
    for c in cs:
        keys.append((c["id"], norm(c["name"])))
        keys.append((c["id"], norm(c["id"].replace("-", " "))))
    return keys


def best_match(n: str, keys: list[tuple[str, str]]) -> tuple[str, float]:
    best, score = "", 0.0
    ts = set(n.split())
    for cid, k in keys:
        if k == n:
            return cid, 1.0
        tk = set(k.split())
        if not ts or not tk:
            continue
        jac = len(ts & tk) / len(ts | tk)
        r = difflib.SequenceMatcher(None, n, k).ratio()
        s = max(jac, r)
        if s > score:
            best, score = cid, s
    return best, round(score, 3)


MATCH_AT = 0.86  # at or above: treated as already in the catalog


def priority(entry: dict) -> int:
    """Lower is sooner. Digital and non-US first, as asked; ties by name."""
    d = entry["digital"]
    non_us = not US_HINT.search(entry["name"])
    return 0 if d and non_us else 1 if d else 2 if non_us else 3


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--offline", help="parse a saved copy of the index page")
    ap.add_argument("--show", type=int, metavar="N", help="print next N todo items")
    a = ap.parse_args()

    prior = {}
    if OUT.exists():
        prior = {e["index_ref"]: e for e in json.loads(OUT.read_text(encoding="utf-8"))["items"]}

    if a.show is not None and not a.offline and OUT.exists():
        items = sorted((e for e in prior.values() if e["status"] == "todo"),
                       key=lambda e: (e["priority"], e["name"].lower()))
        for e in items[: a.show]:
            print(f'{e["priority"]} {e["name"]}  [ref {e["index_ref"]}]'
                  f'{"  (greyed in index)" if e["index_greyed"] else ""}'
                  f'  ~ {e["closest"]} {e["closest_score"]}')
        return 0

    names = parse_names(fetch_index(a.offline))
    if len(names) < 300:
        print(f"only {len(names)} names parsed -- the index layout changed; "
              "refusing to overwrite", file=sys.stderr)
        return 1

    keys = catalog_keys()
    items = []
    for n in names:
        old = prior.get(n["index_ref"], {})
        close, score = best_match(norm(n["name"]), keys)
        status = old.get("status", "todo")
        if score >= MATCH_AT and status == "todo":
            status = "encoded"
        e = {**n, "closest": close, "closest_score": score, "status": status,
             "reason": old.get("reason", ""), "digital": bool(DIGITAL.search(n["name"]))}
        e["priority"] = priority(e)
        items.append(e)

    # A name that disappeared from the index keeps its entry: the contest may
    # still exist, and a human's `reason` is worth more than index tidiness.
    live = {e["index_ref"] for e in items}
    for ref, e in prior.items():
        if ref not in live:
            items.append({**e, "index_missing": True})

    items.sort(key=lambda e: (e["status"] != "todo", e["priority"], e["name"].lower()))
    summary = {s: sum(1 for e in items if e["status"] == s)
               for s in sorted({e["status"] for e in items})}
    OUT.write_text(json.dumps({
        "_about": ("DISCOVERY ONLY. Names located via a third-party index; nothing here is a "
                   "source for any contest fact. Work an item by reading the SPONSOR's own "
                   "rules page. status: todo | encoded | skip (with reason) | blocked (with reason)."),
        "index": INDEX_URL,
        "summary": summary,
        "items": items,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(names)} index names; {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
