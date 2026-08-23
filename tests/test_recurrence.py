"""
Test suite for the contest recurrence engine.

The critical tests here are the sponsor-validation ones: we encode a rule in the
sponsor's own words, generate a date, and assert it matches a date that sponsor
published independently. That is what proves the catalog is an independent
compilation and not a copy of anyone else's.

Run:  pytest -q
"""

import sys
from datetime import date, datetime, timedelta, timezone as _timezone
from pathlib import Path

import pytest

UTC = _timezone.utc

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from contestcal import load_catalog, load_registry  # noqa: E402
from contestcal.recurrence import (  # noqa: E402
    CATALOG_BANDS,
    CATALOG_MODES,
    NoAnchorsThisYear,
    _full_weekends_in_month,
    _saturdays_in_month,
    eligibility_for,
    expand,
    expand_year,
    filter_by_eligibility,
    resolve_anchors,
    resolve_rules_url,
)


@pytest.fixture(scope="module")
def catalog():
    return load_catalog()


def by_id(catalog, cid):
    return next(c for c in catalog if c["id"] == cid)


# ---------------------------------------------------------------------------
# The full-weekend definition -- the subtlest part of the whole engine
# ---------------------------------------------------------------------------

def test_full_weekend_excludes_month_ending_saturday():
    """
    January 2026 ends on Saturday the 31st. That Saturday does NOT begin a full
    weekend, because Feb 1 falls outside January. A naive "count the Saturdays"
    implementation gets this wrong and silently shifts contest dates.
    """
    assert len(_saturdays_in_month(2026, 1)) == 5
    assert len(_full_weekends_in_month(2026, 1)) == 4
    assert _full_weekends_in_month(2026, 1)[-1] == date(2026, 1, 24)


def test_full_weekend_edge_occurs_regularly():
    """This edge case is not exotic -- it happens ~17 times in a decade."""
    count = sum(
        1
        for y in range(2026, 2036)
        for m in range(1, 13)
        if len(_saturdays_in_month(y, m)) != len(_full_weekends_in_month(y, m))
    )
    assert count == 17


# ---------------------------------------------------------------------------
# Sponsor validation -- ARRL
# ---------------------------------------------------------------------------

ARRL_2026 = {
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


@pytest.mark.parametrize("cid,expected", sorted(ARRL_2026.items()))
def test_arrl_dates_match_published_table(catalog, cid, expected):
    """Generated from ARRL's rules; checked against ARRL's own 2026 date table."""
    occ = expand(by_id(catalog, cid), 2026)
    assert occ, f"{cid} produced no occurrence"
    assert occ[0].start.date() == expected


def test_rtty_roundup_never_falls_on_january_first(catalog):
    """
    ARRL: 'first full weekend of January, but never on January 1'. Exercised in
    any year where Jan 1 is itself a Saturday.
    """
    c = by_id(catalog, "arrl-rtty-roundup")
    for y in range(2026, 2046):
        anchor = resolve_anchors(c["recurrence"], y)[0]
        assert not (anchor.month == 1 and anchor.day == 1)


# ---------------------------------------------------------------------------
# Sponsor validation -- RSGB (second continent, second organisation)
# ---------------------------------------------------------------------------

def test_rsgb_iota_matches_published_2026_dates(catalog):
    """
    RSGB rules: 'the contest always takes place over the last FULL weekend of
    July'. RSGB independently publishes Sat 25 - Sun 26 July 2026, 1200-1200 UTC.
    """
    occ = expand(by_id(catalog, "rsgb-iota"), 2026)[0]
    assert occ.start.date() == date(2026, 7, 25)
    assert occ.end.date() == date(2026, 7, 26)
    assert (occ.start.hour, occ.end.hour) == (12, 12)
    assert occ.duration_hours == 24


def test_iota_log_deadline_computed(catalog):
    """RSGB requires logs within 5 days of the contest end."""
    occ = expand(by_id(catalog, "rsgb-iota"), 2026)[0]
    assert occ.log_due is not None
    assert (occ.log_due - occ.end).days == 5


# ---------------------------------------------------------------------------
# High-frequency recurrence
# ---------------------------------------------------------------------------

def test_weekly_contest_expands_across_year(catalog):
    """CWops CWT: four sessions per week -> ~208 occurrences. See the Tier 4
    section below for the session-time detail."""
    occ = expand(by_id(catalog, "cwops-cwt"), 2026)
    assert 205 <= len(occ) <= 212
    assert all(o.start.year == 2026 for o in occ)


def test_monthly_contest_yields_twelve(catalog):
    occ = expand(by_id(catalog, "ars-spartan-sprint"), 2026)
    assert len(occ) == 12
    assert len({o.start.month for o in occ}) == 12


def test_no_occurrence_leaks_outside_requested_year(catalog):
    for year in (2026, 2027, 2030):
        assert all(o.start.year == year for o in expand_year(catalog, year))


# ---------------------------------------------------------------------------
# Rules links
# ---------------------------------------------------------------------------

def test_year_versioned_url_pattern_resolves(catalog):
    """RSGB versions rules by year; links must follow or they rot each January."""
    c = by_id(catalog, "rsgb-iota")
    assert resolve_rules_url(c, 2026).endswith("/2026/riota.shtml")
    assert resolve_rules_url(c, 2031).endswith("/2031/riota.shtml")


def test_stable_slug_url_is_year_independent(catalog):
    c = by_id(catalog, "arrl-field-day")
    assert resolve_rules_url(c, 2026) == resolve_rules_url(c, 2035)


def test_every_verified_contest_has_a_rules_link(catalog):
    missing = [
        c["id"]
        for c in catalog
        if c.get("verified") and not (c.get("rules_url") or c.get("rules_url_pattern"))
    ]
    assert not missing, f"verified contests missing rules link: {missing}"


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------

def test_domestic_only_contest_blocked_for_dx(catalog):
    afs = by_id(catalog, "rsgb-afs-cw")
    assert eligibility_for(afs, "K")["can_enter"] is False
    assert eligibility_for(afs, "G")["can_enter"] is True


def test_us_only_contest_blocked_for_dx(catalog):
    ss = by_id(catalog, "arrl-sweepstakes-cw")
    assert eligibility_for(ss, "K")["can_enter"] is True
    assert eligibility_for(ss, "G")["can_enter"] is False


def test_two_sided_contest_reports_who_you_work(catalog):
    """ARRL DX: a K station may enter, but works DX only."""
    e = eligibility_for(by_id(catalog, "arrl-dx-cw"), "K")
    assert e["can_enter"] is True
    assert "DX" in e["works"]


def test_blocked_contests_carry_an_explanation(catalog):
    """Silently hiding a contest is worse than hiding it with a reason."""
    for c in catalog:
        e = eligibility_for(c, "K")
        if not e["can_enter"]:
            assert e["reason"], f"{c['id']} filtered with no reason given"


def test_filter_is_symmetric_across_entities(catalog):
    occ = expand_year(catalog, 2026, my_entity="K")
    k_can = len(filter_by_eligibility(occ, "K"))
    g_occ = expand_year(catalog, 2026, my_entity="G")
    g_can = len(filter_by_eligibility(g_occ, "G"))
    assert k_can < len(occ) and g_can < len(g_occ)


def test_include_ineligible_returns_everything(catalog):
    occ = expand_year(catalog, 2026, my_entity="K")
    assert len(filter_by_eligibility(occ, "K", include_ineligible=True)) == len(occ)


# ---------------------------------------------------------------------------
# Catalog integrity
# ---------------------------------------------------------------------------

def test_contest_ids_unique(catalog):
    ids = [c["id"] for c in catalog]
    assert len(ids) == len(set(ids))


def test_every_contest_expands_without_error(catalog):
    for c in catalog:
        for y in (2026, 2027, 2028):
            expand(c, y)


def test_end_always_after_start(catalog):
    for o in expand_year(catalog, 2026):
        assert o.end > o.start, f"{o.contest_id} ends before it starts"


def test_registry_flags_derived_sources():
    """
    Guard rail: the registry must keep naming sources that are downstream of
    contestcalendar.com, so nobody reintroduces them as 'primary' later.
    """
    reg = load_registry()
    derived = {d["name"] for d in reg["known_derived_sources"]}
    assert any("Corral" in n for n in derived)
    assert any("SM3CER" in n for n in derived)
    # qrpcontest.com is the one that would actually get taken. It publishes
    # recurrences in exactly this catalog's shape, for the one sponsor whose
    # rules are nowhere on the public web -- and it links WA7BNM from its own
    # front page, so it is downstream too.
    assert any("qrpcontest" in n.lower() for n in derived)


REGISTRY_TIERS = [
    "tier_1_major_international",
    "tier_2_european_societies",
    "tier_3_other_regions",
    "tier_4_specialty_clubs",
    "tier_5_qso_parties",
]


def _registry_owner(reg):
    """sponsor string -> (tier key, org name). The registry declares this join."""
    owner = {}
    for tier in REGISTRY_TIERS:
        for org in reg[tier]:
            for sponsor in org["catalog_sponsors"]:
                assert sponsor not in owner, f"{sponsor} claimed by two orgs"
                owner[sponsor] = (tier, org["org"])
    return owner


def _tally(rows):
    return (
        len(rows),
        sum(1 for c in rows if c.get("verified")),
        sum(1 for c in rows if "active_until" in c),
    )


def test_registry_coverage_is_current(catalog):
    """
    The `coverage` block and every per-org `encoded` count are generated from
    the catalog by scripts/coverage.py. This recomputes them from scratch
    rather than importing that script: a generator that checks its own output
    is grading its own homework.

    Stale counts are the specific failure being guarded. The registry's
    hand-written `estimated_total` figures went stale silently -- 10-10 was
    listed at four QSO Parties and runs three -- and a sourcing pass planned
    against numbers that were never true wastes the pass. Anything stating how
    much of the catalog exists therefore has to be derived from the catalog.
    """
    reg = load_registry()
    owner = _registry_owner(reg)
    regions = {k: v for k, v in reg["region_map"].items() if not k.startswith("$")}
    cov = reg["coverage"]

    for c in catalog:
        assert c["sponsor"] in owner, f"{c['id']}: sponsor {c['sponsor']!r} unregistered"
        assert c.get("country") in regions, f"{c['id']}: country not in region_map"

    assert (cov["total_encoded"], cov["total_verified"], cov["total_retired"]) == _tally(
        catalog
    )
    assert cov["sponsors_missing_from_registry"] == []
    assert cov["unverified_ids"] == sorted(
        c["id"] for c in catalog if not c.get("verified")
    )

    for tier in REGISTRY_TIERS:
        for org in reg[tier]:
            rows = [c for c in catalog if owner[c["sponsor"]] == (tier, org["org"])]
            encoded, verified, _retired = _tally(rows)
            assert org["encoded"] == encoded, f"{org['org']}: encoded"
            assert org["encoded_verified"] == verified, f"{org['org']}: encoded_verified"

        row = cov["by_tier"][tier]
        rows = [c for c in catalog if owner[c["sponsor"]][0] == tier]
        assert (row["encoded"], row["verified"], row["retired"]) == _tally(rows), tier
        assert row["orgs"] == len(reg[tier]), tier
        assert row["orgs_worked"] == sum(1 for o in reg[tier] if o["encoded"] > 0), tier

    for country in set(regions):
        rows = [c for c in catalog if c["country"] == country]
        if rows:
            row = cov["by_country"][country]
            assert (row["encoded"], row["verified"], row["retired"]) == _tally(rows)
        else:
            assert country not in cov["by_country"], country

    for region in set(regions.values()):
        rows = [c for c in catalog if regions[c["country"]] == region]
        if rows:
            row = cov["by_region"][region]
            assert (row["encoded"], row["verified"], row["retired"]) == _tally(rows)
        else:
            # A region with nothing in it is invisible to every operator who
            # lives there, so it is named out loud rather than merely absent.
            assert region not in cov["by_region"], region
            assert region in cov["thin"]["regions_with_nothing"], region

    thin = cov["thin"]
    biggest = max(cov["by_region"].items(), key=lambda kv: kv[1]["encoded"])
    assert thin["largest_region"] == biggest[0]
    assert thin["largest_region_share_pct"] == round(
        100.0 * biggest[1]["encoded"] / len(catalog), 1
    )
    assert thin["tiers_barely_started"] == sorted(
        t
        for t in REGISTRY_TIERS
        if len(reg[t]) > 1 and sum(1 for o in reg[t] if o["encoded"] > 0) <= 1
    )
    assert thin["orgs_blocked_at_source"] == sorted(
        o["org"]
        for t in REGISTRY_TIERS
        for o in reg[t]
        if o.get("status") == "blocked"
    )


# ---------------------------------------------------------------------------
# Tier 4 sponsor validation -- high-frequency club contests
# ---------------------------------------------------------------------------

def test_cwt_has_four_weekly_sessions(catalog):
    """
    cwops.org: four one-hour tests weekly -- Wed 1300Z/1900Z, Thu 0300Z/0700Z.
    An earlier stub had only three, silently dropping ~52 sessions a year.
    """
    occ = expand(by_id(catalog, "cwops-cwt"), 2026)
    assert 205 <= len(occ) <= 212
    first_week = [o for o in occ if o.start.month == 1 and o.start.day <= 8]
    assert len(first_week) == 4
    assert sorted(o.start.hour for o in first_week) == [3, 7, 13, 19]


def test_sst_runs_monday_and_friday(catalog):
    """k1usn.com: twice weekly at 0000Z Mondays and 2000Z Fridays."""
    occ = expand(by_id(catalog, "k1usn-sst"), 2026)
    assert 100 <= len(occ) <= 106
    weekdays = {o.start.weekday() for o in occ}
    assert weekdays == {0, 4}  # Monday and Friday


def test_skcc_wes_second_saturday(catalog):
    """skccgroup.com: 1200 UTC on the 2nd Saturday, ending 2359 UTC Sunday."""
    occ = expand(by_id(catalog, "skcc-wes"), 2026)
    assert len(occ) == 12
    assert all(o.start.weekday() == 5 for o in occ)
    assert all(8 <= o.start.day <= 14 for o in occ)  # 2nd Saturday window
    sep = next(o for o in occ if o.start.month == 9)
    assert sep.start.date() == date(2026, 9, 12)  # SKCC's published date


def test_skcc_sks_fourth_wednesday(catalog):
    """skccgroup.com: fourth Wednesday of each month at 0000 UTC, two hours."""
    occ = expand(by_id(catalog, "skcc-sks"), 2026)
    assert len(occ) == 12
    assert all(o.start.weekday() == 2 for o in occ)
    aug = next(o for o in occ if o.start.month == 8)
    assert aug.start.date() == date(2026, 8, 26)  # SKCC's published date
    assert aug.duration_hours == 2


NAQP_2026 = {
    "naqp-cw": [date(2026, 1, 10), date(2026, 8, 1)],
    "naqp-ssb": [date(2026, 1, 17), date(2026, 8, 15)],
    "naqp-rtty": [date(2026, 2, 28), date(2026, 7, 18)],
}


@pytest.mark.parametrize("cid,expected", sorted(NAQP_2026.items()))
def test_naqp_matches_ncj_published_dates(catalog, cid, expected):
    occ = expand(by_id(catalog, cid), 2026)
    assert [o.start.date() for o in occ] == expected


def test_naqp_rtty_uses_last_saturday_not_last_full_weekend(catalog):
    """
    NCJ: the winter RTTY running starts on the LAST SATURDAY in February. In
    2026 that is Feb 28, whose Sunday falls in March -- so it is explicitly NOT
    the last full weekend (Feb 21). Proves the two rules are distinct.
    """
    occ = expand(by_id(catalog, "naqp-rtty"), 2026)
    feb = next(o for o in occ if o.start.month == 2)
    assert feb.start.date() == date(2026, 2, 28)
    assert feb.start.date() != date(2026, 2, 21)
    assert feb.end.month == 3  # spills into March


def test_naqp_is_twelve_hours(catalog):
    for cid in NAQP_2026:
        for o in expand(by_id(catalog, cid), 2026):
            assert 11.9 < o.duration_hours < 12.1


# ---------------------------------------------------------------------------
# CQ Magazine -- the eight CQ contests.
#
# CQ is the one sponsor in this catalog that publishes almost no recurrence
# wording at all. Its five rules pages state the period ("Starts 00:00:00 UTC
# Saturday Ends 23:59:59 UTC Sunday") and that year's dates, and stop there. A
# sweep of every archived rules document on CQ's own five sites for 2016-2026
# turned up exactly one recurrence sentence, in the 2016 WPX rules:
#
#     "Each contest mode is a separate event running from 0000 UTC Saturday
#      until 2359 UTC Sunday. SSB is the last full weekend of March and CW is
#      the last full weekend of May."
#
# So seven of the eight rules are held to CQ's own published dates rather than
# to CQ's prose, and these tables are what makes that safe. Two independent
# CQ-published fields are checked: the contest dates CQ prints in the header of
# each year's rules, and the explicit log deadline CQ prints inside them.
# ---------------------------------------------------------------------------

# Dates CQ printed in the header of its own rules for that year. For CQ 160
# that is the 2200Z Friday start ("CW: 2200Z January 23 to 2200Z January 25");
# for the rest it is the 0000Z Saturday start.
CQ_PRINTED_DATES = {
    "cq-160-cw": [
        (2016, date(2016, 1, 29)), (2017, date(2017, 1, 27)),
        (2018, date(2018, 1, 26)), (2019, date(2019, 1, 25)),
        (2020, date(2020, 1, 24)), (2021, date(2021, 1, 29)),
        (2022, date(2022, 1, 28)), (2023, date(2023, 1, 27)),
        (2024, date(2024, 1, 26)), (2025, date(2025, 1, 24)),
        (2026, date(2026, 1, 23)),
    ],
    "cq-160-ssb": [
        (2016, date(2016, 2, 26)), (2017, date(2017, 2, 24)),
        (2018, date(2018, 2, 23)), (2019, date(2019, 2, 22)),
        (2020, date(2020, 2, 21)), (2021, date(2021, 2, 26)),
        (2022, date(2022, 2, 25)), (2023, date(2023, 2, 24)),
        (2024, date(2024, 2, 23)), (2025, date(2025, 2, 21)),
        (2026, date(2026, 2, 27)),
    ],
    "cq-wpx-ssb": [
        (2021, date(2021, 3, 27)), (2023, date(2023, 3, 25)),
        (2024, date(2024, 3, 30)), (2025, date(2025, 3, 29)),
        (2026, date(2026, 3, 28)),
    ],
    "cq-wpx-cw": [
        (2021, date(2021, 5, 29)), (2023, date(2023, 5, 27)),
        (2024, date(2024, 5, 25)), (2025, date(2025, 5, 24)),
        (2026, date(2026, 5, 30)),
    ],
    # 2025 is deliberately absent: CQ's own WPX_RTTY_Rules_2025_en.pdf is
    # headed "February 10-11, 2024", which were the 2024 dates. The log
    # deadline in that same PDF puts the 2025 running on February 8-9, and the
    # deadline table below is what pins it.
    "cq-wpx-rtty": [
        (2022, date(2022, 2, 12)), (2024, date(2024, 2, 10)),
        (2026, date(2026, 2, 14)),
    ],
    "cq-ww-rtty": [
        (2016, date(2016, 9, 24)), (2017, date(2017, 9, 23)),
        (2019, date(2019, 9, 28)), (2021, date(2021, 9, 25)),
        (2022, date(2022, 9, 24)), (2023, date(2023, 9, 23)),
        (2024, date(2024, 9, 28)), (2025, date(2025, 9, 27)),
        (2026, date(2026, 9, 26)),
    ],
    # CQ has not published 2026 CQ WW rules; cqww.com still serves the 2025 set.
    "cq-ww-ssb": [
        (2016, date(2016, 10, 29)), (2019, date(2019, 10, 26)),
        (2020, date(2020, 10, 24)), (2021, date(2021, 10, 30)),
        (2022, date(2022, 10, 29)), (2023, date(2023, 10, 28)),
        (2024, date(2024, 10, 26)), (2025, date(2025, 10, 25)),
    ],
    "cq-ww-cw": [
        (2016, date(2016, 11, 26)), (2019, date(2019, 11, 23)),
        (2020, date(2020, 11, 28)), (2021, date(2021, 11, 27)),
        (2022, date(2022, 11, 26)), (2023, date(2023, 11, 25)),
        (2024, date(2024, 11, 23)), (2025, date(2025, 11, 29)),
    ],
}


@pytest.mark.parametrize("cid,published", sorted(CQ_PRINTED_DATES.items()))
def test_cq_matches_the_dates_cq_printed_in_its_own_rules(catalog, cid, published):
    c = by_id(catalog, cid)
    for year, expected in published:
        occ = expand(c, year)
        assert occ, f"{cid} produced nothing for {year}"
        assert occ[0].start.date() == expected, (
            f"{cid} {year}: engine gave {occ[0].start.date()}, "
            f"CQ printed {expected}"
        )


# The log deadline CQ printed inside each year's rules, as (year, window days,
# deadline date). The window is CQ's own: "All entries must be sent WITHIN FIVE
# (5) DAYS after the end of the contest" through 2025, and "WITHIN 48 HOURS"
# from 2026 for WPX, WPX RTTY and WW RTTY. Checking end + window against the
# printed deadline reaches the years whose header text would not extract, and
# is a second CQ-published field rather than a restatement of the first.
CQ_PRINTED_DEADLINES = {
    "cq-160-cw": [
        (2016, 5, date(2016, 2, 5)), (2017, 5, date(2017, 2, 3)),
        (2018, 5, date(2018, 2, 2)), (2021, 5, date(2021, 2, 5)),
        (2022, 5, date(2022, 2, 4)), (2023, 5, date(2023, 2, 3)),
        (2024, 5, date(2024, 2, 2)), (2025, 5, date(2025, 1, 31)),
        (2026, 5, date(2026, 1, 30)),
    ],
    "cq-160-ssb": [
        (2016, 5, date(2016, 3, 4)), (2017, 5, date(2017, 3, 3)),
        (2018, 5, date(2018, 3, 2)), (2020, 5, date(2020, 2, 28)),
        (2021, 5, date(2021, 3, 5)), (2022, 5, date(2022, 3, 4)),
        (2023, 5, date(2023, 3, 3)), (2024, 5, date(2024, 3, 1)),
        (2025, 5, date(2025, 2, 28)), (2026, 5, date(2026, 3, 6)),
    ],
    "cq-wpx-ssb": [
        (2016, 5, date(2016, 4, 1)), (2017, 5, date(2017, 3, 31)),
        (2018, 5, date(2018, 3, 30)), (2019, 5, date(2019, 4, 5)),
        (2020, 5, date(2020, 4, 3)), (2021, 5, date(2021, 4, 2)),
        (2022, 5, date(2022, 4, 1)), (2023, 5, date(2023, 3, 31)),
        (2024, 5, date(2024, 4, 5)), (2025, 5, date(2025, 4, 4)),
        (2026, 2, date(2026, 3, 31)),
    ],
    "cq-wpx-cw": [
        (2016, 5, date(2016, 6, 3)), (2017, 5, date(2017, 6, 2)),
        (2018, 5, date(2018, 6, 1)), (2019, 5, date(2019, 5, 31)),
        (2020, 5, date(2020, 6, 5)), (2021, 5, date(2021, 6, 4)),
        (2022, 5, date(2022, 6, 3)), (2023, 5, date(2023, 6, 2)),
        (2024, 5, date(2024, 5, 31)), (2025, 5, date(2025, 5, 30)),
        (2026, 2, date(2026, 6, 2)),
    ],
    "cq-wpx-rtty": [
        (2016, 5, date(2016, 2, 19)), (2017, 5, date(2017, 2, 17)),
        (2018, 5, date(2018, 2, 16)), (2019, 5, date(2019, 2, 15)),
        (2020, 5, date(2020, 2, 14)), (2021, 5, date(2021, 2, 19)),
        (2022, 5, date(2022, 2, 18)), (2023, 5, date(2023, 2, 17)),
        (2024, 5, date(2024, 2, 16)), (2025, 5, date(2025, 2, 14)),
        (2026, 2, date(2026, 2, 17)),
    ],
    "cq-ww-rtty": [
        (2016, 5, date(2016, 9, 30)), (2017, 5, date(2017, 9, 29)),
        (2018, 5, date(2018, 10, 5)), (2019, 5, date(2019, 10, 4)),
        (2020, 5, date(2020, 10, 2)), (2021, 5, date(2021, 10, 1)),
        (2022, 5, date(2022, 9, 30)), (2023, 5, date(2023, 9, 29)),
        (2024, 5, date(2024, 10, 4)), (2025, 5, date(2025, 10, 3)),
        (2026, 2, date(2026, 9, 29)),
    ],
    "cq-ww-ssb": [
        (2016, 5, date(2016, 11, 4)), (2017, 5, date(2017, 11, 3)),
        (2018, 5, date(2018, 11, 2)), (2019, 5, date(2019, 11, 1)),
        (2020, 5, date(2020, 10, 30)), (2021, 5, date(2021, 11, 5)),
        (2022, 5, date(2022, 11, 4)), (2023, 5, date(2023, 11, 3)),
        (2024, 5, date(2024, 11, 1)), (2025, 5, date(2025, 10, 31)),
    ],
    "cq-ww-cw": [
        (2016, 5, date(2016, 12, 2)), (2017, 5, date(2017, 12, 1)),
        (2018, 5, date(2018, 11, 30)), (2019, 5, date(2019, 11, 29)),
        (2020, 5, date(2020, 12, 4)), (2021, 5, date(2021, 12, 3)),
        (2022, 5, date(2022, 12, 2)), (2023, 5, date(2023, 12, 1)),
        (2024, 5, date(2024, 11, 29)), (2025, 5, date(2025, 12, 5)),
    ],
}


@pytest.mark.parametrize("cid,published", sorted(CQ_PRINTED_DEADLINES.items()))
def test_cq_end_dates_match_the_log_deadlines_cq_printed(catalog, cid, published):
    c = by_id(catalog, cid)
    for year, window, deadline in published:
        occ = expand(c, year)
        assert occ, f"{cid} produced nothing for {year}"
        o = occ[0]
        assert o.end.date() + timedelta(days=window) == deadline, (
            f"{cid} {year}: engine ends {o.end.date()}, +{window}d misses "
            f"CQ's printed deadline {deadline}"
        )
        # Where the year's window is the one on the record, log_due -- the
        # field the site actually shows -- must land on CQ's printed instant,
        # time included. CQ prints "2359 UTC" for the weekend contests and
        # "2200z" for CQ 160, which is exactly end + window.
        if window == c["log_deadline_days"]:
            assert o.log_due == datetime.combine(
                deadline, o.end.timetz()
            ), f"{cid} {year}: log_due {o.log_due} != CQ's {deadline}"


def test_cq_160_ssb_is_the_fourth_saturday_not_the_last_anything(catalog):
    """
    The one CQ rule that neither "last full weekend" nor "last Saturday"
    explains. CQ settles it in both directions with its own dates: 2020 ran
    2200Z Feb 21 (the last Saturday was Feb 29) and 2026 runs 2200Z Feb 27 to
    2200Z Mar 1 (the last full weekend was Feb 21-22). Only the fourth Saturday
    of February fits both, and the CW running in January is a different rule
    again -- there, the last full weekend fits all eleven years.
    """
    ssb = by_id(catalog, "cq-160-ssb")

    twenty = expand(ssb, 2020)[0]
    assert twenty.start.date() == date(2020, 2, 21)  # Friday before Sat Feb 22
    assert twenty.start.date() != date(2020, 2, 28)  # not the Sat Feb 29 weekend

    six = expand(ssb, 2026)[0]
    assert six.start.date() == date(2026, 2, 27)
    assert six.start.date() != date(2026, 2, 20)  # not the last full weekend
    assert six.end.date() == date(2026, 3, 1)  # spills into March

    # January's CW running really is the last full weekend: in 2026 the last
    # Saturday is Jan 31, whose Sunday falls in February, and CQ ran Jan 24-25.
    cw = expand(by_id(catalog, "cq-160-cw"), 2026)[0]
    assert cw.start.date() == date(2026, 1, 23)
    assert cw.end.date() == date(2026, 1, 25)


CQ_WEEKEND_CONTESTS = [
    "cq-wpx-ssb", "cq-wpx-cw", "cq-wpx-rtty",
    "cq-ww-ssb", "cq-ww-cw", "cq-ww-rtty",
]


@pytest.mark.parametrize("cid", CQ_WEEKEND_CONTESTS)
def test_cq_weekend_contests_run_0000_saturday_to_2359_sunday(catalog, cid):
    """CQ states the period identically on all four weekend rules pages."""
    o = expand(by_id(catalog, cid), 2026)[0]
    assert o.start.weekday() == 5
    assert (o.start.hour, o.start.minute) == (0, 0)
    assert o.end.weekday() == 6
    assert (o.end.hour, o.end.minute) == (23, 59)
    assert 47.9 < o.duration_hours < 48.1


@pytest.mark.parametrize("cid", ["cq-160-cw", "cq-160-ssb"])
def test_cq_160_is_48_hours_from_2200z_friday(catalog, cid):
    """cq160.com: 'Each contest is 48 hours long and starts at 2200Z.'"""
    o = expand(by_id(catalog, cid), 2026)[0]
    assert o.start.weekday() == 4  # Friday
    assert (o.start.hour, o.start.minute) == (22, 0)
    assert o.end.weekday() == 6  # Sunday
    assert (o.end.hour, o.end.minute) == (22, 0)
    assert 47.9 < o.duration_hours < 48.1


NCJ_SPRINT_2026 = {
    "ncj-sprint-cw": [date(2026, 2, 8), date(2026, 9, 13)],
    "ncj-sprint-rtty": [date(2026, 3, 15), date(2026, 9, 20)],
}


@pytest.mark.parametrize("cid,expected", sorted(NCJ_SPRINT_2026.items()))
def test_ncj_sprint_matches_published_2026_dates(catalog, cid, expected):
    """
    NCJ's 2026 Sprint rules state each date twice -- once in rule 4 'Contest
    Periods' and again in 'Table 1 - The 2026 Sprint calendar'. Both agree.
    """
    occ = expand(by_id(catalog, cid), 2026)
    assert [o.start.date() for o in occ] == expected
    assert all(o.start.hour == 0 and o.start.minute == 0 for o in occ)
    assert all((o.end.hour, o.end.minute) == (3, 59) for o in occ)


def test_ncj_sprint_stays_silent_for_years_ncj_has_not_published(catalog):
    """
    NCJ publishes dates, not a recurrence rule, and flagged 2026 September with
    'NOTE CW DATE SHIFT'. The 2026 dates happen to land on the 2nd and 3rd
    Sundays, but inferring that as a rule would invent dates NCJ never stated.
    A 'manual' record must generate nothing for an unpublished year.
    """
    for cid in NCJ_SPRINT_2026:
        assert expand(by_id(catalog, cid), 2027) == []


def test_ncj_sprint_log_deadline_is_seven_days(catalog):
    """NCJ rule 14: 'Entries must be received no later than 7 days after the
    Sprint.' Table 1 gives logs due Feb 15 for the Feb 8 CW Sprint."""
    feb = expand(by_id(catalog, "ncj-sprint-cw"), 2026)[0]
    assert feb.log_due is not None
    assert feb.log_due.date() == date(2026, 2, 15)


NCCC_SESSIONS = {
    "nccc-ns-ft4": (1, 0),
    "nccc-ns-rtty": (1, 45),
    "nccc-ns-cw": (2, 30),
}


@pytest.mark.parametrize("cid,hm", sorted(NCCC_SESSIONS.items()))
def test_nccc_sprints_run_weekly_at_their_published_utc_slot(catalog, cid, hm):
    """
    ncccsprint.com: CW NS is '0230-0300 UTC Fridays (Thursday evening NA time,
    DST ignored)'; RTTY NS 'is always 0145-0215 UTC'; FT4 NS starts '0100 UTC'.
    Each runs 'each Thursday' -- so ~52 Friday-UTC sessions a year.
    """
    occ = expand(by_id(catalog, cid), 2026)
    assert 51 <= len(occ) <= 53
    assert {o.start.weekday() for o in occ} == {4}  # Friday UTC
    assert {(o.start.hour, o.start.minute) for o in occ} == {hm}
    assert all(o.duration_hours == 0.5 for o in occ)


def test_nccc_sessions_are_45_minutes_apart(catalog):
    """
    NCCC states the gaps rather than a bare list of times: FT4 is '45 minutes
    BEFORE the regular RTTY NS', which is in turn '45 minutes BEFORE the
    regular CW NS'. Encoding all three lets us check that arithmetic holds.
    """
    week = {
        cid: next(
            o for o in expand(by_id(catalog, cid), 2026) if o.start.date() == date(2026, 3, 6)
        )
        for cid in NCCC_SESSIONS
    }
    ft4, rtty, cw = week["nccc-ns-ft4"], week["nccc-ns-rtty"], week["nccc-ns-cw"]
    assert (rtty.start - ft4.start).total_seconds() == 45 * 60
    assert (cw.start - rtty.start).total_seconds() == 45 * 60


def test_nccc_ns_matches_sponsors_published_ladder_table(catalog):
    """
    Cross-check against a date table NCCC published independently of the rules
    text: the 'NSL XXXV - 2023' schedule pairs US Thursday dates with Zulu
    Friday dates at 0230-0300Z (US Feb 2 / Zulu Feb 3, and weekly thereafter).
    """
    occ = {o.start.date() for o in expand(by_id(catalog, "nccc-ns-cw"), 2023)}
    for published in (
        date(2023, 2, 3),
        date(2023, 2, 10),
        date(2023, 2, 17),
        date(2023, 2, 24),
        date(2023, 3, 3),
        date(2023, 3, 10),
    ):
        assert published in occ, f"NCCC published {published} Zulu; engine missed it"


def test_4sqrp_sss_anchors_second_sunday_and_runs_into_monday_utc(catalog):
    """
    4sqrp.com: 'The SSS is held the second Sunday night of every month (local
    time). It runs for two (2) hours from 7 PM until 9 PM central time.' 7 PM
    CST is 0100 UTC the following day, so every session lands on a Monday UTC
    even though the sponsor's rule names Sunday.
    """
    occ = expand(by_id(catalog, "4sqrp-sss"), 2026)
    assert len(occ) == 12
    assert all(o.start.weekday() == 0 for o in occ)  # Monday UTC
    assert all(o.duration_hours == 2 for o in occ)
    # Second Sunday of May 2026 is the 10th -> 0100 UTC Monday the 11th.
    may = next(o for o in occ if o.start.month == 5)
    assert may.start.date() == date(2026, 5, 11)


def test_spartan_sprint_anchors_on_first_monday_not_first_tuesday(catalog):
    """
    ars-qrp.com: 'Held on the first Monday of every month', 8-10 p.m. Eastern.
    That is NOT the same as the first Tuesday UTC: whenever the 1st falls on a
    Tuesday the two diverge by a week. September and December 2026 are both
    such months, and the earlier encoding got both wrong.
    """
    occ = expand(by_id(catalog, "ars-spartan-sprint"), 2026)
    assert len(occ) == 12
    assert all(o.start.weekday() == 1 for o in occ)  # Tuesday UTC
    dates = {o.start.month: o.start.date() for o in occ}
    assert dates[9] == date(2026, 9, 8), "first Monday Sep 7 -> Sep 8 UTC, not Sep 1"
    assert dates[12] == date(2026, 12, 8), "first Monday Dec 7 -> Dec 8 UTC, not Dec 1"


def test_first_monday_plus_one_never_equals_first_tuesday_blindly(catalog):
    """
    Guard the rule itself, not just 2026: the anchor must always be the day
    after the first Monday, which is the first Tuesday only in months whose
    1st is not a Tuesday.
    """
    from datetime import timedelta

    c = by_id(catalog, "ars-spartan-sprint")
    for y in range(2026, 2036):
        for anchor in resolve_anchors(c["recurrence"], y):
            assert anchor.weekday() == 0 and anchor.day <= 7
            assert (anchor + timedelta(days=1)).weekday() == 1


def test_sponsor_anchored_contests_declare_a_zone_and_explain_it(catalog):
    """
    A contest whose sponsor publishes local times only must name an IANA zone,
    mark its time specs wall_clock, and explain the UTC consequence -- or a
    reader will trust a UTC instant that is an hour wrong for half the year.
    """
    for cid in ("4sqrp-sss", "ars-spartan-sprint", "nzart-jock-white-field-day"):
        c = by_id(catalog, cid)
        assert c.get("timezone"), f"{cid} has no timezone"
        assert c["start"].get("wall_clock") is True, cid
        assert c["end"].get("wall_clock") is True, cid
        assert "UTC" in c["note"], cid
        # A sessioned contest is expanded from `sessions`, not from the
        # top-level pair, so an unmarked session would silently be resolved as
        # UTC no matter what the top-level specs say.
        for s in c.get("sessions", []):
            assert s["start"].get("wall_clock") is True, cid
            assert s["end"].get("wall_clock") is True, cid


# ---------------------------------------------------------------------------
# Sponsor validation -- PODXS 070 Club
#
# The 070 Club is the best-documented sponsor found so far: its contest
# calendar page states each recurrence rule in words AND publishes a projected
# date table running 2026-2035. The rules go in the catalog; the table is held
# back as the independent check, which is exactly the shape of evidence this
# project needs -- one sponsor, two statements, made without reference to us.
# ---------------------------------------------------------------------------

PODXS_PUBLISHED = {
    # club's stated rule -> its own projected dates, 2026..2035
    "podxs-pskfest": (
        "1st Sat after 1 Jan",
        ["3-Jan-26", "2-Jan-27", "8-Jan-28", "6-Jan-29", "5-Jan-30",
         "4-Jan-31", "3-Jan-32", "8-Jan-33", "7-Jan-34", "6-Jan-35"],
    ),
    "podxs-valentine-sprint": (
        "Valentine's Day",
        ["14-Feb-26", "14-Feb-27", "14-Feb-28", "14-Feb-29", "14-Feb-30",
         "14-Feb-31", "14-Feb-32", "14-Feb-33", "14-Feb-34", "14-Feb-35"],
    ),
    "podxs-st-patricks": (
        "3rd Sat of March",
        ["21-Mar-26", "20-Mar-27", "18-Mar-28", "17-Mar-29", "16-Mar-30",
         "15-Mar-31", "20-Mar-32", "19-Mar-33", "18-Mar-34", "17-Mar-35"],
    ),
    "podxs-new-member-jamboree": (
        "1st Sat in April",
        ["4-Apr-26", "3-Apr-27", "1-Apr-28", "7-Apr-29", "6-Apr-30",
         "5-Apr-31", "3-Apr-32", "2-Apr-33", "1-Apr-34", "7-Apr-35"],
    ),
    "podxs-tdw": (
        "1st weekend ending in June",
        ["5-Jun-26", "4-Jun-27", "2-Jun-28", "1-Jun-29", "31-May-30",
         "30-May-31", "4-Jun-32", "3-Jun-33", "2-Jun-34", "1-Jun-35"],
    ),
    "podxs-40m-firecracker": (
        "1st Sat after 1 July",
        ["4-Jul-26", "3-Jul-27", "8-Jul-28", "7-Jul-29", "6-Jul-30",
         "5-Jul-31", "3-Jul-32", "2-Jul-33", "8-Jul-34", "7-Jul-35"],
    ),
    "podxs-jay-hudak-80m": (
        "1st Sat in Sept",
        ["5-Sep-26", "4-Sep-27", "2-Sep-28", "1-Sep-29", "7-Sep-30",
         "6-Sep-31", "4-Sep-32", "3-Sep-33", "2-Sep-34", "1-Sep-35"],
    ),
    "podxs-160m-great-pumpkin": (
        "2nd Sat in Oct",
        ["10-Oct-26", "9-Oct-27", "14-Oct-28", "13-Oct-29", "12-Oct-30",
         "11-Oct-31", "9-Oct-32", "8-Oct-33", "14-Oct-34", "13-Oct-35"],
    ),
    "podxs-triple-play": (
        "2nd Sat in Nov",
        ["14-Nov-26", "13-Nov-27", "11-Nov-28", "10-Nov-29", "9-Nov-30",
         "8-Nov-31", "13-Nov-32", "12-Nov-33", "11-Nov-34", "10-Nov-35"],
    ),
    "podxs-triple-play-doubleheader": (
        "2nd Sat in Dec",
        ["12-Dec-26", "11-Dec-27", "9-Dec-28", "8-Dec-29", "14-Dec-30",
         "13-Dec-31", "11-Dec-32", "10-Dec-33", "9-Dec-34", "8-Dec-35"],
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, dates) for cid, (rule, dates) in sorted(PODXS_PUBLISHED.items())
])
def test_podxs_matches_clubs_own_ten_year_table(catalog, cid, rule, published):
    """
    Ten contests x ten years = 100 dates the club published itself. Every one
    must fall out of the recurrence rule alone.
    """
    c = by_id(catalog, cid)
    for offset, text in enumerate(published):
        year = 2026 + offset
        expected = datetime.strptime(text, "%d-%b-%y").date()
        occ = expand(c, year)
        assert occ, f"{cid} produced nothing for {year} (rule: {rule})"
        assert occ[0].start.date() == expected, (
            f"{cid} {year}: rule '{rule}' gave {occ[0].start.date()}, "
            f"club published {expected}"
        )


