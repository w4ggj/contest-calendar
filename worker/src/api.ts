/**
 * JSON and iCal endpoints.
 *
 *   GET /api/health                     runtime + zone-resolver self-check
 *   GET /api/contests?from=&to=         occurrences in a date range
 *   GET /api/contests?year=2027         a whole year
 *   GET /api/contests/:id               one contest, its rule, next occurrences
 *   GET /api/search?q=                  name and sponsor search
 *   GET /api/ics                        iCal feed, same filters as the UI
 *
 * Every endpoint takes the same filter params (mode, band, duration, sponsor,
 * q) so a filtered view, a filtered API call and a filtered subscription are
 * the same query expressed three ways.
 */

import { buildIcs } from "./ics.js";
import { CATALOG, CATALOG_SIZE, CATALOG_VERSION } from "./catalog.js";
import {
  COMPATIBILITY_DATE,
  resolverSelfCheck,
  runtimeReport,
} from "./runtime.js";
import {
  allSponsors,
  applyFilters,
  BAND_FAMILIES,
  contestById,
  describeRule,
  DURATION_BUCKETS,
  MAX_YEAR,
  MIN_YEAR,
  MODE_FAMILIES,
  nextOccurrences,
  occurrencesForYear,
  occurrencesInRange,
  presetWindow,
  RANGE_PRESETS,
  type Filters,
  type RangeWindow,
} from "./schedule.js";
import { occurrenceToJson } from "./serialize.js";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly hint?: string) {
    super(message);
  }
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The catalog is published under CC BY -- the API is meant to be used.
      "access-control-allow-origin": "*",
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Cache headers.
 *
 * Expansion is deterministic, so a response is valid until the catalog changes.
 * But "now"-relative answers go stale on the clock, not on the catalog, so
 * anything anchored to the present gets a short TTL and everything else a long
 * one.
 */
function cacheable(seconds: number): Record<string, string> {
  return {
    "cache-control": `public, max-age=${seconds}, s-maxage=${seconds}`,
    "x-catalog-version": CATALOG_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

/** Repeatable OR comma-separated: `?mode=CW&mode=SSB` and `?mode=CW,SSB`. */
function multi(params: URLSearchParams, ...names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const raw of params.getAll(name)) {
      for (const piece of raw.split(",")) {
        const v = piece.trim();
        if (v) out.push(v);
      }
    }
  }
  return out;
}

function bool(params: URLSearchParams, name: string): boolean {
  const v = params.get(name);
  return v !== null && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

export function parseFilters(params: URLSearchParams): Filters {
  const modes = multi(params, "mode", "modes");
  const bands = multi(params, "band", "bands");
  const durations = multi(params, "duration", "durations");
  const sponsors = multi(params, "sponsor", "sponsors");

  // Reject unknown values rather than silently returning everything. A typo'd
  // `?mode=CQ` that quietly behaves like no filter at all is how someone
  // subscribes to a "CW only" feed and gets every contest in the catalog.
  const knownModes = new Set(MODE_FAMILIES.map((m) => m.toLowerCase()));
  for (const m of modes) {
    if (!knownModes.has(m.toLowerCase())) {
      throw new ApiError(
        400,
        `unknown mode: ${JSON.stringify(m)}`,
        `known modes: ${MODE_FAMILIES.join(", ")}`,
      );
    }
  }
  const knownBands = new Set(BAND_FAMILIES.map((b) => b.toLowerCase()));
  for (const b of bands) {
    if (!knownBands.has(b.toLowerCase())) {
      throw new ApiError(
        400,
        `unknown band: ${JSON.stringify(b)}`,
        `known bands: ${BAND_FAMILIES.join(", ")}`,
      );
    }
  }
  for (const d of durations) {
    if (!(d in DURATION_BUCKETS)) {
      throw new ApiError(
        400,
        `unknown duration bucket: ${JSON.stringify(d)}`,
        `known buckets: ${Object.keys(DURATION_BUCKETS).join(", ")}`,
      );
    }
  }

  return {
    modes,
    bands,
    durations,
    sponsors,
    q: params.get("q") ?? undefined,
    eligibleOnly: bool(params, "eligible"),
    verifiedOnly: bool(params, "verified"),
    entity: params.get("entity") ?? undefined,
  };
}

function parseDate(value: string, name: string): number {
  // Accept a plain date or a full instant. A plain date is read as UTC
  // midnight -- explicitly, because `new Date("2026-03-08")` being UTC while
  // `new Date("2026-03-08T00:00")` is local is the exact trap this project
  // spent a whole brief removing.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const iso = dateOnly.test(value) ? `${value}T00:00:00Z` : value;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new ApiError(
      400,
      `${name} is not a date: ${JSON.stringify(value)}`,
      "use YYYY-MM-DD or a full ISO-8601 instant ending in Z",
    );
  }
  return ms;
}

