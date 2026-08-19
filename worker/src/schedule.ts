/**
 * Query layer over the recurrence engine.
 *
 * The engine expands a whole year at a time; everything a user asks for is a
 * slice of that. Years are memoised per isolate because expansion is
 * deterministic and pure -- same catalog, same year, same answer, forever.
 */

// Side-effect import, and the order matters: this pins the zone resolver at
// module scope. ES module evaluation runs it before anything below, so no
// expansion in this file can happen on an unpinned resolver.
import "./runtime.js";

import {
  expandYear,
  type Contest,
  type Occurrence,
  type RecurrenceRule,
  type Session,
  type TimeSpec,
} from "../../engine/src/recurrence.js";
import { CATALOG, contestById } from "./catalog.js";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Year cache
// ---------------------------------------------------------------------------

const yearCache = new Map<string, Occurrence[]>();

/** Wider than anyone will ask for, narrow enough that a bad query cannot make
 *  the Worker expand ten thousand years. */
export const MIN_YEAR = 1990;
export const MAX_YEAR = 2100;

export function occurrencesForYear(year: number, myEntity = "K"): Occurrence[] {
  if (year < MIN_YEAR || year > MAX_YEAR) return [];
  const key = `${year}:${myEntity}`;
  let cached = yearCache.get(key);
  if (!cached) {
    cached = expandYear(CATALOG, year, myEntity);
    yearCache.set(key, cached);
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Mode and band families
// ---------------------------------------------------------------------------

/**
 * A record says exactly what it is; the FILTER is what widens.
 *
 * Before 2026-08-16 this went the other way: `modeFamilies()` inflated each
 * record, so an RTTY contest carried `["RTTY", "Digital"]` and rendered as
 * "RTTY/Digital" -- a row claiming something the sponsor never said. Now
 * `modes` is the controlled set from `CATALOG_MODES` and a record is displayed
 * verbatim; only the query is widened, here.
 *
 * The relation below answers the question the brief asks: someone filtering
 * "Digital" expects FT8 results. They get them, and RTTY too, because both are
 * digital modes. Someone filtering "FT8/FT4" gets only FT8/FT4 -- the narrower
 * ask is honoured as asked. See FRONTEND_BRIEF.md, "Modes: FT8/FT4 is its own
 * mode AND a member of Digital".
 *
 * `Mixed` is on the right of every specific mode: a Mixed contest genuinely
 * permits CW, and a CW operator wants to see it. It is on the LEFT of nothing
 * but itself -- selecting "Mixed" means "contests where more than one mode
 * counts", which a CW-only contest is not.
 */
export const MODE_FAMILIES = ["CW", "SSB", "FM", "RTTY", "Digital", "FT8/FT4", "Mixed"] as const;
export type ModeFamily = (typeof MODE_FAMILIES)[number];

/** Filter token -> the record modes it accepts. */
const MODE_SUBSUMES: Record<ModeFamily, readonly ModeFamily[]> = {
  "CW": ["CW", "Mixed"],
  "SSB": ["SSB", "Mixed"],
  // FM is its own mode and NOT under SSB. The catalog used SSB as a general
  // phone token until 2026-08-19, which was fine while every phone contest
  // allowed SSB -- and stopped being fine at SARL's VHF/UHF FM Mode Contest,
  // which is FM only. Calling that SSB would state something the sponsor does
  // not permit, which is the one thing this table exists to prevent.
  "FM": ["FM", "Mixed"],
  "RTTY": ["RTTY", "Mixed"],
  "Digital": ["Digital", "RTTY", "FT8/FT4", "Mixed"],
  "FT8/FT4": ["FT8/FT4", "Mixed"],
  "Mixed": ["Mixed"],
};

/**
 * The filter tokens a record answers to -- the relation above, transposed.
 *
 * Kept as a projection rather than as a second hand-written table, so the two
 * directions cannot disagree. Published on the API as `mode_families`; the UI
 * shows `o.modes`, not this.
 */
export function modeFamilies(modes: string[]): ModeFamily[] {
  const recorded = new Set(modes.map((m) => m.trim()));
  return MODE_FAMILIES.filter((token) =>
    MODE_SUBSUMES[token].some((m) => recorded.has(m)),
  );
}

/**
 * Band families, low to high: the catalog's ladder with everything above 6m
 * collapsed to VHF+.
 *
 * The catalog records 2m, 70cm and 3cm separately -- see `CATALOG_BANDS` -- but
 * offering eighteen checkboxes to answer "what can I work this weekend" is
 * worse than offering twelve. VHF+ is where the collapse costs least: a station
 * equipped for 70cm is equipped for 2m, so the bands above 6m are one decision
 * for almost everyone. HF is not: 40m and 10m are different contests entirely.
 */
export const BAND_FAMILIES = [
  "160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "VHF+",
] as const;
export type BandFamily = (typeof BAND_FAMILIES)[number];

const HF_BANDS = new Set<string>(BAND_FAMILIES.slice(0, 11));

export function bandFamilies(bands: string[]): BandFamily[] {
  const out = new Set<BandFamily>();
  for (const raw of bands) {
    const b = raw.trim();
    if (HF_BANDS.has(b)) out.add(b as BandFamily);
    else out.add("VHF+"); // 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 3cm
  }
  return BAND_FAMILIES.filter((b) => out.has(b));
}

// ---------------------------------------------------------------------------
// Duration buckets
// ---------------------------------------------------------------------------

/**
 * "I have two hours free tonight" is the question no other contest calendar
 * can answer. These are the buckets that make it answerable.
 */
export const DURATION_BUCKETS = {
  "lt2": { label: "Under 2 hours", min: 0, max: 2 },
  "2-12": { label: "2 to 12 hours", min: 2, max: 12 },
  "12-24": { label: "12 to 24 hours", min: 12, max: 24 },
  "gte24": { label: "24 hours or more", min: 24, max: Infinity },
} as const;

export type DurationBucket = keyof typeof DURATION_BUCKETS;

export function durationBucketOf(hours: number): DurationBucket {
  if (hours < 2) return "lt2";
  if (hours < 12) return "2-12";
  if (hours < 24) return "12-24";
  return "gte24";
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface Filters {
  modes?: string[];
  bands?: string[];
  durations?: string[];
  sponsors?: string[];
  /**
   * Exact contest ids.
   *
   * Not a convenience for `q=`: `q` is a substring match, and five records in
   * the catalog have an id or a name that contains another one -- subscribing
   * to `q=bartg-sprint` silently hands you BARTG Sprint 75 and BARTG Sprint
   * PSK63 as well. A per-contest subscription that quietly carries a second
   * contest is the failure this project exists to avoid, so the detail view's
   * feed link names the record exactly.
   */
  ids?: string[];
  q?: string;
  /** Hide contests this entity cannot enter. Off by default: a contest you
   *  cannot ENTER is still one worth WORKING. */
  eligibleOnly?: boolean;
  entity?: string;
  verifiedOnly?: boolean;
}

function matchesQuery(o: Occurrence, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    o.name.toLowerCase().includes(needle) ||
    o.sponsor.toLowerCase().includes(needle) ||
    o.contest_id.toLowerCase().includes(needle)
  );
}

export interface FilterOutcome {
  kept: Occurrence[];
  /**
   * Contests dropped by a band filter ONLY because their bands are unrecorded,
   * by name, deduplicated.
   *
   * Empty `bands` means "we have not read this off the sponsor's page", not
   * "this contest uses no bands" -- the invariant is stated in both engines. So
   * every band filter necessarily hides such a record, and a calendar that
   * hides something silently is the exact failure this project exists to avoid.
   * The caller is expected to say so on the page.
   */
  unrecordedBands: string[];
}

/**
 * Filter, and account for what the band filter could not judge.
 *
 * `applyFilters` is the same pass without the accounting, for callers -- the
 * API, mostly -- that only want the rows.
 */
export function filterWithNotes(
  occurrences: Occurrence[],
  f: Filters,
): FilterOutcome {
  const wantModes = f.modes?.length
    ? new Set(f.modes.map((m) => m.toLowerCase()))
    : null;
  const wantBands = f.bands?.length
    ? new Set(f.bands.map((b) => b.toLowerCase()))
    : null;
  const wantDur = f.durations?.length ? new Set(f.durations) : null;
  const wantSponsors = f.sponsors?.length
    ? new Set(f.sponsors.map((s) => s.toLowerCase()))
    : null;
  const wantIds = f.ids?.length ? new Set(f.ids) : null;

  const kept: Occurrence[] = [];
  const unrecorded = new Set<string>();

  for (const o of occurrences) {
    if (wantIds && !wantIds.has(o.contest_id)) continue;
    if (wantModes) {
      const fams = modeFamilies(o.modes).map((m) => m.toLowerCase());
      if (!fams.some((m) => wantModes.has(m))) continue;
    }
    if (wantDur && !wantDur.has(durationBucketOf(o.duration_hours))) continue;
    if (wantSponsors && !wantSponsors.has(o.sponsor.toLowerCase())) continue;
    if (f.verifiedOnly && !o.verified) continue;
    if (f.eligibleOnly && !o.can_enter) continue;
    if (f.q && !matchesQuery(o, f.q)) continue;

    // Bands are tested last so the tally counts only contests the reader would
    // otherwise have seen. A CW contest excluded by a Digital filter is not
    // "hidden by missing data", and saying so would be noise.
    if (wantBands) {
      if (!o.bands.length) {
        unrecorded.add(o.name);
        continue;
      }
      const fams = bandFamilies(o.bands).map((b) => b.toLowerCase());
      if (!fams.some((b) => wantBands.has(b))) continue;
    }

    kept.push(o);
  }

  return { kept, unrecordedBands: [...unrecorded].sort() };
}

export function applyFilters(
  occurrences: Occurrence[],
  f: Filters,
): Occurrence[] {
  return filterWithNotes(occurrences, f).kept;
}

// ---------------------------------------------------------------------------
// Range queries
// ---------------------------------------------------------------------------

/**
 * The instant an occurrence occupies on a UTC timeline, for range tests.
 *
 * Operator-anchored (`local_rolling`) contests have no UTC instant by design.
 * They still happen on a known DATE, so range membership uses the wall reading
 * as a date-level approximation -- which is the most a rolling contest can
 * honestly support. `sort_key` carries the same caveat in the engine. Callers
 * must not surface these as instants; the row is tagged `local_rolling` so the
 * UI renders "06:00 your local time" instead of converting.
 */
function spanOf(o: Occurrence): { start: number; end: number } {
  const start = (o.start ?? o.start_wall)!.getTime();
  const end = (o.end ?? o.end_wall)!.getTime();
  return { start, end };
}

/**
 * Every occurrence overlapping [fromMs, toMs], inclusive.
 *
 * Expands one year either side of the requested range. The year BEFORE matters:
 * a contest opening 2200Z on 31 December belongs to that year's expansion but
 * runs into the next, and a naive "expand the years the range touches" drops it
 * from every New Year query.
 */
export function occurrencesInRange(
  fromMs: number,
  toMs: number,
  myEntity = "K",
): Occurrence[] {
  const firstYear = new Date(fromMs).getUTCFullYear() - 1;
  const lastYear = new Date(toMs).getUTCFullYear();

  const out: Occurrence[] = [];
  for (let y = firstYear; y <= lastYear; y++) {
    for (const o of occurrencesForYear(y, myEntity)) {
      const { start, end } = spanOf(o);
      if (end >= fromMs && start <= toMs) out.push(o);
    }
  }
  out.sort(bySortKeyThenName);
  return out;
}

function bySortKeyThenName(a: Occurrence, b: Occurrence): number {
  const d = a.sort_key - b.sort_key;
  if (d !== 0) return d;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The landing view
// ---------------------------------------------------------------------------

/**
 * The span of time the page is showing.
 *
 * `id` is the URL token that produced it, so the page can render the date-range
 * control as a set of links and the reader's choice survives a reload and the
 * back button without any script. An absent window is the default view --
 * "from now until the end of the month, or thirty days, whichever reaches
 * further" -- which is not expressible as a preset because its end depends on
 * what is in it.
 */
export interface RangeWindow {
  from: number;
  to: number;
  id: string;
  label: string;
  /**
   * The same span as a phrase that follows "No CW contests …".
   *
   * Kept beside the label rather than derived from it, because "Next 12 months"
   * and "1 Dec 2026 to 31 Dec 2026" need different prepositions and an empty
   * state that misnames the span the reader asked about is worse than none.
   */
  scope: string;
}

export interface NowView {
  now: number;
  /** The window actually rendered, default one included. */
  window: RangeWindow;
  live: Occurrence[];
  /**
   * The rail section. Empty AND not applicable when the window starts after
   * the coming week -- a reader who asked for December should not be told
   * nothing starts in the next seven days.
   */
  next7: Occurrence[];
  weekApplies: boolean;
  /** Rest of the window after the 7-day rail. On the default window: the rest
   *  of the current UTC month, or the next 30 days when that would be empty. */
  later: Occurrence[];
  laterLabel: string;
  laterRangeEnd: number;
  totalConsidered: number;
  /** Contests a band filter had to drop because their bands are unrecorded.
   *  The page says so rather than letting them vanish. */
  unrecordedBands: string[];
}

export function buildNowView(
  nowMs: number,
  filters: Filters = {},
  myEntity = "K",
  window?: RangeWindow,
): NowView {
  const now = new Date(nowMs);
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);

  // The default window has no single end: it reaches to the end of the month,
  // or thirty days, whichever is further, and then decides between them by
  // what it found. Presets are simply a `from`/`to` the reader chose instead.
  const isDefault = !window;
  const from = window ? window.from : nowMs;
  const to = window ? window.to : Math.max(monthEnd, nowMs + 30 * DAY_MS);

  // The rail only covers the seven days from now, so it applies only when the
  // window overlaps them. A window starting in December does not get a rail
  // section reporting that nothing starts this week.
  const weekEnd = Math.min(nowMs + 7 * DAY_MS, to);
  const weekApplies = from <= nowMs + 7 * DAY_MS && to > nowMs;

  // Pull the whole window once, then partition -- cheaper than three passes
  // and guarantees the buckets cannot disagree about an edge case. Reaching a
  // week back catches contests already running when the window opens.
  const outcome = filterWithNotes(
    occurrencesInRange(from - 7 * DAY_MS, to, myEntity),
    filters,
  );
  const all = outcome.kept;

  const live: Occurrence[] = [];
  const next7: Occurrence[] = [];
  const monthRest: Occurrence[] = [];
  const thirtyDays: Occurrence[] = [];
  const rest: Occurrence[] = [];

  for (const o of all) {
    const { start, end } = spanOf(o);
    if (end < from || start > to) continue;

    if (start <= nowMs && end > nowMs) {
      live.push(o);
    } else if (weekApplies && start > Math.max(nowMs, from) && start <= weekEnd) {
      next7.push(o);
    } else if (start > weekEnd && start >= from) {
      rest.push(o);
      if (start < monthEnd) monthRest.push(o);
      if (start <= nowMs + 30 * DAY_MS) thirtyDays.push(o);
    }
  }

  // Live contests sort by what ends soonest -- if you are deciding right now,
  // "closes in 40 minutes" is more urgent than "closes tomorrow".
  live.sort((a, b) => spanOf(a).end - spanOf(b).end);

  const useMonth = isDefault && monthRest.length > 0;
  const later = isDefault ? (useMonth ? monthRest : thirtyDays) : rest;
  const laterLabel = isDefault
    ? useMonth
      ? "Later this month"
      : "Next 30 days"
    : weekApplies
      ? `Rest of ${window!.label.toLowerCase()}`
      : window!.label;

  return {
    now: nowMs,
    window: window ?? {
      from,
      to: useMonth ? monthEnd : nowMs + 30 * DAY_MS,
      id: "",
      label: useMonth ? "This month" : "Next 30 days",
      scope: useMonth ? "this month" : "in the next 30 days",
    },
    live,
    next7,
    weekApplies,
    later,
    laterLabel,
    laterRangeEnd: isDefault ? (useMonth ? monthEnd : nowMs + 30 * DAY_MS) : to,
    totalConsidered: live.length + next7.length + later.length,
    unrecordedBands: outcome.unrecordedBands,
  };
}

// ---------------------------------------------------------------------------
// Date-range presets
// ---------------------------------------------------------------------------

/**
 * The ranges the page offers, as links rather than as a widget.
 *
 * Anchored on `now` rather than on calendar boundaries because the question is
 * "what can I work", and "the next 30 days" answers it on the 29th in a way
 * "this month" does not.
 */
export const RANGE_PRESETS: Record<string, { label: string; days: number }> = {
  "7d": { label: "Next 7 days", days: 7 },
  "30d": { label: "Next 30 days", days: 30 },
  "90d": { label: "Next 90 days", days: 90 },
  "365d": { label: "Next 12 months", days: 365 },
};

export function presetWindow(id: string, nowMs: number): RangeWindow | null {
  const p = RANGE_PRESETS[id];
  if (!p) return null;
  return {
    from: nowMs,
    to: nowMs + p.days * DAY_MS,
    id,
    label: p.label,
    scope: `in the ${p.label.toLowerCase()}`,
  };
}

// ---------------------------------------------------------------------------
// Per-contest lookup
// ---------------------------------------------------------------------------

/** The next `limit` occurrences of one contest at or after `fromMs`. */
export function nextOccurrences(
  contestId: string,
  fromMs: number,
  limit = 6,
  myEntity = "K",
): Occurrence[] {
  const startYear = new Date(fromMs).getUTCFullYear();
  const out: Occurrence[] = [];
  // Look ahead a few years: annual contests need only one, but a `manual`
  // record may have no dates published for the coming year and still resume.
  for (let y = startYear; y <= startYear + 4 && out.length < limit; y++) {
    for (const o of occurrencesForYear(y, myEntity)) {
      if (o.contest_id !== contestId) continue;
      if (spanOf(o).end < fromMs) continue;
      out.push(o);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export { contestById };

// ---------------------------------------------------------------------------
// Plain-language recurrence
// ---------------------------------------------------------------------------

const ORDINALS = ["", "First", "Second", "Third", "Fourth", "Fifth"];
const WEEKDAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday", "Sunday",
];
const MONTHS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  if (n >= 1) return ORDINALS[n] ?? `${n}th`;
  if (n === -1) return "Last";
  // BFRA states LZ DX as "the weekend before the last full weekend of
  // November" -- a rule with no forward ordinal, encoded as n = -2. Without
  // this branch `ORDINALS[-2]` is undefined and the phrase read "-2th full
  // weekend of November", which is worse than saying nothing.
  return `${ORDINALS[-n] ?? `${-n}th`}-to-last`;
}

/** "January, February and August" -- a list as someone would read it aloud. */
function joinList(parts: string[]): string {
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The exception clause, where a rule has one.
 *
 * `exclude_dates` is not "this contest skips that date" -- the engine pushes
 * the anchor a week forward instead, which is what ARRL's own rules say happens
 * when the first full weekend of January would open on the 1st. Stating only
 * the exclusion and not the shift would describe a rule the engine does not
 * implement.
 */
function exceptClause(rule: RecurrenceRule): string {
  const dates = rule.exclude_dates ?? [];
  if (!dates.length) return "";
  const when = joinList(dates.map(([m, d]) => `${d} ${MONTHS[m]}`));
  return `, except when that falls on ${when} — then the weekend after`;
}

/**
 * Render a recurrence rule the way a sponsor writes it.
 *
 * "Fourth full weekend of June" is genuinely useful and it is the one thing no
 * other contest calendar can show, because no other one stores rules -- they
 * store dates. Worth keeping faithful.
 */
export function describeRule(rule: RecurrenceRule): string {
  return `${describeAnchor(rule)}${exceptClause(rule)}`;
}

function describeAnchor(rule: RecurrenceRule): string {
  switch (rule.type) {
    case "nth_full_weekend":
      return `${ordinal(rule.n!)} full weekend of ${MONTHS[rule.month!]}`;
    case "nth_weekday":
      return `${ordinal(rule.n!)} ${WEEKDAYS[rule.weekday!]} of ${MONTHS[rule.month!]}`;
    case "fixed_date":
      return `${MONTHS[rule.month!]} ${rule.day}, every year`;
    // WIA's "weekend in August closest to the 15th". Missing from this switch
    // until the detail view put the rule on the page: it fell through to the
    // default and both API and page said "nearest_weekday" out loud.
    case "nearest_weekday":
      return `${WEEKDAYS[rule.weekday!]} nearest ${MONTHS[rule.month!]} ${rule.day}`;
    case "monthly_nth_weekday": {
      const when = `${ordinal(rule.n!)} ${WEEKDAYS[rule.weekday!]}`;
      if (!rule.months || rule.months.length === 12) return `${when} of every month`;
      return `${when} of ${joinList(rule.months.map((m) => MONTHS[m]))}`;
    }
    // NZART's sprints run "each Tuesday in April and August" -- the months were
    // being dropped here, so the phrase claimed a weekly contest that runs all
    // year. The rule the engine holds is the narrower one.
    case "weekly":
      return rule.months?.length && rule.months.length < 12
        ? `Every ${WEEKDAYS[rule.weekday!]} in ${joinList(rule.months.map((m) => MONTHS[m]))}`
        : `Every ${WEEKDAYS[rule.weekday!]}`;
    case "multi_weekend":
      return rule.weekends!
        .map((w) => `${ordinal(w.n)} full weekend of ${MONTHS[w.month]}`)
        .join(", and ");
    case "composite":
      return rule.rules!.map(describeRule).join(", and ");
    case "manual":
      return "Dates set by the sponsor each year (no derivable rule)";
    default:
      return rule.type;
  }
}

/**
 * The weekday a rule anchors on, where it has one.
 *
 * Only so the clock line can name the days: "0000Z Saturday → 2359Z Sunday"
 * rather than "0000Z → 2359Z the next day". `fixed_date` and `manual` anchor on
 * a date and genuinely have no weekday, and saying so is the honest answer --
 * guessing one from next year's occurrence would state a fact about the rule
 * that the rule does not contain.
 */
export function anchorWeekday(rule: RecurrenceRule): number | null {
  switch (rule.type) {
    // A full weekend is a Sat/Sun pair and the engine anchors it on the
    // Saturday; every offset in such a record is relative to that.
    case "nth_full_weekend":
    case "multi_weekend":
      return 5;
    case "nth_weekday":
    case "weekly":
    case "monthly_nth_weekday":
    case "nearest_weekday":
      return rule.weekday ?? null;
    case "composite": {
      const each = rule.rules!.map(anchorWeekday);
      return each.every((w) => w !== null && w === each[0]) ? each[0] : null;
    }
    default:
      return null;
  }
}

/** "Saturday", "Sunday", or "the next day" when the anchor has no weekday. */
function offsetDay(anchor: number | null, offset: number): string {
  if (anchor !== null) return WEEKDAYS[(((anchor + offset) % 7) + 7) % 7];
  if (offset === 0) return "";
  if (offset === 1) return "the next day";
  if (offset === -1) return "the day before";
  return offset > 0 ? `${offset} days later` : `${-offset} days earlier`;
}

/**
 * One running's clock, stated the way a rules page states it:
 * "0000Z Saturday → 2359Z Sunday".
 *
 * Reads the offsets rather than an expanded occurrence, because this describes
 * the RULE and must hold for every year. A `wall_clock` spec is rendered as a
 * bare reading with no `Z`, because it is not one -- the zone is named beside
 * it, and converting it here would be the category error the engine refuses.
 */
export function describeWindow(
  start: TimeSpec,
  end: TimeSpec,
  rule: RecurrenceRule,
): string {
  const anchor = anchorWeekday(rule);
  const clock = (s: TimeSpec) => `${s.time}${s.wall_clock ? "" : "Z"}`;
  const sDay = offsetDay(anchor, start.day_offset ?? 0);
  const eDay = offsetDay(anchor, end.day_offset ?? 0);

  if (sDay === eDay) {
    return sDay ? `${clock(start)} → ${clock(end)} ${sDay}` : `${clock(start)} → ${clock(end)}`;
  }
  const left = sDay ? `${clock(start)} ${sDay}` : clock(start);
  const right = eDay ? `${clock(end)} ${eDay}` : clock(end);
  return `${left} → ${right}`;
}

/**
 * The clock lines for a contest: one, or one per session.
 *
 * Several runnings off one anchor are `sessions` -- CWT's four hours in a day,
 * SST's Monday and Friday. A contest with sessions does not run from the first
 * session's start to the last one's end, so collapsing them to a single window
 * would overstate it by twenty hours.
 */
export function describeSchedule(contest: Contest): string[] {
  const sessions: Session[] | undefined = contest.sessions;
  if (sessions?.length) {
    return sessions.map((s) => describeWindow(s.start, s.end, contest.recurrence));
  }
  return [describeWindow(contest.start, contest.end, contest.recurrence)];
}

/** Every distinct sponsor in the catalog, for the filter UI. */
export function allSponsors(): string[] {
  return [...new Set(CATALOG.map((c: Contest) => c.sponsor ?? ""))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