def test_podxs_january_and_july_sprints_skip_the_first_of_the_month(catalog):
    """
    '1st Sat AFTER 1 Jan' and '1st Sat AFTER 1 July' exclude the 1st itself.
    The club's table proves it: 2028 and 2033 open January 1 on a Saturday and
    the club lists Jan 8 both times; 2028 and 2034 do the same for July.
    A plain 'first Saturday' rule would be a week early in four of ten years.
    """
    for cid, month, years in (
        ("podxs-pskfest", 1, (2028, 2033)),
        ("podxs-40m-firecracker", 7, (2028, 2034)),
    ):
        c = by_id(catalog, cid)
        for y in years:
            assert date(y, month, 1).weekday() == 5, "test premise: 1st is a Saturday"
            assert expand(c, y)[0].start.day == 8


def test_podxs_tdw_can_start_in_may(catalog):
    """
    'First weekend ENDING in June' anchors on June's first Sunday and counts
    back to Friday, so the contest itself can open in May -- the club lists
    31-May-30 and 30-May-31. An anchor picked from Fridays *in June* would put
    both a week late.
    """
    c = by_id(catalog, "podxs-tdw")
    for y, expected in ((2030, date(2030, 5, 31)), (2031, date(2031, 5, 30))):
        occ = expand(c, y)[0]
        assert occ.start.date() == expected
        assert occ.start.month == 5 and occ.end.month == 6
        assert occ.start.weekday() == 4 and occ.end.weekday() == 6  # Fri -> Sun


def test_podxs_sprints_have_the_right_window_length(catalog):
    """
    Three shapes: 24-hour parties, 24-hour windows opening 2000 UTC, and the
    72-hour three-day sprints. All are outer windows -- most carry a six-hour
    operating limit, which is recorded in `note`, not in the timestamps.
    """
    hours = {
        "podxs-pskfest": 24,
        "podxs-valentine-sprint": 24,
        "podxs-st-patricks": 24,
        "podxs-new-member-jamboree": 24,
        "podxs-40m-firecracker": 24,
        "podxs-jay-hudak-80m": 24,
        "podxs-160m-great-pumpkin": 24,
        "podxs-tdw": 72,
        "podxs-triple-play": 72,
        "podxs-triple-play-doubleheader": 72,
    }
    for cid, expected in hours.items():
        occ = expand(by_id(catalog, cid), 2026)[0]
        assert abs(occ.duration_hours - expected) < 0.02, cid


def test_podxs_logs_are_due_seven_days_after(catalog):
    """070 general rules: 'All contest submissions are due 7 (seven) calendar
    days after the end of the contest.'"""
    for cid in PODXS_PUBLISHED:
        occ = expand(by_id(catalog, cid), 2026)[0]
        assert occ.log_due is not None, cid
        assert (occ.log_due - occ.end).days == 7, cid


# ---------------------------------------------------------------------------
# Sponsor validation -- AGCW-DL (fourth continent-scale sponsor, German text)
#
# AGCW states each recurrence in words and then, on several pages, adds its own
# "nächster Termin" -- the next date -- which is exactly the independent check
# this project needs. Those four dates are asserted below.
# ---------------------------------------------------------------------------

AGCW_NEXT_TERMIN = {
    # AGCW's stated rule -> the date AGCW itself gives as "nächster Termin"
    "agcw-htp-80m": ("erster Samstag im Februar", date(2026, 2, 7)),
    "agcw-htp-40m": ("erster Samstag im September", date(2026, 9, 5)),
    "agcw-yl-cw-party": ("erster Dienstag im März", date(2026, 3, 3)),
}


@pytest.mark.parametrize("cid,rule,expected", [
    (cid, rule, exp) for cid, (rule, exp) in sorted(AGCW_NEXT_TERMIN.items())
])
def test_agcw_matches_its_own_naechster_termin(catalog, cid, rule, expected):
    occ = expand(by_id(catalog, cid), 2026)
    assert len(occ) == 1
    assert occ[0].start.date() == expected, f"{cid}: rule '{rule}'"


def test_agcw_sta_runs_third_wednesday_twice_a_year(catalog):
    """
    agcw.de: 'Jeden dritten Mittwoch im Februar und jeden dritten Mittwoch im
    Oktober von 1900 bis 2030 UTC. Nächster Termin: 21. Okt. 2026.' Two legs a
    year off different months -- a composite of two nth_weekday rules.
    """
    occ = expand(by_id(catalog, "agcw-sta"), 2026)
    assert [o.start.date() for o in occ] == [date(2026, 2, 18), date(2026, 10, 21)]
    assert all(o.start.weekday() == 2 for o in occ)  # Wednesday
    assert all(o.duration_hours == 1.5 for o in occ)


def test_agcw_vhf_uhf_has_four_dates_with_two_sessions_each(catalog):
    """
    agcw.de: '1. Januar, 3. Samstag im März, 2. Samstag im Juni, 4. Samstag im
    September ... VHF von 14.00 bis 17.00 UTC auf 2m und UHF von 17.00 bis
    18.00 UTC auf 70cm'. Four anchors x two sessions = eight occurrences, and
    the UHF leg must start exactly where the VHF leg ends.
    """
    occ = expand(by_id(catalog, "agcw-vhf-uhf"), 2026)
    assert len(occ) == 8
    anchors = sorted({o.start.date() for o in occ})
    assert anchors == [
        date(2026, 1, 1), date(2026, 3, 21), date(2026, 6, 13), date(2026, 9, 26)
    ]
    for anchor in anchors:
        day = sorted((o for o in occ if o.start.date() == anchor), key=lambda o: o.start)
        assert len(day) == 2
        assert day[0].duration_hours == 3 and day[1].duration_hours == 1
        assert day[0].end == day[1].start, "UHF leg must start as the VHF leg ends"


def test_agcw_fixed_date_contests_track_the_calendar_not_the_week(catalog):
    """
    Three AGCW contests hang off fixed dates -- New Year's Day, May 1st, and
    German Unity Day. They must land on the same date every year and drift
    through the week, unlike everything anchored on an nth weekday.
    """
    for cid, (month, day) in (
        ("agcw-hnyc", (1, 1)),
        ("agcw-qrp-qrp-party", (5, 1)),
        ("agcw-dtc", (10, 3)),
    ):
        weekdays = set()
        for y in range(2026, 2036):
            occ = expand(by_id(catalog, cid), y)[0]
            assert (occ.start.month, occ.start.day) == (month, day)
            weekdays.add(occ.start.weekday())
        assert len(weekdays) > 1, f"{cid} should drift through the week"


def test_agcw_dtc_entry_is_open_but_every_qso_needs_a_german_station(catalog):
    """
    AGCW: 'Teilnehmen können alle Funkamateurinnen und Funamateure' but
    'Mindestens eine der an einem QSO beteiligten Stationen muss sich in
    Deutschland befinden.' Those are different claims, and collapsing them into
    a single can_enter boolean would wrongly hide the contest from DX -- who can
    enter it perfectly well, just working DL only.
    """
    e = eligibility_for(by_id(catalog, "agcw-dtc"), "K")
    assert e["can_enter"] is True
    assert "Deutschland" in e["practical"] or "German" in e["practical"]


def test_agcw_zap_merit_is_flagged_unverified_for_its_missing_end_time(catalog):
    """
    AGCW publishes 'jeden Montag, Vorloggen ab 1740 UTC, Telegrammsendung 1800
    UTC' and no closing time. The stored end is a placeholder, so the record
    must stay verified:false and say why -- a confident wrong duration is worse
    than an admitted gap.
    """
    c = by_id(catalog, "agcw-zap-merit")
    assert c["verified"] is False
    assert "PLACEHOLDER" in c["note"]
    occ = expand(c, 2026)
    assert 51 <= len(occ) <= 53
    assert {o.start.weekday() for o in occ} == {0}  # Monday


# ---------------------------------------------------------------------------
# Sponsor validation -- BARTG, SARTG, 10-10 International, FISTS
# ---------------------------------------------------------------------------

BARTG_PUBLISHED = {
    # BARTG states the rule in its rules PDF and the dates on its web page.
    "bartg-hf-rtty": (
        "third full weekend of March",
        [(2027, 3, 20), (2028, 3, 18), (2029, 3, 17),
         (2030, 3, 16), (2031, 3, 15), (2032, 3, 20)],
    ),
    "bartg-sprint": (
        "fourth full weekend of January",
        [(2027, 1, 23), (2028, 1, 22), (2029, 1, 27),
         (2030, 1, 26), (2031, 1, 25), (2032, 1, 24)],
    ),
    "bartg-sprint75": (
        "fourth Sunday of April",
        [(2027, 4, 25), (2028, 4, 23), (2029, 4, 22),
         (2030, 4, 28), (2031, 4, 27), (2032, 4, 25)],
    ),
    "bartg-sprint-psk63": (
        "third Sunday of September",
        [(2026, 9, 20), (2027, 9, 19), (2028, 9, 17),
         (2029, 9, 16), (2030, 9, 15), (2031, 9, 21)],
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, dates) for cid, (rule, dates) in sorted(BARTG_PUBLISHED.items())
])
def test_bartg_matches_its_own_published_schedules(catalog, cid, rule, published):
    """
    BARTG is unusual in publishing both halves separately: the rules PDF states
    the recurrence in words, and the contest page lists six years of dates. The
    rule goes in the catalog; the dates are the check.
    """
    c = by_id(catalog, cid)
    for y, m, day in published:
        occ = expand(c, y)
        assert occ, f"{cid} produced nothing for {y}"
        assert occ[0].start.date() == date(y, m, day), f"{cid} {y}: rule '{rule}'"


def test_bartg_january_sprint_needs_full_weekends_not_saturdays(catalog):
    """
    January 2032 has five Saturdays but only four FULL weekends -- Jan 31 2032
    is a Saturday whose Sunday falls in February. BARTG publishes 24 January
    2032, the fourth full weekend. A 'fourth Saturday' reading gives the same
    answer here, but a 'last full weekend' or five-Saturday reading would not,
    and the distinction is exactly the one this engine exists to get right.
    """
    assert len(_saturdays_in_month(2032, 1)) == 5
    assert len(_full_weekends_in_month(2032, 1)) == 4
    occ = expand(by_id(catalog, "bartg-sprint"), 2032)[0]
    assert occ.start.date() == date(2032, 1, 24)


def test_bartg_sprint75_is_fourth_sunday_not_last_sunday(catalog):
    """
    April 2028 and April 2029 both have five Sundays, and BARTG lists the
    fourth in each (23rd and 22nd). 'Last Sunday' would give the 30th and 29th.
    """
    c = by_id(catalog, "bartg-sprint75")
    assert expand(c, 2028)[0].start.date() == date(2028, 4, 23)
    assert expand(c, 2029)[0].start.date() == date(2029, 4, 22)


def test_sartg_ww_rtty_runs_three_separate_periods(catalog):
    """
    sartg.com: 'Third full weekend in August', '15 - 16 August 2026', and
    'Three (3) separate periods: 0000 - 0800 UTC Saturday / 1600 - 2400 UTC
    Saturday / 0800 - 1600 UTC Sunday'. Three eight-hour blocks with real gaps
    between them, not a continuous 48-hour run.
    """
    occ = expand(by_id(catalog, "sartg-ww-rtty"), 2026)
    assert len(occ) == 3
    assert occ[0].start.date() == date(2026, 8, 15)  # SARTG's published date
    assert all(o.duration_hours == 8 for o in occ)
    # There must be a gap between period 1 and period 2, and between 2 and 3.
    assert occ[1].start > occ[0].end
    assert occ[2].start > occ[1].end


def test_sartg_ww_second_period_2400_normalises_to_midnight(catalog):
    """
    SARTG writes the second period as '1600 - 2400 UTC Saturday'. 2400 is a
    legitimate way to write end-of-day and must roll into the next date rather
    than throwing or clamping to 23:00.
    """
    second = expand(by_id(catalog, "sartg-ww-rtty"), 2026)[1]
    assert second.start.hour == 16
    assert second.end.hour == 0
    assert second.end.date() == date(2026, 8, 16)


TENTEN_2026 = {
    "tenten-winter-phone": (date(2026, 2, 7), date(2026, 2, 8)),
    "tenten-summer-phone": (date(2026, 8, 1), date(2026, 8, 2)),
    "tenten-day-sprint": (date(2026, 10, 10), date(2026, 10, 10)),
}


@pytest.mark.parametrize("cid,expected", sorted(TENTEN_2026.items()))
def test_tenten_matches_its_published_2026_schedule(catalog, cid, expected):
    """
    10-10 rule 5.2.2 states each recurrence in words ('the first full weekend
    in February', 'the first full weekend in August', 'October 10th'); the
    club's QSO Party Schedule page independently lists Feb 7-8, Aug 1-2 and
    Oct 10 for 2026.
    """
    occ = expand(by_id(catalog, cid), 2026)[0]
    assert (occ.start.date(), occ.end.date()) == expected


def test_tenten_membership_limits_logs_not_entry(catalog):
    """
    10-10 rule 5.2.1: 'QSO Parties are open to all amateurs with operating
    privileges on the 10 meter band, however, logs will be accepted only from
    active members'. Anyone may operate; only members are scored. Filtering the
    contest out for non-members would hide an event they can absolutely work.
    """
    e = eligibility_for(by_id(catalog, "tenten-winter-phone"), "K")
    assert e["can_enter"] is True
    assert "member" in e["practical"].lower()


FISTS_SPRINT_IDS = [
    "fists-sprint-winter-sat", "fists-sprint-winter-sun",
    "fists-sprint-spring-sat", "fists-sprint-spring-sun",
    "fists-sprint-summer-sat", "fists-sprint-summer-sun",
    "fists-sprint-fall-sat", "fists-sprint-fall-sun",
]


def test_fists_sprints_ran_in_2025_on_their_stated_weekends(catalog):
    """
    fistsna.org: Saturday sprints are the second Saturday of Feb/May/Aug/Nov,
    Sunday sprints the third Sunday of the same months, all 0000-2359 UTC.
    """
    for cid in FISTS_SPRINT_IDS:
        occ = expand(by_id(catalog, cid), 2025)
        assert len(occ) == 1, cid
        o = occ[0]
        assert o.start.month in (2, 5, 8, 11), cid
        if cid.endswith("-sat"):
            assert o.start.weekday() == 5 and 8 <= o.start.day <= 14, cid
        else:
            assert o.start.weekday() == 6 and 15 <= o.start.day <= 21, cid


def test_fists_sprints_generate_nothing_from_2026(catalog):
    """
    fistsna.org: 'Sprints will NOT continue in 2026 due to a lack of
    sufficiant participation.' The records keep the verified rule but must not
    put dates on a 2026 calendar that the club has said will not happen.
    """
    for cid in FISTS_SPRINT_IDS:
        c = by_id(catalog, cid)
        assert c.get("active_until") == 2025, cid
        assert expand(c, 2026) == [], cid
        assert expand(c, 2030) == [], cid


def test_suspended_contests_explain_themselves(catalog):
    """A record that silently generates nothing is indistinguishable from a
    broken one. Anything with active_until must say why in its note."""
    for c in catalog:
        if c.get("active_until"):
            assert c.get("note"), f"{c['id']} is time-limited with no note"


# ---------------------------------------------------------------------------
# Sponsor validation -- JARL, RAC, WIA, Oceania DX, NZART, LABRE, ORARI
#
# The pass that opened Asia, Oceania and South America. Every rule below is
# encoded from the sponsor's own wording; every date below was published by the
# same sponsor separately from that wording, on the same page or in an earlier
# year's rules. The rule goes in the catalog, the dates are the check, and
# neither came from an aggregator.
# ---------------------------------------------------------------------------

WORLD_PUBLISHED = {
    "jarl-aa-dx-cw": (
        "third Saturday in June",
        [(2026, 6, 20)],
    ),
    "jarl-aa-dx-phone": (
        "first Saturday in September",
        [(2026, 9, 5)],
    ),
    "jarl-ww-rtty": (
        "third Saturday in October",
        [(2026, 10, 17)],
    ),
    "rac-canada-day": (
        "Canada Day, July 1",
        [(2025, 7, 1), (2026, 7, 1)],
    ),
    "wia-remembrance-day": (
        "weekend in August closest to the 15th",
        [(2023, 8, 12), (2026, 8, 15)],
    ),
    "wia-john-moyle-field-day": (
        "3rd full weekend in March",
        [(2026, 3, 21)],
    ),
    "wia-vk-shires": (
        "weekend prior to the second Monday of June",
        [(2026, 6, 6), (2027, 6, 12)],
    ),
    "wia-harry-angel-sprint": (
        "first Saturday in May",
        [(2026, 5, 2)],
    ),
    "wia-trans-tasman": (
        "Saturday night of the third full weekend of July",
        [(2026, 7, 18)],
    ),
    "ocdx-phone": (
        "first full weekend in October",
        [(2024, 10, 5), (2026, 10, 3)],
    ),
    "ocdx-cw": (
        "second full weekend in October",
        [(2024, 10, 12), (2026, 10, 10)],
    ),
    "nzart-jock-white-field-day": (
        "last full weekend in February, moved a week when February has only three",
        [(2026, 2, 28), (2027, 2, 27)],
    ),
    "nzart-sangster-shield": (
        "third Saturday of May",
        [(2026, 5, 16)],
    ),
    "nzart-memorial-contest": (
        "first Saturday in July",
        [(2026, 7, 4)],
    ),
    "labre-dx": (
        "3rd (third) weekend of July",
        [(2026, 7, 18)],
    ),
    "orari-north-jakarta-dx": (
        "every June 2nd weekend",
        [(2026, 6, 13), (2027, 6, 12), (2028, 6, 10), (2029, 6, 9)],
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, dates) for cid, (rule, dates) in sorted(WORLD_PUBLISHED.items())
])
def test_world_sponsors_match_their_own_published_dates(catalog, cid, rule, published):
    c = by_id(catalog, cid)
    for y, m, day in published:
        occ = expand(c, y)
        assert occ, f"{cid} produced nothing for {y}"
        assert occ[0].start.date() == date(y, m, day), f"{cid} {y}: rule '{rule}'"


# ---------------------------------------------------------------------------
# SARL -- and the reason Africa was stuck at one record.
#
# sarl.org.za served an expired certificate, then became a parked cPanel page.
# The league had moved to mysarl.org.za, which publishes a per-contest rules
# PDF for each event AND its own SARL-Contests-2026-Calendar.ics. That .ics is
# the independent second source every record here is tested against: its times
# carry TZID="South Africa Standard Time", a fixed +0200 with no DST, and SARL's
# own X-CALSTART confirms the offset by writing 09:00 local as 07:00Z.
# ---------------------------------------------------------------------------

SARL_PUBLISHED = {
    "sarl-hf-phone": (
        "HF Phone Contest on (1st Sunday) 2 August 2026 14:00 to 17:00 UTC",
        [(2026, 8, 2)],
    ),
    "sarl-hf-digital": (
        "HF Digital Contest on (2nd Sunday) 9 August 2026 13:00 UTC to 16:00 UTC",
        [(2026, 8, 9)],
    ),
    "sarl-hf-cw": (
        "HF CW Contest on (4th Sunday) 23 August 2026 14:00 to 17:00 UTC",
        [(2026, 8, 23)],
    ),
    "sarl-africa-all-mode-dx": (
        "12:00 UTC on Saturday 28 March to 12:00 UTC on Sunday 29 March 2026 "
        "(The 4th full weekend of March)",
        [(2026, 3, 28)],
    ),
    "sarl-equinox-6m-march": (
        "From 00:01UTC on the 16th March to 23:59 UTC on 15th April",
        [(2026, 3, 16)],
    ),
    "sarl-equinox-6m-september": (
        "From 00:01UTC on the 16th September to 23:59 UTC on 15th October",
        [(2026, 9, 16)],
    ),
    "sarl-qrp-summer": (
        "Summer Leg: 3rd Saturday of January - 17 January 2026 - from 07:00 to 09:00 UTC",
        [(2026, 1, 17)],
    ),
    "sarl-qrp-autumn": (
        "Autumn Leg: 1st Saturday of April - 4 April 2026 - from 13:30 to 15:30 UTC",
        [(2026, 4, 4)],
    ),
    "sarl-qrp-winter": (
        "Winter Leg: 3rd Saturday of July - 18 July 2026 - from 07:00 to 09:00 UTC",
        [(2026, 7, 18)],
    ),
    "sarl-qrp-spring": (
        "Spring Leg: 1st Saturday of November - 7 November 2026 - from 13:30 to 15:30 UTC",
        [(2026, 11, 7)],
    ),
    "sarl-hamnet-40m-sec": (
        "12:00 to 14:00 UTC on (the 1st Sunday) 1 March 2026",
        [(2026, 3, 1)],
    ),
    "sarl-top-band-qso": (
        "Wednesday 2026/06/03 22:01 UTC, per SARL's own Date Ordered List",
        [(2026, 6, 3)],
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, dates) for cid, (rule, dates) in sorted(SARL_PUBLISHED.items())
])
def test_sarl_contests_match_the_dates_sarl_publishes(catalog, cid, rule, published):
    c = by_id(catalog, cid)
    for y, m, day in published:
        occ = expand(c, y)
        assert occ, f"{cid} produced nothing for {y}"
        assert occ[0].start.date() == date(y, m, day), f"{cid} {y}: rule '{rule}'"


def test_sarl_two_leg_contests_produce_both_legs(catalog):
    """
    Field Day and the Africa FT4 contest each run twice a year off ONE record,
    because both legs share a start and end offset and differ only in the
    weekend they anchor to. A record that produced one leg would silently drop
    half the contest, which no date-level test on the first occurrence catches.
    """
    fd = [o.start.date() for o in expand(by_id(catalog, "sarl-national-field-day"), 2026)]
    assert fd == [date(2026, 3, 14), date(2026, 9, 5)]

    ft4 = [o.start.date() for o in expand(by_id(catalog, "sarl-africa-ft4"), 2026)]
    assert ft4 == [date(2026, 4, 11), date(2026, 9, 12)]


def test_sarl_hf_series_runs_the_hours_sarl_states(catalog):
    """
    The digital leg starts an hour earlier than the other two. That is SARL's
    own wording -- '13:00 UTC to 16:00 UTC' against '14:00 to 17:00' -- and it
    is the kind of detail a copied schedule regularises away.
    """
    hours = {}
    for cid in ("sarl-hf-phone", "sarl-hf-digital", "sarl-hf-cw"):
        (o,) = expand(by_id(catalog, cid), 2026)
        hours[cid] = (o.start.hour, o.end.hour)
    assert hours == {
        "sarl-hf-phone": (14, 17),
        "sarl-hf-digital": (13, 16),
        "sarl-hf-cw": (14, 17),
    }


def test_sarl_equinox_legs_run_a_month_and_end_where_sarl_says(catalog):
    """
    Two records rather than one, because the end offsets differ: 16 March to
    15 April is 30 days and 16 September to 15 October is 29. One record
    carries one start/end pair, so a single record would be wrong by a day in
    one leg or the other.
    """
    (mar,) = expand(by_id(catalog, "sarl-equinox-6m-march"), 2026)
    assert (mar.start.date(), mar.end.date()) == (date(2026, 3, 16), date(2026, 4, 15))

    (sep,) = expand(by_id(catalog, "sarl-equinox-6m-september"), 2026)
    assert (sep.start.date(), sep.end.date()) == (date(2026, 9, 16), date(2026, 10, 15))

    for o in (mar, sep):
        assert (o.start.hour, o.start.minute) == (0, 1)
        assert (o.end.hour, o.end.minute) == (23, 59)


def test_africa_all_mode_deadline_matches_the_date_sarl_prints(catalog):
    """
    SARL states this deadline BOTH ways -- '15 days after the contest' and
    'Monday 13 April 2026' -- so the span can be encoded against the sponsor's
    own arithmetic rather than inferred from one year's date.
    """
    c = by_id(catalog, "sarl-africa-all-mode-dx")
    assert c["log_deadline_days"] == 15
    (o,) = expand(c, 2026)
    assert o.log_due.date() == date(2026, 4, 13)


# The legs, which the first-occurrence table above cannot see. SARL runs most of
# its programme two or four times a year off one rule, and a record that
# produced only the first would look right in every date test and be missing
# half the contest.
SARL_LEGS = {
    "sarl-club-40m": [(2026, 1, 24), (2026, 4, 25), (2026, 7, 25), (2026, 11, 28)],
    "sarl-club-20m": [(2026, 3, 21), (2026, 6, 20)],
    "sarl-club-80m": [(2026, 2, 18), (2026, 5, 20), (2026, 8, 19), (2026, 10, 21)],
    "sarl-80m-qso-party": [(2026, 4, 2), (2026, 10, 1)],
    "sarl-yl-qso-party": [(2026, 3, 7), (2026, 8, 9)],
    "sarl-youth-qso-party": [(2026, 6, 16), (2026, 8, 15)],
    "sarl-newbie-qso-party": [(2026, 7, 4), (2026, 11, 21)],
}


@pytest.mark.parametrize("cid,published", sorted(SARL_LEGS.items()))
def test_sarl_multi_leg_records_produce_every_leg(catalog, cid, published):
    got = [o.start.date() for o in expand(by_id(catalog, cid), 2026)]
    assert got == [date(*d) for d in published], cid


