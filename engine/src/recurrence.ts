/**
 * Contest recurrence engine -- TypeScript port of contestcal/recurrence.py.
 *
 * A direct translation, deliberately. The Python suite and this one assert the
 * same dates against the same sponsor-published tables, so any divergence is a
 * bug in one of them rather than a difference of opinion.
 *
 * Encodes amateur radio contest scheduling rules as data, then expands them
 * into concrete UTC instants for any requested year. This is an independent
 * compilation built from contest sponsors' own published rules -- not derived
 * from any third-party calendar.
 *
 * Rule types
 * ----------
 * nth_full_weekend   {month, n}            n=-1 means last. A "full weekend" is
 *                                          a Sat/Sun pair with BOTH days in the
 *                                          month.
 * nth_weekday        {month, n, weekday}   weekday 0=Mon .. 6=Sun. n=-1 = last.
 * fixed_date         {month, day}          Same calendar date every year.
 * nearest_weekday    {month, day, weekday} The instance of `weekday` closest to
 *                                          {month, day} -- WIA Remembrance Day's
 *                                          "weekend in August closest to the 15th".
 *
 * Anchors
 * -------
 * Rules resolve to an anchor Saturday (weekend rules) or an anchor day (weekday
 * / fixed rules). Start and end are then expressed as offsets from that anchor,
 * so a contest that opens 2200 UTC Friday and closes 1559 UTC Sunday is:
 *
 *     start: {day_offset: -1, time: "2200"}
 *     end:   {day_offset: +1, time: "1559"}
 *
 * Time handling
 * -------------
 * Times are UTC unless a record says otherwise. Two kinds of contest say
 * otherwise, and they need OPPOSITE treatment -- conflating them was a real bug:
 *
 * **Sponsor-anchored local time.** The sponsor runs the contest at a clock time
 * in *their* zone. Exactly one correct UTC instant exists per occurrence; it
 * moves an hour with DST. Set `timezone` to an IANA zone and mark each time spec
 * `wall_clock: true`.
 *
 * **Operator-anchored local time.** The contest starts at a clock time wherever
 * the *operator* is. No single UTC instant exists and converting to one is a
 * category error. Set `local_rolling: true`; `start`/`end` stay null and the
 * wall-clock fields carry the times instead.
 *
 * The two are mutually exclusive and `expand()` throws if a record sets both.
 *
 * Dates
 * -----
 * All calendar arithmetic runs on `Date` objects pinned to UTC midnight via
 * `Date.UTC(...)` and read back with `getUTC*`. That keeps it zone-free and
 * deterministic, mirroring Python's `datetime.date`. Wall-clock readings are
 * carried the same way -- a `Date` whose UTC fields hold the wall reading -- and
 * are never presented as instants.
 */

import { resolveWallClock, type WallFields } from "./zones.js";

export const SATURDAY = 5;

// ---------------------------------------------------------------------------
// Catalog vocabularies
// ---------------------------------------------------------------------------
//
// `modes` and `bands` are controlled sets, not free text. They were free text
// once: `Digital` and `DIGITAL` were different values, PSK31 and RTTY75 sat
// alongside them as if they were peers, and a band filter could not be written
// at all. A filter is only ever as good as the field it reads.
//
// What each field may hold:
//
//   modes       one or more of CATALOG_MODES, in the order the sponsor writes
//               them ("CW/SSB", not the vocabulary's order)
//   submodes    free text, for the specifics `modes` deliberately drops --
//               "PSK31", "RTTY 75 baud". Displayed, never filtered on: a
//               free-text field cannot be a filter, which is the whole point
//   bands       zero or more of CATALOG_BANDS, low to high
//   bands_note  free text, for a sponsor's range or suggestion wording that a
//               list of tokens cannot carry -- "10 GHz through light"
//
// EMPTY `bands` MEANS UNRECORDED, NOT UNBANDED. Every band filter therefore
// excludes such a record, and callers that filter must say so rather than let
// it vanish. Mirrored in contestcal/recurrence.py.

