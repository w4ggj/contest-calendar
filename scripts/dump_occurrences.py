"""
Dump a year of occurrences as JSON, straight from the Python engine.

This is the reference the TypeScript port is held against: engine/tests/
parity.test.ts runs this and compares every field of every occurrence. Two
engines passing the same assertions is not the same as two engines agreeing,
and the fields nobody wrote an assertion for are exactly where a port drifts.

Usage:  python scripts/dump_occurrences.py 2026 [> year.json]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from contestcal import load_catalog  # noqa: E402
from contestcal.recurrence import expand_year  # noqa: E402


def main() -> int:
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    my_entity = sys.argv[2] if len(sys.argv) > 2 else "K"
    occurrences = expand_year(load_catalog(), year, my_entity)
    json.dump([o.to_dict() for o in occurrences], sys.stdout, indent=None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
