"""
Regenerate the `coverage` block and the per-org `encoded` counts in
data/sources.registry.json from the catalog.

The registry's hand-written `estimated_total` figures were written before any
sponsor's pages were read, and verification has moved them in both directions.
Anything that says how much of the catalog exists therefore has to be computed
from the catalog, not maintained by hand -- otherwise the next sourcing pass
plans against numbers that were never true.

Everything this script writes is asserted by `test_registry_coverage_is_current`
in both engines, so a stale registry fails the build rather than misleading
someone quietly.

Usage:
    python scripts/coverage.py            # regenerate, write, print the summary
    python scripts/coverage.py --check    # print the summary, exit 1 if stale
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running directly (python scripts/coverage.py) without installing.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json  # noqa: E402
from datetime import date  # noqa: E402

from contestcal import REGISTRY_PATH, load_catalog, load_registry  # noqa: E402

TIERS = [
    "tier_1_major_international",
    "tier_2_european_societies",
    "tier_3_other_regions",
    "tier_4_specialty_clubs",
    "tier_5_qso_parties",
]


def org_entries(reg: dict):
    """Every org entry across the list-shaped tiers, with its tier key."""
    for tier in TIERS:
        for org in reg[tier]:
            yield tier, org


def region_map(reg: dict) -> dict:
    """country -> region, minus the `$comment` key the JSON carries inline."""
    return {k: v for k, v in reg["region_map"].items() if not k.startswith("$")}


def compute(contests: list, reg: dict) -> dict:
    """
    Build the whole generated picture: per-org counts plus the coverage block.

    Returns {"per_org": {(tier, org): {...}}, "coverage": {...}}.
    """
    regions = region_map(reg)

    # sponsor string -> (tier, org name). The registry is the only place this
    # join is declared, so a sponsor nobody registered shows up as missing
    # rather than being silently bucketed somewhere plausible.
    owner: dict[str, tuple[str, str]] = {}
    for tier, org in org_entries(reg):
        for sponsor in org["catalog_sponsors"]:
            owner[sponsor] = (tier, org["org"])

    per_org: dict[tuple[str, str], dict] = {
        (tier, org["org"]): {"encoded": 0, "encoded_verified": 0}
        for tier, org in org_entries(reg)
    }
    by_tier: dict[str, dict] = {
        tier: {"orgs": 0, "orgs_worked": 0, "encoded": 0, "verified": 0, "retired": 0}
        for tier in TIERS
    }
    by_region: dict[str, dict] = {}
    by_country: dict[str, dict] = {}
    unverified: list[str] = []
    missing: set[str] = set()

    for c in contests:
        sponsor = c["sponsor"]
        verified = bool(c.get("verified"))
        # `active_until` marks a contest the sponsor has stopped running. The
        # records stay so past years still answer correctly, but they are not
        # live coverage and must not be counted as such.
        retired = "active_until" in c

        if not verified:
            unverified.append(c["id"])

        if sponsor in owner:
            tier, org = owner[sponsor]
            per_org[(tier, org)]["encoded"] += 1
            per_org[(tier, org)]["encoded_verified"] += int(verified)
            by_tier[tier]["encoded"] += 1
            by_tier[tier]["verified"] += int(verified)
            by_tier[tier]["retired"] += int(retired)
        else:
            missing.add(sponsor)

        country = c.get("country") or ""
        region = regions.get(country, "UNMAPPED")
        for bucket, key in ((by_region, region), (by_country, country)):
            row = bucket.setdefault(key, {"encoded": 0, "verified": 0, "retired": 0})
            row["encoded"] += 1
            row["verified"] += int(verified)
            row["retired"] += int(retired)

    for tier, org in org_entries(reg):
        counts = per_org[(tier, org["org"])]
        by_tier[tier]["orgs"] += 1
        by_tier[tier]["orgs_worked"] += int(counts["encoded"] > 0)

    total = len(contests)
    biggest = max(by_region.items(), key=lambda kv: kv[1]["encoded"], default=("", {}))
    coverage = {
        "$comment": reg["coverage"]["$comment"],
        "as_of": date.today().isoformat(),
        "total_encoded": total,
        "total_verified": sum(1 for c in contests if c.get("verified")),
        "total_retired": sum(1 for c in contests if "active_until" in c),
        "by_tier": by_tier,
        "by_region": dict(sorted(by_region.items(), key=lambda kv: -kv[1]["encoded"])),
        "by_country": dict(sorted(by_country.items(), key=lambda kv: -kv[1]["encoded"])),
        "thin": {
            "$comment": (
                "Where the catalog is not a world calendar yet. `regions_with_nothing` "
                "is the headline: a region with zero contests is invisible to every "
                "operator in it, which is a worse failure than an unverified record."
            ),
            "regions_with_nothing": sorted(
                r for r in set(regions.values()) if r not in by_region
            ),
            "largest_region": biggest[0],
            "largest_region_share_pct": (
                round(100.0 * biggest[1].get("encoded", 0) / total, 1) if total else 0.0
            ),
            "tiers_barely_started": sorted(
                tier
                for tier, row in by_tier.items()
                if row["orgs_worked"] <= 1 and row["orgs"] > 1
            ),
            "orgs_blocked_at_source": sorted(
                org["org"]
                for _tier, org in org_entries(reg)
                if org.get("status") == "blocked"
            ),
        },
        "unverified_ids": sorted(unverified),
        "sponsors_missing_from_registry": sorted(missing),
    }
    return {"per_org": per_org, "coverage": coverage}


def apply(reg: dict, computed: dict) -> dict:
    """Write the computed numbers back onto a registry dict, in place."""
    for tier, org in org_entries(reg):
        counts = computed["per_org"][(tier, org["org"])]
        org["encoded"] = counts["encoded"]
        org["encoded_verified"] = counts["encoded_verified"]
    reg["coverage"] = computed["coverage"]
    return reg


def render(coverage: dict, reg: dict) -> str:
    """The human summary. Ordered worst-covered first -- that is the point."""
    out = []
    t, v, r = (
        coverage["total_encoded"],
        coverage["total_verified"],
        coverage["total_retired"],
    )
    out.append(f"Catalog coverage as of {coverage['as_of']}")
    out.append(f"  {t} contests encoded, {v} verified at source, {r} retired by sponsor")
    out.append("")

    out.append("  By tier                                  orgs  worked  enc  ver")
    for tier, row in coverage["by_tier"].items():
        out.append(
            f"    {tier:36s} {row['orgs']:4d}  {row['orgs_worked']:6d} "
            f"{row['encoded']:4d} {row['verified']:4d}"
        )
    # tier_5 used to be appended by hand here with "--" for its org counts,
    # because it was a placeholder dict with no orgs in it. It became a real
    # list-shaped tier on 2026-08-23 when the Florida Contest Group was encoded,
    # so it comes through the loop above like the other four.
    out.append("")

    out.append("  By region                        enc   ver   share")
    for region, row in coverage["by_region"].items():
        share = 100.0 * row["encoded"] / t if t else 0.0
        out.append(
            f"    {region:28s} {row['encoded']:4d}  {row['verified']:4d}  {share:5.1f}%"
        )
    for region in coverage["thin"]["regions_with_nothing"]:
        out.append(f"    {region:28s} {0:4d}  {0:4d}  {0.0:5.1f}%   <- nothing at all")
    out.append("")

    if coverage["sponsors_missing_from_registry"]:
        out.append("  SPONSORS IN THE CATALOG WITH NO REGISTRY ENTRY:")
        for s in coverage["sponsors_missing_from_registry"]:
            out.append(f"    {s}")
        out.append("")

    out.append(f"  Unverified ({len(coverage['unverified_ids'])}):")
    for cid in coverage["unverified_ids"]:
        out.append(f"    {cid}")
    return "\n".join(out)


def main() -> int:
    check = "--check" in sys.argv
    catalog = load_catalog()
    reg = load_registry()
    computed = compute(catalog, reg)

    before = json.dumps(reg, sort_keys=True)
    apply(reg, computed)
    after = json.dumps(reg, sort_keys=True)

    print(render(computed["coverage"], reg))
    print()

    # as_of alone changing is not drift worth failing on.
    stale = before != after and not _only_as_of_differs(before, after)
    if check:
        if stale:
            print("  STALE: registry counts disagree with the catalog.")
            print("  Fix by: python scripts/coverage.py")
            return 1
        print("  Registry coverage is current.")
        return 0

    REGISTRY_PATH.write_text(
        json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"  Wrote {REGISTRY_PATH.name}.")
    return 0


def _only_as_of_differs(before: str, after: str) -> bool:
    b, a = json.loads(before), json.loads(after)
    b["coverage"]["as_of"] = a["coverage"]["as_of"] = None
    return json.dumps(b, sort_keys=True) == json.dumps(a, sort_keys=True)


if __name__ == "__main__":
    raise SystemExit(main())