export const CATALOG_MODES = [
  "CW", "SSB", "RTTY", "Digital", "FT8/FT4", "Mixed",
] as const;

export const CATALOG_BANDS = [
  "160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m",
  "6m", "2m", "1.25m", "70cm", "33cm", "23cm", "13cm", "3cm",
] as const;

export type CatalogMode = (typeof CATALOG_MODES)[number];
export type CatalogBand = (typeof CATALOG_BANDS)[number];

/**
 * A rule that simply does not fire in the requested year.
 *
 * Legitimate and common: a "fifth Saturday" rule in a month with four, or a
 * `manual` record for a year the sponsor has not published yet. `expand()`
 * treats it as "this contest does not run" and returns nothing.
 *
 * Deliberately distinct from a malformed rule. An unknown rule type throws a
 * plain Error and is allowed to surface, because a typo in the catalog that
 * silently produces an empty schedule is exactly the kind of quiet wrongness
 * this project refuses everywhere else.
 */
export class NoAnchorsThisYear extends Error {}

const DAY_MS = 86_400_000;

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface TimeSpec {
  day_offset?: number;
  time: string;
  wall_clock?: boolean;
}

export interface Session {
  start: TimeSpec;
  end: TimeSpec;
}

export interface RecurrenceRule {
  type: string;
  month?: number;
  day?: number;
  n?: number;
  weekday?: number;
  months?: number[];
  weekends?: { month: number; n: number }[];
  rules?: RecurrenceRule[];
  dates?: Record<string, string[]>;
  exclude_dates?: [number, number][];
}

export interface Eligibility {
  scope?: string;
  entities?: string[];
  sides?: Record<string, string[]>;
  works?: string;
  practical?: string;
  verified?: boolean;
  note?: string;
}

export interface Contest {
  id: string;
  name: string;
  recurrence: RecurrenceRule;
  start: TimeSpec;
  end: TimeSpec;
  sessions?: Session[];
  timezone?: string;
  local_rolling?: boolean;
  modes?: string[];
  /** Free text, e.g. "PSK31". The specifics `modes` deliberately drops. */
  submodes?: string[];
  bands?: string[];
  /** The sponsor's own wording where a band list is a range or a suggestion. */
  bands_note?: string;
  sponsor?: string;
  country?: string;
  rules_url?: string;
  rules_url_pattern?: string;
  rules_url_archived?: string;
  rules_url_checked?: string;
  verified?: boolean;
  note?: string;
  exchange?: string;
  log_deadline_days?: number;
  active_from?: number;
  active_until?: number;
  eligibility?: Eligibility;
  [key: string]: unknown;
}

export interface EligibilityResult {
  scope: string;
  can_enter: boolean;
  reason: string;
  works: string;
  practical: string;
  verified: boolean;
}

// --------------------------------------------------------------------------
// Eligibility
// --------------------------------------------------------------------------

/**
 * Work out whether an operator in `myEntity` can enter a given contest.
 *
 * Deliberately NOT a boolean. Contests restrict participation in several
 * distinct ways and collapsing them loses information operators need:
 *
 * - "worldwide"      anyone may enter (CQ WW, RSGB IOTA)
 * - "entity_list"    only listed entities may enter (ARRL Sweepstakes: K/VE;
 *                    RSGB AFS: G; SARL contests: ZS)
 * - "two_sided"      everyone enters, but each side works only the other
 *                    (ARRL DX: US/VE work DX, DX works US/VE)
 *
 * Returns an object rather than true/false so the UI can say *why* something is
 * filtered, which is far more useful than silently hiding it.
 */