function parseYear(value: string): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new ApiError(
      400,
      `year out of range: ${JSON.stringify(value)}`,
      `expected an integer between ${MIN_YEAR} and ${MAX_YEAR}`,
    );
  }
  return year;
}

/**
 * Resolve the range a request is asking about.
 *
 * `?year=` wins, then `?from=`/`?to=`. With neither, the default is the next
 * 30 days from now -- the question people actually arrive with.
 */
export function resolveRange(
  params: URLSearchParams,
  nowMs: number,
): { from: number; to: number; kind: string; year?: number } {
  const yearParam = params.get("year");
  if (yearParam !== null) {
    const year = parseYear(yearParam);
    return {
      from: Date.UTC(year, 0, 1),
      to: Date.UTC(year, 11, 31, 23, 59, 59, 999),
      kind: "year",
      year,
    };
  }

  const fromParam = params.get("from");
  const toParam = params.get("to");
  if (fromParam !== null || toParam !== null) {
    const from = fromParam !== null ? parseDate(fromParam, "from") : nowMs;
    // A bare `to=2026-03-08` means through the END of that day, not its
    // midnight -- otherwise a single-day query returns nothing.
    const to =
      toParam !== null
        ? /^\d{4}-\d{2}-\d{2}$/.test(toParam)
          ? parseDate(toParam, "to") + DAY_MS - 1
          : parseDate(toParam, "to")
        : from + 30 * DAY_MS;
    if (to < from) {
      throw new ApiError(400, "`to` is before `from`");
    }
    if (to - from > 366 * 5 * DAY_MS) {
      throw new ApiError(
        400,
        "range too wide (max 5 years)",
        "request a year at a time with ?year=",
      );
    }
    return { from, to, kind: "range" };
  }

  return { from: nowMs, to: nowMs + 30 * DAY_MS, kind: "default" };
}

/**
 * The date range the PAGE is asking about, which is a narrower question than
 * the API's: it has a default worth keeping, and it has to name itself.
 *
 * Returns `undefined` for the default view, whose end is decided by what it
 * finds rather than by the query. `?from=`/`?to=` beat `?range=` when both are
 * present -- an explicit pair of dates is the more specific instruction.
 */
export function parsePageWindow(
  params: URLSearchParams,
  nowMs: number,
): RangeWindow | undefined {
  const fromParam = params.get("from");
  const toParam = params.get("to");

  if (fromParam || toParam) {
    const r = resolveRange(params, nowMs);
    return {
      from: r.from,
      to: r.to,
      id: "custom",
      label: `${utcDay(r.from)} to ${utcDay(r.to)}`,
      scope: `between ${utcDay(r.from)} and ${utcDay(r.to)}`,
    };
  }

  const rangeParam = params.get("range");
  if (!rangeParam) return undefined;

  const win = presetWindow(rangeParam, nowMs);
  if (!win) {
    throw new ApiError(
      400,
      `unknown range: ${JSON.stringify(rangeParam)}`,
      `known ranges: ${Object.keys(RANGE_PRESETS).join(", ")}`,
    );
  }
  return win;
}