def test_sarl_club_contests_run_in_the_months_sarl_names(catalog):
    """
    The club contests are "the 4th Saturday of a month" and "the third
    Wednesday of a month" -- but only in four months of the year, and only two
    for the 20 m one. Dropping the month list would put eight extra contests a
    year on the calendar that SARL does not run, which is the same class of
    error as NZART's April-and-August sprints reading as weekly.
    """
    months = {
        "sarl-club-40m": [1, 4, 7, 11],
        "sarl-club-20m": [3, 6],
        "sarl-club-80m": [2, 5, 8, 10],
    }
    for cid, expected in months.items():
        assert by_id(catalog, cid)["recurrence"]["months"] == expected, cid
        assert len(expand(by_id(catalog, cid), 2026)) == len(expected), cid


def test_sarl_parties_mix_a_fixed_date_with_an_ordinal(catalog):
    """
    Two of these hang one leg on a national holiday and the other on an
    ordinal weekday: the YL party runs on the first Saturday of March and then
    on National Women's Day, 9 August, which is a fixed date; the Youth party
    runs on National Youth Day, 16 June, and then the third Saturday of August.

    One record each, because both legs share their hour -- and `composite` can
    hold rules of different types, which is what makes that possible.
    """
    yl = expand(by_id(catalog, "sarl-yl-qso-party"), 2027)
    assert [o.start.date() for o in yl] == [date(2027, 3, 6), date(2027, 8, 9)]

    youth = expand(by_id(catalog, "sarl-youth-qso-party"), 2027)
    assert [o.start.date() for o in youth] == [date(2027, 6, 16), date(2027, 8, 21)]


def test_sarl_top_band_is_flagged_rather_than_guessed(catalog):
    """
    Two problems, either of which alone would justify the flag.

    SARL's rules prose says the contest starts "22:01 UTC 4 June (00:01 CAT)
    Thursday 4 June", but 22:01 UTC on Thursday the 4th is 00:01 CAT on FRIDAY
    the 5th. SARL's own Date Ordered List says Wednesday 3 June 22:01 UTC,
    which is 00:01 CAT Thursday -- self-consistent, so that is what is encoded.

    And "the first full week of June" has two readings that agree in 2026 and
    diverge in 2027: a Monday-to-Sunday week wholly inside June puts the
    Thursday on the 10th, while the first week containing the whole
    Thursday-to-Sunday block puts it on the 3rd. So no ordinal rule is encoded
    at all -- only the date SARL published.
    """
    c = by_id(catalog, "sarl-top-band-qso")
    assert c["recurrence"]["type"] == "manual"
    assert c["verified"] is False
    assert "first full week" in c["note"]

    (o,) = expand(c, 2026)
    assert o.start.date() == date(2026, 6, 3)
    assert (o.start.hour, o.start.minute) == (22, 1)
    assert o.end.date() == date(2026, 6, 7)
    assert (o.end.hour, o.end.minute) == (21, 59)

    # No year SARL has not published. Absent beats guessed.
    assert expand(c, 2027) == []


def test_sarl_club_eligibility_is_marked_as_our_inference(catalog):
    """
    The club contests require an "Abbreviated Club Callsign" derived from an
    ICASA-issued callsign, and ICASA is the South African regulator -- so a
    station elsewhere has no valid exchange to send. That is a reading, not
    SARL's wording, so the eligibility carries verified: false and says so.
    Every other SARL record's eligibility quotes a sentence and is verified.
    """
    for cid in ("sarl-club-40m", "sarl-club-20m", "sarl-club-80m"):
        e = by_id(catalog, cid)["eligibility"]
        assert e["scope"] == "entity_list" and e["entities"] == ["ZS"], cid
        assert e["verified"] is False, cid
        assert "READING" in e["note"], cid

    for cid in ("sarl-hamnet-40m-sec", "sarl-top-band-qso"):
        e = by_id(catalog, cid)["eligibility"]
        assert e["scope"] == "entity_list" and e["verified"] is True, cid


def test_sarl_entry_is_worldwide_which_corrects_an_earlier_guess(catalog):
    """
    This catalog previously carried SARL HF Phone as ZS-only, flagged
    verified: false with the note 'SARL contests are generally South African
    entrants only. Confirm.' Reading the rules confirmed the opposite: the
    scoring table's Area 9 is 'Stations in the rest of the world', and the two
    Africa DX contests say worldwide entry in as many words.

    The flag did its job, so this test pins the correction rather than the
    guess -- an unverified record that was WRONG is the case the flag exists
    for, and it should not be able to come back quietly.
    """
    for cid in ("sarl-hf-phone", "sarl-hf-digital", "sarl-hf-cw",
                "sarl-africa-all-mode-dx", "sarl-africa-ft4",
                "sarl-equinox-6m-march", "sarl-national-field-day"):
        c = by_id(catalog, cid)
        assert c["eligibility"]["scope"] == "worldwide", cid
        assert eligibility_for(c, "K")["can_enter"], cid
        assert c["verified"], cid


# WIA: "Weekend in August closest to the 15th". Seven years, seven weekdays for
# the 15th, so the whole table is covered -- 2019 is skipped only because it
# would repeat a weekday. The rule can never be ambiguous: the nearest instance
# of a weekday is at most three days away, and a tie would need a distance of
# 3.5, which does not exist because seven is odd.
REMEMBRANCE_DAY_SHIFTS = [
    (2018, 2, 18),   # the 15th is a Wednesday -> forward 3
    (2020, 5, 15),   # ...a Saturday           -> already there
    (2021, 6, 14),   # ...a Sunday             -> back 1
    (2022, 0, 13),   # ...a Monday             -> back 2
    (2023, 1, 12),   # ...a Tuesday            -> back 3
    (2024, 3, 17),   # ...a Thursday           -> forward 2
    (2025, 4, 16),   # ...a Friday             -> forward 1
]


@pytest.mark.parametrize("year,weekday_of_15th,day", REMEMBRANCE_DAY_SHIFTS)
def test_nearest_weekday_resolves_every_case_to_a_saturday(
    catalog, year, weekday_of_15th, day
):
    assert date(year, 8, 15).weekday() == weekday_of_15th
    anchors = resolve_anchors(
        by_id(catalog, "wia-remembrance-day")["recurrence"], year
    )
    assert anchors == [date(year, 8, day)]
    assert anchors[0].weekday() == 5
    assert abs((anchors[0] - date(year, 8, 15)).days) <= 3


# RAC's own rules PDFs, one per year. The December Saturday ordinal is 4th,
# 3rd, 3rd, 3rd, 5th, 4th, 3rd -- and 2026 is not a Saturday at all.
RAC_WINTER_PUBLISHED = [
    (2019, 12, 28), (2020, 12, 19), (2021, 12, 18), (2022, 12, 17),
    (2023, 12, 30), (2024, 12, 28), (2025, 12, 20), (2026, 12, 27),
]


def test_rac_canada_winter_reproduces_every_date_rac_published(catalog):
    c = by_id(catalog, "rac-canada-winter")
    for y, m, day in RAC_WINTER_PUBLISHED:
        occ = expand(c, y)
        assert occ, f"rac-canada-winter produced nothing for {y}"
        assert occ[0].start.date() == date(y, m, day)


def test_rac_canada_winter_is_manual_because_no_rule_fits(catalog):
    """
    The point of `manual` is that it is used only where a rule would be a guess.
    RAC announces this date each year: the eight dates it has published are not
    a consistent ordinal Saturday, and 2026's is a Sunday. A record that fitted
    an ordinal to them would print confident dates for years RAC has not set.
    """
    ordinals = set()
    for y, m, day in RAC_WINTER_PUBLISHED:
        d = date(y, m, day)
        if d.weekday() == 5:
            ordinals.add(sum(1 for s in _saturdays_in_month(y, m) if s <= d))
    assert len(ordinals) > 1, "an ordinal Saturday would have fitted after all"
    assert date(2026, 12, 27).weekday() == 6  # Sunday
    # ...and the years RAC has not announced are simply absent, not guessed.
    assert expand(by_id(catalog, "rac-canada-winter"), 2027) == []


def test_nzart_field_day_moves_when_february_has_three_full_weekends(catalog):
    """
    NZART: 'when February only has three full weekends then field day will be
    held on Saturday 28th February and Sunday 1st March ... This will occur in
    2026.' The last-full-weekend Saturday is February 21 exactly when February
    has 28 days and starts on a Sunday, which is precisely that case, so the
    exclusion is the rule rather than a patch over one year.
    """
    c = by_id(catalog, "nzart-jock-white-field-day")
    assert len(_full_weekends_in_month(2026, 2)) == 3
    assert _full_weekends_in_month(2026, 2)[-1] == date(2026, 2, 21)
    assert expand(c, 2026)[0].start.date() == date(2026, 2, 28)
    # A four-full-weekend February is untouched by the exclusion.
    assert len(_full_weekends_in_month(2027, 2)) == 4
    assert expand(c, 2027)[0].start.date() == date(2027, 2, 27)


def test_nzart_field_day_runs_two_sessions_on_new_zealand_time(catalog):
    """
    1500-2400 Saturday and 0600-1500 Sunday NZDT. New Zealand is UTC+13 in
    February, so both sessions land on UTC dates that are not the local ones --
    which is the whole reason the record is wall-clock rather than UTC.
    """
    occ = expand(by_id(catalog, "nzart-jock-white-field-day"), 2026)
    assert len(occ) == 2
    assert [o.duration_hours for o in occ] == [9.0, 9.0]
    assert occ[0].start == datetime(2026, 2, 28, 2, 0, tzinfo=UTC)
    assert occ[1].end == datetime(2026, 3, 1, 2, 0, tzinfo=UTC)


NZART_SPRINT_IDS = ("nzart-sprint-cw", "nzart-sprint-ssb", "nzart-sprint-ft4")


@pytest.mark.parametrize("cid", NZART_SPRINT_IDS)
def test_nzart_sprints_run_every_tuesday_in_april_and_august_only(catalog, cid):
    """
    'Each Tuesday in April and August' -- a weekly rule narrowed to a season.
    Encoded as `weekly` with `months` rather than as a composite of ordinal
    Tuesdays: neither April nor August 2026 has a fifth Tuesday, and a composite
    would have to name one, so the whole contest would vanish that year.
    """
    occ = expand(by_id(catalog, cid), 2026)
    assert {o.start.weekday() for o in occ} == {1}  # Tuesday
    assert {o.start.month for o in occ} == {4, 8}
    assert len(occ) == 8  # four Tuesdays in each month, 2026
    assert occ[0].start.date() == date(2026, 4, 7)
    assert occ[-1].start.date() == date(2026, 8, 25)


def test_nzart_sprints_are_three_back_to_back_windows(catalog):
    """
    Three modes, three 29-minute windows, one evening, scored separately -- so
    three records. Each ends one minute before the next begins.
    """
    firsts = [expand(by_id(catalog, cid), 2026)[0] for cid in NZART_SPRINT_IDS]
    assert [o.start.strftime("%H%M") for o in firsts] == ["0800", "0830", "0900"]
    assert [o.end.strftime("%H%M") for o in firsts] == ["0829", "0859", "0929"]
    assert len({o.start.date() for o in firsts}) == 1


def test_jarl_rtty_log_deadline_is_the_tenth_day_after_the_end(catalog):
    """
    JARL: 'Logs must be submitted no later than 24:00 UTC on the 10th day after
    the end of the contest.' The contest ends at 24:00 UTC on October 18 2026,
    which this catalog stores as the instant 00:00 on the 19th, so ten days
    later is 00:00 on the 29th -- 24:00 on the 28th, the tenth day after the
    18th. The two All Asian legs deliberately carry no deadline field, because
    the same arithmetic there lands a day past the date JARL prints.
    """
    o = expand(by_id(catalog, "jarl-ww-rtty"), 2026)[0]
    assert o.end == datetime(2026, 10, 19, 0, 0, tzinfo=UTC)
    assert o.log_due == datetime(2026, 10, 29, 0, 0, tzinfo=UTC)
    for cid in ("jarl-aa-dx-cw", "jarl-aa-dx-phone"):
        assert "log_deadline_days" not in by_id(catalog, cid)


def test_oceania_dx_is_two_consecutive_full_weekends(catalog):
    """
    Phone on the first full weekend of October, CW on the second. The committee
    publishes only the year's dates; the rule in words comes from co-sponsor WIA.
    """
    for y in (2024, 2026):
        phone = expand(by_id(catalog, "ocdx-phone"), y)[0]
        cw = expand(by_id(catalog, "ocdx-cw"), y)[0]
        assert (cw.start - phone.start).days == 7
        assert phone.start.weekday() == cw.start.weekday() == 5


# ---------------------------------------------------------------------------
# Sponsor validation -- REF, UBA, VERON, PZK/SP DX Club, PK RVG, CRK/SARA,
# ARI, URE
#
# The Tier 2 European pass. Most of these societies publish only in their own
# language, so each record carries the rule in the sponsor's own words; the
# dates below were published by the same sponsor separately from that wording,
# in another year's rules or on the sponsor's own calendar page. Where a
# sponsor's calendar is an aggregator of other people's contests -- REF's and
# ARI's are, and UBA's is except for the rows it marks as its own -- it was not
# used at all.
# ---------------------------------------------------------------------------

EUROPE_TIER2_PUBLISHED = {
    "ref-coupe-du-ref-cw": (
        "dernier week-end entier du mois de janvier",
        [(2025, 1, 25), (2026, 1, 24)],
    ),
    "ref-coupe-du-ref-ssb": (
        "dernier week-end entier du mois de fevrier",
        [(2025, 2, 22), (2026, 2, 21)],
    ),
    "ref-160m": (
        "troisieme week-end de novembre",
        [(2025, 11, 15), (2026, 11, 21)],
    ),
    "ref-ddfm-50mhz": (
        "le deuxieme samedi de juin",
        [(2025, 6, 14), (2026, 6, 13)],
    ),
    "uba-dx-ssb": (
        "starts every year on the last Saturday of January",
        [(2026, 1, 31)],
    ),
    "uba-dx-cw": (
        "starts every year on the last Saturday of February",
        [(2026, 2, 28)],
    ),
    "uba-psk63-prefix": (
        "every year the 2nd weekend of january",
        [(2026, 1, 10), (2027, 1, 9)],
    ),
    "pacc": (
        "het tweede volle weekend van februari",
        [(2026, 2, 14), (2027, 2, 13), (2028, 2, 12), (2029, 2, 10)],
    ),
    "sp-dx-contest": (
        "pierwszy pelny weekend kwietnia",
        [(2025, 4, 5), (2026, 4, 4)],
    ),
    "sp-dx-rtty": (
        "the 4th full weekend of April",
        [(2026, 4, 25)],
    ),
    "ok-om-dx-ssb": (
        "second weekend in April",
        [(2026, 4, 11)],
    ),
    "ok-om-dx-cw": (
        "second (full) weekend in November",
        [(2026, 11, 14)],
    ),
    "ok-dx-rtty": (
        "3rd full weekend in December",
        [(2026, 12, 19)],
    ),
    "ari-international-dx": (
        "il primo weekend completo di Maggio",
        [(2026, 5, 2)],
    ),
    "ari-contest-sezioni-hf": (
        "ogni secondo week-end completo di Giugno",
        [(2026, 6, 13)],
    ),
    "ari-40-80": (
        "il secondo weekend completo di Dicembre",
        [(2025, 12, 13), (2026, 12, 12)],
    ),
    "ure-rey-de-espana-cw": (
        "3rd full weekend of May",
        [(2026, 5, 16)],
    ),
    "ure-rey-de-espana-ssb": (
        "4rd full weekend of June",  # URE's typo, quoted as written
        [(2026, 6, 27)],
    ),
    "ure-eapsk63": (
        "segundo fin de semana del mes de marzo",
        [(2026, 3, 14)],
    ),
    "ure-cncw": (
        "3rd full weekend of July",
        [(2026, 7, 18)],
    ),
    "ure-cme": (
        "2nd full weekend of August",
        [(2026, 8, 8)],
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, dates) for cid, (rule, dates) in sorted(EUROPE_TIER2_PUBLISHED.items())
])
def test_tier2_european_societies_match_their_own_published_dates(
    catalog, cid, rule, published
):
    c = by_id(catalog, cid)
    for y, m, day in published:
        occ = expand(c, y)
        assert occ, f"{cid} produced nothing for {y}"
        assert occ[0].start.date() == date(y, m, day), f"{cid} {y}: rule '{rule}'"


def test_uba_dx_is_the_last_saturday_not_the_last_full_weekend(catalog):
    """
    UBA: 'starts every year on the last Saturday of January'. The two readings
    diverge in 2026 and UBA's own dates settle it -- January 31 is a Saturday
    and February 1 a Sunday, so the last FULL weekend of January 2026 is the
    24th, but UBA published January 31 - February 1.
    """
    assert _full_weekends_in_month(2026, 1)[-1] == date(2026, 1, 24)
    assert expand(by_id(catalog, "uba-dx-ssb"), 2026)[0].start.date() == date(
        2026, 1, 31
    )
    # 2026 separates the two readings on both legs: February 28 is a Saturday
    # whose Sunday falls in March, so the last full weekend of February is the
    # 21st -- and UBA published February 28 - March 1.
    assert _full_weekends_in_month(2026, 2)[-1] == date(2026, 2, 21)
    assert expand(by_id(catalog, "uba-dx-cw"), 2026)[0].start.date() == date(
        2026, 2, 28
    )


# UBA prints a log deadline beside each ON Contest leg. All four are the leg's
# own date plus five days, which is what makes 'no later than 5 days after the
# contest' encodable rather than a fixed date to be quoted.
UBA_ON_LEGS = [
    ("uba-on-6m", date(2026, 9, 27), date(2026, 10, 2)),
    ("uba-on-80-40-ssb", date(2026, 10, 4), date(2026, 10, 9)),
    ("uba-on-80-40-cw", date(2026, 10, 11), date(2026, 10, 16)),
    ("uba-on-2m", date(2026, 10, 18), date(2026, 10, 23)),
]


@pytest.mark.parametrize("cid,day,deadline", UBA_ON_LEGS)
def test_uba_on_contest_deadlines_are_the_dates_uba_printed(
    catalog, cid, day, deadline
):
    o = expand(by_id(catalog, cid), 2026)[0]
    assert o.start.date() == day
    assert o.log_due.date() == deadline


def test_ref_160m_deadline_is_the_second_monday_after_the_contest(catalog):
    """
    REF states no interval for this one -- 'A plus tard le deuxieme lundi apres
    le concours' -- so the 8 in the record is derived, and only correct because
    the contest always ends at 0000 UTC on a Sunday. Checked across a decade
    rather than asserted once.
    """
    c = by_id(catalog, "ref-160m")
    for y in range(2025, 2035):
        o = expand(c, y)[0]
        assert o.start.weekday() == 5 and o.end.weekday() == 6
        mondays = [
            o.start.date() + timedelta(days=n)
            for n in range(1, 15)
            if (o.start.date() + timedelta(days=n)).weekday() == 0
        ]
        assert o.log_due.date() == mondays[1], y


def test_ure_night_break_contests_run_two_sessions(catalog):
    """
    URE's CNCW and CME both stop overnight: '1200 UTC Saturday till 2259 UTC
    Saturday and from 0500UTC till 1159UTC Sunday'. Two sessions, not one long
    window -- a single span would claim eighteen hours of operating time that
    the rules do not permit.
    """
    for cid, first in (("ure-cncw", date(2026, 7, 18)), ("ure-cme", date(2026, 8, 8))):
        occ = expand(by_id(catalog, cid), 2026)
        assert len(occ) == 2, cid
        assert occ[0].start.date() == first
        assert [o.start.strftime("%H%M") for o in occ] == ["1200", "0500"]
        assert [o.end.strftime("%H%M") for o in occ] == ["2259", "1159"]
        # Six hours off air between them, which is the point of the split.
        assert (occ[1].start - occ[0].end) == timedelta(hours=6, minutes=1)


def test_ure_deadline_is_fifteen_days_from_the_end_of_the_second_session(catalog):
    """
    Every URE record states '(15 days)' and prints a date. For the two-session
    contests the printed date is fifteen days after the SECOND session ends;
    the engine applies the interval per session, so the first session's
    computed deadline is a day early. Recorded in the records' notes rather
    than papered over.
    """
    for cid, printed in (
        ("ure-cncw", date(2026, 8, 3)),
        ("ure-cme", date(2026, 8, 24)),
    ):
        occ = expand(by_id(catalog, cid), 2026)
        assert occ[1].log_due.date() == printed, cid
        assert occ[0].log_due.date() == printed - timedelta(days=1), cid


def test_ok_dx_rtty_carries_no_deadline_because_the_sponsor_contradicts_itself(
    catalog,
):
    """
    The rules say 'not later than 7th day after the contest'; the announcement
    of the same edition prints 26 December -- with the wrong year, 2025, for a
    2026 contest. The stored end is 00:00 on the Sunday, so seven days from
    there is the 27th. No number is invented: the field is absent and both
    statements are quoted in the record. The two OK/OM legs, whose parenthetical
    dates DO match their stated interval, encode it.
    """
    assert "log_deadline_days" not in by_id(catalog, "ok-dx-rtty")
    o = expand(by_id(catalog, "ok-dx-rtty"), 2026)[0]
    assert o.end == datetime(2026, 12, 20, 0, 0, tzinfo=UTC)
    assert o.log_due is None
    for cid, due in (
        ("ok-om-dx-ssb", date(2026, 4, 19)),
        ("ok-om-dx-cw", date(2026, 11, 22)),
    ):
        assert expand(by_id(catalog, cid), 2026)[0].log_due.date() == due


# Records where the sponsor publishes dates and never states a rule. Each is
# manual on purpose: an ordinal fitted to the dates would print confident
# schedules for years the sponsor has not announced.
TIER2_MANUAL = {
    "uba-spring-2m": (2026, 2027),
    "uba-spring-80m-cw": (2026, 2027),
    "uba-spring-6m": (2026, 2027),
    "uba-spring-80m-ssb": (2026, 2027),
    "uba-on-6m": (2026, 2027),
    "uba-on-80-40-ssb": (2026, 2027),
    "uba-on-80-40-cw": (2026, 2027),
    "uba-on-2m": (2026, 2027),
    "uba-bma": (2026, 2027),
    "paccdigi": (2027, 2028),
    "ure-eartty": (2026, 2027),
}


@pytest.mark.parametrize("cid,last,after", [
    (cid, last, after) for cid, (last, after) in sorted(TIER2_MANUAL.items())
])
def test_tier2_manual_records_stop_where_the_sponsor_stopped_publishing(
    catalog, cid, last, after
):
    c = by_id(catalog, cid)
    assert c["recurrence"]["type"] == "manual"
    assert expand(c, last), f"{cid} produced nothing for its last published year"
    assert expand(c, after) == [], f"{cid} guessed {after}, a year nobody published"


def test_paccdigi_is_manual_even_though_both_dates_look_like_a_rule(catalog):
    """
    VERON's two published PACCdigi editions are both the third Saturday of
    April, and the temptation is to encode that. VERON does not say it -- the
    PACC page says 'het tweede volle weekend van februari' in so many words and
    the PACCdigi page says nothing of the kind, so the difference is the
    sponsor's, not ours.
    """
    c = by_id(catalog, "paccdigi")
    published = [expand(c, y)[0].start.date() for y in (2026, 2027)]
    assert published == [date(2026, 4, 18), date(2027, 4, 17)]
    assert all(d.weekday() == 5 for d in published)
    assert all(15 <= d.day <= 21 for d in published)  # third Saturday, both years
    assert c["recurrence"]["type"] == "manual"


def test_ure_rtty_is_manual_while_ure_states_a_rule_for_its_other_five(catalog):
    """
    Five of URE's six HF contests name an ordinal weekend in both language
    versions of their page. EA RTTY names a date and nothing else, in both, so
    it alone is manual -- the contrast is what makes that a reading of URE
    rather than an inconsistency of ours.
    """
    assert by_id(catalog, "ure-eartty")["recurrence"]["type"] == "manual"
    others = [
        "ure-rey-de-espana-cw", "ure-rey-de-espana-ssb",
        "ure-eapsk63", "ure-cncw", "ure-cme",
    ]
    for cid in others:
        assert by_id(catalog, cid)["recurrence"]["type"] == "nth_full_weekend", cid


def test_czech_contest_hosts_are_http_because_their_tls_is_broken(catalog):
    """
    okomdx.crk.cz and okrtty.crk.cz serve a certificate issued for
    default.web4u.cz, so HTTPS fails validation. The http:// URLs are a
    recorded blocker, not an oversight, and each record says so -- the same
    treatment given to SARL's dead host.
    """
    for cid in ("ok-om-dx-ssb", "ok-om-dx-cw", "ok-dx-rtty"):
        c = by_id(catalog, cid)
        assert c["rules_url"].startswith("http://"), cid
        assert "crk.cz" in c["rules_url"], cid
        assert "TLS" in c["note"], cid


# ---------------------------------------------------------------------------
# Sponsor validation -- DARC
#
# The rules are German and each record quotes them in German. The dates and
# deadlines below are DARC's, published separately from that wording in its own
# "Termine DARC KW Conteste 2026" table at /darc-kw-conteste/kw-conteste/. That
# table lists only DARC's own contests, so it is a sponsor source and not an
# aggregator -- the one IARU event on it is not encoded, for that reason.
# ---------------------------------------------------------------------------

DARC_PUBLISHED = {
    "wae-dx-cw": (
        "CW: August, zweites Wochenende",
        [(2026, 8, 8)],
    ),
    "wae-dx-ssb": (
        "SSB: September, zweites Wochenende",
        [(2026, 9, 12)],
    ),
    "wae-dx-rtty": (
        "RTTY: November, zweites Wochenende",
        [(2026, 11, 14)],
    ),
    "darc-wag": (
        "Oktober, drittes volles Wochenende, 1500 UTC Samstag bis 1459 UTC Sonntag",
        [(2026, 10, 17)],
    ),
    "darc-10m": (
        "Zweiter Sonntag im Januar, 0900-1059 UTC",
        [(2026, 1, 11)],
    ),
    "darc-xmas": (
        "26. Dezember, 08.30-10.59 UTC",
        [(2026, 12, 26)],
    ),
    "darc-ft4": (
        "Jeweils 2. Monat im Quartal, Am 2. Dienstag im Monat",
        [(2026, 2, 10), (2026, 5, 12), (2026, 8, 11), (2026, 11, 10)],
    ),
    "darc-rtty-kurzcontest": (
        "jeweils im 1. Monat eines jeden Quartals am 2. Dienstag",
        [(2026, 1, 13), (2026, 4, 14), (2026, 7, 14), (2026, 10, 13)],
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, dates) for cid, (rule, dates) in sorted(DARC_PUBLISHED.items())
])
def test_darc_contests_match_darcs_own_published_dates(catalog, cid, rule, published):
    got = [o.start.date() for o in expand(by_id(catalog, cid), 2026)]
    assert got == [date(*d) for d in published], f"{cid}: rule '{rule}'"


# The deadline column of the same table. DARC states the interval once in the
# general contest rules and again in most of the individual Ausschreibungen, so
# these are a second statement of it rather than a restatement of ours.
DARC_PUBLISHED_DEADLINES = {
    "wae-dx-cw": [(2026, 8, 16)],
    "wae-dx-ssb": [(2026, 9, 20)],
    "wae-dx-rtty": [(2026, 11, 22)],
    "darc-wag": [(2026, 10, 25)],
    "darc-10m": [(2026, 1, 18)],
    "darc-xmas": [(2027, 1, 2)],
    "darc-ft4": [(2026, 2, 17), (2026, 5, 19), (2026, 8, 18), (2026, 11, 17)],
    "darc-rtty-kurzcontest": [
        (2026, 1, 20), (2026, 4, 21), (2026, 7, 21), (2026, 10, 20),
    ],
}


@pytest.mark.parametrize("cid,published", sorted(DARC_PUBLISHED_DEADLINES.items()))
def test_darc_log_deadlines_match_darcs_own_published_dates(catalog, cid, published):
    c = by_id(catalog, cid)
    assert c["log_deadline_days"] == 7, cid
    got = [o.log_due.date() for o in expand(c, 2026)]
    assert got == [date(*d) for d in published], cid


def test_darc_wae_rtty_is_the_second_full_weekend_not_the_second_weekend(catalog):
    """
    DARC writes 'zweites Wochenende', without 'volles'. November 2026 is the
    year that separates the readings: 1 November is a Sunday whose Saturday
    belongs to October, so counting weekends from it gives 7-8 November. DARC
    publishes 14-15, which is the second FULL weekend.
    """
    assert date(2026, 11, 1).weekday() == 6  # an orphan Sunday
    assert _full_weekends_in_month(2026, 11)[1] == date(2026, 11, 14)
    assert expand(by_id(catalog, "wae-dx-rtty"), 2026)[0].start.date() == date(
        2026, 11, 14
    )


def test_wae_cw_deadline_follows_the_interval_darc_states_twice(catalog):
    """
    DARC contradicts itself on this one leg. Rule 13 of the WAE rules and the
    general contest rules both say seven days; seven days is 16 August 2026,
    which is what DARC's own contest calendar prints. The per-leg line on the
    rules page says 17.08.2026. The interval wins because it is stated twice
    and because it reproduces the SSB and RTTY legs' printed instants exactly.
    """
    c = by_id(catalog, "wae-dx-cw")
    assert expand(c, 2026)[0].log_due.date() == date(2026, 8, 16)
    assert "17.08.2026" in c["note"]  # the losing statement stays recorded


def test_darc_quarterly_series_interleave_on_the_same_weekday(catalog):
    """
    RTTY takes the first month of each quarter and FT4 the second, both on the
    second Tuesday. Encoded as one record each, so the two months lists must
    stay disjoint or a leg would be claimed twice.
    """
    rtty = by_id(catalog, "darc-rtty-kurzcontest")["recurrence"]
    ft4 = by_id(catalog, "darc-ft4")["recurrence"]
    assert rtty["months"] == [1, 4, 7, 10]
    assert ft4["months"] == [2, 5, 8, 11]
    assert not set(rtty["months"]) & set(ft4["months"])
    assert rtty["weekday"] == ft4["weekday"] == 1  # Tuesday
    assert rtty["n"] == ft4["n"] == 2
    for cid in ("darc-rtty-kurzcontest", "darc-ft4"):
        for o in expand(by_id(catalog, cid), 2026):
            assert o.start.weekday() == 1, cid
            assert 8 <= o.start.day <= 14, cid  # the second Tuesday, always


def test_darc_xmas_is_a_calendar_date_and_ignores_the_weekday(catalog):
    """
    26 December whatever day it falls on -- 2026 is a Saturday, 2027 a Sunday,
    2028 a Tuesday. A weekday rule fitted to any one of them would be wrong the
    next year.
    """
    c = by_id(catalog, "darc-xmas")
    assert c["recurrence"] == {"type": "fixed_date", "month": 12, "day": 26}
    for y, weekday in ((2026, 5), (2027, 6), (2028, 1)):
        occ = expand(c, y)[0]
        assert occ.start.date() == date(y, 12, 26)
        assert occ.start.weekday() == weekday


def test_darc_10m_rule_comes_from_darcs_superseded_ausschreibung(catalog):
    """
    The current Ausschreibung prints '11.01.26' and no rule; the pre-2023 one
    DARC keeps below it on the same page says 'Zweiter Sonntag im Januar'. That
    is where the recurrence comes from, and the record says so rather than
    letting a rule appear to have been fitted to a single date.
    """
    c = by_id(catalog, "darc-10m")
    assert c["recurrence"] == {"type": "nth_weekday", "month": 1, "n": 2, "weekday": 6}
    assert "bis 2023" in c["source_note"]
    assert expand(c, 2026)[0].start.date() == date(2026, 1, 11)


def test_darc_records_all_carry_the_sponsor_string_the_registry_joins_on(catalog):
    """
    DARC runs these under one contest department; the registry's DARC entry
    lists exactly one catalog_sponsors string, and an unregistered sponsor is
    only detectable through that join.
    """
    darc = [c for c in catalog if c["id"] in DARC_PUBLISHED]
    assert len(darc) == 8
    assert {c["sponsor"] for c in darc} == {"DARC"}
    assert {c["country"] for c in darc} == {"DE"}


# ---------------------------------------------------------------------------
# Counting backwards past "last"
#
# `n` used to mean "the nth from the front", with -1 special-cased to mean the
# last. BFRA's LZ DX Contest is the rule that needed more: "the weekend before
# the last full weekend of November", which BFRA states as a rule and not as an
# annual announcement, because the weekend it names is defined by CQ WW CW
# sitting on the last one. So n <= -1 now counts back from the end.
#
# The risk that comes with it is n=0, which is a position in neither direction.
# Read as "the first" it silently shifts a contest; read as "no anchors this
# year" it silently empties one. It raises instead, and because
# NoAnchorsThisYear is a ValueError, `monthly_nth_weekday`'s skip-a-short-month
# catch had to be narrowed so it does not swallow that.
# ---------------------------------------------------------------------------

def _synthetic(rule):
    """A minimal record for exercising a rule with no catalog entry behind it."""
    return {
        "id": "synthetic",
        "name": "Synthetic",
        "recurrence": rule,
        "start": {"day_offset": 0, "time": "0000"},
        "end": {"day_offset": 0, "time": "0100"},
    }


