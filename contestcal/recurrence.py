"""
Contest recurrence engine.

Encodes amateur radio contest scheduling rules as data, then expands them into
concrete UTC datetimes for any requested year. This is an independent compilation
built from contest sponsors' own published rules -- not derived from any
third-party calendar.

Rule types
----------
nth_full_weekend   {month, n}            n=-1 means last, n=-2 the one before it.
                                         A "full weekend" is a Sat/Sun pair with
                                         BOTH days in the month.
nth_weekday        {month, n, weekday}   weekday 0=Mon .. 6=Sun. Negative n counts
                                         back from the last.
fixed_date         {month, day}          Same calendar date every year.
nearest_weekday    {month, day, weekday} The instance of `weekday` closest to
                                         {month, day} -- WIA Remembrance Day's
                                         "weekend in August closest to the 15th".

Anchors
-------
Rules resolve to an anchor Saturday (weekend rules) or an anchor day (weekday /
fixed rules). Start and end are then expressed as offsets from that anchor, so a
contest that opens 2200 UTC Friday and closes 1559 UTC Sunday is:

    start: {day_offset: -1, time: "2200"}
    end:   {day_offset: +1, time: "1559"}

Time handling
-------------
Times are UTC unless a record says otherwise. Two kinds of contest say otherwise,
and they need OPPOSITE treatment -- conflating them was a real bug:

**Sponsor-anchored local time.** The sponsor runs the contest at a clock time in
*their* zone (4SQRP SSS: "7 PM until 9 PM central time (CST or CDT, whichever is
in effect)"). Exactly one correct UTC instant exists per occurrence; it moves an
hour with DST. Set `timezone` to an IANA zone and mark each time spec
`wall_clock: true`. The engine resolves through `zoneinfo`, so DST is free.

**Operator-anchored local time.** The contest starts at a clock time wherever the
*operator* is, sweeping the globe as local dawn moves west. No single UTC instant
exists and converting to one is a category error. Set `local_rolling: true`; the
engine then leaves `Occurrence.start`/`end` as None and populates the wall-clock
fields instead, so a wrong instant cannot leak into a feed.

The two are mutually exclusive and `expand()` raises if a record sets both.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

SATURDAY = 5

# --------------------------------------------------------------------------
# Catalog vocabularies
# --------------------------------------------------------------------------
#
# `modes` and `bands` are controlled sets, not free text. They were free text
# once: `Digital` and `DIGITAL` were different values, PSK31 and RTTY75 sat
# alongside them as if they were peers, and a band filter could not be written
# at all. A filter is only ever as good as the field it reads.
#
# What each field may hold:
#
#   modes       one or more of CATALOG_MODES, in the order the sponsor writes
#               them ("CW/SSB", not the vocabulary's order)
#   submodes    free text, for the specifics `modes` deliberately drops --
#               "PSK31", "RTTY 75 baud". Displayed, never filtered on: a
#               free-text field cannot be a filter, which is the whole point
#   bands       zero or more of CATALOG_BANDS, low to high
#   bands_note  free text, for a sponsor's range or suggestion wording that a
#               list of tokens cannot carry -- "10 GHz through light"
#
# EMPTY `bands` MEANS UNRECORDED, NOT UNBANDED. Every band filter therefore
# excludes such a record, and callers that filter must say so rather than let
# it vanish. Mirrored in engine/src/recurrence.ts.

CATALOG_MODES = ("CW", "SSB", "FM", "RTTY", "Digital", "FT8/FT4", "Mixed")

CATALOG_BANDS = (
    "160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m",
    "6m", "2m", "1.25m", "70cm", "33cm", "23cm", "13cm", "3cm",
)


class NoAnchorsThisYear(ValueError):
    """
    A rule that simply does not fire in the requested year.

    Legitimate and common: a "fifth Saturday" rule in a month with four, or a
    `manual` record for a year the sponsor has not published yet. `expand()`
    treats it as "this contest does not run" and returns nothing.

    Deliberately distinct from a malformed rule. An unknown rule type raises
    plain ValueError and is allowed to surface, because a typo in the catalog
    that silently produces an empty schedule is exactly the kind of quiet
    wrongness this project refuses everywhere else.
    """


# --------------------------------------------------------------------------
# Eligibility
# --------------------------------------------------------------------------

def eligibility_for(contest: dict[str, Any], my_entity: str = "K") -> dict[str, Any]:
    """
    Work out whether an operator in `my_entity` can enter a given contest.

    Deliberately NOT a boolean. Contests restrict participation in several
    distinct ways and collapsing them loses information operators need:

    - "worldwide"      anyone may enter (CQ WW, RSGB IOTA)
    - "entity_list"    only listed entities may enter (ARRL Sweepstakes: K/VE;
                       RSGB AFS: G; SARL contests: ZS)
    - "two_sided"      everyone enters, but each side works only the other
                       (ARRL DX: US/VE work DX, DX works US/VE)

    Returns a dict rather than True/False so the UI can say *why* something is
    filtered, which is far more useful than silently hiding it.
    """
    elig = contest.get("eligibility", {})
    scope = elig.get("scope", "worldwide")

    result = {
        "scope": scope,
        "can_enter": True,
        "reason": "",
        "works": elig.get("works", "everyone"),
        "practical": elig.get("practical", ""),
        "verified": elig.get("verified", False),
    }

    if scope == "entity_list":
        entities = elig.get("entities", [])
        result["can_enter"] = my_entity in entities
        # Name them when the list is short enough to read. RSGB's Commonwealth
        # Contest is limited to 151 call-area prefixes, and joining those into a
        # sentence produces a paragraph nobody reads instead of an answer.
        listed = (
            ", ".join(entities)
            if len(entities) <= 8
            else f"{len(entities)} listed entities"
        )
        if not result["can_enter"]:
            result["reason"] = (
                f"Entry limited to {listed}. "
                f"{my_entity} stations may be worked but cannot submit an entry."
            )
        else:
            result["reason"] = f"Entry limited to {listed} -- includes {my_entity}."

    elif scope == "two_sided":
        sides = elig.get("sides", {})
        my_side = next((k for k, v in sides.items() if my_entity in v), None)
        if my_side:
            other = [k for k in sides if k != my_side]
            result["works"] = f"works {other[0] if other else 'the other side'} only"
            result["reason"] = f"{my_entity} is in the '{my_side}' group."
        else:
            result["reason"] = f"{my_entity} not listed in either side -- check rules."
            result["can_enter"] = False

    return result


def filter_by_eligibility(
    occurrences: list["Occurrence"],
    my_entity: str = "K",
    include_ineligible: bool = False,
) -> list["Occurrence"]:
    """
    Filter a schedule to what `my_entity` can actually enter.

    Default hides contests you cannot enter. Pass include_ineligible=True to
    keep everything -- useful because a contest you cannot ENTER may still be a
    contest worth WORKING (activity on the band, and the other side often wants
    your multiplier).
    """
    if include_ineligible:
        return occurrences
    return [o for o in occurrences if o.can_enter]


# --------------------------------------------------------------------------
# Rules links
# --------------------------------------------------------------------------

def resolve_rules_url(contest: dict[str, Any], year: int) -> str:
    """
    Resolve the sponsor's rules URL for a given year.

    Sponsors split into two camps:

    - **Stable slugs.** ARRL keeps one URL per contest forever
      (arrl.org/field-day). Use `rules_url`.
    - **Year-versioned paths.** RSGB publishes each season separately
      (rsgbcc.org/hf/rules/2026/riota.shtml). Use `rules_url_pattern` with a
      {year} placeholder so links stay live as years roll over.

    Hardcoding a single URL for a year-versioned sponsor means every link rots
    the following January, so prefer the pattern whenever one exists.
    """
    pattern = contest.get("rules_url_pattern")
    if pattern:
        return pattern.format(year=year)
    return contest.get("rules_url", "")


# --------------------------------------------------------------------------
# Anchor resolution
# --------------------------------------------------------------------------

def _saturdays_in_month(year: int, month: int) -> list[date]:
    """Every Saturday falling in the given month."""
    days_in_month = calendar.monthrange(year, month)[1]
    return [
        date(year, month, d)
        for d in range(1, days_in_month + 1)
        if date(year, month, d).weekday() == SATURDAY
    ]


def _full_weekends_in_month(year: int, month: int) -> list[date]:
    """
    Saturdays that begin a *full* weekend -- both Sat and Sun inside the month.

    This is the definition sponsors use. It matters roughly once a year: when a
    month ends on a Saturday, that Saturday does not start a full weekend, so
    "first full weekend" shifts a week later than a naive "first Saturday".
    """
    days_in_month = calendar.monthrange(year, month)[1]
    return [s for s in _saturdays_in_month(year, month) if s.day + 1 <= days_in_month]


def _nth(items: list[date], n: int) -> date:
    """
    1-indexed selection, counted from the front for n >= 1 and from the back for
    n <= -1: n=-1 is the last item, n=-2 the one before it, and so on.

    Sponsors do write rules that count backwards past "last". BFRA's LZ DX
    Contest is "the weekend before the last full weekend of November", which is
    n=-2 -- and it is a *rule*, not an annual announcement, because the weekend
    it names is defined by CQ WW CW sitting on the last one.

    n=0 is not a position in either direction and is rejected as a malformed
    rule rather than silently read as the first or the last.
    """
    if not items:
        raise NoAnchorsThisYear("no candidate dates in month")
    if n == 0:
        raise ValueError("n=0 is not a valid occurrence index")
    if abs(n) > len(items):
        raise NoAnchorsThisYear(
            f"requested occurrence {n} but only {len(items)} exist"
        )
    return items[n if n < 0 else n - 1]


def _weekdays_in_month(year: int, month: int, weekday: int) -> list[date]:
    days_in_month = calendar.monthrange(year, month)[1]
    return [
        date(year, month, d)
        for d in range(1, days_in_month + 1)
        if date(year, month, d).weekday() == weekday
    ]


def resolve_anchors(rule: dict[str, Any], year: int) -> list[date]:
    """
    Turn a recurrence rule into every anchor date it produces in the given year.

    Annual rules yield one anchor. Weekly and monthly rules yield many -- these
    matter a great deal for a global catalog, where high-frequency events
    (CWops CWT weekly, SKCC Sprint monthly, ARS Spartan Sprint monthly) are a
    large share of all contests.
    """
    kind = rule["type"]

    if kind == "nth_full_weekend":
        anchors = [_nth(_full_weekends_in_month(year, rule["month"]), rule["n"])]
    elif kind == "nth_weekday":
        anchors = [
            _nth(_weekdays_in_month(year, rule["month"], rule["weekday"]), rule["n"])
        ]
    elif kind == "fixed_date":
        anchors = [date(year, rule["month"], rule["day"])]
    elif kind == "nearest_weekday":
        # e.g. WIA Remembrance Day: "Weekend in August closest to the 15th".
        # Well defined in all seven cases and never ambiguous: the nearest
        # instance of a weekday is at most three days away, and a tie would
        # need a distance of 3.5, which does not exist because seven is odd.
        target = date(year, rule["month"], rule["day"])
        shift = (rule["weekday"] - target.weekday()) % 7  # 0..6, forwards
        if shift > 3:
            shift -= 7  # ...or backwards, when that is the shorter way round
        anchors = [target + timedelta(days=shift)]
    elif kind == "monthly_nth_weekday":
        # e.g. ARS Spartan Sprint: first Monday of every month.
        anchors = []
        for m in rule.get("months", list(range(1, 13))):
            try:
                anchors.append(
                    _nth(_weekdays_in_month(year, m, rule["weekday"]), rule["n"])
                )
            except NoAnchorsThisYear:
                # A "fifth Monday" rule simply skips months that have four.
                # Narrower than `except ValueError` so a malformed n=0 rule
                # still raises instead of quietly producing an empty year.
                continue
    elif kind == "weekly":
        # e.g. CWops CWT: every Wednesday. `months` narrows it to a season
        # rather than the whole year -- NZART's sprints run "each Tuesday in
        # April and August" and on no other Tuesday. Same key, same meaning as
        # in monthly_nth_weekday.
        months = set(rule.get("months", range(1, 13)))
        anchors = []
        d = date(year, 1, 1)
        while d.weekday() != rule["weekday"]:
            d += timedelta(days=1)
        while d.year == year:
            if d.month in months:
                anchors.append(d)
            d += timedelta(days=7)
    elif kind == "multi_weekend":
        # e.g. Stew Perry Topband Challenge: several set weekends per year.
        anchors = [
            _nth(_full_weekends_in_month(year, spec["month"]), spec["n"])
            for spec in rule["weekends"]
        ]
    elif kind == "composite":
        # A contest whose sessions follow DIFFERENT rules. NAQP RTTY is the
        # motivating case: the winter running starts on the last Saturday in
        # February, but the summer running is the third full weekend in July.
        # Those are genuinely different rule types, so nest them.
        anchors = []
        for sub in rule["rules"]:
            anchors.extend(resolve_anchors(sub, year))
    elif kind == "manual":
        # Sponsor sets dates annually with no derivable rule (e.g. ARRL EME).
        #
        # An entry is a date string, OR an object carrying that date's own
        # times. The second form exists because some series move their clock
        # mid-run: RSGB's 3.5 MHz Autumn Series is 1900-2030 in September and
        # October and 2000-2130 in November, and REP's FT4 series does the same.
        # Splitting those into one record per clock time would fragment a series
        # the sponsor treats as one; storing a single time would put a contest on
        # the calendar at an hour it does not run.
        anchors = [
            date(*map(int, (e if isinstance(e, str) else e["date"]).split("-")))
            for e in rule.get("dates", {}).get(str(year), [])
        ]
    else:
        raise ValueError(f"unknown rule type: {kind!r}")

    if not anchors:
        raise NoAnchorsThisYear("rule produced no anchors")

    # Exclusions push an anchor forward a week. Used by ARRL RTTY Roundup,
    # whose rules state it is the first full weekend of January but never
    # falls on January 1.
    excluded = {tuple(e) for e in rule.get("exclude_dates", [])}
    if excluded:
        anchors = [
            a + timedelta(days=7) if (a.month, a.day) in excluded else a
            for a in anchors
        ]

    return sorted(anchors)


def resolve_anchor(rule: dict[str, Any], year: int) -> date:
    """Back-compat single-anchor accessor."""
    return resolve_anchors(rule, year)[0]


# --------------------------------------------------------------------------
# Occurrence expansion
# --------------------------------------------------------------------------

@dataclass
class Occurrence:
    contest_id: str
    name: str
    start: datetime | None
    end: datetime | None
    start_wall: datetime | None = None
    end_wall: datetime | None = None
    local_rolling: bool = False
    timezone_name: str = ""
    modes: list[str] = field(default_factory=list)
    submodes: list[str] = field(default_factory=list)
    bands: list[str] = field(default_factory=list)
    bands_note: str = ""
    sponsor: str = ""
    rules_url: str = ""
    verified: bool = False
    note: str = ""
    exchange: str = ""
    country: str = ""
    log_deadline_days: int | None = None
    rules_url_archived: str = ""
    rules_url_checked: str = ""
    can_enter: bool = True
    eligibility_scope: str = "worldwide"
    eligibility_reason: str = ""
    works: str = "everyone"
    practical: str = ""

    @property
    def log_due(self) -> datetime | None:
        """
        Log submission deadline, where the sponsor states one.

        None for operator-anchored contests: the contest has no single UTC end,
        so a deadline counted from it would be as fictional as the end itself.
        """
        if self.log_deadline_days is None or self.end is None:
            return None
        return self.end + timedelta(days=self.log_deadline_days)

    @property
    def duration_hours(self) -> float:
        """
        Length of the occurrence. Operator-anchored contests still have a well
        defined duration -- 6am Saturday to midnight Sunday is the same span of
        hours everywhere -- so fall back to the wall-clock pair.
        """
        if self.start is not None and self.end is not None:
            delta = self.end - self.start
        else:
            delta = self.end_wall - self.start_wall
        return delta.total_seconds() / 3600

    @property
    def start_date(self) -> date:
        """
        Calendar date the occurrence opens on. Well defined either way: a
        rolling contest has no UTC instant but still starts on a known date.
        """
        return (self.start or self.start_wall).date()

    @property
    def sort_key(self) -> datetime:
        """
        Ordering only -- NOT a claim about when this happens. A rolling
        contest's wall time is treated as if it were UTC purely so a mixed
        schedule can be sorted; never surface this value to a user.
        """
        if self.start is not None:
            return self.start
        return self.start_wall.replace(tzinfo=timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        return {
            "contest_id": self.contest_id,
            "name": self.name,
            "start": self.start.isoformat().replace("+00:00", "Z") if self.start else None,
            "end": self.end.isoformat().replace("+00:00", "Z") if self.end else None,
            "start_wall": self.start_wall.isoformat() if self.start_wall else None,
            "end_wall": self.end_wall.isoformat() if self.end_wall else None,
            "local_rolling": self.local_rolling,
            "timezone": self.timezone_name,
            "duration_hours": round(self.duration_hours, 2),
            "modes": self.modes,
            "submodes": self.submodes,
            "bands": self.bands,
            "bands_note": self.bands_note,
            "sponsor": self.sponsor,
            "rules_url": self.rules_url,
            "verified": self.verified,
            "note": self.note,
            "exchange": self.exchange,
            "country": self.country,
            "rules_url_archived": self.rules_url_archived,
            "rules_url_checked": self.rules_url_checked,
            "can_enter": self.can_enter,
            "eligibility_scope": self.eligibility_scope,
            "eligibility_reason": self.eligibility_reason,
            "works": self.works,
            "practical": self.practical,
            "log_due": self.log_due.isoformat().replace("+00:00", "Z") if self.log_due else None,
        }


def _wall_datetime(anchor: date, spec: dict[str, Any]) -> datetime:
    """
    Naive clock reading for a time spec -- a date and a time with no zone.

    Deliberately zone-free: what this reading MEANS depends on the contest
    (UTC, a sponsor's zone, or the operator's), and that decision belongs to
    the caller rather than being baked in here.
    """
    d = anchor + timedelta(days=spec.get("day_offset", 0))
    hhmm = spec["time"]
    hour, minute = int(hhmm[:2]), int(hhmm[2:])
    # 2400 is used by some sponsors to mean end-of-day; normalise it.
    if hour == 24:
        d += timedelta(days=1)
        hour = 0
    return datetime(d.year, d.month, d.day, hour, minute)


def _apply_offset(
    anchor: date, spec: dict[str, Any], tz_name: str | None = None
) -> datetime:
    """
    Resolve a time spec to a real UTC instant.

    A `wall_clock` spec is read in the contest's `timezone` and converted, so
    the same rule yields 0100Z in January and 0000Z in July. Everything else is
    already UTC.

    On the two DST edges `zoneinfo` resolves silently rather than raising, so
    the behaviour is pinned by test rather than left to chance: a nonexistent
    spring-forward time resolves using the pre-transition offset, and an
    ambiguous fall-back time takes the first (still-DST) pass via fold=0.
    """
    naive = _wall_datetime(anchor, spec)
    if not spec.get("wall_clock"):
        return naive.replace(tzinfo=timezone.utc)
    if not tz_name:
        raise ValueError(
            "time spec is marked wall_clock but the contest sets no 'timezone'; "
            "refusing to guess a zone"
        )
    return naive.replace(tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc)


def expand(
    contest: dict[str, Any], year: int, my_entity: str = "K"
) -> list[Occurrence]:
    """
    Expand one contest definition into ALL its occurrences in the given year.

    Returns a list because weekly and monthly contests occur many times per
    year. Annual contests return a single-element list.
    """
    if year < contest.get("active_from", 1900):
        return []
    if year > contest.get("active_until", 9999):
        return []

    try:
        anchors = resolve_anchors(contest["recurrence"], year)
    except NoAnchorsThisYear:
        # The contest does not run this year. A malformed rule is NOT caught
        # here -- it raises, rather than yielding a silently empty schedule.
        return []

    # Some contests run several sessions off one anchor (e.g. CWops CWT runs
    # three sessions on the same day). Default is a single session.
    sessions = contest.get("sessions") or [
        {"start": contest["start"], "end": contest["end"]}
    ]

    # Per-date times, for a `manual` series whose clock moves mid-run. Keyed by
    # anchor and aligned positionally so that exclude_dates shifting an anchor
    # cannot silently detach a date from its own times.
    rule = contest["recurrence"]
    per_date: list[list[dict] | None] = [None] * len(anchors)
    if rule.get("type") == "manual":
        entries = rule.get("dates", {}).get(str(year), [])
        for i, entry in enumerate(entries):
            if isinstance(entry, dict) and ("start" in entry or "end" in entry):
                per_date[i] = [{
                    "start": {
                        "day_offset": entry.get(
                            "start_day_offset", contest["start"]["day_offset"]
                        ),
                        "time": entry.get("start", contest["start"]["time"]),
                    },
                    "end": {
                        "day_offset": entry.get(
                            "end_day_offset", contest["end"]["day_offset"]
                        ),
                        "time": entry.get("end", contest["end"]["time"]),
                    },
                }]

    elig = eligibility_for(contest, my_entity)

    tz_name = contest.get("timezone")
    rolling = bool(contest.get("local_rolling"))
    if tz_name and rolling:
        raise ValueError(
            f"{contest['id']}: sets both 'timezone' and 'local_rolling'. A contest "
            f"is anchored to the SPONSOR's clock or to the OPERATOR's, not both."
        )

    out: list[Occurrence] = []
    for i, anchor in enumerate(anchors):
        for sess in (per_date[i] or sessions):
            start_wall = _wall_datetime(anchor, sess["start"])
            end_wall = _wall_datetime(anchor, sess["end"])

            if rolling:
                # No UTC instant exists for this contest -- see module docstring.
                start = end = None
                reference = start_wall
                if end_wall <= start_wall:
                    raise ValueError(f"{contest['id']}: end not after start in {year}")
            else:
                start = _apply_offset(anchor, sess["start"], tz_name)
                end = _apply_offset(anchor, sess["end"], tz_name)
                reference = start
                if end <= start:
                    raise ValueError(f"{contest['id']}: end not after start in {year}")

            # Keep occurrences inside the requested year.
            if reference.year != year:
                continue
            out.append(
                Occurrence(
                    contest_id=contest["id"],
                    name=contest["name"],
                    start=start,
                    end=end,
                    # Wall readings are only meaningful when a zone other than
                    # UTC is in play; leave them unset for ordinary contests.
                    start_wall=start_wall if (rolling or tz_name) else None,
                    end_wall=end_wall if (rolling or tz_name) else None,
                    local_rolling=rolling,
                    timezone_name=tz_name or "",
                    modes=contest.get("modes", []),
                    submodes=contest.get("submodes", []),
                    bands=contest.get("bands", []),
                    bands_note=contest.get("bands_note", ""),
                    sponsor=contest.get("sponsor", ""),
                    rules_url=resolve_rules_url(contest, year),
                    verified=contest.get("verified", False),
                    note=contest.get("note", ""),
                    exchange=contest.get("exchange", ""),
                    country=contest.get("country", ""),
                    log_deadline_days=contest.get("log_deadline_days"),
                    rules_url_archived=contest.get("rules_url_archived", ""),
                    rules_url_checked=contest.get("rules_url_checked", ""),
                    can_enter=elig["can_enter"],
                    eligibility_scope=elig["scope"],
                    eligibility_reason=elig["reason"],
                    works=elig["works"],
                    practical=elig["practical"],
                )
            )
    return out


def expand_year(
    contests: list[dict[str, Any]], year: int, my_entity: str = "K"
) -> list[Occurrence]:
    """Expand a whole catalog into a chronologically sorted year of occurrences."""
    out: list[Occurrence] = []
    for c in contests:
        out.extend(expand(c, year, my_entity))
    out.sort(key=lambda o: (o.sort_key, o.name))
    return out
