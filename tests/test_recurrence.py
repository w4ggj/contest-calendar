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
    for cid in ("4sqrp-sss", "ars-spartan-sprint"):
        c = by_id(catalog, cid)
        assert c.get("timezone"), f"{cid} has no timezone"
        assert c["start"].get("wall_clock") is True, cid
        assert c["end"].get("wall_clock") is True, cid
        assert "UTC" in c["note"], cid


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