def test_nth_counts_backwards_past_last():
    """
    November 2025 has five full weekends: 1, 8, 15, 22 and 29 November. -1 is
    the last, -2 the one before it, -3 the one before that.
    """
    assert _full_weekends_in_month(2025, 11) == [
        date(2025, 11, 1),
        date(2025, 11, 8),
        date(2025, 11, 15),
        date(2025, 11, 22),
        date(2025, 11, 29),
    ]
    for n, expected in ((-1, 29), (-2, 22), (-3, 15)):
        got = expand(_synthetic({"type": "nth_full_weekend", "month": 11, "n": n}), 2025)
        assert got[0].start.date() == date(2025, 11, expected), n


def test_nth_counting_back_past_the_start_is_an_empty_year_not_an_error():
    """
    Asking for the sixth-from-last of five is the same kind of nothing as a
    fifth Monday in a four-Monday month: the year has no such date, and expand
    returns nothing rather than raising.
    """
    rule = {"type": "nth_full_weekend", "month": 11, "n": -6}
    assert expand(_synthetic(rule), 2025) == []


def test_nth_rejects_zero_as_a_malformed_rule():
    """
    n=0 is a catalog typo, not a date that does not exist. Read as "the first"
    it moves a contest a week; read as NoAnchorsThisYear it drops the contest
    from the calendar without a word. Neither is acceptable, so it raises -- and
    the exception must not be NoAnchorsThisYear, or callers that legitimately
    swallow that would swallow this too.
    """
    rule = {"type": "nth_weekday", "month": 11, "n": 0, "weekday": 5}
    with pytest.raises(ValueError) as exc:
        expand(_synthetic(rule), 2025)
    assert not isinstance(exc.value, NoAnchorsThisYear)
    assert "n=0" in str(exc.value)


def test_monthly_nth_weekday_skips_short_months_but_not_malformed_rules():
    """
    A "fifth Monday" rule simply has no date in a month with four, and skipping
    those is the whole point of the catch inside monthly_nth_weekday. It is
    narrowed to NoAnchorsThisYear so a n=0 rule inside the same loop still
    raises instead of quietly producing an empty year.
    """
    months = list(range(1, 13))
    fifths = expand(
        _synthetic(
            {"type": "monthly_nth_weekday", "n": 5, "weekday": 0, "months": months}
        ),
        2026,
    )
    assert 0 < len(fifths) < 12
    assert all(o.start.day > 28 for o in fifths)
    assert all(o.start.weekday() == 0 for o in fifths)

    with pytest.raises(ValueError) as exc:
        expand(
            _synthetic(
                {"type": "monthly_nth_weekday", "n": 0, "weekday": 0, "months": months}
            ),
            2026,
        )
    assert not isinstance(exc.value, NoAnchorsThisYear)


# ---------------------------------------------------------------------------
# Sponsor validation -- the remaining Tier 2 European societies
#
# USKA, OeVSV, MRASZ, BFRA, FRR, SRS, HRS, LRAL, ERAU, LRMD, SRR and UARL. Each
# rule is quoted in the sponsor's own language on the record; the dates below
# are the sponsor's too, published separately from that wording -- a KW-Contest
# date page, a year printed inside the rules themselves, an archive of past
# editions, a society calendar. NRAU is absent on purpose: it is blocked at
# source and encodes nothing. See data/sources.md.
#
# Session records emit one occurrence per session, so start dates are deduped.
# ---------------------------------------------------------------------------

TIER2B_PUBLISHED = {
    "uska-helvetia": (
        "Letztes volles Wochenende im April, Samstag 13:00 UTC bis Sonntag 12:59 UTC",
        {2026: [(2026, 4, 25)], 2027: [(2027, 4, 24)]},
    ),
    "uska-field-day-cw": (
        "CW: Erstes volles Wochenende im Juni",
        {2026: [(2026, 6, 6)], 2027: [(2027, 6, 5)]},
    ),
    "uska-field-day-ssb": (
        "SSB: Erstes volles Wochenende im September",
        {2026: [(2026, 9, 5)]},
    ),
    "uska-nmd": (
        "Dritter Sonntag im Juli, 06:00 UTC bis 09:59 UTC",
        {2026: [(2026, 7, 19)]},
    ),
    "uska-weihnachtswettbewerb-ssb": (
        "SSB: Erster Samstag im Dezember, 07:00 bis 09:59 UTC",
        {2026: [(2026, 12, 5)]},
    ),
    "uska-weihnachtswettbewerb-cw": (
        "CW: Zweiter Samstag im Dezember, 07:00 bis 09:59 UTC",
        {2026: [(2026, 12, 12)]},
    ),
    "oevsv-aoee-80-40": (
        "2. TERMIN: 1. Mai 2026",
        {2026: [(2026, 5, 1)]},
    ),
    "oevsv-aoec-160m": (
        "Jeweils am dritten vollen Wochenende im NOVEMBER",
        {2025: [(2025, 11, 15)], 2026: [(2026, 11, 21)]},
    ),
    "mrasz-ha-dx": (
        "every year 3rd full weekend of January",
        {2026: [(2026, 1, 17)]},
    ),
    "mrasz-yl-om": (
        "minden evben marcius 8-hoz legkozelebb eso hetvegen",
        {2026: [(2026, 3, 8)]},
    ),
    "mrasz-rfwd-hf": (
        "evente aprilis 18.-an 16.00 UT-tol 16.59 UT-ig",
        {2026: [(2026, 4, 18)]},
    ),
    "bfra-lz-dx": (
        "The weekend before the last full weekend of November",
        {2025: [(2025, 11, 22)], 2026: [(2026, 11, 21)]},
    ),
    "frr-yo-dx-hf": (
        "Al patrulea weekend intreg al lunii August",
        {2026: [(2026, 8, 22)]},
    ),
    "hrs-9a-dx": (
        "3rd full weekend in December",
        {2025: [(2025, 12, 20)], 2026: [(2026, 12, 19)]},
    ),
    "srs-tesla-memorial-hf-cw": (
        "odrzavace se svake godine drugog vikenda u martu",
        {
            2019: [(2019, 3, 9)],
            2020: [(2020, 3, 14)],
            2021: [(2021, 3, 13)],
            2022: [(2022, 3, 12)],
            2023: [(2023, 3, 11)],
            2024: [(2024, 3, 9)],
            2025: [(2025, 3, 8)],
            2026: [(2026, 3, 14)],
        },
    ),
    "lral-18-november-80m": (
        "18. novembri no 08.00-11.14 pec vieteja laika",
        {2026: [(2026, 11, 18)]},
    ),
    "lral-4-may-80m": (
        "4. maija no 07.00-10.14 pec vieteja laika",
        {2026: [(2026, 5, 4)]},
    ),
    "erau-es-open": (
        "3rd SATURDAY in APRIL: 18. APRIL 2026 05.00 - 08.59 UTC",
        {2026: [(2026, 4, 18)]},
    ),
    "erau-es-ll-kv": (
        "9-s etapis laupaeva hommikuti vastavalt ERAU kalenderplaanile",
        {
            2026: [
                (2026, 1, 3),
                (2026, 2, 14),
                (2026, 3, 7),
                (2026, 4, 4),
                (2026, 5, 2),
                (2026, 9, 5),
                (2026, 10, 3),
                (2026, 11, 7),
                (2026, 12, 5),
            ]
        },
    ),
    "lrmd-vytautas-magnus": (
        "kiekvienais metais pirma sekmadieni po Nauju metu, 0700-0759 UTC",
        {2026: [(2026, 1, 4)]},
    ),
    "lrmd-wal": (
        "2026 m. birzelio 06 d. (sestadieni), 06:00-08:59 UTC",
        {2026: [(2026, 6, 6)]},
    ),
    "srr-russian-dx": (
        "s 12:00 UTC 20 marta po 11:59 UTC 21 marta 2027 goda",
        {2027: [(2027, 3, 20)]},
    ),
    "uarl-champ-rtty": (
        "Teletaypnyy Chempionat Ukrayiny na KKH - 7 bereznya 2026 r.",
        {2026: [(2026, 3, 7)]},
    ),
    "uarl-champ-cw": (
        "Telehrafnyy Chempionat Ukrayiny na KKH - 15 bereznya 2026 r.",
        {2026: [(2026, 3, 15)]},
    ),
    "uarl-champ-ssb": (
        "Telefonnyy Chempionat Ukrayiny na KKH - 22 bereznya 2026 r.",
        {2026: [(2026, 3, 22)]},
    ),
    "uarl-lp-cup-cw": (
        "bude provedeno 10 travnya 2026r. z 16:00 do 17:59 UT",
        {2026: [(2026, 5, 10)]},
    ),
    # REP prints six years of dates beside the rule -- the longest independent
    # table any sponsor in this catalog publishes -- so all six are checked.
    "rep-portugal-day-hf": (
        "each year on the second weekend of June",
        {
            2025: [(2025, 6, 14)],
            2026: [(2026, 6, 13)],
            2027: [(2027, 6, 12)],
            2028: [(2028, 6, 10)],
            2029: [(2029, 6, 9)],
            2030: [(2030, 6, 8)],
        },
    ),
    "rep-portugal-day-vhf-uhf": (
        "organiza no 10 de junho (feriado) de cada ano",
        {2025: [(2025, 6, 10)], 2026: [(2026, 6, 10)]},
    ),
    "rep-50mhz": (
        "Primeiro fim de semana completo de agosto",
        {2025: [(2025, 8, 2)]},
    ),
}


def _start_dates(catalog, cid, year):
    """Unique start dates, in order. A sessions record yields one per session."""
    seen = []
    for o in expand(by_id(catalog, cid), year):
        if o.start.date() not in seen:
            seen.append(o.start.date())
    return seen


@pytest.mark.parametrize("cid,rule,year,published", [
    (cid, rule, year, dates)
    for cid, (rule, years) in sorted(TIER2B_PUBLISHED.items())
    for year, dates in sorted(years.items())
])
def test_tier2b_contests_match_their_sponsors_published_dates(
    catalog, cid, rule, year, published
):
    got = _start_dates(catalog, cid, year)
    assert got == [date(*d) for d in published], f"{cid} {year}: rule '{rule}'"


def test_tesla_memorial_second_weekend_means_second_full_weekend(catalog):
    """
    SRS says "odrzavace se svake godine drugog vikenda u martu" -- every year,
    the second weekend in March -- and publishes eight editions. 2020 is the
    year that separates the readings: 1 March 2020 was a Sunday whose Saturday
    belonged to February, so counting weekends by their Sunday gives 7-8 March.
    SRS published 14-15, which is the second FULL weekend.
    """
    assert date(2020, 3, 1).weekday() == 6  # an orphan Sunday
    assert _full_weekends_in_month(2020, 3)[1] == date(2020, 3, 14)
    assert _start_dates(catalog, "srs-tesla-memorial-hf-cw", 2020) == [date(2020, 3, 14)]
    # ...and the eight published editions all reproduce, which is what makes it
    # a rule rather than eight coincidences.
    assert len(TIER2B_PUBLISHED["srs-tesla-memorial-hf-cw"][1]) == 8


def test_lz_dx_counts_back_two_weekends_because_cq_ww_cw_takes_the_last(catalog):
    """
    BFRA anchors its date to another sponsor's contest: "The weekend before the
    last full weekend of November (the weekend before CQWW CW contest weekend)".
    That is n=-2, and it is the record that made the engine count backwards past
    "last". November 2025 has five full weekends and BFRA published 22-23.
    """
    assert len(_full_weekends_in_month(2025, 11)) == 5
    c = by_id(catalog, "bfra-lz-dx")
    assert c["recurrence"] == {"type": "nth_full_weekend", "month": 11, "n": -2}
    assert _start_dates(catalog, "bfra-lz-dx", 2025) == [date(2025, 11, 22)]
    assert _full_weekends_in_month(2025, 11)[-1] == date(2025, 11, 29)  # CQ WW CW


def test_yo_dx_is_the_fourth_full_weekend_not_the_last(catalog):
    """
    August 2026 separates the readings: 1 August is a Saturday, so the month has
    five full weekends and the fourth (22-23) is not the last (29-30). The
    current yodx.ro rules and FRR's own 2026 announcement both say the fourth.
    An older hamradio.ro PDF says "Ultimul weekend intreg" -- the last -- and
    that statement stays on the record rather than being reconciled away.
    """
    weekends = _full_weekends_in_month(2026, 8)
    assert len(weekends) == 5
    assert weekends[3] == date(2026, 8, 22) and weekends[-1] == date(2026, 8, 29)
    assert _start_dates(catalog, "frr-yo-dx-hf", 2026) == [date(2026, 8, 22)]
    assert "Ultimul weekend intreg" in by_id(catalog, "frr-yo-dx-hf")["note"]


def test_aoec_third_full_weekend_survives_an_orphan_sunday(catalog):
    """
    OeVSV states the rule twice, in German and in English, and prints 15
    November 2025 for itself. 2026 is the harder year: 1 November is a Sunday
    whose Saturday belongs to October, so the full weekends start on the 7th and
    the third is the 21st.
    """
    assert date(2026, 11, 1).weekday() == 6  # an orphan Sunday
    assert _full_weekends_in_month(2026, 11)[0] == date(2026, 11, 7)
    assert _start_dates(catalog, "oevsv-aoec-160m", 2025) == [date(2025, 11, 15)]
    assert _start_dates(catalog, "oevsv-aoec-160m", 2026) == [date(2026, 11, 21)]


def test_uska_forward_dates_come_from_uskas_own_kw_contest_page(catalog):
    """
    USKA's KW-Contest page prints the year's dates separately from the
    Reglemente, and states two 2027 dates in prose: "Der Helvetia Contest findet
    am 24. - 25. April 2027 ... statt" and "Der Field Day in CW findet am 5. -
    6. Juni 2027 ... statt". Those are forward statements rather than calendar
    rows, so they test the rule a year past every other date USKA publishes.
    """
    assert _start_dates(catalog, "uska-helvetia", 2027) == [date(2027, 4, 24)]
    assert _start_dates(catalog, "uska-field-day-cw", 2027) == [date(2027, 6, 5)]


def test_weihnachtswettbewerb_sessions_leave_the_gap_hour_out(catalog):
    """
    Each Saturday is a phone-or-CW morning and then a separate digital hour, and
    the hour between them is not part of the contest. Two sessions rather than
    one 07:00-10:59 span, or the calendar would claim an hour USKA does not run.
    """
    for cid in ("uska-weihnachtswettbewerb-ssb", "uska-weihnachtswettbewerb-cw"):
        occs = expand(by_id(catalog, cid), 2026)
        assert len(occs) == 2, cid
        assert [(o.start.hour, o.start.minute) for o in occs] == [(7, 0), (10, 0)], cid
        assert [(o.end.hour, o.end.minute) for o in occs] == [(9, 59), (10, 59)], cid


def test_weihnachtswettbewerb_carries_no_deadline_because_uska_states_none(catalog):
    """
    Three of USKA's four KW Reglemente say "Die Logs sind innert 8 Tagen ...
    einzureichen". The Weihnachtswettbewerb's says nothing at all. Borrowing the
    interval from its siblings would be this catalog inventing a deadline, so
    none is encoded and the silence is recorded on the record.
    """
    for cid in ("uska-weihnachtswettbewerb-ssb", "uska-weihnachtswettbewerb-cw"):
        c = by_id(catalog, cid)
        assert "log_deadline_days" not in c, cid
        assert "no log deadline" in c["note"], cid
    for cid in ("uska-helvetia", "uska-field-day-cw", "uska-field-day-ssb", "uska-nmd"):
        assert by_id(catalog, cid)["log_deadline_days"] == 8, cid


def test_yl_om_falls_on_the_sunday_nearest_8_march(catalog):
    """
    MRASZ ties the date to International Women's Day: "minden evben marcius
    8-hoz legkozelebb eso hetvegen", run on the Sunday. 2026 is the only year
    MRASZ confirms independently, and in it 8 March is itself a Sunday, so the
    rule and the date agree trivially. The caveat is on the record; what is
    asserted here is that the rule is nearest-Sunday and not a hard 8 March.
    """
    c = by_id(catalog, "mrasz-yl-om")
    assert c["recurrence"] == {
        "type": "nearest_weekday", "month": 3, "day": 8, "weekday": 6
    }
    assert date(2026, 3, 8).weekday() == 6
    assert _start_dates(catalog, "mrasz-yl-om", 2026) == [date(2026, 3, 8)]
    # 8 March 2027 is a Monday, so the nearest Sunday is behind it, not ahead.
    assert date(2027, 3, 8).weekday() == 0
    assert _start_dates(catalog, "mrasz-yl-om", 2027) == [date(2027, 3, 7)]
    assert "Only that one year is independently confirmed" in c["note"]


def test_vmc_first_sunday_reading_is_recorded_as_a_caveat(catalog):
    """
    LRMD writes it both ways on the same page: "pirma sekmadieni po Nauju metu"
    and "the first Sunday after New Year's Day". The readings diverge only when
    1 January is itself a Sunday, and LRMD has published no such year, so the
    first-Sunday-in-January reading is encoded and the divergence is recorded
    rather than resolved by picking a winner nobody has confirmed.
    """
    c = by_id(catalog, "lrmd-vytautas-magnus")
    assert c["recurrence"] == {"type": "nth_weekday", "month": 1, "n": 1, "weekday": 6}
    assert _start_dates(catalog, "lrmd-vytautas-magnus", 2026) == [date(2026, 1, 4)]
    assert "CAVEAT" in c["note"] and "1 January is itself a Sunday" in c["note"]
    # 2034 is such a year: the two readings give 1 January and 8 January.
    assert date(2034, 1, 1).weekday() == 6
    assert _start_dates(catalog, "lrmd-vytautas-magnus", 2034) == [date(2034, 1, 1)]


def test_es_ll_kv_tallinn_wall_clock_reproduces_eraus_own_utc_calendar(catalog):
    """
    ERAU's rules give the hour in Estonian time -- "Etappide algus on 10:00 Eesti
    aja (EA) jargi" -- and its 2026 calendar prints the same nine stages in UTC:
    08:00-08:59 for stages 1, 2, 3, 8 and 9, and 07:00-07:59 for 4, 5, 6 and 7.
    That split IS the DST boundary, and it is the second source: get the zone
    handling wrong in either direction and four rows stop matching.
    """
    c = by_id(catalog, "erau-es-ll-kv")
    assert c["timezone"] == "Europe/Tallinn"
    occs = expand(c, 2026)
    assert len(occs) == 9
    assert [o.start.hour for o in occs] == [8, 8, 8, 7, 7, 7, 7, 8, 8]
    assert {(o.end.hour, o.end.minute) for o in occs} == {(8, 59), (7, 59)}


def test_lral_rounds_are_riga_wall_clock(catalog):
    """
    LRAL states the rounds "pec vieteja laika" -- in local time -- and never in
    UTC, so the same 08.00 start is a different instant in November than the
    07.00 start is in May. 18 November 2026 is EET (UTC+2) and 4 May 2026 is
    EEST (UTC+3).
    """
    nov = expand(by_id(catalog, "lral-18-november-80m"), 2026)
    assert by_id(catalog, "lral-18-november-80m")["timezone"] == "Europe/Riga"
    assert [o.start.hour for o in nov] == [6, 8]  # 08.00 and 10.15 local
    assert (nov[1].start.hour, nov[1].start.minute) == (8, 15)

    may = expand(by_id(catalog, "lral-4-may-80m"), 2026)
    assert [o.start.hour for o in may] == [4, 6]  # 07.00 and 09.15 local
    assert (may[1].start.hour, may[1].start.minute) == (6, 15)


def test_uarl_championships_are_kyiv_wall_clock_and_the_lp_cup_is_not(catalog):
    """
    UARL writes its championships in Kyiv time ("z 19:00 do 19:29 kyyivskoho
    chasu") and its Low Power Cup in UT with Kyiv time in brackets ("z 16:00 do
    17:59 UT (z 19:00 kyyivskoho chasu do 20:59)"). Same local hour, two
    different UTC instants, because March is EET and May is EEST -- and only one
    of the two records is wall-clocked. Encoding both the same way would move
    one of them by an hour.
    """
    for cid in ("uarl-champ-rtty", "uarl-champ-cw", "uarl-champ-ssb"):
        c = by_id(catalog, cid)
        assert c["timezone"] == "Europe/Kyiv", cid
        o = expand(c, 2026)[0]
        assert (o.start.hour, o.end.hour) == (17, 18), cid  # 19:00-20:59 Kyiv, EET
        assert o.end.minute == 59, cid

    cup = by_id(catalog, "uarl-lp-cup-cw")
    assert "timezone" not in cup
    o = expand(cup, 2026)[0]
    assert (o.start.hour, o.end.hour, o.end.minute) == (16, 17, 59)


def test_rdxc_deadline_lands_on_the_date_srr_prints(catalog):
    """
    SRR states the interval and the instant in one sentence: reports are taken
    "v techenii 14 dney posle okonchaniya sorevnovaniy (po 04.04.2027 goda
    vklyuchitelno)". The contest ends 11:59 UTC on 21 March 2027, and fourteen
    days is 4 April -- so the sponsor's own arithmetic is what checks ours.
    """
    c = by_id(catalog, "srr-russian-dx")
    assert c["log_deadline_days"] == 14
    o = expand(c, 2027)[0]
    assert o.end.date() == date(2027, 3, 21)
    assert o.log_due.date() == date(2027, 4, 4)


def test_lp_cup_deadline_lands_on_the_date_uarl_prints(catalog):
    """
    Same shape, from UARL: "7 dib pislya zakinchennya zmahan. Tobto, 17 travnya
    2026 roku ostanniy den." Seven days from 10 May is 17 May.
    """
    c = by_id(catalog, "uarl-lp-cup-cw")
    assert c["log_deadline_days"] == 7
    o = expand(c, 2026)[0]
    assert o.log_due.date() == date(2026, 5, 17)


def test_es_open_is_worldwide_with_a_note_not_two_sided(catalog):
    """
    ERAU's rule is asymmetric -- "ESTONIAN STATIONS CAN WORK ALL THE STATIONS WHO
    PARTICIPATE ... NON-ES STATIONS CAN WORK ONLY ES STATIONS" -- but that is
    about who counts, not about who may enter. two_sided needs both sides
    enumerated and tells a station in neither that it cannot enter, which is
    false here. Same call as DARC's WAE and WAG and JARL's All Asian.
    """
    elig = by_id(catalog, "erau-es-open")["eligibility"]
    assert elig["scope"] == "worldwide"
    assert "NON-ES STATIONS CAN WORK ONLY ES STATIONS" in elig["note"]
    for entity in ("ES", "K", "JA", "VK"):
        assert eligibility_for(by_id(catalog, "erau-es-open"), entity)["can_enter"]


def test_tier2b_records_carry_the_sponsor_strings_the_registry_joins_on(catalog):
    """
    Three Baltic societies share one registry entry but are three separate
    sponsors in the catalog, because an LV record is not an EE one. The join is
    the only thing that makes an unregistered sponsor detectable, so it is
    asserted here rather than left to the coverage test to discover.
    """
    records = [c for c in catalog if c["id"] in TIER2B_PUBLISHED]
    assert len(records) == 29
    assert {c["sponsor"] for c in records} == {
        "USKA", "ÖVSV", "MRASZ", "BFRA", "FRR", "SRS", "HRS",
        "LRAL", "ERAU", "LRMD", "SRR", "UARL", "REP",
    }
    assert {c["country"] for c in records} == {
        "CH", "AT", "HU", "BG", "RO", "RS", "HR", "LV", "EE", "LT", "RU", "UA",
        "PT",
    }
    reg = load_registry()
    owner = _registry_owner(reg)
    for c in records:
        assert owner[c["sponsor"]][0] == "tier_2_european_societies", c["id"]


def test_rep_portugal_day_hf_runs_noon_to_noon(catalog):
    """
    The date table above checks six years of REP's own published dates. This
    checks the clock, which a table of dates cannot: 'Time: 12:00 UTC to 11:59
    UTC', a minute short of 24 hours.
    """
    (o,) = expand(by_id(catalog, "rep-portugal-day-hf"), 2026)
    assert (o.start.hour, o.start.minute) == (12, 0)
    assert (o.end.hour, o.end.minute) == (11, 59)
    assert o.start.date() == date(2026, 6, 13)
    assert o.end.date() == date(2026, 6, 14)


def test_rep_vhf_uhf_follows_the_holiday_and_not_the_second_saturday(catalog):
    """
    REP publishes two live and contradictory rules for this one contest.
    concursos.rep.pt -- the portal rep.pt's own front page links to -- says
    'no 10 de junho (feriado) de cada ano'. portugaldaycontest.rep.pt still
    says 'no 2 Sabado do mes de junho de cada ano, (8 de Junho de 2024)'. They
    give different days in every year where 10 June is not the second Saturday.

    The fixed date is encoded because it is the one REP ran: its own 'Logs
    recebidos - VHF-UHF 2025' post is dated 10 June 2025, a TUESDAY, while the
    second Saturday of June 2025 was the 14th. This test is the decision, so
    that reverting it means arguing with the evidence rather than editing JSON.
    """
    (o,) = expand(by_id(catalog, "rep-portugal-day-vhf-uhf"), 2025)
    assert o.start.date() == date(2025, 6, 10)
    assert o.start.weekday() == 1  # Tuesday
    assert o.start.date() != date(2025, 6, 14)  # the superseded page's answer

    for year in (2026, 2027, 2028):
        (o,) = expand(by_id(catalog, "rep-portugal-day-vhf-uhf"), year)
        assert o.start.date() == date(year, 6, 10)
        assert (o.start.hour, o.end.hour) == (12, 18)


def test_rep_50mhz_takes_the_first_complete_weekend_of_august(catalog):
    """
    'Primeiro fim de semana completo de agosto, desde as 14:00 UTC de sabado
    as 14:00 UTC de domingo. 2025: o concurso ocorre nos dias 2 e 3 de agosto.'

    Note what this does NOT prove. For the FIRST weekend of a 31-day month the
    full-weekend reading and 'first Saturday' agree in every year, because the
    only Saturday that cannot open a full weekend is one falling on the last
    day of the month. The type is REP's own wording, not a date-changing
    choice, and the note on the record says so.
    """
    (o,) = expand(by_id(catalog, "rep-50mhz"), 2025)
    assert o.start.date() == date(2025, 8, 2)
    assert o.end.date() == date(2025, 8, 3)
    assert (o.start.hour, o.end.hour) == (14, 14)
    assert o.duration_hours == 24


def test_rep_deadlines_are_encoded_only_where_the_sponsor_states_a_span(catalog):
    """
    All three REP contests state a log deadline and only one of them is a span.

    The VHF/UHF contest runs on a fixed date (10 June) and its logs are due on
    a fixed date (20 June), so ten days is exact in every year. The other two
    state a calendar deadline against a moving contest -- 'no later than June
    30th of the same year', 'ate as 23:59 (UTC) do dia 8 de Agosto de 2025' --
    which is a different number of days every year, so they carry none rather
    than a number REP never wrote. Same rule as JARL All Asian.
    """
    assert by_id(catalog, "rep-portugal-day-vhf-uhf")["log_deadline_days"] == 10
    for cid in ("rep-portugal-day-hf", "rep-50mhz"):
        assert "log_deadline_days" not in by_id(catalog, cid), cid


def test_rca_holds_only_the_editions_argentina_published(catalog):
    """
    Radio Club Argentino states one dated running per contest and no
    recurrence, so both records are `manual` and both currently sit in the
    past: 18 October 2025 for the 40 m contest and 13 June 2026 for the 80 m
    one. Neither puts anything on a forward calendar, and that is correct --
    fitting an ordinal to a single date would be a rule RCA has not written.

    South America is the catalog's thinnest region, which makes this exactly
    the place where inventing a rule would be most tempting and least
    defensible.
    """
    for cid, year, day in (("rca-nacional-40m", 2025, date(2025, 10, 18)),
                           ("rca-nacional-80m", 2026, date(2026, 6, 13))):
        c = by_id(catalog, cid)
        assert c["recurrence"]["type"] == "manual", cid
        (o,) = expand(c, year)
        assert o.start.date() == day, cid
        # No year RCA has not announced.
        assert expand(c, year + 1) == [], cid

    # RCA restricts entry to Argentina and its neighbours, which is a real
    # entity list rather than a formality, so a K station cannot enter.
    assert not eligibility_for(by_id(catalog, "rca-nacional-80m"), "K")["can_enter"]
    assert eligibility_for(by_id(catalog, "rca-nacional-80m"), "LU")["can_enter"]


# ---------------------------------------------------------------------------
# JARL's Japanese-language contests.
#
# These four were deferred on 2026-08-17 with the note "they are real contests
# and a future pass should read the Japanese pages rather than guess". Read
# 2026-08-19. JARL states each recurrence in its 規約 and then prints the year's
# dates separately at the head of the same page, which is the independent check.
# ---------------------------------------------------------------------------

JARL_JP_PUBLISHED = {
    "jarl-all-ja": (
        "毎年4月の最終日曜日の前日の21時00分から最終日曜日の21時00分（JST）まで",
        (2026, 4, 25),
    ),
    "jarl-6m-and-down": (
        "毎年7月の第1土曜日21時00分～翌日の15時00分（JST）",
        (2026, 7, 4),
    ),
    "jarl-field-day": (
        "毎年8月の第1土曜日の21時00分から翌日の15時00分（JST）まで",
        (2026, 8, 1),
    ),
    "jarl-acag": (
        "毎年10月第2月曜日の前々日の21時00分から前日の21時00分（JST）まで",
        (2026, 10, 10),
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, d) for cid, (rule, d) in sorted(JARL_JP_PUBLISHED.items())
])
def test_jarl_japanese_contests_match_jarls_published_dates(catalog, cid, rule, published):
    (o,) = expand(by_id(catalog, cid), 2026)
    assert o.start.date() == date(*published), f"{cid}: rule '{rule}'"


def test_jarl_states_its_times_in_tokyo_and_they_never_shift(catalog):
    """
    JARL writes 21時00分（JST）, so the records carry Asia/Tokyo wall clock
    rather than a UTC time converted by hand. Japan has not observed daylight
    saving since 1952, so the resolved instant is 1200Z every year -- which is
    worth pinning precisely BECAUSE it never moves: if it ever does, something
    has gone wrong in the zone layer rather than at JARL.
    """
    for year in (2026, 2027, 2030):
        for cid in JARL_JP_PUBLISHED:
            (o,) = expand(by_id(catalog, cid), year)
            assert o.start_wall.hour == 21, cid
            assert o.start.hour == 12, f"{cid} {year}: 2100 JST is 1200Z"


def test_acag_hangs_off_japans_sports_day_and_counts_backwards(catalog):
    """
    全市全郡 is the only rule in the catalog anchored on a public holiday and
    counted backwards: "毎年10月第2月曜日の前々日の21時00分から前日の21時00分" --
    from 21:00 two days before the second Monday of October until 21:00 the day
    before it. The second Monday of October is Japan's Sports Day.

    It is NOT "the second full weekend of October", and the difference is not
    academic: the two readings agree in 2026 and 2027 and then diverge by a
    whole week in 2028 and 2029. A calendar that guessed the weekend reading
    would send someone to the radio seven days late, twice.
    """
    expected = {
        2026: date(2026, 10, 10),
        2027: date(2027, 10, 9),
        2028: date(2028, 10, 7),   # a full-weekend reading says the 14th
        2029: date(2029, 10, 6),   # ...and the 13th
        2030: date(2030, 10, 12),
    }
    for year, day in expected.items():
        (o,) = expand(by_id(catalog, "jarl-acag"), year)
        assert o.start.date() == day, year
        # Always the Saturday, and always ending on the Sunday.
        assert o.start.weekday() == 5 and o.end.weekday() == 6, year

    for year in (2028, 2029):
        weekend = resolve_anchors({"type": "nth_full_weekend", "month": 10, "n": 2}, year)[0]
        assert expand(by_id(catalog, "jarl-acag"), year)[0].start.date() != weekend, year


def test_all_ja_follows_jarls_wording_though_nothing_turns_on_it(catalog):
    """
    The opposite case, recorded so the distinction above is not overclaimed.
    ALL JA is "the day before the last Sunday of April", which is the same date
    as "the last full weekend of April" in every year and always will be:
    April's last Sunday falls on the 24th at the earliest, so the Saturday
    before it is never outside the month. JARL's wording is encoded because it
    is JARL's, not because it changes an answer.
    """
    for year in range(2026, 2036):
        (o,) = expand(by_id(catalog, "jarl-all-ja"), year)
        weekend = resolve_anchors({"type": "nth_full_weekend", "month": 4, "n": -1}, year)[0]
        assert o.start.date() == weekend, year


def test_jarl_domestic_contests_are_japan_only_and_carry_no_deadline(catalog):
    """
    "日本国内のアマチュア局およびSWL" -- amateur stations within Japan, and SWLs.
    A JA station can be WORKED from anywhere, which is why these records exist
    at all; entry is the restricted part, and that is a display-time filter.

    And no log deadline: JARL prints a dated one per edition above the rules
    rather than a span inside them. All four 2026 deadlines happen to fall ten
    days after their contest, which is suggestive and is not a rule JARL wrote.
    """
    for cid in JARL_JP_PUBLISHED:
        c = by_id(catalog, cid)
        assert c["eligibility"]["scope"] == "entity_list", cid
        assert c["eligibility"]["entities"] == ["JA"], cid
        assert not eligibility_for(c, "K")["can_enter"], cid
        assert eligibility_for(c, "JA")["can_enter"], cid
        assert "log_deadline_days" not in c, cid