export function eligibilityFor(
  contest: Contest,
  myEntity = "K",
): EligibilityResult {
  const elig = contest.eligibility ?? {};
  const scope = elig.scope ?? "worldwide";

  const result: EligibilityResult = {
    scope,
    can_enter: true,
    reason: "",
    works: elig.works ?? "everyone",
    practical: elig.practical ?? "",
    verified: elig.verified ?? false,
  };

  if (scope === "entity_list") {
    const entities = elig.entities ?? [];
    result.can_enter = entities.includes(myEntity);
    result.reason = result.can_enter
      ? `Entry limited to ${entities.join(", ")} -- includes ${myEntity}.`
      : `Entry limited to ${entities.join(", ")}. ` +
        `${myEntity} stations may be worked but cannot submit an entry.`;
  } else if (scope === "two_sided") {
    const sides = elig.sides ?? {};
    const mySide = Object.keys(sides).find((k) => sides[k].includes(myEntity));
    if (mySide) {
      const other = Object.keys(sides).filter((k) => k !== mySide);
      result.works = `works ${other[0] ?? "the other side"} only`;
      result.reason = `${myEntity} is in the '${mySide}' group.`;
    } else {
      result.reason = `${myEntity} not listed in either side -- check rules.`;
      result.can_enter = false;
    }
  }

  return result;
}

/**
 * Filter a schedule to what `myEntity` can actually enter.
 *
 * Default hides contests you cannot enter. Pass includeIneligible to keep
 * everything -- useful because a contest you cannot ENTER may still be a
 * contest worth WORKING (activity on the band, and the other side often wants
 * your multiplier).
 */
export function filterByEligibility(
  occurrences: Occurrence[],
  _myEntity = "K",
  includeIneligible = false,
): Occurrence[] {
  if (includeIneligible) return occurrences;
  return occurrences.filter((o) => o.can_enter);
}

// --------------------------------------------------------------------------
// Rules links
// --------------------------------------------------------------------------

/**
 * Resolve the sponsor's rules URL for a given year.
 *
 * Sponsors split into two camps:
 *
 * - **Stable slugs.** ARRL keeps one URL per contest forever
 *   (arrl.org/field-day). Use `rules_url`.
 * - **Year-versioned paths.** RSGB publishes each season separately
 *   (rsgbcc.org/hf/rules/2026/riota.shtml). Use `rules_url_pattern` with a
 *   {year} placeholder so links stay live as years roll over.
 *
 * Hardcoding a single URL for a year-versioned sponsor means every link rots
 * the following January, so prefer the pattern whenever one exists.
 */
export function resolveRulesUrl(contest: Contest, year: number): string {
  const pattern = contest.rules_url_pattern;
  if (pattern) return pattern.replace(/\{year\}/g, String(year));
  return contest.rules_url ?? "";
}

// --------------------------------------------------------------------------
// Calendar helpers -- UTC-pinned, so no runtime zone ever leaks in
// --------------------------------------------------------------------------

export function makeDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Python's weekday(): 0 = Monday .. 6 = Sunday. */
export function weekdayOf(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every Saturday falling in the given month. */
export function saturdaysInMonth(year: number, month: number): Date[] {
  const out: Date[] = [];
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const d = makeDate(year, month, day);
    if (weekdayOf(d) === SATURDAY) out.push(d);
  }
  return out;
}

/**
 * Saturdays that begin a *full* weekend -- both Sat and Sun inside the month.
 *
 * This is the definition sponsors use. It matters roughly once a year: when a
 * month ends on a Saturday, that Saturday does not start a full weekend, so
 * "first full weekend" shifts a week later than a naive "first Saturday".
 */
export function fullWeekendsInMonth(year: number, month: number): Date[] {
  const last = daysInMonth(year, month);
  return saturdaysInMonth(year, month).filter((s) => s.getUTCDate() + 1 <= last);
}

export function weekdaysInMonth(
  year: number,
  month: number,
  weekday: number,
): Date[] {
  const out: Date[] = [];
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const d = makeDate(year, month, day);
    if (weekdayOf(d) === weekday) out.push(d);
  }
  return out;
}

/** 1-indexed selection; n=-1 selects the last item. */
function nth(items: Date[], n: number): Date {
  if (items.length === 0) {
    throw new NoAnchorsThisYear("no candidate dates in month");
  }
  if (n === -1) return items[items.length - 1];
  if (n < 1 || n > items.length) {
    throw new NoAnchorsThisYear(
      `requested occurrence ${n} but only ${items.length} exist`,
    );
  }
  return items[n - 1];
}

