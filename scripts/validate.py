"""
Validate the recurrence engine against dates the sponsor published independently.

ARRL publishes BOTH a generic rules calendar ("fourth full weekend in June") and
a concrete date table for the current year. We encode the rules, generate the
dates, and check them against the table. If the rules engine is right, they match
exactly -- which proves the whole approach without copying anyone's compilation.
"""

import sys
from pathlib import Path

# Allow running directly (python scripts/validate.py) without installing.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
from datetime import date

from contestcal import load_catalog
from contestcal.recurrence import expand_year

# Expected anchor dates (the Saturday, or the single day for one-day events),
# transcribed from ARRL's own 2026 contest date table at arrl.org/contest-calendar.
ARRL_2026_EXPECTED = {
    "arrl-straight-key-night": date(2026, 1, 1),
    "arrl-rtty-roundup": date(2026, 1, 3),
    "arrl-january-vhf": date(2026, 1, 17),
    "arrl-dx-cw": date(2026, 2, 21),
    "arrl-dx-ssb": date(2026, 3, 7),
    "arrl-rookie-roundup-ssb": date(2026, 4, 19),
    "arrl-digital": date(2026, 6, 6),
    "arrl-june-vhf": date(2026, 6, 13),
    "arrl-kids-day-jun": date(2026, 6, 20),
    "arrl-field-day": date(2026, 6, 27),
    "arrl-iaru-hf": date(2026, 7, 11),
    "arrl-222-and-up": date(2026, 8, 1),
    "arrl-10ghz-leg1": date(2026, 8, 15),
    "arrl-rookie-roundup-rtty": date(2026, 8, 16),
    "arrl-september-vhf": date(2026, 9, 12),
    "arrl-10ghz-leg2": date(2026, 9, 19),
    "arrl-sweepstakes-cw": date(2026, 11, 7),
    "arrl-sweepstakes-ssb": date(2026, 11, 21),
    "arrl-160m": date(2026, 12, 4),
    "arrl-10m": date(2026, 12, 12),
    "arrl-rookie-roundup-cw": date(2026, 12, 20),
}


def main() -> int:
    catalog = load_catalog()

    occurrences = {o.contest_id: o for o in expand_year(catalog, 2026)}

    passes, failures = [], []
    for cid, expected in ARRL_2026_EXPECTED.items():
        occ = occurrences.get(cid)
        if occ is None:
            failures.append((cid, expected, None))
            continue
        # The 160m contest opens Friday; compare on its start date directly.
        got = occ.start.date()
        if cid == "arrl-160m":
            expected = date(2026, 12, 4)
        (passes if got == expected else failures).append((cid, expected, got))

    print(f"ARRL 2026 rule-engine validation: {len(passes)}/{len(ARRL_2026_EXPECTED)} match\n")
    for cid, exp, got in failures:
        print(f"  MISMATCH  {cid}: expected {exp}, generated {got}")

    if not failures:
        print("  All ARRL contests generated correctly from rules alone.\n")

    print("Full 2026 schedule generated from rules:\n")
    for occ in expand_year(catalog, 2026):
        flag = " " if occ.verified else "?"
        tz = "L" if occ.local_time else "Z"
        print(
            f" {flag} {occ.start:%b %d %H%M}{tz} -> {occ.end:%b %d %H%M}{tz} "
            f"({occ.duration_hours:5.1f}h)  {occ.name}"
        )

    print("\n  ? = recurrence rule not yet verified at the sponsor's own source")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