ARSI_PUBLISHED = {
    "arsi-vu-dx": ("22 - 23 August 2026, 12:00 UTC to 11:59:59 UTC", (2026, 8, 22), 12),
    "arsi-qrp-day": ("27th - 28th June 2026, 5:30 UTC to 11:59:59 UTC", (2026, 6, 27), 5),
    "arsi-vu-rookie": ("25 - 26 April 2026, 12:00 UTC to 11:59:59 UTC", (2026, 4, 25), 12),
    "arsi-40m-cq-vu-ssb": ("21 - 22 March 2026, 7:30 PM IST", (2026, 3, 21), 14),
    "arsi-40m-cq-vu-cw": ("5 - 6 Dec 2026, 7:30 PM IST", (2026, 12, 5), 14),
}


@pytest.mark.parametrize("cid,rule,day,hour", [
    (cid, r, d, h) for cid, (r, d, h) in sorted(ARSI_PUBLISHED.items())
])
def test_arsi_holds_the_editions_india_published(catalog, cid, rule, day, hour):
    """
    ARSI publishes dates and no recurrence -- every page opens with the year's
    dates and states no rule anywhere. So all five are manual, hold exactly the
    2026 edition, and produce nothing for a year ARSI has not announced.
    """
    c = by_id(catalog, cid)
    assert c["recurrence"]["type"] == "manual", cid
    (o,) = expand(c, 2026)
    assert o.start.date() == date(*day), f"{cid}: {rule}"
    assert o.start.hour == hour, f"{cid}: {rule}"
    assert expand(c, 2027) == [], cid


def test_arsi_40m_contests_are_stated_in_indian_time_only(catalog):
    """
    Three of ARSI's five pages give UTC. The two 40M ones give ONLY Indian
    Standard Time -- "7:30 PM IST to 7:29:59 PM IST" -- so those records carry
    Asia/Kolkata wall clock rather than a UTC time converted by hand. India is
    a fixed +05:30 with no daylight saving, so 1930 IST is 1400 UTC and always
    will be; the record still says what the page said.
    """
    for cid in ("arsi-40m-cq-vu-ssb", "arsi-40m-cq-vu-cw"):
        c = by_id(catalog, cid)
        assert c["timezone"] == "Asia/Kolkata", cid
        (o,) = expand(c, 2026)
        assert (o.start_wall.hour, o.start_wall.minute) == (19, 30), cid
        assert (o.start.hour, o.start.minute) == (14, 0), cid

    # ...and the three that state UTC carry no zone at all.
    for cid in ("arsi-vu-dx", "arsi-qrp-day", "arsi-vu-rookie"):
        assert "timezone" not in by_id(catalog, cid), cid


def test_arsi_40m_eligibility_records_a_contradiction_rather_than_resolving_it(catalog):
    """
    Both 40M pages say "Any licensed ham can participate in the contest" and
    then, four lines later, "Though this contest is only for VU, any DX contacts
    in the log will get 2 QSO multiplier points". The two cannot both be taken
    at face value. The likely reading -- entry is VU, DX may be worked -- is
    what is encoded, with eligibility.verified false saying so.
    """
    for cid in ("arsi-40m-cq-vu-ssb", "arsi-40m-cq-vu-cw"):
        e = by_id(catalog, cid)["eligibility"]
        assert e["scope"] == "entity_list" and e["entities"] == ["VU"], cid
        assert e["verified"] is False, cid
        assert "CONTRADICTS" in e["note"], cid

    # The VU-DX contest is the opposite case and is stated plainly, so it is
    # verified: "Geographic Focus : India. Participation : Worldwide."
    dx = by_id(catalog, "arsi-vu-dx")["eligibility"]
    assert dx["scope"] == "worldwide" and dx["verified"] is True
    assert eligibility_for(by_id(catalog, "arsi-vu-dx"), "K")["can_enter"]


# TRAC publishes a page per year, so its own dates check its own rule -- and
# in one year out of four they disagree. See data/sources.md.
TRAC_PUBLISHED = {2023: (7, 8), 2024: (7, 6), 2025: (7, 5), 2026: (7, 4)}


@pytest.mark.parametrize("year,md", sorted(TRAC_PUBLISHED.items()))
def test_trac_reproduces_every_date_turkey_published(catalog, year, md):
    (o,) = expand(by_id(catalog, "trac-ta-vhf-uhf"), year)
    assert o.start.date() == date(year, *md)
    assert (o.start.hour, o.end.hour) == (12, 12)


def test_trac_exception_is_flagged_as_an_inference(catalog):
    """
    TRAC states "Temmuz ayının ilk hafta sonu" -- the first weekend of July --
    and that reproduces its 2024, 2025 and 2026 dates. It does NOT reproduce
    2023: 1 July 2023 was itself a Saturday, the rule gives 1-2 July, and TRAC
    ran the contest on 8-9 July.

    exclude_dates [[7, 1]] is what makes all four come out right. It is the
    same shape as ARRL RTTY Roundup's "never 1 January" -- except ARRL STATES
    its exception and TRAC does not, so this is one year's evidence fitted into
    a rule. Hence verified: false, and hence this test, which exists to keep
    the inference visible rather than to bless it.
    """
    c = by_id(catalog, "trac-ta-vhf-uhf")
    assert c["verified"] is False
    assert c["recurrence"]["exclude_dates"] == [[7, 1]]
    assert "INFERENCE" in c["note"]

    # Inert in most years, and the years it is not are named.
    for year in (2028, 2034, 2045):
        assert date(year, 7, 1).weekday() == 5, year
        (o,) = expand(c, year)
        assert o.start.date() == date(year, 7, 8), year

    # Without the exception the 2023 running would be wrong by a week, which is
    # the whole reason it is there.
    naive = resolve_anchors({"type": "nth_full_weekend", "month": 7, "n": 1}, 2023)[0]
    assert naive == date(2023, 7, 1)
    assert expand(c, 2023)[0].start.date() == date(2023, 7, 8)


# Nine contests run by eight South African clubs, all from the SARL Contest
# Manual -- which carries their full rules and names each organiser, so it is
# where these rules are published rather than a listing of them.
ZA_CLUB_PUBLISHED = {
    "zs1-qso-party": ("last Sunday of July", [(2026, 7, 26)], 16),
    "zs2-qso-party": ("3rd Sunday of July", [(2026, 7, 19)], 14),
    "zs3-qso-party": ("3rd Sunday of May", [(2026, 5, 17)], 14),
    "zs4-qso-party": ("2nd Sunday of April", [(2026, 4, 12)], 14),
    "zs5-qso-party": ("1st Sunday of July", [(2026, 7, 5)], 14),
    "hammies-qso-party": ("2nd Sunday of June", [(2026, 6, 14)], 14),
    "early-morning-coffee-qso-party":
        ("2nd Wednesday of May and October", [(2026, 5, 13), (2026, 10, 14)], 4),
    "awasa-cw-activity-day": ("1st Sunday of February", [(2026, 2, 1)], 13),
    "hamsat-sa-qo100-qso-party": ("2nd Sunday February", [(2026, 2, 8)], 13),
}


@pytest.mark.parametrize("cid,rule,days,hour", [
    (cid, r, d, h) for cid, (r, d, h) in sorted(ZA_CLUB_PUBLISHED.items())
])
def test_za_club_contests_match_the_manuals_own_dates(catalog, cid, rule, days, hour):
    occ = expand(by_id(catalog, cid), 2026)
    assert [o.start.date() for o in occ] == [date(*d) for d in days], f"{cid}: {rule}"
    assert occ[0].start.hour == hour, f"{cid}: {rule}"


def test_za_club_contests_are_credited_to_their_clubs_not_to_sarl(catalog):
    """
    The SARL Contest Manual publishes these, but SARL does not run them -- it
    names a Sponsor Club for each. Crediting them to SARL would be wrong twice
    over: it would misattribute the contest, and it would hide eight clubs
    behind one sponsor filter. Nine contests, nine clubs -- one each.
    """
    sponsors = {by_id(catalog, cid)["sponsor"] for cid in ZA_CLUB_PUBLISHED}
    assert "SARL" not in sponsors
    assert len(sponsors) == 9, sponsors
    assert "Cape Town Amateur Radio Club" in sponsors
    assert "Port Elizabeth Amateur Radio Society (PEARS)" in sponsors


def test_zs1_runs_an_hour_later_than_the_other_provincial_parties(catalog):
    # Five provincial parties with near-identical rules, and one of them starts
    # at 16:00 rather than 14:00. That is the detail a regularised copy of a
    # calendar would smooth away, so it gets its own assertion.
    assert expand(by_id(catalog, "zs1-qso-party"), 2026)[0].start.hour == 16
    for cid in ("zs2-qso-party", "zs3-qso-party", "zs4-qso-party", "zs5-qso-party"):
        assert expand(by_id(catalog, cid), 2026)[0].start.hour == 14, cid


def test_za_club_eligibility_is_unverified_where_the_manual_is_silent(catalog):
    """
    The manual names entity lists for SARL's own HAMNET and Top Band contests
    and says nothing at all about who may enter the club parties. Silence is
    not a statement, so those records are worldwide with verified false.
    """
    silent = ["zs1-qso-party", "zs2-qso-party", "zs3-qso-party", "zs4-qso-party",
              "zs5-qso-party", "hammies-qso-party", "early-morning-coffee-qso-party",
              "awasa-cw-activity-day"]
    for cid in silent:
        e = by_id(catalog, cid)["eligibility"]
        assert e["scope"] == "worldwide" and e["verified"] is False, cid

    # HamSat-SA is the exception: its aim names "South Africa and the world".
    e = by_id(catalog, "hamsat-sa-qo100-qso-party")["eligibility"]
    assert e["scope"] == "worldwide" and e["verified"] is True


def test_pears_runs_two_scored_sessions_back_to_back(catalog):
    """
    PEARS calls it "a 44-hour dual contest ... divided into 2 sessions", and
    scores them separately. They are contiguous -- the second "commences
    immediately after" the first ends at 14:00 UTC on the Saturday -- so a
    single 44-hour occurrence would draw the same bar on the rail while losing
    the fact that there are two scored periods.

    The anchor is the 2nd FRIDAY of January, which is how PEARS phrases it:
    "(2nd Friday and Saturday of January)".
    """
    occ = expand(by_id(catalog, "pears-national-vhf-uhf"), 2026)
    assert len(occ) == 2
    assert occ[0].start.date() == date(2026, 1, 9) and occ[0].start.weekday() == 4
    assert occ[0].duration_hours == 22 and occ[1].duration_hours == 22
    # Contiguous: session two starts exactly where session one ends.
    assert occ[0].end == occ[1].start


def test_sota_says_all_bands_so_none_are_recorded(catalog):
    # "Frequencies and modes: All amateur bands and modes". Mixed is exactly
    # what that sentence means for modes; for bands there is no list to record,
    # and writing one would invent a restriction SARL did not state.
    c = by_id(catalog, "zs-sota-activity-weekend")
    assert c["bands"] == []
    assert c["modes"] == ["Mixed"]
    occ = expand(c, 2026)
    assert [o.start.date() for o in occ] == [date(2026, 5, 16), date(2026, 9, 19)]


def test_australia_day_opens_the_day_before_the_holiday(catalog):
    """
    Australia Day is 26 January and the contest opens at 2200 UTC on the 25th,
    which is 0900 on the 26th in eastern Australia. The anchor is therefore the
    26th with a negative offset on the start, exactly as WIA states it -- not a
    rule about the 25th, which would drift if WIA ever moved the hours.
    """
    for year in (2026, 2027, 2028):
        (o,) = expand(by_id(catalog, "wia-australia-day"), year)
        assert o.start.date() == date(year, 1, 25)
        assert (o.start.hour, o.end.hour) == (22, 10)
        assert o.end.date() == date(year, 1, 26)
        assert o.duration_hours == 12

    # WIA's "Phone" covers AM, FM and SSB; FM has a token and AM does not.
    c = by_id(catalog, "wia-australia-day")
    assert "FM" in c["modes"] and "SSB" in c["modes"]
    assert c["submodes"] == ["AM"]


# WWROF publishes future dates on its front page and keeps a rules PDF per
# year, so five of the sponsor's own dates check one rule.
WW_DIGI_PUBLISHED = {
    2024: date(2024, 8, 24),
    2026: date(2026, 8, 29),
    2027: date(2027, 8, 28),
    2028: date(2028, 8, 26),
    2029: date(2029, 8, 25),
}


@pytest.mark.parametrize("year,day", sorted(WW_DIGI_PUBLISHED.items()))
def test_ww_digi_reproduces_every_date_wwrof_published(catalog, year, day):
    assert expand(by_id(catalog, "ww-digi"), year)[0].start.date() == day


def test_ww_digi_is_a_full_weekend_rule_and_2024_is_why(catalog):
    """
    "Last full weekend of August" and "last Saturday of August" are different
    rules. They agree every year EXCEPT when 31 August is a Saturday, because
    the Sunday then falls in September and that weekend is not full.

    2024 was such a year, and WWROF's own 2024 rules PDF says the contest ran
    Saturday 24 August -- not the 31st. So the full-weekend reading is what the
    sponsor actually runs. This test exists because the two encodings agree in
    2026, 2027, 2028 and 2029, so every year a casual check is likely to try
    would pass with the wrong rule stored.
    """
    c = by_id(catalog, "ww-digi")
    assert c["recurrence"] == {"type": "nth_full_weekend", "month": 8, "n": -1}

    # The year that separates them, from both directions.
    assert date(2024, 8, 31).weekday() == 5          # a Saturday...
    assert date(2024, 9, 1).month == 9               # ...whose Sunday is not in August
    assert expand(c, 2024)[0].start.date() == date(2024, 8, 24)


def test_ww_digi_records_the_2026_rule_changes(catalog):
    # Both changed for 2026 and both matter to an operator: the log deadline
    # went from five days to 48 hours, and autonomous operation is now
    # prohibited -- which is a rule about unattended FT8.
    c = by_id(catalog, "ww-digi")
    assert c["log_deadline_days"] == 2
    assert "Autonomous systems or robots" in c["source_note"]
    assert c["modes"] == ["FT8/FT4"]
    occ = expand(c, 2026)[0]
    assert (occ.start.hour, occ.start.minute) == (12, 0)
    assert (occ.end.hour, occ.end.minute) == (11, 59)


# RSGB keeps a rules page per year, so five years of its own dates check one
# rule -- fifteen date-points across three contests, all from one anchor.
AFS_PUBLISHED = {
    2022: (8, 16, 22),
    2023: (7, 15, 21),
    2024: (6, 14, 20),
    2025: (4, 12, 18),
    2026: (3, 11, 17),
}


@pytest.mark.parametrize("year,days", sorted(AFS_PUBLISHED.items()))
def test_rsgb_afs_reproduces_every_date_rsgb_published(catalog, year, days):
    got = tuple(
        expand(by_id(catalog, cid), year)[0].start.day
        for cid in ("rsgb-afs-cw", "rsgb-afs-data", "rsgb-afs-ssb")
    )
    assert got == days, year


def test_rsgb_afs_hangs_three_contests_off_one_anchor(catalog):
    """
    The AFS CW Saturday is the anchor; Datamodes is the Sunday eight days later
    and SSB the Saturday fourteen days later. Datamodes has no consistent
    ordinal of its own -- it is the third Sunday of January in 2022 and 2023
    and the second in 2024, 2025 and 2026 -- so encoding it as an ordinal would
    have been wrong in two of the five years RSGB published.
    """
    offsets = {"rsgb-afs-cw": 0, "rsgb-afs-data": 8, "rsgb-afs-ssb": 14}
    for cid, off in offsets.items():
        c = by_id(catalog, cid)
        assert c["start"]["day_offset"] == off, cid
        assert c["recurrence"]["exclude_dates"] == [[1, 1]], cid
        assert c["verified"], cid

    # The Datamodes leg really does move ordinal between years.
    assert expand(by_id(catalog, "rsgb-afs-data"), 2023)[0].start.day == 15   # 3rd Sunday
    assert expand(by_id(catalog, "rsgb-afs-data"), 2026)[0].start.day == 11   # 2nd Sunday


def test_rsgb_afs_new_year_exception_is_evidenced(catalog):
    # 1 January 2022 was itself a Saturday and RSGB ran AFS CW on the 8th. The
    # exclusion is not a guess fitted to one year: it is the only reading that
    # fits all five years across all three contests.
    assert date(2022, 1, 1).weekday() == 5
    assert expand(by_id(catalog, "rsgb-afs-cw"), 2022)[0].start.date() == date(2022, 1, 8)
    # Next time it decides anything.
    assert date(2028, 1, 1).weekday() == 5
    assert expand(by_id(catalog, "rsgb-afs-cw"), 2028)[0].start.date() == date(2028, 1, 8)


# Four years of RSGB's own rules pages, per contest. RSGB keeps a page per
# year, so the sponsor checks the sponsor's rule -- 28 date-points here.
RSGB_PUBLISHED = {
    "rsgb-1_8mhz-first": {2023: (2, 11), 2024: (2, 10), 2025: (2, 8), 2026: (2, 14)},
    "rsgb-1_8mhz-second": {2023: (11, 18), 2024: (11, 16), 2025: (11, 15), 2026: (11, 21)},
    "rsgb-club-calls": {2023: (11, 11), 2024: (11, 9), 2025: (11, 8), 2026: (11, 14)},
    "rsgb-nfd-cw": {2023: (6, 3), 2024: (6, 1), 2025: (6, 7), 2026: (6, 6)},
    "rsgb-ssb-field-day": {2023: (9, 2), 2024: (9, 7), 2025: (9, 6), 2026: (9, 5)},
    "rsgb-low-power": {2023: (7, 16), 2024: (7, 21), 2025: (7, 20), 2026: (7, 19)},
}


@pytest.mark.parametrize(
    "cid,year,md",
    [(cid, y, md) for cid, years in sorted(RSGB_PUBLISHED.items())
     for y, md in sorted(years.items())],
)
def test_rsgb_reproduces_four_years_of_its_own_dates(catalog, cid, year, md):
    got = expand(by_id(catalog, cid), year)[0].start.date()
    assert got == date(year, *md), cid


def test_rsgb_national_field_day_has_no_new_year_style_exception(catalog):
    """
    The same committee, two different answers, and only published dates
    separate them.

    AFS skips 1 January when it falls on a Saturday -- evidenced by 2022. NFD
    does not skip 1 June: 1 June 2024 was itself a Saturday and RSGB ran the
    contest on it. So the AFS exclusion must not be copied across to NFD out of
    symmetry, and this test is here to fail if someone tries.
    """
    assert date(2024, 6, 1).weekday() == 5
    assert expand(by_id(catalog, "rsgb-nfd-cw"), 2024)[0].start.date() == date(2024, 6, 1)
    assert "exclude_dates" not in by_id(catalog, "rsgb-nfd-cw")["recurrence"]
    assert by_id(catalog, "rsgb-afs-cw")["recurrence"]["exclude_dates"] == [[1, 1]]


def test_rsgb_ft4_activity_day_is_manual_because_the_ordinal_breaks(catalog):
    """
    First Saturday of April in 2023, 2024 and 2025 -- and the second in 2026.
    Three years out of four is not a rule, so the record holds only the date
    RSGB published. Easter Sunday fell on 5 April 2026, which is a plausible
    reason and not a source.
    """
    c = by_id(catalog, "rsgb-ft4-activity-day")
    assert c["recurrence"]["type"] == "manual"
    assert not c["verified"]
    occ = expand(c, 2026)
    assert len(occ) == 1
    assert occ[0].start.date() == date(2026, 4, 11)
    # The ordinal that would have been wrong: 2026's first Saturday is the 4th.
    assert date(2026, 4, 4).weekday() == 5
    # ...and it produces nothing at all for a year RSGB has not published.
    assert expand(c, 2027) == []


def test_rsgb_low_power_leaves_the_lunch_hour_empty(catalog):
    # 0900-1200 and 1300-1600, which is why this record uses sessions. A single
    # seven-hour block would put a contest on the calendar during an hour RSGB
    # does not run one.
    occ = expand(by_id(catalog, "rsgb-low-power"), 2026)
    assert [(o.start.hour, o.end.hour) for o in occ] == [(9, 12), (13, 16)]
    assert all(o.duration_hours == 3.0 for o in occ)


def test_rsgb_top_band_records_differ_in_the_ways_rsgb_states(catalog):
    """
    Three top-band contests, three sets of rules, and the differences are the
    sponsor's own -- which is why they are three records and not one.
    """
    feb = by_id(catalog, "rsgb-1_8mhz-first")
    nov = by_id(catalog, "rsgb-1_8mhz-second")
    club = by_id(catalog, "rsgb-club-calls")

    assert feb["modes"] == ["CW", "SSB"]
    assert nov["modes"] == ["CW"]          # the November leg is CW only
    assert [c["bands"] for c in (feb, nov, club)] == [["160m"]] * 3

    # Club Calls caps the whole contest at 32 W, which is the point of it
    # rather than a footnote. Every other single-ceiling record in the catalog
    # sits at 5 W (a QRP class) or 100 W (the usual low-power class); 32 is a
    # value nothing else uses, so it is exactly the sort of number that gets
    # "tidied" to 30 or 35 by someone who has not read the rules.
    assert club["power_categories"][0]["max_watts"] == 32
    whole_contest_ceilings = {
        c["power_categories"][0]["max_watts"]
        for c in catalog
        if len(c.get("power_categories") or []) == 1
        and c["power_categories"][0].get("max_watts")
    }
    assert whole_contest_ceilings == {5, 32, 100}

    # Club Calls and the November leg are a week apart and are not the same
    # contest -- the second and third Saturdays of November.
    assert expand(club, 2026)[0].start.date() == date(2026, 11, 14)
    assert expand(nov, 2026)[0].start.date() == date(2026, 11, 21)


def test_nrau_is_blocked_for_the_right_contests_and_not_for_sac(catalog):
    """
    This test used to assert NRAU encoded NOTHING, and it was half right.

    nrau.net does say its contest information is under revision, and it does
    publish nothing usable for NRAU-Baltic or the Nordic Activity Contests --
    that half stands and those are still unencoded. What it got wrong is the
    leap from "this organisation's site is blocked" to "this organisation runs
    nothing we can read". NRAU also organises the Scandinavian Activity Contest,
    which publishes complete rules with standing recurrence wording at a domain
    of its own, and SAC appeared nowhere in the registry at all until the
    2026-08-21 gap audit.

    So the assertion is now the corrected shape: SAC is encoded, the blocked
    contests are still absent, and the entry says both.
    """
    reg = load_registry()
    nrau = next(o for o in reg["tier_2_european_societies"] if o["org"] == "NRAU")

    # The flagship is in, both legs, from the contest's own site.
    sac = sorted(c["id"] for c in catalog if c["sponsor"] == "NRAU")
    assert sac == ["sac-cw", "sac-ssb"]
    for cid in sac:
        c = by_id(catalog, cid)
        assert "sactest.net" in c["rules_url"], cid
        assert c["verified"], cid

    # ...and the part that really is blocked is still empty. No NAC, no Baltic.
    names = " ".join(c["name"].lower() for c in catalog)
    assert "nordic activity" not in names
    assert "nrau-baltic" not in names

    assert nrau["status"] == "partial"
    assert nrau["catalog_sponsors"] == ["NRAU"]
    assert "under revision" in nrau["notes"]


# ---------------------------------------------------------------------------
# Time zones
#
# `local_time` used to mean two incompatible things: "the sponsor runs this at
# a clock time in THEIR zone" and "this starts at a clock time wherever YOU
# are". The first has exactly one correct UTC instant that moves with DST; the
# second has none at all. These tests pin both halves of the split, and the two
# DST edges, which zoneinfo resolves silently rather than raising.
# ---------------------------------------------------------------------------

def test_no_record_still_uses_legacy_local_time(catalog):
    """The migration is only finished when nothing carries the old flag."""
    stragglers = [c["id"] for c in catalog if "local_time" in c]
    assert not stragglers, f"still using retired local_time: {stragglers}"


def test_no_record_has_both_timezone_and_local_rolling(catalog):
    """
    A contest is anchored to the sponsor's clock or to the operator's. Both at
    once is incoherent, and the engine refuses to expand such a record.
    """
    for c in catalog:
        assert not (c.get("timezone") and c.get("local_rolling")), c["id"]


def test_timezone_records_mark_every_spec_wall_clock(catalog):
    """
    A `timezone` with an unmarked time spec is the dangerous half-migration:
    the zone looks handled but the spec is still read as UTC.
    """
    for c in catalog:
        if not c.get("timezone"):
            continue
        specs = c.get("sessions") or [{"start": c["start"], "end": c["end"]}]
        for s in specs:
            assert s["start"].get("wall_clock") is True, c["id"]
            assert s["end"].get("wall_clock") is True, c["id"]


def test_wall_clock_without_a_timezone_is_refused():
    """
    Refusing beats defaulting. Silently treating an unzoned wall_clock spec as
    UTC is exactly the bug this rework removes.
    """
    broken = {
        "id": "broken",
        "name": "Broken",
        "recurrence": {"type": "fixed_date", "month": 6, "day": 1},
        "start": {"day_offset": 0, "time": "1900", "wall_clock": True},
        "end": {"day_offset": 0, "time": "2100", "wall_clock": True},
    }
    with pytest.raises(ValueError, match="wall_clock"):
        expand(broken, 2026)


def test_sponsor_anchored_shifts_with_dst(catalog):
    """
    The whole point. 4SQRP says it themselves: "7 PM until 9 PM central time
    (CST or CDT, whichever is in effect at the time). If you use UTC, that time
    changes when we switch from CST to CDT (or vice versa)."

    Same wall clock in January and July; UTC instants exactly one hour apart.
    """
    occ = {o.start.month: o for o in expand(by_id(catalog, "4sqrp-sss"), 2026)}
    jan, jul = occ[1], occ[7]

    assert jan.start_wall.hour == 19 and jul.start_wall.hour == 19
    assert jan.start.hour == 1, "19:00 CST is 0100Z"
    assert jul.start.hour == 0, "19:00 CDT is 0000Z"

    # Expressed as an offset from the same wall reading, the gap is one hour.
    assert (jan.start - jan.start_wall.replace(tzinfo=jan.start.tzinfo)) - (
        jul.start - jul.start_wall.replace(tzinfo=jul.start.tzinfo)
    ) == timedelta(hours=1)


def test_spartan_sprint_shifts_with_dst_too(catalog):
    """
    ARS publishes no UTC time at all and says the event "is always at these
    Local Times", so the UTC instant is what moves. December and July differ.
    """
    occ = {o.start.month: o for o in expand(by_id(catalog, "ars-spartan-sprint"), 2026)}
    assert occ[12].start.hour == 1, "20:00 EST is 0100Z"
    assert occ[7].start.hour == 0, "20:00 EDT is 0000Z"
    assert all(o.start_wall.hour == 20 for o in occ.values())


def test_dst_spring_forward_hour():
    """
    02:30 on 2026-03-08 in America/Chicago DOES NOT EXIST -- the clocks jump
    from 02:00 to 03:00. zoneinfo does not raise; it resolves using the
    pre-transition offset, which lands at 0830Z. That is the conventional
    "shift forward an hour" outcome, and it is pinned here so it stays a
    decision rather than an accident.

    No contest is anchored in this window today, but 0100-0300 local sprints
    are common in this hobby and one will land here eventually.
    """
    c = {
        "id": "spring-forward-probe",
        "name": "Spring Forward Probe",
        "timezone": "America/Chicago",
        "recurrence": {"type": "fixed_date", "month": 3, "day": 8},
        "start": {"day_offset": 0, "time": "0230", "wall_clock": True},
        "end": {"day_offset": 0, "time": "0430", "wall_clock": True},
    }
    occ = expand(c, 2026)[0]
    assert occ.start_wall == datetime(2026, 3, 8, 2, 30)
    assert occ.start == datetime(2026, 3, 8, 8, 30, tzinfo=UTC)


def test_dst_fall_back_hour():
    """
    01:30 on 2026-11-01 in America/Chicago happens TWICE. zoneinfo picks
    between them with `fold`, defaulting to 0 -- the first, still-CDT pass,
    which is 0630Z. The second pass would be 0730Z, a full hour later, and
    both are "valid". Pinned so the default is a choice.
    """
    c = {
        "id": "fall-back-probe",
        "name": "Fall Back Probe",
        "timezone": "America/Chicago",
        "recurrence": {"type": "fixed_date", "month": 11, "day": 1},
        "start": {"day_offset": 0, "time": "0130", "wall_clock": True},
        "end": {"day_offset": 0, "time": "0330", "wall_clock": True},
    }
    occ = expand(c, 2026)[0]
    assert occ.start == datetime(2026, 11, 1, 6, 30, tzinfo=UTC), "fold=0, first pass"


def test_rolling_contest_exposes_no_utc_instant():
    """
    An operator-anchored contest starts at a clock time wherever you are, so no
    single UTC instant exists. The engine must hand back None rather than a
    plausible-looking timestamp that would be wrong for everyone not on UTC --
    a hard failure beats a wrong value that propagates into an iCal feed.

    Exercised against a synthetic definition: no contest in the catalog is
    operator-anchored today (ARRL moved 10 GHz to fixed UTC), but the capability
    is here so the next one found does not get a fake instant.
    """
    c = {
        "id": "rolling-probe",
        "name": "Rolling Probe",
        "local_rolling": True,
        "recurrence": {"type": "nth_full_weekend", "month": 8, "n": 3},
        "start": {"day_offset": 0, "time": "0600"},
        "end": {"day_offset": 1, "time": "2359"},
    }
    occ = expand(c, 2026)[0]

    assert occ.start is None and occ.end is None
    assert occ.local_rolling is True
    assert occ.start_wall == datetime(2026, 8, 15, 6, 0)
    assert occ.start_wall.tzinfo is None, "a wall reading must not claim a zone"
    assert occ.start_date == date(2026, 8, 15)
    assert occ.duration_hours == pytest.approx(41.98, abs=0.02)

    payload = occ.to_dict()
    assert payload["start"] is None and payload["end"] is None
    assert payload["start_wall"] == "2026-08-15T06:00:00"


def test_rolling_contest_claims_no_log_deadline():
    """A deadline counted from an end that does not exist would be fiction."""
    c = {
        "id": "rolling-probe",
        "name": "Rolling Probe",
        "local_rolling": True,
        "log_deadline_days": 30,
        "recurrence": {"type": "fixed_date", "month": 6, "day": 1},
        "start": {"day_offset": 0, "time": "0600"},
        "end": {"day_offset": 0, "time": "1800"},
    }
    assert expand(c, 2026)[0].log_due is None


def test_conflicting_time_anchors_are_refused():
    c = {
        "id": "conflicted",
        "name": "Conflicted",
        "timezone": "America/Chicago",
        "local_rolling": True,
        "recurrence": {"type": "fixed_date", "month": 6, "day": 1},
        "start": {"day_offset": 0, "time": "1900", "wall_clock": True},
        "end": {"day_offset": 0, "time": "2100", "wall_clock": True},
    }
    with pytest.raises(ValueError, match="local_rolling"):
        expand(c, 2026)


def test_mixed_schedule_sorts_without_comparing_apples_to_oranges(catalog):
    """
    Sorting a year that mixes UTC, zoned and rolling contests must not blow up
    on naive-vs-aware comparison. `sort_key` exists for exactly this.
    """
    occ = expand_year(catalog, 2026)
    keys = [o.sort_key for o in occ]
    assert keys == sorted(keys)
    assert all(k.tzinfo is not None for k in keys)


def test_arrl_10ghz_is_utc_not_local_any_more(catalog):
    """
    ARRL moved this contest off local time and says so in the rules: "Each
    weekend begins 0900 UTC Saturday and runs through 0759 UTC Monday. NOTE:
    This is a change from the previous start and end times in local time."

    It was stored here as 0600 local Saturday to 2359 local Sunday, which is
    now wrong twice over -- wrong hours and wrong model.
    """
    for cid, expected in (
        ("arrl-10ghz-leg1", date(2026, 8, 15)),
        ("arrl-10ghz-leg2", date(2026, 9, 19)),
    ):
        c = by_id(catalog, cid)
        assert not c.get("timezone") and not c.get("local_rolling")
        occ = expand(c, 2026)[0]
        assert occ.start == datetime(expected.year, expected.month, expected.day, 9, 0, tzinfo=UTC)
        assert (occ.end.hour, occ.end.minute) == (7, 59)
        assert (occ.end.date() - occ.start.date()).days == 2, "Saturday to Monday"


