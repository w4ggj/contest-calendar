"""
Test suite for the contest recurrence engine.

The critical tests here are the sponsor-validation ones: we encode a rule in the
sponsor's own words, generate a date, and assert it matches a date that sponsor
published independently. That is what proves the catalog is an independent
compilation and not a copy of anyone else's.

Run:  pytest -q
"""

import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from contestcal import load_catalog, load_registry  # noqa: E402
from contestcal.recurrence import (  # noqa: E402
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