// --------------------------------------------------------------------------
// Anchor resolution
// --------------------------------------------------------------------------

/**
 * Turn a recurrence rule into every anchor date it produces in the given year.
 *
 * Annual rules yield one anchor. Weekly and monthly rules yield many -- these
 * matter a great deal for a global catalog, where high-frequency events
 * (CWops CWT weekly, SKCC Sprint monthly, ARS Spartan Sprint monthly) are a
 * large share of all contests.
 */
export function resolveAnchors(rule: RecurrenceRule, year: number): Date[] {
  const kind = rule.type;
  let anchors: Date[];

  if (kind === "nth_full_weekend") {
    anchors = [nth(fullWeekendsInMonth(year, rule.month!), rule.n!)];
  } else if (kind === "nth_weekday") {
    anchors = [nth(weekdaysInMonth(year, rule.month!, rule.weekday!), rule.n!)];
  } else if (kind === "fixed_date") {
    anchors = [makeDate(year, rule.month!, rule.day!)];
  } else if (kind === "nearest_weekday") {
    // e.g. WIA Remembrance Day: "Weekend in August closest to the 15th".
    // Well defined in all seven cases and never ambiguous: the nearest
    // instance of a weekday is at most three days away, and a tie would
    // need a distance of 3.5, which does not exist because seven is odd.
    const target = makeDate(year, rule.month!, rule.day!);
    let shift = (((rule.weekday! - weekdayOf(target)) % 7) + 7) % 7; // 0..6, forwards
    if (shift > 3) shift -= 7; // ...or backwards, when that is the shorter way round
    anchors = [addDays(target, shift)];
  } else if (kind === "monthly_nth_weekday") {
    // e.g. ARS Spartan Sprint: first Monday of every month.
    anchors = [];
    const months = rule.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    for (const m of months) {
      try {
        anchors.push(nth(weekdaysInMonth(year, m, rule.weekday!), rule.n!));
      } catch {
        continue;
      }
    }
  } else if (kind === "weekly") {
    // e.g. CWops CWT: every Wednesday. `months` narrows it to a season
    // rather than the whole year -- NZART's sprints run "each Tuesday in
    // April and August" and on no other Tuesday. Same key, same meaning as
    // in monthly_nth_weekday.
    const inMonths = new Set(
      rule.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    anchors = [];
    let d = makeDate(year, 1, 1);
    while (weekdayOf(d) !== rule.weekday!) d = addDays(d, 1);
    while (d.getUTCFullYear() === year) {
      if (inMonths.has(d.getUTCMonth() + 1)) anchors.push(d);
      d = addDays(d, 7);
    }
  } else if (kind === "multi_weekend") {
    // e.g. Stew Perry Topband Challenge: several set weekends per year.
    anchors = rule.weekends!.map((spec) =>
      nth(fullWeekendsInMonth(year, spec.month), spec.n),
    );
  } else if (kind === "composite") {
    // A contest whose sessions follow DIFFERENT rules. NAQP RTTY is the
    // motivating case: the winter running starts on the last Saturday in
    // February, but the summer running is the third full weekend in July.
    // Those are genuinely different rule types, so nest them.
    anchors = [];
    for (const sub of rule.rules!) anchors.push(...resolveAnchors(sub, year));
  } else if (kind === "manual") {
    // Sponsor sets dates annually with no derivable rule (e.g. ARRL EME).
    const listed = rule.dates?.[String(year)] ?? [];
    anchors = listed.map((s) => {
      const [y, m, d] = s.split("-").map(Number);
      return makeDate(y, m, d);
    });
  } else {
    throw new Error(`unknown rule type: ${JSON.stringify(kind)}`);
  }

  if (anchors.length === 0) throw new NoAnchorsThisYear("rule produced no anchors");

  // Exclusions push an anchor forward a week. Used by ARRL RTTY Roundup,
  // whose rules state it is the first full weekend of January but never
  // falls on January 1.
  const excluded = new Set(
    (rule.exclude_dates ?? []).map(([m, d]) => `${m}-${d}`),
  );
  if (excluded.size > 0) {
    anchors = anchors.map((a) =>
      excluded.has(`${a.getUTCMonth() + 1}-${a.getUTCDate()}`)
        ? addDays(a, 7)
        : a,
    );
  }

  return anchors.sort((a, b) => a.getTime() - b.getTime());
}

/** Back-compat single-anchor accessor. */
export function resolveAnchor(rule: RecurrenceRule, year: number): Date {
  return resolveAnchors(rule, year)[0];
}

// --------------------------------------------------------------------------
// Occurrence expansion
// --------------------------------------------------------------------------

export interface OccurrenceInit {
  contest_id: string;
  name: string;
  start: Date | null;
  end: Date | null;
  start_wall?: Date | null;
  end_wall?: Date | null;
  local_rolling?: boolean;
  timezone_name?: string;
  modes?: string[];
  /** Free text, e.g. "PSK31". The specifics `modes` deliberately drops. */
  submodes?: string[];
  bands?: string[];
  /** The sponsor's own wording where a band list is a range or a suggestion. */
  bands_note?: string;
  sponsor?: string;
  rules_url?: string;
  verified?: boolean;
  note?: string;
  exchange?: string;
  country?: string;
  log_deadline_days?: number | null;
  rules_url_archived?: string;
  rules_url_checked?: string;
  can_enter?: boolean;
  eligibility_scope?: string;
  eligibility_reason?: string;
  works?: string;
  practical?: string;
}

export class Occurrence {
  contest_id: string;
  name: string;
  start: Date | null;
  end: Date | null;
  start_wall: Date | null;
  end_wall: Date | null;
  local_rolling: boolean;
  timezone_name: string;
  modes: string[];
  submodes: string[];
  bands: string[];
  bands_note: string;
  sponsor: string;
  rules_url: string;
  verified: boolean;
  note: string;
  exchange: string;
  country: string;
  log_deadline_days: number | null;
  rules_url_archived: string;
  rules_url_checked: string;
  can_enter: boolean;
  eligibility_scope: string;
  eligibility_reason: string;
  works: string;
  practical: string;

  constructor(init: OccurrenceInit) {
    this.contest_id = init.contest_id;
    this.name = init.name;
    this.start = init.start;
    this.end = init.end;
    this.start_wall = init.start_wall ?? null;
    this.end_wall = init.end_wall ?? null;
    this.local_rolling = init.local_rolling ?? false;
    this.timezone_name = init.timezone_name ?? "";
    this.modes = init.modes ?? [];
    this.submodes = init.submodes ?? [];
    this.bands = init.bands ?? [];
    this.bands_note = init.bands_note ?? "";
    this.sponsor = init.sponsor ?? "";
    this.rules_url = init.rules_url ?? "";
    this.verified = init.verified ?? false;
    this.note = init.note ?? "";
    this.exchange = init.exchange ?? "";
    this.country = init.country ?? "";
    this.log_deadline_days = init.log_deadline_days ?? null;
    this.rules_url_archived = init.rules_url_archived ?? "";
    this.rules_url_checked = init.rules_url_checked ?? "";
    this.can_enter = init.can_enter ?? true;
    this.eligibility_scope = init.eligibility_scope ?? "worldwide";
    this.eligibility_reason = init.eligibility_reason ?? "";
    this.works = init.works ?? "everyone";
    this.practical = init.practical ?? "";
  }

  /**
   * Log submission deadline, where the sponsor states one.
   *
   * Null for operator-anchored contests: the contest has no single UTC end,
   * so a deadline counted from it would be as fictional as the end itself.
   */
  get log_due(): Date | null {
    if (this.log_deadline_days === null || this.end === null) return null;
    return new Date(this.end.getTime() + this.log_deadline_days * DAY_MS);
  }

  /**
   * Length of the occurrence. Operator-anchored contests still have a well
   * defined duration -- 6am Saturday to midnight Sunday is the same span of
   * hours everywhere -- so fall back to the wall-clock pair.
   */
  get duration_hours(): number {
    const ms =
      this.start !== null && this.end !== null
        ? this.end.getTime() - this.start.getTime()
        : this.end_wall!.getTime() - this.start_wall!.getTime();
    return ms / 3_600_000;
  }

  /**
   * Calendar date the occurrence opens on. Well defined either way: a rolling
   * contest has no UTC instant but still starts on a known date.
   */
  get start_date(): string {
    return isoDate((this.start ?? this.start_wall)!);
  }

  /**
   * Ordering only -- NOT a claim about when this happens. A rolling contest's
   * wall time is treated as if it were UTC purely so a mixed schedule can be
   * sorted; never surface this value to a user.
   */
  get sort_key(): number {
    return (this.start ?? this.start_wall)!.getTime();
  }

  toDict(): Record<string, unknown> {
    const logDue = this.log_due;
    return {
      contest_id: this.contest_id,
      name: this.name,
      start: this.start ? formatInstant(this.start) : null,
      end: this.end ? formatInstant(this.end) : null,
      start_wall: this.start_wall ? formatNaive(this.start_wall) : null,
      end_wall: this.end_wall ? formatNaive(this.end_wall) : null,
      local_rolling: this.local_rolling,
      timezone: this.timezone_name,
      duration_hours: roundHalfEven(this.duration_hours, 2),
      modes: this.modes,
      submodes: this.submodes,
      bands: this.bands,
      bands_note: this.bands_note,
      sponsor: this.sponsor,
      rules_url: this.rules_url,
      verified: this.verified,
      note: this.note,
      exchange: this.exchange,
      country: this.country,
      rules_url_archived: this.rules_url_archived,
      rules_url_checked: this.rules_url_checked,
      can_enter: this.can_enter,
      eligibility_scope: this.eligibility_scope,
      eligibility_reason: this.eligibility_reason,
      works: this.works,
      practical: this.practical,
      log_due: logDue ? formatInstant(logDue) : null,
    };
  }
}

/** Python's datetime.isoformat() with +00:00 swapped for Z, seconds always shown. */
export function formatInstant(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

/** Python's naive datetime.isoformat() -- no offset, no zone, deliberately. */
export function formatNaive(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/**
 * Python's round() is banker's rounding, and duration_hours goes through it in
 * to_dict(). Matching it keeps the two engines byte-identical on output.
 */
function roundHalfEven(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (Math.abs(diff - 0.5) < Number.EPSILON * Math.abs(scaled)) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return rounded / factor;
}

/**
 * Naive clock reading for a time spec -- a date and a time with no zone.
 *
 * Deliberately zone-free: what this reading MEANS depends on the contest
 * (UTC, a sponsor's zone, or the operator's), and that decision belongs to the
 * caller rather than being baked in here. Carried as a Date whose UTC fields
 * hold the wall reading; never treat it as an instant.
 */
export function wallDatetime(anchor: Date, spec: TimeSpec): Date {
  let d = addDays(anchor, spec.day_offset ?? 0);
  const hhmm = spec.time;
  let hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(2));
  // 2400 is used by some sponsors to mean end-of-day; normalise it.
  if (hour === 24) {
    d = addDays(d, 1);
    hour = 0;
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute),
  );
}

function wallFieldsOf(d: Date): WallFields {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/**
 * Resolve a time spec to a real UTC instant.
 *
 * A `wall_clock` spec is read in the contest's `timezone` and converted, so the
 * same rule yields 0100Z in January and 0000Z in July. Everything else is
 * already UTC.
 *
 * On the two DST edges the resolution is pinned rather than left to chance: a
 * nonexistent spring-forward time resolves using the pre-transition offset, and
 * an ambiguous fall-back time takes the first (still-DST) pass. See zones.ts.
 */
export function applyOffset(
  anchor: Date,
  spec: TimeSpec,
  tzName?: string | null,
): Date {
  const naive = wallDatetime(anchor, spec);
  if (!spec.wall_clock) return naive;
  if (!tzName) {
    throw new Error(
      "time spec is marked wall_clock but the contest sets no 'timezone'; " +
        "refusing to guess a zone",
    );
  }
  return new Date(resolveWallClock(wallFieldsOf(naive), tzName));
}

/**
 * Expand one contest definition into ALL its occurrences in the given year.
 *
 * Returns an array because weekly and monthly contests occur many times per
 * year. Annual contests return a single-element array.
 */
export function expand(
  contest: Contest,
  year: number,
  myEntity = "K",
): Occurrence[] {
  if (year < (contest.active_from ?? 1900)) return [];
  if (year > (contest.active_until ?? 9999)) return [];

  let anchors: Date[];
  try {
    anchors = resolveAnchors(contest.recurrence, year);
  } catch (err) {
    // The contest does not run this year. A malformed rule is NOT caught
    // here -- it throws, rather than yielding a silently empty schedule.
    if (err instanceof NoAnchorsThisYear) return [];
    throw err;
  }

  // Some contests run several sessions off one anchor (e.g. CWops CWT runs
  // four sessions on the same day). Default is a single session.
  const sessions: Session[] = contest.sessions ?? [
    { start: contest.start, end: contest.end },
  ];

  const elig = eligibilityFor(contest, myEntity);

  const tzName = contest.timezone;
  const rolling = Boolean(contest.local_rolling);
  if (tzName && rolling) {
    throw new Error(
      `${contest.id}: sets both 'timezone' and 'local_rolling'. A contest ` +
        `is anchored to the SPONSOR's clock or to the OPERATOR's, not both.`,
    );
  }

  const out: Occurrence[] = [];
  for (const anchor of anchors) {
    for (const sess of sessions) {
      const startWall = wallDatetime(anchor, sess.start);
      const endWall = wallDatetime(anchor, sess.end);

      let start: Date | null;
      let end: Date | null;
      let reference: Date;

      if (rolling) {
        // No UTC instant exists for this contest -- see module docstring.
        start = null;
        end = null;
        reference = startWall;
        if (endWall.getTime() <= startWall.getTime()) {
          throw new Error(`${contest.id}: end not after start in ${year}`);
        }
      } else {
        start = applyOffset(anchor, sess.start, tzName);
        end = applyOffset(anchor, sess.end, tzName);
        reference = start;
        if (end.getTime() <= start.getTime()) {
          throw new Error(`${contest.id}: end not after start in ${year}`);
        }
      }

      // Keep occurrences inside the requested year.
      if (reference.getUTCFullYear() !== year) continue;

      out.push(
        new Occurrence({
          contest_id: contest.id,
          name: contest.name,
          start,
          end,
          // Wall readings are only meaningful when a zone other than UTC is in
          // play; leave them unset for ordinary contests.
          start_wall: rolling || tzName ? startWall : null,
          end_wall: rolling || tzName ? endWall : null,
          local_rolling: rolling,
          timezone_name: tzName ?? "",
          modes: contest.modes ?? [],
          submodes: contest.submodes ?? [],
          bands: contest.bands ?? [],
          bands_note: contest.bands_note ?? "",
          sponsor: contest.sponsor ?? "",
          rules_url: resolveRulesUrl(contest, year),
          verified: contest.verified ?? false,
          note: contest.note ?? "",
          exchange: contest.exchange ?? "",
          country: contest.country ?? "",
          log_deadline_days: contest.log_deadline_days ?? null,
          rules_url_archived: contest.rules_url_archived ?? "",
          rules_url_checked: contest.rules_url_checked ?? "",
          can_enter: elig.can_enter,
          eligibility_scope: elig.scope,
          eligibility_reason: elig.reason,
          works: elig.works,
          practical: elig.practical,
        }),
      );
    }
  }
  return out;
}

/** Expand a whole catalog into a chronologically sorted year of occurrences. */
export function expandYear(
  contests: Contest[],
  year: number,
  myEntity = "K",
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const c of contests) out.push(...expand(c, year, myEntity));
  out.sort((a, b) => {
    const d = a.sort_key - b.sort_key;
    if (d !== 0) return d;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}