def test_unknown_rule_type_surfaces_instead_of_yielding_an_empty_schedule():
    """
    A rule that produces no anchors this year is fine and returns nothing -- a
    fifth-Saturday rule in a four-Saturday month, or a `manual` record for an
    unpublished year. A rule type that does not exist is a catalog typo, and
    swallowing it would silently drop the contest from every calendar.
    """
    c = {
        "id": "typo",
        "name": "Typo",
        "recurrence": {"type": "nth_fortnight", "month": 6, "n": 1},
        "start": {"day_offset": 0, "time": "0000"},
        "end": {"day_offset": 0, "time": "0100"},
    }
    with pytest.raises(ValueError, match="unknown rule type"):
        expand(c, 2026)


def test_composite_rule_handles_mixed_subrules():
    """A composite may mix rule types -- last-weekday plus nth-full-weekend."""
    anchors = resolve_anchors(
        {
            "type": "composite",
            "rules": [
                {"type": "nth_weekday", "month": 2, "n": -1, "weekday": 5},
                {"type": "nth_full_weekend", "month": 7, "n": 3},
            ],
        },
        2026,
    )
    assert anchors == [date(2026, 2, 28), date(2026, 7, 18)]


# ---------------------------------------------------------------------------
# Catalog vocabularies
#
# `modes` and `bands` were free text until 2026-08-16: `Digital` and `DIGITAL`
# were different values, PSK31 sat alongside them as if it were a peer, and no
# band filter could be written at all. These tests are what stops that
# returning -- a controlled set that nothing enforces is a convention, and a
# convention decays one hand-edited record at a time.
#
# Mirrored one-for-one in engine/tests/recurrence.test.ts.
# ---------------------------------------------------------------------------


def test_every_record_draws_its_modes_from_the_controlled_set(catalog):
    offenders = [
        (c["id"], m)
        for c in catalog
        for m in c.get("modes", [])
        if m not in CATALOG_MODES
    ]
    assert offenders == [], f"modes outside the vocabulary: {offenders}"


def test_every_record_declares_at_least_one_mode(catalog):
    # A contest with no mode cannot be found by anyone filtering on mode, and
    # every sponsor states one. Absence here is an editing slip, not a fact.
    assert [c["id"] for c in catalog if not c.get("modes")] == []


def test_every_record_draws_its_bands_from_the_ladder(catalog):
    offenders = [
        (c["id"], b)
        for c in catalog
        for b in c.get("bands", [])
        if b not in CATALOG_BANDS
    ]
    assert offenders == [], f"bands outside the ladder: {offenders}"


def test_bands_are_listed_low_to_high(catalog):
    # Order is displayed as-is -- "160-10m" is collapsed from the ends of the
    # list. An unsorted list renders as a wrong range rather than as a mess,
    # which is the kind of wrong that gets believed.
    for c in catalog:
        bands = c.get("bands", [])
        order = [CATALOG_BANDS.index(b) for b in bands]
        assert order == sorted(order), f"{c['id']} lists bands out of order: {bands}"


def test_no_record_carries_a_duplicate_mode_or_band(catalog):
    for c in catalog:
        for fieldname in ("modes", "bands"):
            values = c.get(fieldname, [])
            assert len(values) == len(set(values)), f"{c['id']}: duplicate {fieldname}"


def test_retired_free_text_tokens_are_gone_everywhere(catalog):
    # The exact values that were in the catalog before the migration. Named
    # rather than inferred, so this fails loudly if one is reintroduced by a
    # copy-paste from an old record.
    retired = {"DIGITAL", "PSK31", "PSK63", "RTTY75", "FT4", "VHF+", "222MHz+", "10GHz+"}
    stragglers = [
        (c["id"], v)
        for c in catalog
        for v in c.get("modes", []) + c.get("bands", [])
        if v in retired
    ]
    assert stragglers == [], f"pre-migration tokens still in the catalog: {stragglers}"


def test_submodes_are_specifics_not_a_second_mode_list(catalog):
    # `submodes` is free text on purpose. What it must never hold is a value
    # from the controlled set -- that would be the mode recorded twice, in two
    # fields, and the two would eventually disagree.
    for c in catalog:
        for s in c.get("submodes", []):
            assert s not in CATALOG_MODES, f"{c['id']}: submode {s!r} belongs in modes"


def test_a_record_with_submodes_declares_the_family_they_belong_to(catalog):
    # PSK31 without Digital, or FT4 without FT8/FT4, is a record that shows up
    # in no filter at all. The submode is the detail; the mode is the handle.
    for c in catalog:
        if c.get("submodes"):
            assert c.get("modes"), f"{c['id']} has submodes but no mode"


def test_unrecorded_bands_are_the_documented_exception(catalog):
    """
    Empty `bands` means unrecorded, and a band filter drops the record. That is
    a real cost, so it is pinned to the records that have a documented reason.

    jarl-new-year-qso-party: JARL's rule is "All bands and Modes permitted for
    JA amateur radio stations" and points at the Japanese band plan. There is no
    band list on the page to record, and inferring one from the band plan would
    be this catalog writing a rule JARL did not.

    zs-sota-activity-weekend: SARL states "Frequencies and modes: All amateur
    bands and modes". Same shape as JARL -- there is no list on the page, and
    writing one out would be this catalog inventing a restriction the sponsor
    did not state.

    Note what BOTH of these have in common, and what neither is: the sponsor
    said "all bands", and we recorded that as an absence rather than guessing a
    list. sarl-hf-phone used to be here for the OTHER reason -- its source was
    unreachable -- and it left this list on 2026-08-19 when the league turned
    out to have moved rather than died. Waiting was the right call: the rule is
    to document a blocked source and stop, never to reach for an aggregator.
    """
    unrecorded = sorted(c["id"] for c in catalog if not c.get("bands"))
    assert unrecorded == ["jarl-new-year-qso-party", "zs-sota-activity-weekend"]


def test_bands_note_never_stands_in_for_a_band_list(catalog):
    # The note carries the sponsor's wording; it is not a place to record the
    # bands themselves in prose and skip the machine-readable list.
    for c in catalog:
        if c.get("bands_note"):
            assert c.get("bands"), f"{c['id']} has a bands_note but no bands"


@pytest.mark.parametrize("cid,last,after", [
    (cid, last, after) for cid, (last, after) in sorted(TIER2_MANUAL.items())
])
def test_tier2_manual_records_stop_where_the_sponsor_stopped_publishing(
    catalog, cid, last, after
):
    c = by_id(catalog, cid)
    assert c["recurrence"]["type"] == "manual"
    assert expand(c, last), f"{cid} produced nothing for its last published year"
    assert expand(c, after) == [], f"{cid} guessed {after}, a year nobody published"


def test_paccdigi_is_manual_even_though_both_dates_look_like_a_rule(catalog):
    """
    VERON's two published PACCdigi editions are both the third Saturday of
    April, and the temptation is to encode that. VERON does not say it -- the
    PACC page says 'het tweede volle weekend van februari' in so many words and
    the PACCdigi page says nothing of the kind, so the difference is the
    sponsor's, not ours.
    """
    c = by_id(catalog, "paccdigi")
    published = [expand(c, y)[0].start.date() for y in (2026, 2027)]
    assert published == [date(2026, 4, 18), date(2027, 4, 17)]
    assert all(d.weekday() == 5 for d in published)
    assert all(15 <= d.day <= 21 for d in published)  # third Saturday, both years
    assert c["recurrence"]["type"] == "manual"


def test_ure_rtty_is_manual_while_ure_states_a_rule_for_its_other_five(catalog):
    """
    Five of URE's six HF contests name an ordinal weekend in both language
    versions of their page. EA RTTY names a date and nothing else, in both, so
    it alone is manual -- the contrast is what makes that a reading of URE
    rather than an inconsistency of ours.
    """
    assert by_id(catalog, "ure-eartty")["recurrence"]["type"] == "manual"
    others = [
        "ure-rey-de-espana-cw", "ure-rey-de-espana-ssb",
        "ure-eapsk63", "ure-cncw", "ure-cme",
    ]
    for cid in others:
        assert by_id(catalog, cid)["recurrence"]["type"] == "nth_full_weekend", cid


def test_czech_contest_hosts_are_http_because_their_tls_is_broken(catalog):
    """
    okomdx.crk.cz and okrtty.crk.cz serve a certificate issued for
    default.web4u.cz, so HTTPS fails validation. The http:// URLs are a
    recorded blocker, not an oversight, and each record says so -- the same
    treatment given to SARL's dead host.
    """
    for cid in ("ok-om-dx-ssb", "ok-om-dx-cw", "ok-dx-rtty"):
        c = by_id(catalog, cid)
        assert c["rules_url"].startswith("http://"), cid
        assert "crk.cz" in c["rules_url"], cid
        assert "TLS" in c["note"], cid


# ---------------------------------------------------------------------------
# Sponsor validation -- DARC
#
# The rules are German and each record quotes them in German. The dates and
# deadlines below are DARC's, published separately from that wording in its own
# "Termine DARC KW Conteste 2026" table at /darc-kw-conteste/kw-conteste/. That
# table lists only DARC's own contests, so it is a sponsor source and not an
# aggregator -- the one IARU event on it is not encoded, for that reason.
# ---------------------------------------------------------------------------

DARC_PUBLISHED = {
    "wae-dx-cw": (
        "CW: August, zweites Wochenende",
        [(2026, 8, 8)],
    ),
    "wae-dx-ssb": (
        "SSB: September, zweites Wochenende",
        [(2026, 9, 12)],
    ),
    "wae-dx-rtty": (
        "RTTY: November, zweites Wochenende",
        [(2026, 11, 14)],
    ),
    "darc-wag": (
        "Oktober, drittes volles Wochenende, 1500 UTC Samstag bis 1459 UTC Sonntag",
        [(2026, 10, 17)],
    ),
    "darc-10m": (
        "Zweiter Sonntag im Januar, 0900-1059 UTC",
        [(2026, 1, 11)],
    ),
    "darc-xmas": (
        "26. Dezember, 08.30-10.59 UTC",
        [(2026, 12, 26)],
    ),
    "darc-ft4": (
        "Jeweils 2. Monat im Quartal, Am 2. Dienstag im Monat",
        [(2026, 2, 10), (2026, 5, 12), (2026, 8, 11), (2026, 11, 10)],
    ),
    "darc-rtty-kurzcontest": (
        "jeweils im 1. Monat eines jeden Quartals am 2. Dienstag",
        [(2026, 1, 13), (2026, 4, 14), (2026, 7, 14), (2026, 10, 13)],
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, dates) for cid, (rule, dates) in sorted(DARC_PUBLISHED.items())
])
def test_darc_contests_match_darcs_own_published_dates(catalog, cid, rule, published):
    got = [o.start.date() for o in expand(by_id(catalog, cid), 2026)]
    assert got == [date(*d) for d in published], f"{cid}: rule '{rule}'"


# The deadline column of the same table. DARC states the interval once in the
# general contest rules and again in most of the individual Ausschreibungen, so
# these are a second statement of it rather than a restatement of ours.
DARC_PUBLISHED_DEADLINES = {
    "wae-dx-cw": [(2026, 8, 16)],
    "wae-dx-ssb": [(2026, 9, 20)],
    "wae-dx-rtty": [(2026, 11, 22)],
    "darc-wag": [(2026, 10, 25)],
    "darc-10m": [(2026, 1, 18)],
    "darc-xmas": [(2027, 1, 2)],
    "darc-ft4": [(2026, 2, 17), (2026, 5, 19), (2026, 8, 18), (2026, 11, 17)],
    "darc-rtty-kurzcontest": [
        (2026, 1, 20), (2026, 4, 21), (2026, 7, 21), (2026, 10, 20),
    ],
}


@pytest.mark.parametrize("cid,published", sorted(DARC_PUBLISHED_DEADLINES.items()))
def test_darc_log_deadlines_match_darcs_own_published_dates(catalog, cid, published):
    c = by_id(catalog, cid)
    assert c["log_deadline_days"] == 7, cid
    got = [o.log_due.date() for o in expand(c, 2026)]
    assert got == [date(*d) for d in published], cid


def test_darc_wae_rtty_is_the_second_full_weekend_not_the_second_weekend(catalog):
    """
    DARC writes 'zweites Wochenende', without 'volles'. November 2026 is the
    year that separates the readings: 1 November is a Sunday whose Saturday
    belongs to October, so counting weekends from it gives 7-8 November. DARC
    publishes 14-15, which is the second FULL weekend.
    """
    assert date(2026, 11, 1).weekday() == 6  # an orphan Sunday
    assert _full_weekends_in_month(2026, 11)[1] == date(2026, 11, 14)
    assert expand(by_id(catalog, "wae-dx-rtty"), 2026)[0].start.date() == date(
        2026, 11, 14
    )


def test_wae_cw_deadline_follows_the_interval_darc_states_twice(catalog):
    """
    DARC contradicts itself on this one leg. Rule 13 of the WAE rules and the
    general contest rules both say seven days; seven days is 16 August 2026,
    which is what DARC's own contest calendar prints. The per-leg line on the
    rules page says 17.08.2026. The interval wins because it is stated twice
    and because it reproduces the SSB and RTTY legs' printed instants exactly.
    """
    c = by_id(catalog, "wae-dx-cw")
    assert expand(c, 2026)[0].log_due.date() == date(2026, 8, 16)
    assert "17.08.2026" in c["note"]  # the losing statement stays recorded


def test_darc_quarterly_series_interleave_on_the_same_weekday(catalog):
    """
    RTTY takes the first month of each quarter and FT4 the second, both on the
    second Tuesday. Encoded as one record each, so the two months lists must
    stay disjoint or a leg would be claimed twice.
    """
    rtty = by_id(catalog, "darc-rtty-kurzcontest")["recurrence"]
    ft4 = by_id(catalog, "darc-ft4")["recurrence"]
    assert rtty["months"] == [1, 4, 7, 10]
    assert ft4["months"] == [2, 5, 8, 11]
    assert not set(rtty["months"]) & set(ft4["months"])
    assert rtty["weekday"] == ft4["weekday"] == 1  # Tuesday
    assert rtty["n"] == ft4["n"] == 2
    for cid in ("darc-rtty-kurzcontest", "darc-ft4"):
        for o in expand(by_id(catalog, cid), 2026):
            assert o.start.weekday() == 1, cid
            assert 8 <= o.start.day <= 14, cid  # the second Tuesday, always


def test_darc_xmas_is_a_calendar_date_and_ignores_the_weekday(catalog):
    """
    26 December whatever day it falls on -- 2026 is a Saturday, 2027 a Sunday,
    2028 a Tuesday. A weekday rule fitted to any one of them would be wrong the
    next year.
    """
    c = by_id(catalog, "darc-xmas")
    assert c["recurrence"] == {"type": "fixed_date", "month": 12, "day": 26}
    for y, weekday in ((2026, 5), (2027, 6), (2028, 1)):
        occ = expand(c, y)[0]
        assert occ.start.date() == date(y, 12, 26)
        assert occ.start.weekday() == weekday


def test_darc_10m_rule_comes_from_darcs_superseded_ausschreibung(catalog):
    """
    The current Ausschreibung prints '11.01.26' and no rule; the pre-2023 one
    DARC keeps below it on the same page says 'Zweiter Sonntag im Januar'. That
    is where the recurrence comes from, and the record says so rather than
    letting a rule appear to have been fitted to a single date.
    """
    c = by_id(catalog, "darc-10m")
    assert c["recurrence"] == {"type": "nth_weekday", "month": 1, "n": 2, "weekday": 6}
    assert "bis 2023" in c["source_note"]
    assert expand(c, 2026)[0].start.date() == date(2026, 1, 11)


def test_darc_records_all_carry_the_sponsor_string_the_registry_joins_on(catalog):
    """
    DARC runs these under one contest department; the registry's DARC entry
    lists exactly one catalog_sponsors string, and an unregistered sponsor is
    only detectable through that join.
    """
    darc = [c for c in catalog if c["id"] in DARC_PUBLISHED]
    assert len(darc) == 8
    assert {c["sponsor"] for c in darc} == {"DARC"}
    assert {c["country"] for c in darc} == {"DE"}


# ---------------------------------------------------------------------------
# Counting backwards past "last"
#
# `n` used to mean "the nth from the front", with -1 special-cased to mean the
# last. BFRA's LZ DX Contest is the rule that needed more: "the weekend before
# the last full weekend of November", which BFRA states as a rule and not as an
# annual announcement, because the weekend it names is defined by CQ WW CW
# sitting on the last one. So n <= -1 now counts back from the end.
#
# The risk that comes with it is n=0, which is a position in neither direction.
# Read as "the first" it silently shifts a contest; read as "no anchors this
# year" it silently empties one. It raises instead, and because
# NoAnchorsThisYear is a ValueError, `monthly_nth_weekday`'s skip-a-short-month
# catch had to be narrowed so it does not swallow that.
# ---------------------------------------------------------------------------

def _synthetic(rule):
    """A minimal record for exercising a rule with no catalog entry behind it."""
    return {
        "id": "synthetic",
        "name": "Synthetic",
        "recurrence": rule,
        "start": {"day_offset": 0, "time": "0000"},
        "end": {"day_offset": 0, "time": "0100"},
    }


def test_nth_counts_backwards_past_last():
    """
    November 2025 has five full weekends: 1, 8, 15, 22 and 29 November. -1 is
    the last, -2 the one before it, -3 the one before that.
    """
    assert _full_weekends_in_month(2025, 11) == [
        date(2025, 11, 1),
        date(2025, 11, 8),
        date(2025, 11, 15),
        date(2025, 11, 22),
        date(2025, 11, 29),
    ]
    for n, expected in ((-1, 29), (-2, 22), (-3, 15)):
        got = expand(_synthetic({"type": "nth_full_weekend", "month": 11, "n": n}), 2025)
        assert got[0].start.date() == date(2025, 11, expected), n


def test_nth_counting_back_past_the_start_is_an_empty_year_not_an_error():
    """
    Asking for the sixth-from-last of five is the same kind of nothing as a
    fifth Monday in a four-Monday month: the year has no such date, and expand
    returns nothing rather than raising.
    """
    rule = {"type": "nth_full_weekend", "month": 11, "n": -6}
    assert expand(_synthetic(rule), 2025) == []


def test_nth_rejects_zero_as_a_malformed_rule():
    """
    n=0 is a catalog typo, not a date that does not exist. Read as "the first"
    it moves a contest a week; read as NoAnchorsThisYear it drops the contest
    from the calendar without a word. Neither is acceptable, so it raises -- and
    the exception must not be NoAnchorsThisYear, or callers that legitimately
    swallow that would swallow this too.
    """
    rule = {"type": "nth_weekday", "month": 11, "n": 0, "weekday": 5}
    with pytest.raises(ValueError) as exc:
        expand(_synthetic(rule), 2025)
    assert not isinstance(exc.value, NoAnchorsThisYear)
    assert "n=0" in str(exc.value)


def test_monthly_nth_weekday_skips_short_months_but_not_malformed_rules():
    """
    A "fifth Monday" rule simply has no date in a month with four, and skipping
    those is the whole point of the catch inside monthly_nth_weekday. It is
    narrowed to NoAnchorsThisYear so a n=0 rule inside the same loop still
    raises instead of quietly producing an empty year.
    """
    months = list(range(1, 13))
    fifths = expand(
        _synthetic(
            {"type": "monthly_nth_weekday", "n": 5, "weekday": 0, "months": months}
        ),
        2026,
    )
    assert 0 < len(fifths) < 12
    assert all(o.start.day > 28 for o in fifths)
    assert all(o.start.weekday() == 0 for o in fifths)

    with pytest.raises(ValueError) as exc:
        expand(
            _synthetic(
                {"type": "monthly_nth_weekday", "n": 0, "weekday": 0, "months": months}
            ),
            2026,
        )
    assert not isinstance(exc.value, NoAnchorsThisYear)


# ---------------------------------------------------------------------------
# Sponsor validation -- the remaining Tier 2 European societies
#
# USKA, OeVSV, MRASZ, BFRA, FRR, SRS, HRS, LRAL, ERAU, LRMD, SRR and UARL. Each
# rule is quoted in the sponsor's own language on the record; the dates below
# are the sponsor's too, published separately from that wording -- a KW-Contest
# date page, a year printed inside the rules themselves, an archive of past
# editions, a society calendar. NRAU is absent on purpose: it is blocked at
# source and encodes nothing. See data/sources.md.
#
# Session records emit one occurrence per session, so start dates are deduped.
# ---------------------------------------------------------------------------

TIER2B_PUBLISHED = {
    "uska-helvetia": (
        "Letztes volles Wochenende im April, Samstag 13:00 UTC bis Sonntag 12:59 UTC",
        {2026: [(2026, 4, 25)], 2027: [(2027, 4, 24)]},
    ),
    "uska-field-day-cw": (
        "CW: Erstes volles Wochenende im Juni",
        {2026: [(2026, 6, 6)], 2027: [(2027, 6, 5)]},
    ),
    "uska-field-day-ssb": (
        "SSB: Erstes volles Wochenende im September",
        {2026: [(2026, 9, 5)]},
    ),
    "uska-nmd": (
        "Dritter Sonntag im Juli, 06:00 UTC bis 09:59 UTC",
        {2026: [(2026, 7, 19)]},
    ),
    "uska-weihnachtswettbewerb-ssb": (
        "SSB: Erster Samstag im Dezember, 07:00 bis 09:59 UTC",
        {2026: [(2026, 12, 5)]},
    ),
    "uska-weihnachtswettbewerb-cw": (
        "CW: Zweiter Samstag im Dezember, 07:00 bis 09:59 UTC",
        {2026: [(2026, 12, 12)]},
    ),
    "oevsv-aoee-80-40": (
        "2. TERMIN: 1. Mai 2026",
        {2026: [(2026, 5, 1)]},
    ),
    "oevsv-aoec-160m": (
        "Jeweils am dritten vollen Wochenende im NOVEMBER",
        {2025: [(2025, 11, 15)], 2026: [(2026, 11, 21)]},
    ),
    "mrasz-ha-dx": (
        "every year 3rd full weekend of January",
        {2026: [(2026, 1, 17)]},
    ),
    "mrasz-yl-om": (
        "minden evben marcius 8-hoz legkozelebb eso hetvegen",
        {2026: [(2026, 3, 8)]},
    ),
    "mrasz-rfwd-hf": (
        "evente aprilis 18.-an 16.00 UT-tol 16.59 UT-ig",
        {2026: [(2026, 4, 18)]},
    ),
    "bfra-lz-dx": (
        "The weekend before the last full weekend of November",
        {2025: [(2025, 11, 22)], 2026: [(2026, 11, 21)]},
    ),
    "frr-yo-dx-hf": (
        "Al patrulea weekend intreg al lunii August",
        {2026: [(2026, 8, 22)]},
    ),
    "hrs-9a-dx": (
        "3rd full weekend in December",
        {2025: [(2025, 12, 20)], 2026: [(2026, 12, 19)]},
    ),
    "srs-tesla-memorial-hf-cw": (
        "odrzavace se svake godine drugog vikenda u martu",
        {
            2019: [(2019, 3, 9)],
            2020: [(2020, 3, 14)],
            2021: [(2021, 3, 13)],
            2022: [(2022, 3, 12)],
            2023: [(2023, 3, 11)],
            2024: [(2024, 3, 9)],
            2025: [(2025, 3, 8)],
            2026: [(2026, 3, 14)],
        },
    ),
    "lral-18-november-80m": (
        "18. novembri no 08.00-11.14 pec vieteja laika",
        {2026: [(2026, 11, 18)]},
    ),
    "lral-4-may-80m": (
        "4. maija no 07.00-10.14 pec vieteja laika",
        {2026: [(2026, 5, 4)]},
    ),
    "erau-es-open": (
        "3rd SATURDAY in APRIL: 18. APRIL 2026 05.00 - 08.59 UTC",
        {2026: [(2026, 4, 18)]},
    ),
    "erau-es-ll-kv": (
        "9-s etapis laupaeva hommikuti vastavalt ERAU kalenderplaanile",
        {
            2026: [
                (2026, 1, 3),
                (2026, 2, 14),
                (2026, 3, 7),
                (2026, 4, 4),
                (2026, 5, 2),
                (2026, 9, 5),
                (2026, 10, 3),
                (2026, 11, 7),
                (2026, 12, 5),
            ]
        },
    ),
    "lrmd-vytautas-magnus": (
        "kiekvienais metais pirma sekmadieni po Nauju metu, 0700-0759 UTC",
        {2026: [(2026, 1, 4)]},
    ),
    "lrmd-wal": (
        "2026 m. birzelio 06 d. (sestadieni), 06:00-08:59 UTC",
        {2026: [(2026, 6, 6)]},
    ),
    "srr-russian-dx": (
        "s 12:00 UTC 20 marta po 11:59 UTC 21 marta 2027 goda",
        {2027: [(2027, 3, 20)]},
    ),
    "uarl-champ-rtty": (
        "Teletaypnyy Chempionat Ukrayiny na KKH - 7 bereznya 2026 r.",
        {2026: [(2026, 3, 7)]},
    ),
    "uarl-champ-cw": (
        "Telehrafnyy Chempionat Ukrayiny na KKH - 15 bereznya 2026 r.",
        {2026: [(2026, 3, 15)]},
    ),
    "uarl-champ-ssb": (
        "Telefonnyy Chempionat Ukrayiny na KKH - 22 bereznya 2026 r.",
        {2026: [(2026, 3, 22)]},
    ),
    "uarl-lp-cup-cw": (
        "bude provedeno 10 travnya 2026r. z 16:00 do 17:59 UT",
        {2026: [(2026, 5, 10)]},
    ),
    # REP prints six years of dates beside the rule -- the longest independent
    # table any sponsor in this catalog publishes -- so all six are checked.
    "rep-portugal-day-hf": (
        "each year on the second weekend of June",
        {
            2025: [(2025, 6, 14)],
            2026: [(2026, 6, 13)],
            2027: [(2027, 6, 12)],
            2028: [(2028, 6, 10)],
            2029: [(2029, 6, 9)],
            2030: [(2030, 6, 8)],
        },
    ),
    "rep-portugal-day-vhf-uhf": (
        "organiza no 10 de junho (feriado) de cada ano",
        {2025: [(2025, 6, 10)], 2026: [(2026, 6, 10)]},
    ),
    "rep-50mhz": (
        "Primeiro fim de semana completo de agosto",
        {2025: [(2025, 8, 2)]},
    ),
}


def _start_dates(catalog, cid, year):
    """Unique start dates, in order. A sessions record yields one per session."""
    seen = []
    for o in expand(by_id(catalog, cid), year):
        if o.start.date() not in seen:
            seen.append(o.start.date())
    return seen


@pytest.mark.parametrize("cid,rule,year,published", [
    (cid, rule, year, dates)
    for cid, (rule, years) in sorted(TIER2B_PUBLISHED.items())
    for year, dates in sorted(years.items())
])
def test_tier2b_contests_match_their_sponsors_published_dates(
    catalog, cid, rule, year, published
):
    got = _start_dates(catalog, cid, year)
    assert got == [date(*d) for d in published], f"{cid} {year}: rule '{rule}'"


def test_tesla_memorial_second_weekend_means_second_full_weekend(catalog):
    """
    SRS says "odrzavace se svake godine drugog vikenda u martu" -- every year,
    the second weekend in March -- and publishes eight editions. 2020 is the
    year that separates the readings: 1 March 2020 was a Sunday whose Saturday
    belonged to February, so counting weekends by their Sunday gives 7-8 March.
    SRS published 14-15, which is the second FULL weekend.
    """
    assert date(2020, 3, 1).weekday() == 6  # an orphan Sunday
    assert _full_weekends_in_month(2020, 3)[1] == date(2020, 3, 14)
    assert _start_dates(catalog, "srs-tesla-memorial-hf-cw", 2020) == [date(2020, 3, 14)]
    # ...and the eight published editions all reproduce, which is what makes it
    # a rule rather than eight coincidences.
    assert len(TIER2B_PUBLISHED["srs-tesla-memorial-hf-cw"][1]) == 8


def test_lz_dx_counts_back_two_weekends_because_cq_ww_cw_takes_the_last(catalog):
    """
    BFRA anchors its date to another sponsor's contest: "The weekend before the
    last full weekend of November (the weekend before CQWW CW contest weekend)".
    That is n=-2, and it is the record that made the engine count backwards past
    "last". November 2025 has five full weekends and BFRA published 22-23.
    """
    assert len(_full_weekends_in_month(2025, 11)) == 5
    c = by_id(catalog, "bfra-lz-dx")
    assert c["recurrence"] == {"type": "nth_full_weekend", "month": 11, "n": -2}
    assert _start_dates(catalog, "bfra-lz-dx", 2025) == [date(2025, 11, 22)]
    assert _full_weekends_in_month(2025, 11)[-1] == date(2025, 11, 29)  # CQ WW CW


def test_yo_dx_is_the_fourth_full_weekend_not_the_last(catalog):
    """
    August 2026 separates the readings: 1 August is a Saturday, so the month has
    five full weekends and the fourth (22-23) is not the last (29-30). The
    current yodx.ro rules and FRR's own 2026 announcement both say the fourth.
    An older hamradio.ro PDF says "Ultimul weekend intreg" -- the last -- and
    that statement stays on the record rather than being reconciled away.
    """
    weekends = _full_weekends_in_month(2026, 8)
    assert len(weekends) == 5
    assert weekends[3] == date(2026, 8, 22) and weekends[-1] == date(2026, 8, 29)
    assert _start_dates(catalog, "frr-yo-dx-hf", 2026) == [date(2026, 8, 22)]
    assert "Ultimul weekend intreg" in by_id(catalog, "frr-yo-dx-hf")["note"]


def test_aoec_third_full_weekend_survives_an_orphan_sunday(catalog):
    """
    OeVSV states the rule twice, in German and in English, and prints 15
    November 2025 for itself. 2026 is the harder year: 1 November is a Sunday
    whose Saturday belongs to October, so the full weekends start on the 7th and
    the third is the 21st.
    """
    assert date(2026, 11, 1).weekday() == 6  # an orphan Sunday
    assert _full_weekends_in_month(2026, 11)[0] == date(2026, 11, 7)
    assert _start_dates(catalog, "oevsv-aoec-160m", 2025) == [date(2025, 11, 15)]
    assert _start_dates(catalog, "oevsv-aoec-160m", 2026) == [date(2026, 11, 21)]


def test_uska_forward_dates_come_from_uskas_own_kw_contest_page(catalog):
    """
    USKA's KW-Contest page prints the year's dates separately from the
    Reglemente, and states two 2027 dates in prose: "Der Helvetia Contest findet
    am 24. - 25. April 2027 ... statt" and "Der Field Day in CW findet am 5. -
    6. Juni 2027 ... statt". Those are forward statements rather than calendar
    rows, so they test the rule a year past every other date USKA publishes.
    """
    assert _start_dates(catalog, "uska-helvetia", 2027) == [date(2027, 4, 24)]
    assert _start_dates(catalog, "uska-field-day-cw", 2027) == [date(2027, 6, 5)]


def test_weihnachtswettbewerb_sessions_leave_the_gap_hour_out(catalog):
    """
    Each Saturday is a phone-or-CW morning and then a separate digital hour, and
    the hour between them is not part of the contest. Two sessions rather than
    one 07:00-10:59 span, or the calendar would claim an hour USKA does not run.
    """
    for cid in ("uska-weihnachtswettbewerb-ssb", "uska-weihnachtswettbewerb-cw"):
        occs = expand(by_id(catalog, cid), 2026)
        assert len(occs) == 2, cid
        assert [(o.start.hour, o.start.minute) for o in occs] == [(7, 0), (10, 0)], cid
        assert [(o.end.hour, o.end.minute) for o in occs] == [(9, 59), (10, 59)], cid


def test_weihnachtswettbewerb_carries_no_deadline_because_uska_states_none(catalog):
    """
    Three of USKA's four KW Reglemente say "Die Logs sind innert 8 Tagen ...
    einzureichen". The Weihnachtswettbewerb's says nothing at all. Borrowing the
    interval from its siblings would be this catalog inventing a deadline, so
    none is encoded and the silence is recorded on the record.
    """
    for cid in ("uska-weihnachtswettbewerb-ssb", "uska-weihnachtswettbewerb-cw"):
        c = by_id(catalog, cid)
        assert "log_deadline_days" not in c, cid
        assert "no log deadline" in c["note"], cid
    for cid in ("uska-helvetia", "uska-field-day-cw", "uska-field-day-ssb", "uska-nmd"):
        assert by_id(catalog, cid)["log_deadline_days"] == 8, cid


def test_yl_om_falls_on_the_sunday_nearest_8_march(catalog):
    """
    MRASZ ties the date to International Women's Day: "minden evben marcius
    8-hoz legkozelebb eso hetvegen", run on the Sunday. 2026 is the only year
    MRASZ confirms independently, and in it 8 March is itself a Sunday, so the
    rule and the date agree trivially. The caveat is on the record; what is
    asserted here is that the rule is nearest-Sunday and not a hard 8 March.
    """
    c = by_id(catalog, "mrasz-yl-om")
    assert c["recurrence"] == {
        "type": "nearest_weekday", "month": 3, "day": 8, "weekday": 6
    }
    assert date(2026, 3, 8).weekday() == 6
    assert _start_dates(catalog, "mrasz-yl-om", 2026) == [date(2026, 3, 8)]
    # 8 March 2027 is a Monday, so the nearest Sunday is behind it, not ahead.
    assert date(2027, 3, 8).weekday() == 0
    assert _start_dates(catalog, "mrasz-yl-om", 2027) == [date(2027, 3, 7)]
    assert "Only that one year is independently confirmed" in c["note"]