/** "15 Aug 2026" -- for naming a window, not for a row. */
function utcDay(ms: number): string {
  const d = new Date(ms);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/health
 *
 * Reports which zone resolver is actually installed and proves it resolves the
 * DST edges correctly. Returns 503 when the self-check fails, because a Worker
 * quietly serving contest times through the wrong resolver is not healthy --
 * it is confidently wrong, which is worse than being down.
 */
export function handleHealth(): Response {
  const runtime = runtimeReport();
  const selfCheck = resolverSelfCheck();
  const ok = selfCheck.pass && runtime.intlAvailable;

  return json(
    {
      status: ok ? "ok" : "unhealthy",
      catalog: { contests: CATALOG_SIZE, version: CATALOG_VERSION },
      runtime,
      zoneResolverSelfCheck: selfCheck,
    },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

/** GET /api/contests */
export function handleContests(url: URL, nowMs: number): Response {
  const filters = parseFilters(url.searchParams);
  const range = resolveRange(url.searchParams, nowMs);

  const occurrences =
    range.kind === "year"
      ? applyFilters(occurrencesForYear(range.year!, filters.entity), filters)
      : applyFilters(occurrencesInRange(range.from, range.to, filters.entity), filters);

  return json(
    {
      query: {
        kind: range.kind,
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        ...(range.year ? { year: range.year } : {}),
        filters: describeFilters(filters),
      },
      count: occurrences.length,
      occurrences: occurrences.map(occurrenceToJson),
    },
    // A whole year is fixed until the catalog changes; a now-relative range
    // goes stale on the clock.
    { headers: cacheable(range.kind === "year" ? 86_400 : 300) },
  );
}

/** GET /api/contests/:id */
export function handleContest(id: string, url: URL, nowMs: number): Response {
  const contest = contestById(id);
  if (!contest) {
    throw new ApiError(404, `no contest with id ${JSON.stringify(id)}`, "GET /api/search?q= to find one");
  }

  const limit = Math.min(Number(url.searchParams.get("limit") ?? 6) || 6, 50);
  const upcoming = nextOccurrences(id, nowMs, limit);

  return json(
    {
      contest: {
        id: contest.id,
        name: contest.name,
        sponsor: contest.sponsor ?? "",
        sponsor_home: contest.sponsor_home ?? "",
        country: contest.country ?? "",
        summary: contest.summary ?? "",
        modes: contest.modes ?? [],
        bands: contest.bands ?? [],
        exchange: contest.exchange ?? "",
        power_categories: contest.power_categories ?? [],
        log_format: contest.log_format ?? "",
        log_deadline_days: contest.log_deadline_days ?? null,
        log_submit_url: contest.log_submit_url ?? "",
        timezone: contest.timezone ?? "",
        local_rolling: Boolean(contest.local_rolling),
        eligibility: contest.eligibility ?? { scope: "worldwide" },
        active_from: contest.active_from ?? null,
        active_until: contest.active_until ?? null,
        note: contest.note ?? "",
        // Provenance, which is the whole point of this project. Surfaced at the
        // top level rather than buried, including when it is unflattering.
        verified: Boolean(contest.verified),
        rules_url: contest.rules_url ?? "",
        rules_url_pattern: contest.rules_url_pattern ?? "",
        rules_url_archived: contest.rules_url_archived ?? "",
        rules_url_checked: contest.rules_url_checked ?? "",
        source_note: contest.source_note ?? "",
      },
      rule: {
        plain: describeRule(contest.recurrence),
        raw: contest.recurrence,
        start: contest.start,
        end: contest.end,
        sessions: contest.sessions ?? null,
      },
      next: upcoming.map(occurrenceToJson),
    },
    { headers: cacheable(3600) },
  );
}

/** GET /api/search?q= */
export function handleSearch(url: URL, nowMs: number): Response {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    throw new ApiError(400, "missing required parameter `q`", "try /api/search?q=sprint");
  }

  const needle = q.toLowerCase();
  const matches = CATALOG.filter(
    (c) =>
      c.name.toLowerCase().includes(needle) ||
      (c.sponsor ?? "").toLowerCase().includes(needle) ||
      c.id.toLowerCase().includes(needle),
  );

  // Exact-ish name matches first, then the rest alphabetically. Someone typing
  // "CQ WW" wants CQ WW, not the first CQ contest in catalog order.
  matches.sort((a, b) => {
    const rank = (c: typeof a) =>
      c.name.toLowerCase() === needle ? 0
      : c.name.toLowerCase().startsWith(needle) ? 1
      : c.name.toLowerCase().includes(needle) ? 2
      : 3;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });

  return json(
    {
      query: { q },
      count: matches.length,
      results: matches.map((c) => ({
        id: c.id,
        name: c.name,
        sponsor: c.sponsor ?? "",
        country: c.country ?? "",
        modes: c.modes ?? [],
        bands: c.bands ?? [],
        verified: Boolean(c.verified),
        rule: describeRule(c.recurrence),
        next: nextOccurrences(c.id, nowMs, 1).map(occurrenceToJson)[0] ?? null,
      })),
    },
    { headers: cacheable(3600) },
  );
}

/** GET /api/ics */
export function handleIcs(url: URL, nowMs: number): Response {
  const filters = parseFilters(url.searchParams);

  // A subscription is not a range query. The client refetches forever, so the
  // useful window is "recent past through a couple of years out" regardless of
  // when it is fetched -- the recent past because a contest that ended
  // yesterday should not vanish from the calendar you looked at this morning.
  const from = nowMs - 30 * DAY_MS;
  const to = nowMs + 730 * DAY_MS;

  const occurrences = applyFilters(
    occurrencesInRange(from, to, filters.entity),
    filters,
  );

  const label = describeFilters(filters);
  const name = label.length
    ? `Amateur Radio Contests (${label.join("; ")})`
    : "Amateur Radio Contests";

  const body = buildIcs(occurrences, {
    calendarName: name,
    now: new Date(nowMs),
  });

  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="contests.ics"',
      "access-control-allow-origin": "*",
      ...cacheable(3600),
    },
  });
}

