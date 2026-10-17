/**
 * The Now / next-7-days landing view, rendered on the server.
 *
 * Server-rendered because the page's whole content is "what is true right now",
 * and because the brief asks for no spinner on the landing view. Every time is
 * emitted as UTC with a machine-readable `datetime`, so the page is correct and
 * complete with JavaScript disabled; the client script converts to the reader's
 * own zone and ticks the countdowns as an enhancement. That ordering is
 * deliberate -- a calendar that shows nothing until JS runs is a calendar that
 * shows nothing on a bad phone connection in a park.
 */

import { modeChips } from "./modes.js";
import type { Occurrence } from "../../../engine/src/recurrence.js";
import { CATALOG_SIZE } from "../catalog.js";
import {
  durationBucketOf,
  type Filters,
  type NowView,
} from "../schedule.js";
import {
  dxInRange,
  isApproximate,
  spanOf as dxSpan,
} from "../dx.js";
import {
  describeSelection,
  detailHref,
  emptyState,
  relink,
  renderFilters,
  unrecordedNote,
} from "./filters.js";
import { SITE_NAME, esc, masthead } from "./html.js";
import { pageLinks } from "./pages.js";
import { ICON_LINKS } from "./icon.js";
import { CSS } from "./theme.js";
import { CLIENT_JS, THEME_BOOT } from "./client.js";

const DAY_MS = 86_400_000;

export { esc };

// ---------------------------------------------------------------------------
// Time formatting -- UTC, spoken the way operators speak it
// ---------------------------------------------------------------------------

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "1800Z" -- the way it is written in every set of contest rules. */
export function zTime(d: Date): string {
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
}