def test_vmc_first_sunday_reading_is_recorded_as_a_caveat(catalog):
    """
    LRMD writes it both ways on the same page: "pirma sekmadieni po Nauju metu"
    and "the first Sunday after New Year's Day". The readings diverge only when
    1 January is itself a Sunday, and LRMD has published no such year, so the
    first-Sunday-in-January reading is encoded and the divergence is recorded
    rather than resolved by picking a winner nobody has confirmed.
    """
    c = by_id(catalog, "lrmd-vytautas-magnus")
    assert c["recurrence"] == {"type": "nth_weekday", "month": 1, "n": 1, "weekday": 6}
    assert _start_dates(catalog, "lrmd-vytautas-magnus", 2026) == [date(2026, 1, 4)]
    assert "CAVEAT" in c["note"] and "1 January is itself a Sunday" in c["note"]
    # 2034 is such a year: the two readings give 1 January and 8 January.
    assert date(2034, 1, 1).weekday() == 6
    assert _start_dates(catalog, "lrmd-vytautas-magnus", 2034) == [date(2034, 1, 1)]


def test_es_ll_kv_tallinn_wall_clock_reproduces_eraus_own_utc_calendar(catalog):
    """
    ERAU's rules give the hour in Estonian time -- "Etappide algus on 10:00 Eesti
    aja (EA) jargi" -- and its 2026 calendar prints the same nine stages in UTC:
    08:00-08:59 for stages 1, 2, 3, 8 and 9, and 07:00-07:59 for 4, 5, 6 and 7.
    That split IS the DST boundary, and it is the second source: get the zone
    handling wrong in either direction and four rows stop matching.
    """
    c = by_id(catalog, "erau-es-ll-kv")
    assert c["timezone"] == "Europe/Tallinn"
    occs = expand(c, 2026)
    assert len(occs) == 9
    assert [o.start.hour for o in occs] == [8, 8, 8, 7, 7, 7, 7, 8, 8]
    assert {(o.end.hour, o.end.minute) for o in occs} == {(8, 59), (7, 59)}


def test_lral_rounds_are_riga_wall_clock(catalog):
    """
    LRAL states the rounds "pec vieteja laika" -- in local time -- and never in
    UTC, so the same 08.00 start is a different instant in November than the
    07.00 start is in May. 18 November 2026 is EET (UTC+2) and 4 May 2026 is
    EEST (UTC+3).
    """
    nov = expand(by_id(catalog, "lral-18-november-80m"), 2026)
    assert by_id(catalog, "lral-18-november-80m")["timezone"] == "Europe/Riga"
    assert [o.start.hour for o in nov] == [6, 8]  # 08.00 and 10.15 local
    assert (nov[1].start.hour, nov[1].start.minute) == (8, 15)

    may = expand(by_id(catalog, "lral-4-may-80m"), 2026)
    assert [o.start.hour for o in may] == [4, 6]  # 07.00 and 09.15 local
    assert (may[1].start.hour, may[1].start.minute) == (6, 15)


def test_uarl_championships_are_kyiv_wall_clock_and_the_lp_cup_is_not(catalog):
    """
    UARL writes its championships in Kyiv time ("z 19:00 do 19:29 kyyivskoho
    chasu") and its Low Power Cup in UT with Kyiv time in brackets ("z 16:00 do
    17:59 UT (z 19:00 kyyivskoho chasu do 20:59)"). Same local hour, two
    different UTC instants, because March is EET and May is EEST -- and only one
    of the two records is wall-clocked. Encoding both the same way would move
    one of them by an hour.
    """
    for cid in ("uarl-champ-rtty", "uarl-champ-cw", "uarl-champ-ssb"):
        c = by_id(catalog, cid)
        assert c["timezone"] == "Europe/Kyiv", cid
        o = expand(c, 2026)[0]
        assert (o.start.hour, o.end.hour) == (17, 18), cid  # 19:00-20:59 Kyiv, EET
        assert o.end.minute == 59, cid

    cup = by_id(catalog, "uarl-lp-cup-cw")
    assert "timezone" not in cup
    o = expand(cup, 2026)[0]
    assert (o.start.hour, o.end.hour, o.end.minute) == (16, 17, 59)


def test_rdxc_deadline_lands_on_the_date_srr_prints(catalog):
    """
    SRR states the interval and the instant in one sentence: reports are taken
    "v techenii 14 dney posle okonchaniya sorevnovaniy (po 04.04.2027 goda
    vklyuchitelno)". The contest ends 11:59 UTC on 21 March 2027, and fourteen
    days is 4 April -- so the sponsor's own arithmetic is what checks ours.
    """
    c = by_id(catalog, "srr-russian-dx")
    assert c["log_deadline_days"] == 14
    o = expand(c, 2027)[0]
    assert o.end.date() == date(2027, 3, 21)
    assert o.log_due.date() == date(2027, 4, 4)


def test_lp_cup_deadline_lands_on_the_date_uarl_prints(catalog):
    """
    Same shape, from UARL: "7 dib pislya zakinchennya zmahan. Tobto, 17 travnya
    2026 roku ostanniy den." Seven days from 10 May is 17 May.
    """
    c = by_id(catalog, "uarl-lp-cup-cw")
    assert c["log_deadline_days"] == 7
    o = expand(c, 2026)[0]
    assert o.log_due.date() == date(2026, 5, 17)


def test_es_open_is_worldwide_with_a_note_not_two_sided(catalog):
    """
    ERAU's rule is asymmetric -- "ESTONIAN STATIONS CAN WORK ALL THE STATIONS WHO
    PARTICIPATE ... NON-ES STATIONS CAN WORK ONLY ES STATIONS" -- but that is
    about who counts, not about who may enter. two_sided needs both sides
    enumerated and tells a station in neither that it cannot enter, which is
    false here. Same call as DARC's WAE and WAG and JARL's All Asian.
    """
    elig = by_id(catalog, "erau-es-open")["eligibility"]
    assert elig["scope"] == "worldwide"
    assert "NON-ES STATIONS CAN WORK ONLY ES STATIONS" in elig["note"]
    for entity in ("ES", "K", "JA", "VK"):
        assert eligibility_for(by_id(catalog, "erau-es-open"), entity)["can_enter"]


def test_tier2b_records_carry_the_sponsor_strings_the_registry_joins_on(catalog):
    """
    Three Baltic societies share one registry entry but are three separate
    sponsors in the catalog, because an LV record is not an EE one. The join is
    the only thing that makes an unregistered sponsor detectable, so it is
    asserted here rather than left to the coverage test to discover.
    """
    records = [c for c in catalog if c["id"] in TIER2B_PUBLISHED]
    assert len(records) == 29
    assert {c["sponsor"] for c in records} == {
        "USKA", "ÖVSV", "MRASZ", "BFRA", "FRR", "SRS", "HRS",
        "LRAL", "ERAU", "LRMD", "SRR", "UARL", "REP",
    }
    assert {c["country"] for c in records} == {
        "CH", "AT", "HU", "BG", "RO", "RS", "HR", "LV", "EE", "LT", "RU", "UA",
        "PT",
    }
    reg = load_registry()
    owner = _registry_owner(reg)
    for c in records:
        assert owner[c["sponsor"]][0] == "tier_2_european_societies", c["id"]


def test_rep_portugal_day_hf_runs_noon_to_noon(catalog):
    """
    The date table above checks six years of REP's own published dates. This
    checks the clock, which a table of dates cannot: 'Time: 12:00 UTC to 11:59
    UTC', a minute short of 24 hours.
    """
    (o,) = expand(by_id(catalog, "rep-portugal-day-hf"), 2026)
    assert (o.start.hour, o.start.minute) == (12, 0)
    assert (o.end.hour, o.end.minute) == (11, 59)
    assert o.start.date() == date(2026, 6, 13)
    assert o.end.date() == date(2026, 6, 14)


def test_rep_vhf_uhf_follows_the_holiday_and_not_the_second_saturday(catalog):
    """
    REP publishes two live and contradictory rules for this one contest.
    concursos.rep.pt -- the portal rep.pt's own front page links to -- says
    'no 10 de junho (feriado) de cada ano'. portugaldaycontest.rep.pt still
    says 'no 2 Sabado do mes de junho de cada ano, (8 de Junho de 2024)'. They
    give different days in every year where 10 June is not the second Saturday.

    The fixed date is encoded because it is the one REP ran: its own 'Logs
    recebidos - VHF-UHF 2025' post is dated 10 June 2025, a TUESDAY, while the
    second Saturday of June 2025 was the 14th. This test is the decision, so
    that reverting it means arguing with the evidence rather than editing JSON.
    """
    (o,) = expand(by_id(catalog, "rep-portugal-day-vhf-uhf"), 2025)
    assert o.start.date() == date(2025, 6, 10)
    assert o.start.weekday() == 1  # Tuesday
    assert o.start.date() != date(2025, 6, 14)  # the superseded page's answer

    for year in (2026, 2027, 2028):
        (o,) = expand(by_id(catalog, "rep-portugal-day-vhf-uhf"), year)
        assert o.start.date() == date(year, 6, 10)
        assert (o.start.hour, o.end.hour) == (12, 18)


def test_rep_50mhz_takes_the_first_complete_weekend_of_august(catalog):
    """
    'Primeiro fim de semana completo de agosto, desde as 14:00 UTC de sabado
    as 14:00 UTC de domingo. 2025: o concurso ocorre nos dias 2 e 3 de agosto.'

    Note what this does NOT prove. For the FIRST weekend of a 31-day month the
    full-weekend reading and 'first Saturday' agree in every year, because the
    only Saturday that cannot open a full weekend is one falling on the last
    day of the month. The type is REP's own wording, not a date-changing
    choice, and the note on the record says so.
    """
    (o,) = expand(by_id(catalog, "rep-50mhz"), 2025)
    assert o.start.date() == date(2025, 8, 2)
    assert o.end.date() == date(2025, 8, 3)
    assert (o.start.hour, o.end.hour) == (14, 14)
    assert o.duration_hours == 24


def test_rep_deadlines_are_encoded_only_where_the_sponsor_states_a_span(catalog):
    """
    All three REP contests state a log deadline and only one of them is a span.

    The VHF/UHF contest runs on a fixed date (10 June) and its logs are due on
    a fixed date (20 June), so ten days is exact in every year. The other two
    state a calendar deadline against a moving contest -- 'no later than June
    30th of the same year', 'ate as 23:59 (UTC) do dia 8 de Agosto de 2025' --
    which is a different number of days every year, so they carry none rather
    than a number REP never wrote. Same rule as JARL All Asian.
    """
    assert by_id(catalog, "rep-portugal-day-vhf-uhf")["log_deadline_days"] == 10
    for cid in ("rep-portugal-day-hf", "rep-50mhz"):
        assert "log_deadline_days" not in by_id(catalog, cid), cid


def test_rca_holds_only_the_editions_argentina_published(catalog):
    """
    Radio Club Argentino states one dated running per contest and no
    recurrence, so both records are `manual` and both currently sit in the
    past: 18 October 2025 for the 40 m contest and 13 June 2026 for the 80 m
    one. Neither puts anything on a forward calendar, and that is correct --
    fitting an ordinal to a single date would be a rule RCA has not written.

    South America is the catalog's thinnest region, which makes this exactly
    the place where inventing a rule would be most tempting and least
    defensible.
    """
    for cid, year, day in (("rca-nacional-40m", 2025, date(2025, 10, 18)),
                           ("rca-nacional-80m", 2026, date(2026, 6, 13))):
        c = by_id(catalog, cid)
        assert c["recurrence"]["type"] == "manual", cid
        (o,) = expand(c, year)
        assert o.start.date() == day, cid
        # No year RCA has not announced.
        assert expand(c, year + 1) == [], cid

    # RCA restricts entry to Argentina and its neighbours, which is a real
    # entity list rather than a formality, so a K station cannot enter.
    assert not eligibility_for(by_id(catalog, "rca-nacional-80m"), "K")["can_enter"]
    assert eligibility_for(by_id(catalog, "rca-nacional-80m"), "LU")["can_enter"]


# ---------------------------------------------------------------------------
# JARL's Japanese-language contests.
#
# These four were deferred on 2026-08-17 with the note "they are real contests
# and a future pass should read the Japanese pages rather than guess". Read
# 2026-08-19. JARL states each recurrence in its 規約 and then prints the year's
# dates separately at the head of the same page, which is the independent check.
# ---------------------------------------------------------------------------

JARL_JP_PUBLISHED = {
    "jarl-all-ja": (
        "毎年4月の最終日曜日の前日の21時00分から最終日曜日の21時00分（JST）まで",
        (2026, 4, 25),
    ),
    "jarl-6m-and-down": (
        "毎年7月の第1土曜日21時00分～翌日の15時00分（JST）",
        (2026, 7, 4),
    ),
    "jarl-field-day": (
        "毎年8月の第1土曜日の21時00分から翌日の15時00分（JST）まで",
        (2026, 8, 1),
    ),
    "jarl-acag": (
        "毎年10月第2月曜日の前々日の21時00分から前日の21時00分（JST）まで",
        (2026, 10, 10),
    ),
}


@pytest.mark.parametrize("cid,rule,published", [
    (cid, rule, d) for cid, (rule, d) in sorted(JARL_JP_PUBLISHED.items())
])
def test_jarl_japanese_contests_match_jarls_published_dates(catalog, cid, rule, published):
    (o,) = expand(by_id(catalog, cid), 2026)
    assert o.start.date() == date(*published), f"{cid}: rule '{rule}'"


def test_jarl_states_its_times_in_tokyo_and_they_never_shift(catalog):
    """
    JARL writes 21時00分（JST）, so the records carry Asia/Tokyo wall clock
    rather than a UTC time converted by hand. Japan has not observed daylight
    saving since 1952, so the resolved instant is 1200Z every year -- which is
    worth pinning precisely BECAUSE it never moves: if it ever does, something
    has gone wrong in the zone layer rather than at JARL.
    """
    for year in (2026, 2027, 2030):
        for cid in JARL_JP_PUBLISHED:
            (o,) = expand(by_id(catalog, cid), year)
            assert o.start_wall.hour == 21, cid
            assert o.start.hour == 12, f"{cid} {year}: 2100 JST is 1200Z"


def test_acag_hangs_off_japans_sports_day_and_counts_backwards(catalog):
    """
    全市全郡 is the only rule in the catalog anchored on a public holiday and
    counted backwards: "毎年10月第2月曜日の前々日の21時00分から前日の21時00分" --
    from 21:00 two days before the second Monday of October until 21:00 the day
    before it. The second Monday of October is Japan's Sports Day.

    It is NOT "the second full weekend of October", and the difference is not
    academic: the two readings agree in 2026 and 2027 and then diverge by a
    whole week in 2028 and 2029. A calendar that guessed the weekend reading
    would send someone to the radio seven days late, twice.
    """
    expected = {
        2026: date(2026, 10, 10),
        2027: date(2027, 10, 9),
        2028: date(2028, 10, 7),   # a full-weekend reading says the 14th
        2029: date(2029, 10, 6),   # ...and the 13th
        2030: date(2030, 10, 12),
    }
    for year, day in expected.items():
        (o,) = expand(by_id(catalog, "jarl-acag"), year)
        assert o.start.date() == day, year
        # Always the Saturday, and always ending on the Sunday.
        assert o.start.weekday() == 5 and o.end.weekday() == 6, year

    for year in (2028, 2029):
        weekend = resolve_anchors({"type": "nth_full_weekend", "month": 10, "n": 2}, year)[0]
        assert expand(by_id(catalog, "jarl-acag"), year)[0].start.date() != weekend, year


def test_all_ja_follows_jarls_wording_though_nothing_turns_on_it(catalog):
    """
    The opposite case, recorded so the distinction above is not overclaimed.
    ALL JA is "the day before the last Sunday of April", which is the same date
    as "the last full weekend of April" in every year and always will be:
    April's last Sunday falls on the 24th at the earliest, so the Saturday
    before it is never outside the month. JARL's wording is encoded because it
    is JARL's, not because it changes an answer.
    """
    for year in range(2026, 2036):
        (o,) = expand(by_id(catalog, "jarl-all-ja"), year)
        weekend = resolve_anchors({"type": "nth_full_weekend", "month": 4, "n": -1}, year)[0]
        assert o.start.date() == weekend, year


def test_jarl_domestic_contests_are_japan_only_and_carry_no_deadline(catalog):
    """
    "日本国内のアマチュア局およびSWL" -- amateur stations within Japan, and SWLs.
    A JA station can be WORKED from anywhere, which is why these records exist
    at all; entry is the restricted part, and that is a display-time filter.

    And no log deadline: JARL prints a dated one per edition above the rules
    rather than a span inside them. All four 2026 deadlines happen to fall ten
    days after their contest, which is suggestive and is not a rule JARL wrote.
    """
    for cid in JARL_JP_PUBLISHED:
        c = by_id(catalog, cid)
        assert c["eligibility"]["scope"] == "entity_list", cid
        assert c["eligibility"]["entities"] == ["JA"], cid
        assert not eligibility_for(c, "K")["can_enter"], cid
        assert eligibility_for(c, "JA")["can_enter"], cid
        assert "log_deadline_days" not in c, cid


ARSI_PUBLISHED = {
    "arsi-vu-dx": ("22 - 23 August 2026, 12:00 UTC to 11:59:59 UTC", (2026, 8, 22), 12),
    "arsi-qrp-day": ("27th - 28th June 2026, 5:30 UTC to 11:59:59 UTC", (2026, 6, 27), 5),
    "arsi-vu-rookie": ("25 - 26 April 2026, 12:00 UTC to 11:59:59 UTC", (2026, 4, 25), 12),
    "arsi-40m-cq-vu-ssb": ("21 - 22 March 2026, 7:30 PM IST", (2026, 3, 21), 14),
    "arsi-40m-cq-vu-cw": ("5 - 6 Dec 2026, 7:30 PM IST", (2026, 12, 5), 14),
}


@pytest.mark.parametrize("cid,rule,day,hour", [
    (cid, r, d, h) for cid, (r, d, h) in sorted(ARSI_PUBLISHED.items())
])
def test_arsi_holds_the_editions_india_published(catalog, cid, rule, day, hour):
    """
    ARSI publishes dates and no recurrence -- every page opens with the year's
    dates and states no rule anywhere. So all five are manual, hold exactly the
    2026 edition, and produce nothing for a year ARSI has not announced.
    """
    c = by_id(catalog, cid)
    assert c["recurrence"]["type"] == "manual", cid
    (o,) = expand(c, 2026)
    assert o.start.date() == date(*day), f"{cid}: {rule}"
    assert o.start.hour == hour, f"{cid}: {rule}"
    assert expand(c, 2027) == [], cid


def test_arsi_40m_contests_are_stated_in_indian_time_only(catalog):
    """
    Three of ARSI's five pages give UTC. The two 40M ones give ONLY Indian
    Standard Time -- "7:30 PM IST to 7:29:59 PM IST" -- so those records carry
    Asia/Kolkata wall clock rather than a UTC time converted by hand. India is
    a fixed +05:30 with no daylight saving, so 1930 IST is 1400 UTC and always
    will be; the record still says what the page said.
    """
    for cid in ("arsi-40m-cq-vu-ssb", "arsi-40m-cq-vu-cw"):
        c = by_id(catalog, cid)
        assert c["timezone"] == "Asia/Kolkata", cid
        (o,) = expand(c, 2026)
        assert (o.start_wall.hour, o.start_wall.minute) == (19, 30), cid
        assert (o.start.hour, o.start.minute) == (14, 0), cid

    # ...and the three that state UTC carry no zone at all.
    for cid in ("arsi-vu-dx", "arsi-qrp-day", "arsi-vu-rookie"):
        assert "timezone" not in by_id(catalog, cid), cid


def test_arsi_40m_eligibility_records_a_contradiction_rather_than_resolving_it(catalog):
    """
    Both 40M pages say "Any licensed ham can participate in the contest" and
    then, four lines later, "Though this contest is only for VU, any DX contacts
    in the log will get 2 QSO multiplier points". The two cannot both be taken
    at face value. The likely reading -- entry is VU, DX may be worked -- is
    what is encoded, with eligibility.verified false saying so.
    """
    for cid in ("arsi-40m-cq-vu-ssb", "arsi-40m-cq-vu-cw"):
        e = by_id(catalog, cid)["eligibility"]
        assert e["scope"] == "entity_list" and e["entities"] == ["VU"], cid
        assert e["verified"] is False, cid
        assert "CONTRADICTS" in e["note"], cid

    # The VU-DX contest is the opposite case and is stated plainly, so it is
    # verified: "Geographic Focus : India. Participation : Worldwide."
    dx = by_id(catalog, "arsi-vu-dx")["eligibility"]
    assert dx["scope"] == "worldwide" and dx["verified"] is True
    assert eligibility_for(by_id(catalog, "arsi-vu-dx"), "K")["can_enter"]


# TRAC publishes a page per year, so its own dates check its own rule -- and
# in one year out of four they disagree. See data/sources.md.
TRAC_PUBLISHED = {2023: (7, 8), 2024: (7, 6), 2025: (7, 5), 2026: (7, 4)}


@pytest.mark.parametrize("year,md", sorted(TRAC_PUBLISHED.items()))
def test_trac_reproduces_every_date_turkey_published(catalog, year, md):
    (o,) = expand(by_id(catalog, "trac-ta-vhf-uhf"), year)
    assert o.start.date() == date(year, *md)
    assert (o.start.hour, o.end.hour) == (12, 12)


def test_trac_exception_is_flagged_as_an_inference(catalog):
    """
    TRAC states "Temmuz ayının ilk hafta sonu" -- the first weekend of July --
    and that reproduces its 2024, 2025 and 2026 dates. It does NOT reproduce
    2023: 1 July 2023 was itself a Saturday, the rule gives 1-2 July, and TRAC
    ran the contest on 8-9 July.

    exclude_dates [[7, 1]] is what makes all four come out right. It is the
    same shape as ARRL RTTY Roundup's "never 1 January" -- except ARRL STATES
    its exception and TRAC does not, so this is one year's evidence fitted into
    a rule. Hence verified: false, and hence this test, which exists to keep
    the inference visible rather than to bless it.
    """
    c = by_id(catalog, "trac-ta-vhf-uhf")
    assert c["verified"] is False
    assert c["recurrence"]["exclude_dates"] == [[7, 1]]
    assert "INFERENCE" in c["note"]

    # Inert in most years, and the years it is not are named.
    for year in (2028, 2034, 2045):
        assert date(year, 7, 1).weekday() == 5, year
        (o,) = expand(c, year)
        assert o.start.date() == date(year, 7, 8), year

    # Without the exception the 2023 running would be wrong by a week, which is
    # the whole reason it is there.
    naive = resolve_anchors({"type": "nth_full_weekend", "month": 7, "n": 1}, 2023)[0]
    assert naive == date(2023, 7, 1)
    assert expand(c, 2023)[0].start.date() == date(2023, 7, 8)


# Nine contests run by eight South African clubs, all from the SARL Contest
# Manual -- which carries their full rules and names each organiser, so it is
# where these rules are published rather than a listing of them.
ZA_CLUB_PUBLISHED = {
    "zs1-qso-party": ("last Sunday of July", [(2026, 7, 26)], 16),
    "zs2-qso-party": ("3rd Sunday of July", [(2026, 7, 19)], 14),
    "zs3-qso-party": ("3rd Sunday of May", [(2026, 5, 17)], 14),
    "zs4-qso-party": ("2nd Sunday of April", [(2026, 4, 12)], 14),
    "zs5-qso-party": ("1st Sunday of July", [(2026, 7, 5)], 14),
    "hammies-qso-party": ("2nd Sunday of June", [(2026, 6, 14)], 14),
    "early-morning-coffee-qso-party":
        ("2nd Wednesday of May and October", [(2026, 5, 13), (2026, 10, 14)], 4),
    "awasa-cw-activity-day": ("1st Sunday of February", [(2026, 2, 1)], 13),
    "hamsat-sa-qo100-qso-party": ("2nd Sunday February", [(2026, 2, 8)], 13),
}


@pytest.mark.parametrize("cid,rule,days,hour", [
    (cid, r, d, h) for cid, (r, d, h) in sorted(ZA_CLUB_PUBLISHED.items())
])
def test_za_club_contests_match_the_manuals_own_dates(catalog, cid, rule, days, hour):
    occ = expand(by_id(catalog, cid), 2026)
    assert [o.start.date() for o in occ] == [date(*d) for d in days], f"{cid}: {rule}"
    assert occ[0].start.hour == hour, f"{cid}: {rule}"


def test_za_club_contests_are_credited_to_their_clubs_not_to_sarl(catalog):
    """
    The SARL Contest Manual publishes these, but SARL does not run them -- it
    names a Sponsor Club for each. Crediting them to SARL would be wrong twice
    over: it would misattribute the contest, and it would hide eight clubs
    behind one sponsor filter. Nine contests, nine clubs -- one each.
    """
    sponsors = {by_id(catalog, cid)["sponsor"] for cid in ZA_CLUB_PUBLISHED}
    assert "SARL" not in sponsors
    assert len(sponsors) == 9, sponsors
    assert "Cape Town Amateur Radio Club" in sponsors
    assert "Port Elizabeth Amateur Radio Society (PEARS)" in sponsors


def test_zs1_runs_an_hour_later_than_the_other_provincial_parties(catalog):
    # Five provincial parties with near-identical rules, and one of them starts
    # at 16:00 rather than 14:00. That is the detail a regularised copy of a
    # calendar would smooth away, so it gets its own assertion.
    assert expand(by_id(catalog, "zs1-qso-party"), 2026)[0].start.hour == 16
    for cid in ("zs2-qso-party", "zs3-qso-party", "zs4-qso-party", "zs5-qso-party"):
        assert expand(by_id(catalog, cid), 2026)[0].start.hour == 14, cid


def test_za_club_eligibility_is_unverified_where_the_manual_is_silent(catalog):
    """
    The manual names entity lists for SARL's own HAMNET and Top Band contests
    and says nothing at all about who may enter the club parties. Silence is
    not a statement, so those records are worldwide with verified false.
    """
    silent = ["zs1-qso-party", "zs2-qso-party", "zs3-qso-party", "zs4-qso-party",
              "zs5-qso-party", "hammies-qso-party", "early-morning-coffee-qso-party",
              "awasa-cw-activity-day"]
    for cid in silent:
        e = by_id(catalog, cid)["eligibility"]
        assert e["scope"] == "worldwide" and e["verified"] is False, cid

    # HamSat-SA is the exception: its aim names "South Africa and the world".
    e = by_id(catalog, "hamsat-sa-qo100-qso-party")["eligibility"]
    assert e["scope"] == "worldwide" and e["verified"] is True


def test_pears_runs_two_scored_sessions_back_to_back(catalog):
    """
    PEARS calls it "a 44-hour dual contest ... divided into 2 sessions", and
    scores them separately. They are contiguous -- the second "commences
    immediately after" the first ends at 14:00 UTC on the Saturday -- so a
    single 44-hour occurrence would draw the same bar on the rail while losing
    the fact that there are two scored periods.

    The anchor is the 2nd FRIDAY of January, which is how PEARS phrases it:
    "(2nd Friday and Saturday of January)".
    """
    occ = expand(by_id(catalog, "pears-national-vhf-uhf"), 2026)
    assert len(occ) == 2
    assert occ[0].start.date() == date(2026, 1, 9) and occ[0].start.weekday() == 4
    assert occ[0].duration_hours == 22 and occ[1].duration_hours == 22
    # Contiguous: session two starts exactly where session one ends.
    assert occ[0].end == occ[1].start


def test_sota_says_all_bands_so_none_are_recorded(catalog):
    # "Frequencies and modes: All amateur bands and modes". Mixed is exactly
    # what that sentence means for modes; for bands there is no list to record,
    # and writing one would invent a restriction SARL did not state.
    c = by_id(catalog, "zs-sota-activity-weekend")
    assert c["bands"] == []
    assert c["modes"] == ["Mixed"]
    occ = expand(c, 2026)
    assert [o.start.date() for o in occ] == [date(2026, 5, 16), date(2026, 9, 19)]


def test_australia_day_opens_the_day_before_the_holiday(catalog):
    """
    Australia Day is 26 January and the contest opens at 2200 UTC on the 25th,
    which is 0900 on the 26th in eastern Australia. The anchor is therefore the
    26th with a negative offset on the start, exactly as WIA states it -- not a
    rule about the 25th, which would drift if WIA ever moved the hours.
    """
    for year in (2026, 2027, 2028):
        (o,) = expand(by_id(catalog, "wia-australia-day"), year)
        assert o.start.date() == date(year, 1, 25)
        assert (o.start.hour, o.end.hour) == (22, 10)
        assert o.end.date() == date(year, 1, 26)
        assert o.duration_hours == 12

    # WIA's "Phone" covers AM, FM and SSB; FM has a token and AM does not.
    c = by_id(catalog, "wia-australia-day")
    assert "FM" in c["modes"] and "SSB" in c["modes"]
    assert c["submodes"] == ["AM"]


# WWROF publishes future dates on its front page and keeps a rules PDF per
# year, so five of the sponsor's own dates check one rule.
WW_DIGI_PUBLISHED = {
    2024: date(2024, 8, 24),
    2026: date(2026, 8, 29),
    2027: date(2027, 8, 28),
    2028: date(2028, 8, 26),
    2029: date(2029, 8, 25),
}


@pytest.mark.parametrize("year,day", sorted(WW_DIGI_PUBLISHED.items()))
def test_ww_digi_reproduces_every_date_wwrof_published(catalog, year, day):
    assert expand(by_id(catalog, "ww-digi"), year)[0].start.date() == day


def test_ww_digi_is_a_full_weekend_rule_and_2024_is_why(catalog):
    """
    "Last full weekend of August" and "last Saturday of August" are different
    rules. They agree every year EXCEPT when 31 August is a Saturday, because
    the Sunday then falls in September and that weekend is not full.

    2024 was such a year, and WWROF's own 2024 rules PDF says the contest ran
    Saturday 24 August -- not the 31st. So the full-weekend reading is what the
    sponsor actually runs. This test exists because the two encodings agree in
    2026, 2027, 2028 and 2029, so every year a casual check is likely to try
    would pass with the wrong rule stored.
    """
    c = by_id(catalog, "ww-digi")
    assert c["recurrence"] == {"type": "nth_full_weekend", "month": 8, "n": -1}

    # The year that separates them, from both directions.
    assert date(2024, 8, 31).weekday() == 5          # a Saturday...
    assert date(2024, 9, 1).month == 9               # ...whose Sunday is not in August
    assert expand(c, 2024)[0].start.date() == date(2024, 8, 24)


def test_ww_digi_records_the_2026_rule_changes(catalog):
    # Both changed for 2026 and both matter to an operator: the log deadline
    # went from five days to 48 hours, and autonomous operation is now
    # prohibited -- which is a rule about unattended FT8.
    c = by_id(catalog, "ww-digi")
    assert c["log_deadline_days"] == 2
    assert "Autonomous systems or robots" in c["source_note"]
    assert c["modes"] == ["FT8/FT4"]
    occ = expand(c, 2026)[0]
    assert (occ.start.hour, occ.start.minute) == (12, 0)
    assert (occ.end.hour, occ.end.minute) == (11, 59)


# RSGB keeps a rules page per year, so five years of its own dates check one
# rule -- fifteen date-points across three contests, all from one anchor.
AFS_PUBLISHED = {
    2022: (8, 16, 22),
    2023: (7, 15, 21),
    2024: (6, 14, 20),
    2025: (4, 12, 18),
    2026: (3, 11, 17),
}


@pytest.mark.parametrize("year,days", sorted(AFS_PUBLISHED.items()))
def test_rsgb_afs_reproduces_every_date_rsgb_published(catalog, year, days):
    got = tuple(
        expand(by_id(catalog, cid), year)[0].start.day
        for cid in ("rsgb-afs-cw", "rsgb-afs-data", "rsgb-afs-ssb")
    )
    assert got == days, year


def test_rsgb_afs_hangs_three_contests_off_one_anchor(catalog):
    """
    The AFS CW Saturday is the anchor; Datamodes is the Sunday eight days later
    and SSB the Saturday fourteen days later. Datamodes has no consistent
    ordinal of its own -- it is the third Sunday of January in 2022 and 2023
    and the second in 2024, 2025 and 2026 -- so encoding it as an ordinal would
    have been wrong in two of the five years RSGB published.
    """
    offsets = {"rsgb-afs-cw": 0, "rsgb-afs-data": 8, "rsgb-afs-ssb": 14}
    for cid, off in offsets.items():
        c = by_id(catalog, cid)
        assert c["start"]["day_offset"] == off, cid
        assert c["recurrence"]["exclude_dates"] == [[1, 1]], cid
        assert c["verified"], cid

    # The Datamodes leg really does move ordinal between years.
    assert expand(by_id(catalog, "rsgb-afs-data"), 2023)[0].start.day == 15   # 3rd Sunday
    assert expand(by_id(catalog, "rsgb-afs-data"), 2026)[0].start.day == 11   # 2nd Sunday