/** GET /api/meta -- the vocabulary the filters accept. */
export function handleMeta(): Response {
  return json(
    {
      catalog: { contests: CATALOG_SIZE, version: CATALOG_VERSION },
      compatibility_date: COMPATIBILITY_DATE,
      modes: MODE_FAMILIES,
      bands: BAND_FAMILIES,
      durations: Object.entries(DURATION_BUCKETS).map(([id, d]) => ({
        id,
        label: d.label,
      })),
      ranges: Object.entries(RANGE_PRESETS).map(([id, r]) => ({
        id,
        label: r.label,
      })),
      sponsors: allSponsors(),
      license: "CC BY 4.0",
    },
    { headers: cacheable(3600) },
  );
}

function describeFilters(f: Filters): string[] {
  const parts: string[] = [];
  if (f.modes?.length) parts.push(f.modes.join("/"));
  if (f.bands?.length) parts.push(f.bands.join("/"));
  if (f.durations?.length) {
    parts.push(
      f.durations
        .map((d) => DURATION_BUCKETS[d as keyof typeof DURATION_BUCKETS]?.label ?? d)
        .join("/"),
    );
  }
  if (f.sponsors?.length) parts.push(f.sponsors.join("/"));
  if (f.q) parts.push(`"${f.q}"`);
  if (f.verifiedOnly) parts.push("verified only");
  if (f.eligibleOnly) parts.push("enterable only");
  return parts;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return json(
      { error: err.message, ...(err.hint ? { hint: err.hint } : {}) },
      { status: err.status, headers: { "cache-control": "no-store" } },
    );
  }
  // Anything else is a bug. Say so plainly and let the log carry the detail --
  // but never a stack trace in the body.
  console.error("unhandled error:", err);
  return json(
    { error: "internal error" },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}
