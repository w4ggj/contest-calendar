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
 * Catalog mode strings are not a controlled vocabulary -- `Digital` and
 * `DIGITAL` both appear, alongside PSK31, PSK63, RTTY75 and FT4. Filtering on
 * raw strings would put "Digital" and "DIGITAL" in different buckets, so map
 * to the families the brief actually asks users to filter by.
 *
 * The inconsistent casing is a real data defect, not something to paper over
 * here permanently. Recorded in FRONTEND_BRIEF.md under "Data gaps found while
 * building"; this mapping stays either way, because PSK31 genuinely is Digital.
 */
export const MODE_FAMILIES = ["CW", "SSB", "RTTY", "Digital", "FT8/FT4", "Mixed"] as const;
export type ModeFamily = (typeof MODE_FAMILIES)[number];

export function modeFamilies(modes: string[]): ModeFamily[] {
  const out = new Set<ModeFamily>();
  for (const raw of modes) {
    const m = raw.trim().toUpperCase();
    if (m === "CW") out.add("CW");
    else if (m === "SSB" || m === "PHONE") out.add("SSB");
    else if (m.startsWith("RTTY")) {
      out.add("RTTY");
      out.add("Digital");
    } else if (m === "FT8" || m === "FT4" || m === "FT8/FT4") {
      out.add("FT8/FT4");
      out.add("Digital");
    } else if (m === "MIXED") out.add("Mixed");
    else if (m.startsWith("PSK") || m === "DIGITAL" || m === "DIGI") {
      out.add("Digital");
    } else {
      // Unknown mode: file it under Digital only if it is clearly not phone or
      // CW. Better to leave it unfamilied than to mis-file it -- an unfamilied
      // contest still shows unfiltered, a mis-filed one shows under a filter it
      // does not belong to.
      continue;
    }
  }
  return [...out];
}

/** Band families, low to high. Everything above 6m collapses to VHF+. */
export const BAND_FAMILIES = [
  "160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "VHF+",
] as const;
export type BandFamily = (typeof BAND_FAMILIES)[number];

const HF_BANDS = new Set<string>(BAND_FAMILIES.slice(0, 10));

export function bandFamilies(bands: string[]): BandFamily[] {
  const out = new Set<BandFamily>();
  for (const raw of bands) {
    const b = raw.trim();
    if (HF_BANDS.has(b)) out.add(b as BandFamily);
    else out.add("VHF+"); // VHF+, 2m, 70cm, 222MHz+, 10GHz+
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

export function applyFilters(
  occurrences: Occurrence[],
  f: Filters,
): Occurrence[] {
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

  return occurrences.filter((o) => {
    if (wantModes) {
      const fams = modeFamilies(o.modes).map((m) => m.toLowerCase());
      if (!fams.some((m) => wantModes.has(m))) return false;
    }
    if (wantBands) {
      const fams = bandFamilies(o.bands).map((b) => b.toLowerCase());
      if (!fams.some((b) => wantBands.has(b))) return false;
    }
    if (wantDur && !wantDur.has(durationBucketOf(o.duration_hours))) return false;
    if (wantSponsors && !wantSponsors.has(o.sponsor.toLowerCase())) return false;
    if (f.verifiedOnly && !o.verified) return false;
    if (f.eligibleOnly && !o.can_enter) return false;
    if (f.q && !matchesQuery(o, f.q)) return false;
    return true;
  });
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

export interface NowView {
  now: number;
  live: Occurrence[];
  next7: Occurrence[];
  /** Rest of the current UTC month after the 7-day window, or the next 30 days
   *  when the month is nearly over and that would be empty. */
  later: Occurrence[];
  laterLabel: string;
  laterRangeEnd: number;
  totalConsidered: number;
}

export function buildNowView(
  nowMs: number,
  filters: Filters = {},
  myEntity = "K",
): NowView {
  const weekEnd = nowMs + 7 * DAY_MS;

  const now = new Date(nowMs);
  const monthEnd = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    1,
    0,
    0,
    0,
  );

  // Pull a generous window once, then partition -- cheaper than three passes
  // and guarantees the three buckets cannot disagree about an edge case.
  const horizon = Math.max(monthEnd, nowMs + 30 * DAY_MS);
  const all = applyFilters(occurrencesInRange(nowMs - 7 * DAY_MS, horizon, myEntity), filters);

  const live: Occurrence[] = [];
  const next7: Occurrence[] = [];
  const monthRest: Occurrence[] = [];
  const thirtyDays: Occurrence[] = [];

  for (const o of all) {
    const { start, end } = spanOf(o);
    if (start <= nowMs && end > nowMs) {
      live.push(o);
    } else if (start > nowMs && start <= weekEnd) {
      next7.push(o);
    } else if (start > weekEnd) {
      if (start < monthEnd) monthRest.push(o);
      if (start <= nowMs + 30 * DAY_MS) thirtyDays.push(o);
    }
  }

  // Live contests sort by what ends soonest -- if you are deciding right now,
  // "closes in 40 minutes" is more urgent than "closes tomorrow".
  live.sort((a, b) => spanOf(a).end - spanOf(b).end);

  const useMonth = monthRest.length > 0;
  return {
    now: nowMs,
    live,
    next7,
    later: useMonth ? monthRest : thirtyDays,
    laterLabel: useMonth ? "Later this month" : "Next 30 days",
    laterRangeEnd: useMonth ? monthEnd : nowMs + 30 * DAY_MS,
    totalConsidered: all.length,
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
  return n === -1 ? "Last" : (ORDINALS[n] ?? `${n}th`);
}

/**
 * Render a recurrence rule the way a sponsor writes it.
 *
 * "Fourth full weekend of June" is genuinely useful and it is the one thing no
 * other contest calendar can show, because no other one stores rules -- they
 * store dates. Worth keeping faithful.
 */
export function describeRule(rule: RecurrenceRule): string {
  switch (rule.type) {
    case "nth_full_weekend":
      return `${ordinal(rule.n!)} full weekend of ${MONTHS[rule.month!]}`;
    case "nth_weekday":
      return `${ordinal(rule.n!)} ${WEEKDAYS[rule.weekday!]} of ${MONTHS[rule.month!]}`;
    case "fixed_date":
      return `${MONTHS[rule.month!]} ${rule.day}, every year`;
    case "monthly_nth_weekday": {
      const when = `${ordinal(rule.n!)} ${WEEKDAYS[rule.weekday!]}`;
      if (!rule.months || rule.months.length === 12) return `${when} of every month`;
      return `${when} of ${rule.months.map((m) => MONTHS[m]).join(", ")}`;
    }
    case "weekly":
      return `Every ${WEEKDAYS[rule.weekday!]}`;
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

/** Every distinct sponsor in the catalog, for the filter UI. */
export function allSponsors(): string[] {
  return [...new Set(CATALOG.map((c: Contest) => c.sponsor ?? ""))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}