def test_rsgb_afs_new_year_exception_is_evidenced(catalog):
    # 1 January 2022 was itself a Saturday and RSGB ran AFS CW on the 8th. The
    # exclusion is not a guess fitted to one year: it is the only reading that
    # fits all five years across all three contests.
    assert date(2022, 1, 1).weekday() == 5
    assert expand(by_id(catalog, "rsgb-afs-cw"), 2022)[0].start.date() == date(2022, 1, 8)
    # Next time it decides anything.
    assert date(2028, 1, 1).weekday() == 5
    assert expand(by_id(catalog, "rsgb-afs-cw"), 2028)[0].start.date() == date(2028, 1, 8)


# Four years of RSGB's own rules pages, per contest. RSGB keeps a page per
# year, so the sponsor checks the sponsor's rule -- 28 date-points here.
RSGB_PUBLISHED = {
    "rsgb-1_8mhz-first": {2023: (2, 11), 2024: (2, 10), 2025: (2, 8), 2026: (2, 14)},
    "rsgb-1_8mhz-second": {2023: (11, 18), 2024: (11, 16), 2025: (11, 15), 2026: (11, 21)},
    "rsgb-club-calls": {2023: (11, 11), 2024: (11, 9), 2025: (11, 8), 2026: (11, 14)},
    "rsgb-nfd-cw": {2023: (6, 3), 2024: (6, 1), 2025: (6, 7), 2026: (6, 6)},
    "rsgb-ssb-field-day": {2023: (9, 2), 2024: (9, 7), 2025: (9, 6), 2026: (9, 5)},
    "rsgb-low-power": {2023: (7, 16), 2024: (7, 21), 2025: (7, 20), 2026: (7, 19)},
}


@pytest.mark.parametrize(
    "cid,year,md",
    [(cid, y, md) for cid, years in sorted(RSGB_PUBLISHED.items())
     for y, md in sorted(years.items())],
)
def test_rsgb_reproduces_four_years_of_its_own_dates(catalog, cid, year, md):
    got = expand(by_id(catalog, cid), year)[0].start.date()
    assert got == date(year, *md), cid


def test_rsgb_national_field_day_has_no_new_year_style_exception(catalog):
    """
    The same committee, two different answers, and only published dates
    separate them.

    AFS skips 1 January when it falls on a Saturday -- evidenced by 2022. NFD
    does not skip 1 June: 1 June 2024 was itself a Saturday and RSGB ran the
    contest on it. So the AFS exclusion must not be copied across to NFD out of
    symmetry, and this test is here to fail if someone tries.
    """
    assert date(2024, 6, 1).weekday() == 5
    assert expand(by_id(catalog, "rsgb-nfd-cw"), 2024)[0].start.date() == date(2024, 6, 1)
    assert "exclude_dates" not in by_id(catalog, "rsgb-nfd-cw")["recurrence"]
    assert by_id(catalog, "rsgb-afs-cw")["recurrence"]["exclude_dates"] == [[1, 1]]


def test_rsgb_ft4_activity_day_is_manual_because_the_ordinal_breaks(catalog):
    """
    First Saturday of April in 2023, 2024 and 2025 -- and the second in 2026.
    Three years out of four is not a rule, so the record holds only the date
    RSGB published. Easter Sunday fell on 5 April 2026, which is a plausible
    reason and not a source.
    """
    c = by_id(catalog, "rsgb-ft4-activity-day")
    assert c["recurrence"]["type"] == "manual"
    assert not c["verified"]
    occ = expand(c, 2026)
    assert len(occ) == 1
    assert occ[0].start.date() == date(2026, 4, 11)
    # The ordinal that would have been wrong: 2026's first Saturday is the 4th.
    assert date(2026, 4, 4).weekday() == 5
    # ...and it produces nothing at all for a year RSGB has not published.
    assert expand(c, 2027) == []


def test_rsgb_low_power_leaves_the_lunch_hour_empty(catalog):
    # 0900-1200 and 1300-1600, which is why this record uses sessions. A single
    # seven-hour block would put a contest on the calendar during an hour RSGB
    # does not run one.
    occ = expand(by_id(catalog, "rsgb-low-power"), 2026)
    assert [(o.start.hour, o.end.hour) for o in occ] == [(9, 12), (13, 16)]
    assert all(o.duration_hours == 3.0 for o in occ)


def test_rsgb_top_band_records_differ_in_the_ways_rsgb_states(catalog):
    """
    Three top-band contests, three sets of rules, and the differences are the
    sponsor's own -- which is why they are three records and not one.
    """
    feb = by_id(catalog, "rsgb-1_8mhz-first")
    nov = by_id(catalog, "rsgb-1_8mhz-second")
    club = by_id(catalog, "rsgb-club-calls")

    assert feb["modes"] == ["CW", "SSB"]
    assert nov["modes"] == ["CW"]          # the November leg is CW only
    assert [c["bands"] for c in (feb, nov, club)] == [["160m"]] * 3

    # Club Calls caps the whole contest at 32 W, which is the point of it
    # rather than a footnote. Every other single-ceiling record in the catalog
    # sits at 5 W (a QRP class) or 100 W (the usual low-power class); 32 is a
    # value nothing else uses, so it is exactly the sort of number that gets
    # "tidied" to 30 or 35 by someone who has not read the rules.
    assert club["power_categories"][0]["max_watts"] == 32
    whole_contest_ceilings = {
        c["power_categories"][0]["max_watts"]
        for c in catalog
        if len(c.get("power_categories") or []) == 1
        and c["power_categories"][0].get("max_watts")
    }
    assert whole_contest_ceilings == {5, 32, 100}

    # Club Calls and the November leg are a week apart and are not the same
    # contest -- the second and third Saturdays of November.
    assert expand(club, 2026)[0].start.date() == date(2026, 11, 14)
    assert expand(nov, 2026)[0].start.date() == date(2026, 11, 21)


def test_nrau_is_blocked_for_the_right_contests_and_not_for_sac(catalog):
    """
    This test used to assert NRAU encoded NOTHING, and it was half right.

    nrau.net does say its contest information is under revision, and it does
    publish nothing usable for NRAU-Baltic or the Nordic Activity Contests --
    that half stands and those are still unencoded. What it got wrong is the
    leap from "this organisation's site is blocked" to "this organisation runs
    nothing we can read". NRAU also organises the Scandinavian Activity Contest,
    which publishes complete rules with standing recurrence wording at a domain
    of its own, and SAC appeared nowhere in the registry at all until the
    2026-08-21 gap audit.

    So the assertion is now the corrected shape: SAC is encoded, the blocked
    contests are still absent, and the entry says both.
    """
    reg = load_registry()
    nrau = next(o for o in reg["tier_2_european_societies"] if o["org"] == "NRAU")

    # The flagship is in, both legs, from the contest's own site.
    sac = sorted(c["id"] for c in catalog if c["sponsor"] == "NRAU")
    assert sac == ["sac-cw", "sac-ssb"]
    for cid in sac:
        c = by_id(catalog, cid)
        assert "sactest.net" in c["rules_url"], cid
        assert c["verified"], cid

    # ...and the part that really is blocked is still empty. No NAC, no Baltic.
    names = " ".join(c["name"].lower() for c in catalog)
    assert "nordic activity" not in names
    assert "nrau-baltic" not in names

    assert nrau["status"] == "partial"
    assert nrau["catalog_sponsors"] == ["NRAU"]
    assert "under revision" in nrau["notes"]


# ---------------------------------------------------------------------------
# Time zones
#
# `local_time` used to mean two incompatible things: "the sponsor runs this at
# a clock time in THEIR zone" and "this starts at a clock time wherever YOU
# are". The first has exactly one correct UTC instant that moves with DST; the
# second has none at all. These tests pin both halves of the split, and the two
# DST edges, which zoneinfo resolves silently rather than raising.
# ---------------------------------------------------------------------------

def test_no_record_still_uses_legacy_local_time(catalog):
    """The migration is only finished when nothing carries the old flag."""
    stragglers = [c["id"] for c in catalog if "local_time" in c]
    assert not stragglers, f"still using retired local_time: {stragglers}"


def test_no_record_has_both_timezone_and_local_rolling(catalog):
    """
    A contest is anchored to the sponsor's clock or to the operator's. Both at
    once is incoherent, and the engine refuses to expand such a record.
    """
    for c in catalog:
        assert not (c.get("timezone") and c.get("local_rolling")), c["id"]


def test_timezone_records_mark_every_spec_wall_clock(catalog):
    """
    A `timezone` with an unmarked time spec is the dangerous half-migration:
    the zone looks handled but the spec is still read as UTC.
    """
    for c in catalog:
        if not c.get("timezone"):
            continue
        specs = c.get("sessions") or [{"start": c["start"], "end": c["end"]}]
        for s in specs:
            assert s["start"].get("wall_clock") is True, c["id"]
            assert s["end"].get("wall_clock") is True, c["id"]


def test_wall_clock_without_a_timezone_is_refused():
    """
    Refusing beats defaulting. Silently treating an unzoned wall_clock spec as
    UTC is exactly the bug this rework removes.
    """
    broken = {
        "id": "broken",
        "name": "Broken",
        "recurrence": {"type": "fixed_date", "month": 6, "day": 1},
        "start": {"day_offset": 0, "time": "1900", "wall_clock": True},
        "end": {"day_offset": 0, "time": "2100", "wall_clock": True},
    }
    with pytest.raises(ValueError, match="wall_clock"):
        expand(broken, 2026)


def test_sponsor_anchored_shifts_with_dst(catalog):
    """
    The whole point. 4SQRP says it themselves: "7 PM until 9 PM central time
    (CST or CDT, whichever is in effect at the time). If you use UTC, that time
    changes when we switch from CST to CDT (or vice versa)."

    Same wall clock in January and July; UTC instants exactly one hour apart.
    """
    occ = {o.start.month: o for o in expand(by_id(catalog, "4sqrp-sss"), 2026)}
    jan, jul = occ[1], occ[7]

    assert jan.start_wall.hour == 19 and jul.start_wall.hour == 19
    assert jan.start.hour == 1, "19:00 CST is 0100Z"
    assert jul.start.hour == 0, "19:00 CDT is 0000Z"

    # Expressed as an offset from the same wall reading, the gap is one hour.
    assert (jan.start - jan.start_wall.replace(tzinfo=jan.start.tzinfo)) - (
        jul.start - jul.start_wall.replace(tzinfo=jul.start.tzinfo)
    ) == timedelta(hours=1)


def test_spartan_sprint_shifts_with_dst_too(catalog):
    """
    ARS publishes no UTC time at all and says the event "is always at these
    Local Times", so the UTC instant is what moves. December and July differ.
    """
    occ = {o.start.month: o for o in expand(by_id(catalog, "ars-spartan-sprint"), 2026)}
    assert occ[12].start.hour == 1, "20:00 EST is 0100Z"
    assert occ[7].start.hour == 0, "20:00 EDT is 0000Z"
    assert all(o.start_wall.hour == 20 for o in occ.values())


def test_dst_spring_forward_hour():
    """
    02:30 on 2026-03-08 in America/Chicago DOES NOT EXIST -- the clocks jump
    from 02:00 to 03:00. zoneinfo does not raise; it resolves using the
    pre-transition offset, which lands at 0830Z. That is the conventional
    "shift forward an hour" outcome, and it is pinned here so it stays a
    decision rather than an accident.

    No contest is anchored in this window today, but 0100-0300 local sprints
    are common in this hobby and one will land here eventually.
    """
    c = {
        "id": "spring-forward-probe",
        "name": "Spring Forward Probe",
        "timezone": "America/Chicago",
        "recurrence": {"type": "fixed_date", "month": 3, "day": 8},
        "start": {"day_offset": 0, "time": "0230", "wall_clock": True},
        "end": {"day_offset": 0, "time": "0430", "wall_clock": True},
    }
    occ = expand(c, 2026)[0]
    assert occ.start_wall == datetime(2026, 3, 8, 2, 30)
    assert occ.start == datetime(2026, 3, 8, 8, 30, tzinfo=UTC)


def test_dst_fall_back_hour():
    """
    01:30 on 2026-11-01 in America/Chicago happens TWICE. zoneinfo picks
    between them with `fold`, defaulting to 0 -- the first, still-CDT pass,
    which is 0630Z. The second pass would be 0730Z, a full hour later, and
    both are "valid". Pinned so the default is a choice.
    """
    c = {
        "id": "fall-back-probe",
        "name": "Fall Back Probe",
        "timezone": "America/Chicago",
        "recurrence": {"type": "fixed_date", "month": 11, "day": 1},
        "start": {"day_offset": 0, "time": "0130", "wall_clock": True},
        "end": {"day_offset": 0, "time": "0330", "wall_clock": True},
    }
    occ = expand(c, 2026)[0]
    assert occ.start == datetime(2026, 11, 1, 6, 30, tzinfo=UTC), "fold=0, first pass"


def test_rolling_contest_exposes_no_utc_instant():
    """
    An operator-anchored contest starts at a clock time wherever you are, so no
    single UTC instant exists. The engine must hand back None rather than a
    plausible-looking timestamp that would be wrong for everyone not on UTC --
    a hard failure beats a wrong value that propagates into an iCal feed.

    Exercised against a synthetic definition: no contest in the catalog is
    operator-anchored today (ARRL moved 10 GHz to fixed UTC), but the capability
    is here so the next one found does not get a fake instant.
    """
    c = {
        "id": "rolling-probe",
        "name": "Rolling Probe",
        "local_rolling": True,
        "recurrence": {"type": "nth_full_weekend", "month": 8, "n": 3},
        "start": {"day_offset": 0, "time": "0600"},
        "end": {"day_offset": 1, "time": "2359"},
    }
    occ = expand(c, 2026)[0]

    assert occ.start is None and occ.end is None
    assert occ.local_rolling is True
    assert occ.start_wall == datetime(2026, 8, 15, 6, 0)
    assert occ.start_wall.tzinfo is None, "a wall reading must not claim a zone"
    assert occ.start_date == date(2026, 8, 15)
    assert occ.duration_hours == pytest.approx(41.98, abs=0.02)

    payload = occ.to_dict()
    assert payload["start"] is None and payload["end"] is None
    assert payload["start_wall"] == "2026-08-15T06:00:00"


def test_rolling_contest_claims_no_log_deadline():
    """A deadline counted from an end that does not exist would be fiction."""
    c = {
        "id": "rolling-probe",
        "name": "Rolling Probe",
        "local_rolling": True,
        "log_deadline_days": 30,
        "recurrence": {"type": "fixed_date", "month": 6, "day": 1},
        "start": {"day_offset": 0, "time": "0600"},
        "end": {"day_offset": 0, "time": "1800"},
    }
    assert expand(c, 2026)[0].log_due is None


def test_conflicting_time_anchors_are_refused():
    c = {
        "id": "conflicted",
        "name": "Conflicted",
        "timezone": "America/Chicago",
        "local_rolling": True,
        "recurrence": {"type": "fixed_date", "month": 6, "day": 1},
        "start": {"day_offset": 0, "time": "1900", "wall_clock": True},
        "end": {"day_offset": 0, "time": "2100", "wall_clock": True},
    }
    with pytest.raises(ValueError, match="local_rolling"):
        expand(c, 2026)


def test_mixed_schedule_sorts_without_comparing_apples_to_oranges(catalog):
    """
    Sorting a year that mixes UTC, zoned and rolling contests must not blow up
    on naive-vs-aware comparison. `sort_key` exists for exactly this.
    """
    occ = expand_year(catalog, 2026)
    keys = [o.sort_key for o in occ]
    assert keys == sorted(keys)
    assert all(k.tzinfo is not None for k in keys)


def test_arrl_10ghz_is_utc_not_local_any_more(catalog):
    """
    ARRL moved this contest off local time and says so in the rules: "Each
    weekend begins 0900 UTC Saturday and runs through 0759 UTC Monday. NOTE:
    This is a change from the previous start and end times in local time."

    It was stored here as 0600 local Saturday to 2359 local Sunday, which is
    now wrong twice over -- wrong hours and wrong model.
    """
    for cid, expected in (
        ("arrl-10ghz-leg1", date(2026, 8, 15)),
        ("arrl-10ghz-leg2", date(2026, 9, 19)),
    ):
        c = by_id(catalog, cid)
        assert not c.get("timezone") and not c.get("local_rolling")
        occ = expand(c, 2026)[0]
        assert occ.start == datetime(expected.year, expected.month, expected.day, 9, 0, tzinfo=UTC)
        assert (occ.end.hour, occ.end.minute) == (7, 59)
        assert (occ.end.date() - occ.start.date()).days == 2, "Saturday to Monday"


def test_unknown_rule_type_surfaces_instead_of_yielding_an_empty_schedule():
    """
    A rule that produces no anchors this year is fine and returns nothing -- a
    fifth-Saturday rule in a four-Saturday month, or a `manual` record for an
    unpublished year. A rule type that does not exist is a catalog typo, and
    swallowing it would silently drop the contest from every calendar.
    """
    c = {
        "id": "typo",
        "name": "Typo",
        "recurrence": {"type": "nth_fortnight", "month": 6, "n": 1},
        "start": {"day_offset": 0, "time": "0000"},
        "end": {"day_offset": 0, "time": "0100"},
    }
    with pytest.raises(ValueError, match="unknown rule type"):
        expand(c, 2026)


def test_composite_rule_handles_mixed_subrules():
    """A composite may mix rule types -- last-weekday plus nth-full-weekend."""
    anchors = resolve_anchors(
        {
            "type": "composite",
            "rules": [
                {"type": "nth_weekday", "month": 2, "n": -1, "weekday": 5},
                {"type": "nth_full_weekend", "month": 7, "n": 3},
            ],
        },
        2026,
    )
    assert anchors == [date(2026, 2, 28), date(2026, 7, 18)]


# ---------------------------------------------------------------------------
# Catalog vocabularies
#
# `modes` and `bands` were free text until 2026-08-16: `Digital` and `DIGITAL`
# were different values, PSK31 sat alongside them as if it were a peer, and no
# band filter could be written at all. These tests are what stops that
# returning -- a controlled set that nothing enforces is a convention, and a
# convention decays one hand-edited record at a time.
#
# Mirrored one-for-one in engine/tests/recurrence.test.ts.
# ---------------------------------------------------------------------------


def test_every_record_draws_its_modes_from_the_controlled_set(catalog):
    offenders = [
        (c["id"], m)
        for c in catalog
        for m in c.get("modes", [])
        if m not in CATALOG_MODES
    ]
    assert offenders == [], f"modes outside the vocabulary: {offenders}"


def test_every_record_declares_at_least_one_mode(catalog):
    # A contest with no mode cannot be found by anyone filtering on mode, and
    # every sponsor states one. Absence here is an editing slip, not a fact.
    assert [c["id"] for c in catalog if not c.get("modes")] == []


def test_every_record_draws_its_bands_from_the_ladder(catalog):
    offenders = [
        (c["id"], b)
        for c in catalog
        for b in c.get("bands", [])
        if b not in CATALOG_BANDS
    ]
    assert offenders == [], f"bands outside the ladder: {offenders}"


def test_bands_are_listed_low_to_high(catalog):
    # Order is displayed as-is -- "160-10m" is collapsed from the ends of the
    # list. An unsorted list renders as a wrong range rather than as a mess,
    # which is the kind of wrong that gets believed.
    for c in catalog:
        bands = c.get("bands", [])
        order = [CATALOG_BANDS.index(b) for b in bands]
        assert order == sorted(order), f"{c['id']} lists bands out of order: {bands}"


def test_no_record_carries_a_duplicate_mode_or_band(catalog):
    for c in catalog:
        for fieldname in ("modes", "bands"):
            values = c.get(fieldname, [])
            assert len(values) == len(set(values)), f"{c['id']}: duplicate {fieldname}"


def test_retired_free_text_tokens_are_gone_everywhere(catalog):
    # The exact values that were in the catalog before the migration. Named
    # rather than inferred, so this fails loudly if one is reintroduced by a
    # copy-paste from an old record.
    retired = {"DIGITAL", "PSK31", "PSK63", "RTTY75", "FT4", "VHF+", "222MHz+", "10GHz+"}
    stragglers = [
        (c["id"], v)
        for c in catalog
        for v in c.get("modes", []) + c.get("bands", [])
        if v in retired
    ]
    assert stragglers == [], f"pre-migration tokens still in the catalog: {stragglers}"


def test_submodes_are_specifics_not_a_second_mode_list(catalog):
    # `submodes` is free text on purpose. What it must never hold is a value
    # from the controlled set -- that would be the mode recorded twice, in two
    # fields, and the two would eventually disagree.
    for c in catalog:
        for s in c.get("submodes", []):
            assert s not in CATALOG_MODES, f"{c['id']}: submode {s!r} belongs in modes"


def test_a_record_with_submodes_declares_the_family_they_belong_to(catalog):
    # PSK31 without Digital, or FT4 without FT8/FT4, is a record that shows up
    # in no filter at all. The submode is the detail; the mode is the handle.
    for c in catalog:
        if c.get("submodes"):
            assert c.get("modes"), f"{c['id']} has submodes but no mode"


def test_unrecorded_bands_are_the_documented_exception(catalog):
    """
    Empty `bands` means unrecorded, and a band filter drops the record. That is
    a real cost, so it is pinned to the records that have a documented reason.

    jarl-new-year-qso-party: JARL's rule is "All bands and Modes permitted for
    JA amateur radio stations" and points at the Japanese band plan. There is no
    band list on the page to record, and inferring one from the band plan would
    be this catalog writing a rule JARL did not.

    zs-sota-activity-weekend: SARL states "Frequencies and modes: All amateur
    bands and modes". Same shape as JARL -- there is no list on the page, and
    writing one out would be this catalog inventing a restriction the sponsor
    did not state.

    Note what BOTH of these have in common, and what neither is: the sponsor
    said "all bands", and we recorded that as an absence rather than guessing a
    list. sarl-hf-phone used to be here for the OTHER reason -- its source was
    unreachable -- and it left this list on 2026-08-19 when the league turned
    out to have moved rather than died. Waiting was the right call: the rule is
    to document a blocked source and stop, never to reach for an aggregator.
    """
    unrecorded = sorted(c["id"] for c in catalog if not c.get("bands"))
    assert unrecorded == ["jarl-new-year-qso-party", "zs-sota-activity-weekend"]


def test_bands_note_never_stands_in_for_a_band_list(catalog):
    # The note carries the sponsor's wording; it is not a place to record the
    # bands themselves in prose and skip the machine-readable list.
    for c in catalog:
        if c.get("bands_note"):
            assert c.get("bands"), f"{c['id']} has a bands_note but no bands"


# ---------------------------------------------------------------------------
# The expiry cliff
# ---------------------------------------------------------------------------
#
# A `manual` record produces NOTHING for a year absent from its `dates` map.
# That is correct behaviour and this project's discipline working as designed:
# a sponsor who publishes one year at a time gets a record holding exactly what
# was published, and no ordinal is invented to fill the gap.
#
# The failure mode is that correctness has an expiry date and nothing on the
# record's face says when. A wrong rule shows a contest on the wrong day, which
# somebody notices. An expired one shows nothing at all, on a calendar that
# still looks complete -- so nobody notices, which is worse.
#
# Measured 2026-08-21: 220 of 230 records produce occurrences in 2026 and only
# 194 do in 2027. These tests exist so that number cannot move in silence.

CATALOG_YEAR = 2026

# Re-read the sponsors and move this forward when you do. Past it, the suite
# fails on purpose -- see test_manual_records_get_reviewed_before_the_year_turns.
MANUAL_REVIEW_DEADLINE = date(2026, 12, 1)

# Every `manual` record whose latest published year is CATALOG_YEAR, so it goes
# dark on 1 January. Pinned by id rather than by count: a count tells you the
# cliff moved, ids tell you which contest fell off it.
EXPIRE_AFTER_CATALOG_YEAR = {
    "arsi-40m-cq-vu-cw", "arsi-40m-cq-vu-ssb", "arsi-qrp-day", "arsi-vu-dx",
    "arsi-vu-rookie", "cwops-cw-open", "erau-es-ll-kv", "lrmd-wal",
    "ncj-sprint-cw", "ncj-sprint-rtty", "rac-canada-winter",
    "rca-nacional-80m", "rsgb-80mcc-cw", "rsgb-80mcc-data", "rsgb-80mcc-ssb",
    "rsgb-autumn-cw", "rsgb-autumn-data", "rsgb-autumn-ssb",
    "rsgb-ft4-activity-day", "rsgb-ft4-series", "sarl-top-band-qso",
    "stew-perry", "uarl-champ-cw", "uarl-champ-rtty", "uarl-champ-ssb",
    "uarl-lp-cup-cw", "uba-bma", "uba-on-2m", "uba-on-6m", "uba-on-80-40-cw",
    "uba-on-80-40-ssb", "uba-spring-2m", "uba-spring-6m", "uba-spring-80m-cw",
    "uba-spring-80m-ssb", "ure-eartty",
}

# Records that already produce nothing this year WITHOUT active_until to say
# why. `active_until` means "the sponsor stopped running it"; neither of these
# has that evidence, so setting it would be a claim we cannot support. They are
# pinned here instead, which is the honest form of the same statement.
DARK_WITHOUT_EXPLANATION = {
    "srr-russian-dx",     # holds 2027 only -- invisible for all of 2026
    "rca-nacional-40m",   # holds 2025 only -- invisible in 2026 AND 2027
}


def _latest_manual_year(contest):
    years = [int(y) for y in (contest["recurrence"].get("dates") or {})]
    return max(years) if years else None


def test_the_expiry_cliff_is_exactly_where_we_think_it_is(catalog):
    """
    The set of contests that go dark on 1 January is pinned by id.

    Fails in both directions on purpose. If a record is ADDED to the cliff --
    someone encodes a new sponsor who publishes one year at a time -- it must be
    written down here, so the liability is visible rather than discovered next
    January. If one is REMOVED because next year's dates arrived, that is good
    news and it still has to be recorded, because an unexplained shrink means
    somebody edited the data without understanding this.
    """
    got = {
        c["id"] for c in catalog
        if c["recurrence"]["type"] == "manual"
        and not c.get("active_until")
        and _latest_manual_year(c) == CATALOG_YEAR
    }
    assert got == EXPIRE_AFTER_CATALOG_YEAR


def test_a_record_showing_nothing_this_year_says_why(catalog):
    """
    Every record producing no occurrence in the catalog year is either explained
    by `active_until` -- the sponsor stopped running it, which the eight FISTS
    sprints record correctly -- or is pinned in DARK_WITHOUT_EXPLANATION.

    A record that silently shows nothing is the exact failure this file exists
    to prevent, and it is worse than a wrong date because the site still looks
    complete.
    """
    dark = {c["id"] for c in catalog if not expand(c, CATALOG_YEAR)}
    unexplained = {
        i for i in dark
        if not by_id(catalog, i).get("active_until")
    }
    assert unexplained == DARK_WITHOUT_EXPLANATION

    # ...and the explained ones really are explained, not merely absent.
    for i in dark - unexplained:
        assert by_id(catalog, i)["active_until"] < CATALOG_YEAR, i


def test_manual_records_get_reviewed_before_the_year_turns():
    """
    A dated tripwire, and it is meant to go off.

    Past MANUAL_REVIEW_DEADLINE this fails until somebody re-reads the sponsors
    on the cliff, adds whatever they have published for next year, and moves the
    deadline forward. Bumping the date is not a loophole -- it is the point. It
    turns "nobody looked" into a commit that says who looked and when, which is
    the same move test_registry_coverage_is_current makes for the coverage block.

    Set to 1 December because that is when the sponsors here typically publish
    the following year, and it still leaves a month before the contests vanish.
    """
    today = date.today()
    assert today < MANUAL_REVIEW_DEADLINE, (
        f"{len(EXPIRE_AFTER_CATALOG_YEAR)} manual records hold {CATALOG_YEAR} dates only "
        f"and will produce nothing from {CATALOG_YEAR + 1}-01-01. "
        f"THE CHECKLIST IS IN HANDOVER.md, 'The December re-check'. It is THIRTEEN "
        f"sponsors, not {len(EXPIRE_AFTER_CATALOG_YEAR)} contests -- UBA alone is nine of "
        f"them and three pages cover all nine. RSGB's next URL is derivable: change the "
        f"year in rules/{{year}}/. SARL publishes its manual in December, so it is timed "
        f"right. "
        f"When done: add whatever each sponsor has published, then move "
        f"MANUAL_REVIEW_DEADLINE and CATALOG_YEAR forward and update the two pinned sets. "
        f"Bumping the date without looking is the one way to make this test useless."
    )



def test_a_manual_date_may_carry_its_own_times(catalog):
    """
    The schema question NEEDS_A_HUMAN had been carrying since the REP FT4
    series, settled by RSGB's 3.5 MHz Autumn Series hitting the same wall.

    That series runs 1900-2030 UTC in September and October and 2000-2130 in
    November, and every leg sits on one side or the other of the change. One
    stored time would put two of the three runnings on the calendar an hour
    wrong. The alternatives were a record per clock time -- six for a nine-leg
    series the sponsor treats as one -- or a record per leg, which is nine.

    So a `manual` entry may be a plain date string OR an object carrying that
    date's own times, and splitting by MODE becomes possible without lying
    about an hour.
    """
    got = {
        cid: [
            (o.start.date().isoformat(), o.start.strftime("%H%M"), o.end.strftime("%H%M"))
            for o in expand(by_id(catalog, cid), 2026)
        ]
        for cid in ("rsgb-autumn-cw", "rsgb-autumn-ssb", "rsgb-autumn-data")
    }
    assert got["rsgb-autumn-cw"] == [
        ("2026-09-16", "1900", "2030"),
        ("2026-10-05", "1900", "2030"),
        ("2026-11-26", "2000", "2130"),   # <- November moves the clock
    ]
    assert got["rsgb-autumn-ssb"][-1] == ("2026-11-11", "2000", "2130")
    assert got["rsgb-autumn-data"][-1] == ("2026-11-02", "2000", "2130")

    # Non-vacuous: the earlier legs really do use the record's own default,
    # so this is not asserting that every leg got the override.
    for cid, legs in got.items():
        assert legs[0][1] == "1900", cid
        assert by_id(catalog, cid)["start"]["time"] == "1900", cid


def test_a_plain_manual_date_still_uses_the_record_times(catalog):
    # The override is opt-in per entry. Every other manual record in the catalog
    # lists bare strings and must be untouched by the feature existing -- which
    # is the failure a new code path in `expand` would most easily cause.
    plain = [
        c for c in catalog
        if c["recurrence"]["type"] == "manual"
        and all(isinstance(e, str)
                for lst in c["recurrence"].get("dates", {}).values() for e in lst)
    ]
    assert len(plain) > 20, "expected most manual records to be plain strings"
    for c in plain:
        # A record's own sessions, or the single implied one. ERAU's ES LL KV
        # has three sessions and caught the first version of this assertion,
        # which compared every occurrence against contest["start"].
        # A wall_clock record stores the SPONSOR's clock and resolves to a UTC
        # instant that differs from it -- ERAU's ES LL KV is 1000 local, 0800Z.
        # Comparing a UTC hour against a stored wall hour is the category error
        # the engine exists to prevent, so those are out of scope here.
        if c.get("timezone") or c.get("local_rolling"):
            continue
        want = {
            sess["start"]["time"]
            for sess in (c.get("sessions") or [{"start": c["start"], "end": c["end"]}])
        }
        for year in c["recurrence"].get("dates", {}):
            for o in expand(c, int(year)):
                assert o.start.strftime("%H%M") in want, c["id"]


def test_verified_means_the_evidence_is_in_the_record(catalog):
    """
    HANDOVER.md defines verification as recording the rule IN THE SPONSOR'S OWN
    WORDING in `source_note`. Three SARL club records carried `verified: true`
    with an empty string there, and that is a stricter defect than the thin
    notes the same audit found beside them: an empty source_note is not weak
    evidence, it is none, and there was nothing in the record to check a rule
    against.

    The bar here is deliberately low -- length, not content -- because the
    failure being prevented is an EMPTY one. Judging whether a note actually
    quotes its sponsor is a job for a person reading it; refusing to call a
    record verified with nothing behind it is a job a test can do.
    """
    thin = [
        (c["id"], len(c.get("source_note") or ""))
        for c in catalog
        if c.get("verified") and len(c.get("source_note") or "") < 40
    ]
    assert thin == [], f"verified with no evidence: {thin}"

    # ...and every verified record says when its link was last confirmed, so a
    # note that has quietly gone stale can at least be aged.
    undated = [c["id"] for c in catalog if c.get("verified") and not c.get("rules_url_checked")]
    assert undated == []

def test_the_two_engines_declare_the_same_vocabularies():
    # The Python and TypeScript vocabularies are hand-maintained in two files.
    # This asserts the Python side against the literal text of the TypeScript
    # one, so a value added to one and not the other fails here rather than in
    # a filter six months later.
    ts = (Path(__file__).resolve().parent.parent / "engine" / "src" / "recurrence.ts").read_text(
        encoding="utf-8"
    )
    for name, values in (
        ("CATALOG_MODES", CATALOG_MODES),
        ("CATALOG_BANDS", CATALOG_BANDS),
    ):
        block = ts.split(f"export const {name} = [")[1].split("]")[0]
        declared = tuple(v.strip().strip('",') for v in block.split(",") if v.strip())
        assert declared == values, f"{name} differs between the engines"