/** "Sat 15 Aug" */
export function zDate(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function isoAttr(d: Date): string {
  return d.toISOString();
}

/** "12h", "1h 30m", "48h" -- compact, and never "0.5 hours". */
export function humanDuration(hours: number): string {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "in 3 hours", "in 4 days", "in 12 minutes" -- specific, per the brief. */
export function relative(ms: number): { text: string; soon: boolean } {
  const min = Math.round(ms / 60_000);
  if (min < 1) return { text: "any moment", soon: true };
  if (min < 60) return { text: `in ${min} min`, soon: true };
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    const rem = min % 60;
    return {
      text: rem ? `in ${hours}h ${rem}m` : `in ${hours}h`,
      soon: hours < 6,
    };
  }
  const days = Math.round(hours / 24);
  return { text: `in ${days} day${days === 1 ? "" : "s"}`, soon: false };
}

function endsIn(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min left`;
  const hours = Math.floor(min / 60);
  const rem = min % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m left` : `${hours}h left`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} left`;
}

// ---------------------------------------------------------------------------
// Row parts
// ---------------------------------------------------------------------------

function spanOf(o: Occurrence): { start: Date; end: Date } {
  return { start: (o.start ?? o.start_wall)!, end: (o.end ?? o.end_wall)! };
}

/** "CW · 160-10m · NCJ" -- the operator's own shorthand, not prose. */
function metaLine(o: Occurrence): string {
  const parts: string[] = [];

  // The record's own modes, verbatim. `modeFamilies()` is the FILTER's view --
  // it widens Digital to cover RTTY and FT8/FT4 -- and rendering it here made a
  // row read "RTTY/Digital" for a contest whose sponsor allows only RTTY.
  if (o.modes.length) {
    parts.push(`<span class="mode">${modeChips(o.modes, o.submodes)}</span>`);
  }

  if (o.bands.length) parts.push(esc(bandLabel(o.bands)));

  if (o.sponsor) parts.push(esc(o.sponsor));

  return parts.join('<span class="dot"> · </span>');
}

/**
 * The sponsor's bands as recorded, collapsed to a run when there are many:
 * "160-10m", "6m-3cm". Built from the catalog's own bands rather than the
 * filter's families so a 2m-and-70cm contest never reads as "2-Microwave".
 */
export function bandLabel(bands: string[]): string {
  if (bands.length <= 3) return bands.join("/");
  const first = bands[0];
  const last = bands[bands.length - 1];
  return `${/^\d+m$/.test(first) && /m$/.test(last) ? first.slice(0, -1) : first}-${last}`;
}

function whenLine(o: Occurrence): string {
  const { start, end } = spanOf(o);

  if (o.local_rolling) {
    // No UTC instant exists for this contest. Render the wall clock with a
    // marker and do NOT convert -- converting is the category error the engine
    // refuses to make. None in the catalog today; the model supports them.
    return (
      `<span class="rolling">${esc(zTime(start).replace("Z", ""))} ` +
      `your local time</span><span class="arrow"> → </span>` +
      `${esc(zTime(end).replace("Z", ""))} local` +
      `<span class="dot"> · </span><span class="dur">${esc(humanDuration(o.duration_hours))}</span>`
    );
  }

  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);

  return (
    `<time datetime="${isoAttr(start)}" data-t="start">` +
    `${esc(zTime(start))} ${esc(zDate(start))}</time>` +
    `<span class="arrow"> → </span>` +
    `<time datetime="${isoAttr(end)}" data-t="end">` +
    `${esc(zTime(end))}${sameDay ? "" : ` ${esc(zDate(end))}`}</time>` +
    `<span class="dot"> · </span>` +
    `<span class="dur">${esc(humanDuration(o.duration_hours))}</span>`
  );
}

function flags(o: Occurrence): string {
  const out: string[] = [];
  if (!o.verified) {
    out.push(
      `<span class="flag" title="These dates have not yet been checked ` +
        `against the sponsor's own published rules.">unverified</span>`,
    );
  }
  if (!o.can_enter) {
    out.push(
      `<span class="flag muted" title="${esc(o.eligibility_reason)}">` +
        `can't enter</span>`,
    );
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/**
 * The contest name links to this site's own detail view.
 *
 * **Changed 2026-08-19, and it reverses an earlier decision.** The name used to
 * link straight to the sponsor's rules in a new tab, on the reasoning that the
 * sponsor holds the rules and that leaving this site in place would throw away
 * the filtered view the reader built, which lives in the URL. Both halves of
 * that still hold -- and the detail view satisfies them better. It carries the
 * sponsor's rules link as the first thing on the page, so attribution is one
 * click rather than zero and far more prominent than a row could make it; and
 * because the destination is ours, the reader's query travels with them and
 * every link back restores their view rather than trusting the back button to
 * repopulate a form it often does not.
 *
 * The row keeps exactly ONE link, which is the other reason. The mobile pass
 * gave `.row-name a` a 44px `::after` hit area to make the smallest target on
 * the page thumb-sized; a second inline link in the same row would put two 44px
 * areas within a few pixels of each other and quietly undo that.
 */
function nameCell(o: Occurrence, params: URLSearchParams): string {
  return (
    `<div class="row-main">` +
    `<h3 class="row-name">` +
    `<a href="${esc(detailHref(o.contest_id, params))}">${esc(o.name)}</a>` +
    `${flags(o)}</h3>` +
    `<p class="row-meta">${metaLine(o)}</p>` +
    `<p class="row-when">${whenLine(o)}</p>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/*
 * Everything below the live cards is a table, grouped one row per contest.
 *
 * Why grouped: CWops Test is eight rows of a thirty-three-row page, the NCCC
 * sprints six, K1USN SST three -- about half the page was five contests
 * repeating. A contest is the thing a reader scans for; its sessions are a
 * detail of it, so they sit in the Date / Start / End / Starts-in cells, one
 * line each, and line up across those cells because every cell stacks the same
 * `.sess` blocks at the same height.
 *
 * The table is the wide layout. Below the breakpoint (theme.ts) it is hidden
 * and the same groups are shown as a card list, because nine columns do not fit
 * a phone and sideways scrolling is the failure being avoided. Both are always
 * in the markup: which one shows is a CSS decision, so there is no script that
 * must run before the page has a layout.
 */

export const SORT_KEYS = [
  "contest", "date", "start", "end", "duration", "mode", "band", "sponsor", "in",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface SortSpec {
  key: SortKey;
  dir: "asc" | "desc";
}
export const DEFAULT_SORT: SortSpec = { key: "date", dir: "asc" };

/** Sorting is links (`?sort=band&dir=desc`), so it works with JavaScript off and
 *  survives a reload. An unknown value falls back rather than 400ing: a stale
 *  bookmark should still show the schedule. */
export function parseSort(params: URLSearchParams): SortSpec {
  const key = params.get("sort");
  if (!key || !(SORT_KEYS as readonly string[]).includes(key)) return DEFAULT_SORT;
  return { key: key as SortKey, dir: params.get("dir") === "desc" ? "desc" : "asc" };
}

export interface ContestGroup {
  id: string;
  sessions: Occurrence[];
}

/** One group per contest, in order of each contest's first session. */
export function groupSessions(occs: Occurrence[]): ContestGroup[] {
  const byId = new Map<string, ContestGroup>();
  for (const o of occs) {
    const g = byId.get(o.contest_id);
    if (g) g.sessions.push(o);
    else byId.set(o.contest_id, { id: o.contest_id, sessions: [o] });
  }
  const groups = [...byId.values()];
  for (const g of groups) {
    g.sessions.sort((a, b) => spanOf(a).start.getTime() - spanOf(b).start.getTime());
  }
  return groups.sort(
    (a, b) =>
      spanOf(a.sessions[0]).start.getTime() - spanOf(b.sessions[0]).start.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function sortValue(g: ContestGroup, key: SortKey): string | number | null {
  const o = g.sessions[0];
  const { start, end } = spanOf(o);
  switch (key) {
    case "contest": return o.name.toLowerCase();
    case "date":
    case "in": return start.getTime();
    case "start": return start.getUTCHours() * 60 + start.getUTCMinutes();
    case "end": return end.getTime();
    case "duration": return o.duration_hours;
    case "mode": return o.modes.length ? o.modes.join("/").toLowerCase() : null;
    case "band": return o.bands.length ? bandLabel(o.bands) : null;
    case "sponsor": return o.sponsor ? o.sponsor.toLowerCase() : null;
  }
}

/** Unrecorded values sort last in BOTH directions: a gap in our data is not the
 *  smallest or the largest value of anything. */
export function sortGroups(groups: ContestGroup[], spec: SortSpec): ContestGroup[] {
  const sign = spec.dir === "desc" ? -1 : 1;
  return [...groups].sort((a, b) => {
    const va = sortValue(a, spec.key);
    const vb = sortValue(b, spec.key);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else {
      const c =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "en", { numeric: true });
      if (c) return c * sign;
    }
    return (
      spanOf(a.sessions[0]).start.getTime() - spanOf(b.sessions[0]).start.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  });
}

const COLUMNS: { key: SortKey; label: string; cls: string }[] = [
  { key: "contest", label: "Contest", cls: "c-name" },
  { key: "date", label: "Date", cls: "c-date" },
  { key: "start", label: "Start", cls: "c-start" },
  { key: "end", label: "End", cls: "c-end" },
  { key: "duration", label: "Duration", cls: "c-dur" },
  { key: "mode", label: "Mode", cls: "c-mode" },
  { key: "band", label: "Band", cls: "c-band" },
  { key: "sponsor", label: "Sponsor", cls: "c-sp" },
  { key: "in", label: "Starts in", cls: "c-in" },
];

export interface TableContext {
  now: number;
  params: URLSearchParams;
  /** Path the sort links point at: "/" or "/month". */
  base: string;
  /** Id of the section heading, so a sort click lands where it was made. */
  anchor: string;
  caption: string;
  /** Export bar shown above the table (see tableTools). */
  tools?: string;
}

function headCell(col: (typeof COLUMNS)[number], spec: SortSpec, ctx: TableContext): string {
  const active = spec.key === col.key;
  const nextDir = active && spec.dir === "asc" ? "desc" : "asc";
  const href =
    relink(ctx.params, [], { sort: col.key, dir: nextDir }, ctx.base) + `#${ctx.anchor}`;
  const aria = active ? ` aria-sort="${spec.dir === "asc" ? "ascending" : "descending"}"` : "";
  return (
    `<th scope="col" class="${col.cls}"${aria}>` +
    `<a href="${esc(href)}">${esc(col.label)}` +
    `<span class="sort-ind" aria-hidden="true">${active ? (spec.dir === "asc" ? " ▲" : " ▼") : " ⇅"}</span>` +
    `</a></th>`
  );
}

function sess(inner: string, cls = ""): string {
  return `<span class="sess${cls ? ` ${cls}` : ""}">${inner}</span>`;
}

function dateOf(o: Occurrence): string {
  const { start } = spanOf(o);
  // data-t="date": the client rewrites it to the reader's local date, which can
  // be a day away from the UTC one.
  return o.local_rolling
    ? esc(zDate(start))
    : `<time datetime="${isoAttr(start)}" data-t="date">${esc(zDate(start))}</time>`;
}

function startOf(o: Occurrence): string {
  const { start } = spanOf(o);
  return o.local_rolling
    ? `<span class="rolling">${esc(zTime(start).replace("Z", ""))} local</span>`
    : `<time datetime="${isoAttr(start)}" data-t="start">${esc(zTime(start))}</time>`;
}

function endOf(o: Occurrence): string {
  const { start, end } = spanOf(o);
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  return o.local_rolling
    ? `<span class="rolling">${esc(zTime(end).replace("Z", ""))} local</span>`
    : `<time datetime="${isoAttr(end)}" data-t="end">${esc(zTime(end))}` +
        `${sameDay ? "" : ` ${esc(zDate(end))}`}</time>`;
}

/** The countdown for one session. The page's states are all decided at render
 *  time; the client only ticks the ones that are still in the future. */
function startsIn(o: Occurrence, now: number): string {
  const { start, end } = spanOf(o);
  if (o.local_rolling) return sess("your local clock", "cd");
  if (end.getTime() <= now) return sess("ended", "cd");
  if (start.getTime() <= now) return sess("on the air now", "cd soon");
  const rel = relative(start.getTime() - now);
  return sess(
    esc(rel.text),
    `cd${rel.soon ? " soon" : ""}" data-countdown="start" data-until="${isoAttr(start)}`,
  );
}

/** Escaped, with a break opportunity after each slash so "SSB/CW/Digital" can
 *  fold onto two lines instead of setting the column's minimum width. */
function breakable(v: string): string {
  return esc(v).replace(/\//g, "/<wbr>");
}

function tableRow(g: ContestGroup, ctx: TableContext): string {
  const s = g.sessions;
  const o = s[0];
  const durations = s.map((x) => x.duration_hours);
  const sameDuration = durations.every((d) => d === durations[0]);
  const dur = (sameDuration ? [o] : s).map((x) => sess(esc(humanDuration(x.duration_hours))));

  return (
    `<tr class="crow">` +
    `<th scope="row" class="c-name"><span class="row-name">` +
    `<a href="${esc(detailHref(o.contest_id, ctx.params))}">${esc(o.name)}</a>` +
    `${flags(o)}</span>` +
    (s.length > 1 ? `<span class="nsess">${s.length} sessions</span>` : "") +
    `</th>` +
    `<td class="c-date">${s.map((x) => sess(dateOf(x))).join("")}</td>` +
    `<td class="c-start">${s.map((x) => sess(startOf(x))).join("")}</td>` +
    `<td class="c-end">${s.map((x) => sess(endOf(x))).join("")}</td>` +
    // data-d is the contest's bucket, from durationBucketOf -- the colour role.
    `<td class="c-dur" data-d="${durationBucketOf(o.duration_hours)}">${dur.join("")}</td>` +
    `<td class="c-mode">${
      o.modes.length ? modeChips(o.modes, o.submodes) : `<span class="nr">not recorded</span>`
    }</td>` +
    `<td class="c-band">${
      o.bands.length ? breakable(bandLabel(o.bands)) : `<span class="nr">not recorded</span>`
    }</td>` +
    `<td class="c-sp"><span class="clamp2" title="${esc(o.sponsor)}">${esc(o.sponsor)}</span></td>` +
    `<td class="c-in">${s.map((x) => startsIn(x, ctx.now)).join("")}</td>` +
    `</tr>`
  );
}

/** The phone layout of the same group: a card, its sessions as a list. */
function groupCard(g: ContestGroup, ctx: TableContext): string {
  const o = g.sessions[0];
  return (
    `<li class="gcard">` +
    `<h3 class="row-name"><a href="${esc(detailHref(o.contest_id, ctx.params))}">` +
    `${esc(o.name)}</a>${flags(o)}</h3>` +
    `<p class="row-meta">${metaLine(o)}</p>` +
    `<ul class="gsess">` +
    g.sessions
      .map(
        (x) =>
          `<li><span class="row-when">${whenLine(x)}</span>` +
          `${startsIn(x, ctx.now).replace('class="sess', 'class="gin')}</li>`,
      )
      .join("") +
    `</ul></li>`
  );
}

/**
 * Occurrences as a sortable, grouped table plus its card-list twin.
 * Returns "" for nothing; the caller owns the empty state.
 */
export function contestTable(occs: Occurrence[], ctx: TableContext): string {
  if (!occs.length) return "";
  const spec = parseSort(ctx.params);
  const groups = sortGroups(groupSessions(occs), spec);
  const note =
    occs.length === groups.length
      ? ""
      : `<p class="tbl-note">${occs.length} sessions across ${groups.length} contests; ` +
        `repeats share a row.</p>`;

  return (
    (ctx.tools ?? "") +
    note +
    `<div class="tbl-wrap"><table class="ctab">` +
    `<caption class="vh">${esc(ctx.caption)}</caption>` +
    `<thead><tr>${COLUMNS.map((c) => headCell(c, spec, ctx)).join("")}</tr></thead>` +
    `<tbody>${groups.map((g) => tableRow(g, ctx)).join("")}</tbody>` +
    `</table></div>` +
    `<ol class="gcards">${groups.map((g) => groupCard(g, ctx)).join("")}</ol>`
  );
}

/**
 * Export bar above the first table. CSV is a plain link; Print is a button
 * because it needs window.print, so it is revealed by script. Without script
 * the noscript line says what to do instead -- the print stylesheet applies to
 * the browser's own Print either way.
 */
export function tableTools(csvHref: string): string {
  return (
    `<p class="tbl-tools"><span class="tl">Export this view</span>` +
    `<a href="${esc(csvHref)}" download>CSV</a>` +
    `<button type="button" class="linkbtn" id="printbtn" hidden>Print</button>` +
    `<noscript><span class="tl">Print: use your browser's Print (Ctrl+P)</span></noscript></p>`
  );
}

/** Contests in a window, as a count of rows rather than of sessions. */
export function groupCount(occs: Occurrence[]): number {
  return new Set(occs.map((o) => o.contest_id)).size;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function liveSection(
  live: Occurrence[],
  nowMs: number,
  params: URLSearchParams,
): string {
  if (!live.length) return "";

  const rows = live
    .map((o) => {
      const { start, end } = spanOf(o);
      const total = end.getTime() - start.getTime();
      const pct = Math.min(
        100,
        Math.max(0, ((nowMs - start.getTime()) / total) * 100),
      );
      const left = end.getTime() - nowMs;

      return (
        `<li class="row live">` +
        nameCell(o, params) +
        `<div class="meter" aria-hidden="true">` +
        `<div class="meter-fill" style="--pct:${pct.toFixed(2)}%"></div>` +
        `<div class="meter-text">${pct.toFixed(0)}% elapsed</div>` +
        `</div>` +
        `<div class="row-count soon" data-countdown="end" ` +
        `data-until="${isoAttr(end)}">${esc(endsIn(left))}</div>` +
        `</li>`
      );
    })
    .join("");

  return (
    `<section aria-labelledby="lg-live">` +
    `<h2 class="legend on" id="lg-live">` +
    `<span class="lamp" aria-hidden="true"></span>On the air now` +
    `<span class="count">${live.length}</span></h2>` +
    `<ol class="rows">${rows}</ol>` +
    `</section>`
  );
}

function weekSection(
  next7: Occurrence[],
  nowMs: number,
  empty: string,
  params: URLSearchParams,
  tools = "",
): string {
  const body = next7.length
    ? contestTable(next7, {
        now: nowMs,
        params,
        base: "/",
        anchor: "lg-week",
        caption: "Contests starting in the next 7 days",
        tools,
      })
    : empty;

  return (
    `<section aria-labelledby="lg-week">` +
    `<h2 class="legend" id="lg-week">Next 7 days` +
    `<span class="count">${groupCount(next7)}</span></h2>` +
    body +
    `</section>`
  );
}

/** The way on from the "later" heading: the calendar for the month after the one
 *  the page is in, carrying the reader's filters. Always offered, including when
 *  the section is empty -- an empty heading with nowhere to go is a dead end. */
function nextMonthLink(view: NowView, params: URLSearchParams): string {
  const d = new Date(view.now);
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const m = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
  const name = n.toLocaleString("en", { month: "long", timeZone: "UTC" });
  return (
    `<a class="legend-link" href="${esc(relink(params, ["m", "sort", "dir"], { m }, "/month"))}">` +
    `${esc(name)} calendar →</a>`
  );
}

function laterSection(
  view: NowView,
  empty: string,
  params: URLSearchParams,
  tools = "",
): string {
  if (!view.later.length) {
    return empty
      ? `<section aria-labelledby="lg-later">` +
        `<h2 class="legend" id="lg-later">${esc(view.laterLabel)}` +
        `<span class="count">0</span>${nextMonthLink(view, params)}</h2>${empty}</section>`
      : "";
  }

  return (
    `<section aria-labelledby="lg-later">` +
    `<h2 class="legend" id="lg-later">${esc(view.laterLabel)}` +
    `<span class="count">${groupCount(view.later)}</span>${nextMonthLink(view, params)}</h2>` +
    contestTable(view.later, {
      now: view.now,
      params,
      base: "/",
      anchor: "lg-later",
      caption: view.laterLabel,
      tools,
    }) +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface LandingInput {
  filters: Filters;
  params: URLSearchParams;
  sponsors: string[];
  /**
   * This deployment's origin. Google's subscribe link is a URL on Google's
   * servers carrying ours as a parameter, so it cannot be relative. Taken from
   * the request so `wrangler dev` and production each describe themselves.
   */
  origin: string;
}

/*
 * THERE IS NO GOOGLE SUBSCRIBE LINK, AND THAT IS A TESTED FINDING.
 *
 * `calendar.google.com/calendar/r?cid=<percent-encoded https url>` is the
 * documented deep link for adding a calendar by URL, and it was shipped here on
 * 2026-08-21 in exactly that form — percent-encoded, https rather than webcal.
 * The owner tried it against a real Google account and Google answered
 * "unable to add to calendar". It was removed the same day.
 *
 * So: do not re-add it. It looks correct, it is the form every reference
 * describes, and it does not work. `noGoogleSubscribeDeepLink` in
 * pages.worker.test.ts fails the build if a `cid=` link reappears on any route.
 *
 * What DOES work, and is still here:
 *   - the add-one-event template link on /contest/:id (googleCalendarHref),
 *     confirmed working by the owner on the same pass;
 *   - pasting the feed address into Google's own Settings → Add calendar →
 *     From URL box, which is how the feed was verified end to end on
 *     2026-08-16 (699 events, instants, STATUS and TRANSP all intact).
 */

/**
 * The three sections, and the directions when a section is empty.
 *
 * Which section gets the full "here is what to change" empty state depends on
 * whether anything at all matched: if the week is quiet but next month is not,
 * the reader needs a pointer down the page, not an offer to widen a range that
 * already contains what they want.
 *
 * When nothing matched, the sentence names the whole window the reader asked
 * about rather than the seven-day rail it happens to sit in. Telling someone who
 * asked about the next twelve months that there is nothing "in the next 7 days"
 * answers a narrower question than the one they put in the URL, and implies
 * there might be something later when there is not.
 */
/**
 * DXpeditions overlapping the window this page is showing.
 *
 * A SECTION OF ITS OWN, not rows mixed into the contest list, and not a bar on
 * the seven-day rail. Three reasons, and the first two are the same ones that
 * kept them out of the contest catalog:
 *
 * A DXpedition is not a contest. Putting one in the "next 7 days" list would
 * make the count above it wrong -- that number says contests and a reader adds
 * it up. And the rail is a duration chart: a nineteen-day operation drawn on a
 * seven-day axis is a full-width bar that says nothing, while the whole point
 * of the ramp is that width and colour encode length.
 *
 * The third is that it is worth MORE prominence, not less. A contest comes
 * round next year; a rare entity may not be on the air again for a decade, and
 * an operation running right now is the most perishable thing this site knows.
 * So it sits directly under the contests that are live.
 *
 * DELIBERATELY NOT FILTERED. The filter panel is about contests -- its counts
 * say so -- and two things follow. A band filter would hide every DXpedition
 * here, because none has had its band plan read and empty means unrecorded, so
 * the reader would lose a rare entity over a gap in OUR coverage rather than
 * anything about the operation. And a mode filter would hide an operation
 * working four modes because the reader ticked one. The page says it is
 * unfiltered rather than leaving that to be discovered.
 */
function dxSection(
  view: NowView,
  params: URLSearchParams,
): string {
  const from = view.now;
  const to = Math.max(view.window.to, view.laterRangeEnd);
  const items = dxInRange(from, to);
  if (!items.length) return "";

  const rows = items
    .map((d) => {
      const { from: s, to: e } = dxSpan(d);
      const live = s <= view.now;
      const days = Math.max(1, Math.round((e + 1 - Math.max(s, view.now)) / DAY_MS));
      const when = live
        ? `<span class="dxrow-count soon">on the air now</span>`
        : `<span class="dxrow-count">${esc(relative(s - view.now).text)}</span>`;

      return (
        `<li class="dxrow${live ? " live" : ""}">` +
        `<p class="dxrow-name"><a href="${esc(relink(params, [], {}, "/dx"))}#${esc(d.id)}">` +
        `<span class="dx-call">${esc(d.callsign)}</span> ${esc(d.name)}</a>` +
        (isApproximate(d)
          ? `<span class="flag" title="The team published a departure and a ` +
            `duration rather than dates, so this window is derived from their ` +
            `own figures.">approximate dates</span>`
          : "") +
        `</p>` +
        `<p class="dxrow-meta">${esc(d.entity)}` +
        (d.iota ? `<span class="dot"> · </span>IOTA ${esc(d.iota)}` : "") +
        `<span class="dot"> · </span>${esc(d.team)}` +
        (d.modes.length ? `<span class="dot"> · </span>${esc(d.modes.join("/"))}` : "") +
        `</p>` +
        // NOT <time> elements, and that is the same rule `running()` follows for
        // a rolling contest. The client script converts every <time> it finds,
        // and a DXpedition has no instant to convert -- it is a range of whole
        // UTC days. A bare date would be parsed in the reader's own zone and
        // could land a day out; a fabricated T00:00:00Z would invent an hour the
        // team never published and render as "1:00 AM" somewhere.
        `<p class="dxrow-when">` +
        `<span class="dxd">${esc(d.start)}</span>` +
        `<span class="arrow"> → </span>` +
        `<span class="dxd">${esc(d.end)}</span>` +
        `<span class="dot"> · </span>` +
        `${days} day${days === 1 ? "" : "s"} ${live ? "left" : "long"}</p>` +
        when +
        `</li>`
      );
    })
    .join("");

  return (
    `<section aria-labelledby="lg-dx">` +
    `<h2 class="legend" id="lg-dx">DXpeditions` +
    `<span class="count">${items.length}</span></h2>` +
    `<p class="dx-note">Not contests, and not filtered by your selection above — ` +
    `a rare entity is worth seeing whichever mode you picked, and none of these ` +
    `has had its band plan read, so a band filter would hide them all over a gap ` +
    `in this catalog rather than anything about the operation. ` +
    `<a href="${esc(relink(params, [], {}, "/dx"))}">All DXpeditions</a>.</p>` +
    `<ul class="dxrows">${rows}</ul>` +
    `</section>`
  );
}

/**
 * Contests a band filter could not judge, listed instead of dropped.
 *
 * Same pattern as the DXpedition section: empty `bands` means unrecorded, so the
 * filter would otherwise hide a contest over a gap in our data. Rows are the
 * plain list style (no rail) because the section is not a duration chart, and
 * each row says it is not matched rather than implying the band is fine.
 */
function unrecordedSection(view: NowView, params: URLSearchParams): string {
  if (!view.unrecordedRows.length) return "";
  return (
    `<section aria-labelledby="lg-unrecorded">` +
    `<h2 class="legend" id="lg-unrecorded">Bands not recorded` +
    `<span class="count">${view.unrecordedRows.length}</span></h2>` +
    `<p class="dx-note">Shown whatever band you picked: we have not read these ` +
    `contests' bands off the sponsor's rules, so the band filter cannot say ` +
    `whether they match. Check the rules before you count on a band. ` +
    `<a href="${esc(relink(params, ["band", "bands"]))}">Clear the band filter</a>.</p>` +
    contestTable(view.unrecordedRows, {
      now: view.now,
      params,
      base: "/",
      anchor: "lg-unrecorded",
      caption: "Contests whose bands are not recorded",
    }) +
    `</section>`
  );
}

function sections(view: NowView, input: LandingInput): string {
  const { filters, params } = input;
  const nothing = view.totalConsidered === 0;
  const what = describeSelection(filters);
  const tools = tableTools(relink(params, ["sort", "dir"], {}, "/api/csv"));

  const weekEmpty = !view.weekApplies
    ? ""
    : nothing
      ? emptyState(filters, params, view, view.window.scope)
      : `<div class="empty">` +
        `<p>No ${esc(what)} in the next 7 days.</p>` +
        `<p>There ${view.later.length === 1 ? "is one" : `are ${view.later.length}`} ` +
        `${esc(view.laterLabel.toLowerCase())} — <a href="#lg-later">further down</a>.</p>` +
        `</div>`;

  const laterEmpty =
    nothing && !view.weekApplies
      ? emptyState(filters, params, view, view.window.scope)
      : "";

  return (
    liveSection(view.live, view.now, params) +
    // Directly under the live contests: an operation on the air right now is
    // the most perishable thing on this page.
    dxSection(view, params) +
    (view.weekApplies
      ? weekSection(view.next7, view.now, weekEmpty, params, view.next7.length ? tools : "")
      : "") +
    laterSection(view, laterEmpty, params, view.weekApplies && view.next7.length ? "" : tools) +
    unrecordedSection(view, params)
  );
}

export function renderLanding(view: NowView, input: LandingInput): string {
  const now = new Date(view.now);

  // "Contest calendar" says nothing about who it is for, and the title is what
  // a search result and a pasted link show. SITE_NAME carries the subject; the
  // live count goes in front of it, because a tab that reads "3 contests on the
  // air now" is the one useful thing this page can say from the tab strip.
  const title = view.live.length
    ? `${view.live.length} contest${view.live.length === 1 ? "" : "s"} on the air now · ${SITE_NAME}`
    : SITE_NAME;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${CATALOG_SIZE} amateur radio contests, year-round, with every date computed from the sponsor's own published rules. Local time, filters, month view and an iCal feed.">
<meta name="color-scheme" content="dark light">
${ICON_LINKS}
<link rel="alternate" type="text/calendar" href="/api/ics" title="Amateur radio contests">
<style>${CSS}</style>
<script>${THEME_BOOT}</script>
</head>
<body data-now="${isoAttr(now)}">
${masthead(true, "Skip to contests")}

<header class="readout">
  <div class="shell readout-grid">
    <div>
      <p class="utc" id="utc-readout">
        <span data-clock="utc">${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}</span><span class="z">Z</span>
      </p>
      <p class="utc-date" data-clock="utc-date">${esc(zDate(now))} ${now.getUTCFullYear()}</p>
    </div>
    <div class="local">
      <p class="local-time" data-clock="local"></p>
      <p class="local-label">
        <span data-clock="local-zone">Times below are UTC</span>
      </p>
      <ul class="tally">
        <li class="on"><b>${view.live.length}</b><span>on the air</span></li>
        <li><b>${view.next7.length}</b><span>next 7 days</span></li>
        <li><b>${view.later.length}</b><span>${esc(view.laterLabel.toLowerCase())}</span></li>
        <li class="tot"><b>${view.totalConsidered}</b><span>listed below</span></li>
      </ul>
      <p class="viewswitch"><a class="btn" href="${esc(
        relink(input.params, [], {}, "/month"),
      )}">Month view</a> <a class="btn" href="${esc(
        relink(input.params, [], {}, "/dx"),
      )}">DXpeditions</a></p>
      <div class="controls">
        <div class="tzbar" id="tzbar" hidden>
          <span>Show times in</span>
          <button type="button" class="tzbtn" data-tz="local" aria-pressed="false">Local</button>
          <button type="button" class="tzbtn" data-tz="utc" aria-pressed="true">UTC</button>
        </div>
        <div class="tzbar" id="themebar" hidden>
          <span>Display</span>
          <button type="button" class="thbtn" data-theme-set="auto" aria-pressed="true">Auto</button>
          <button type="button" class="thbtn" data-theme-set="light" aria-pressed="false">Light</button>
          <button type="button" class="thbtn" data-theme-set="dark" aria-pressed="false">Dark</button>
        </div>
      </div>
    </div>
  </div>
</header>

<main class="shell" id="main">
  ${renderFilters({ view, filters: input.filters, params: input.params, sponsors: input.sponsors })}
  ${unrecordedNote(view, input.params)}
  ${sections(view, input)}

  <footer class="foot">
    <p>Dates are computed from recurrence rules taken from each sponsor's own
    published rules — not copied from any third-party calendar. Anything marked
    <span class="flag">unverified</span> has not yet been checked against the
    sponsor's page; the contest link goes to the sponsor.</p>
    <p class="links">${pageLinks()}</p>
    <p class="links">
      <a href="/api/ics">Subscribe (iCal)</a>
      <a href="/api/contests?year=${now.getUTCFullYear()}">This year as JSON</a>
      <a href="/api/health">Health</a>
    </p>
    <p class="feed-note">Apple Calendar, Outlook and Thunderbird take that feed
    address directly. <strong>Google has no working one-click subscribe</strong>
    — paste <code class="feed">${esc(input.origin)}/api/ics</code> into Settings
    → Add calendar → <strong>From URL</strong>. Google then polls it on its own
    schedule, <strong>often 8–24 hours, and that cannot be forced</strong>, so a
    newly-added contest will not appear there straight away.</p>
    <p>Catalog published under CC BY 4.0.</p>
  </footer>
</main>

<script>${CLIENT_JS}</script>
</body>
</html>`;
}
