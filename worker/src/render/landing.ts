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

import type { Occurrence } from "../../../engine/src/recurrence.js";
import { CATALOG_SIZE } from "../catalog.js";
import {
  bandFamilies,
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
import { dayCellLabel } from "./daylabel.js";

const DAY_MS = 86_400_000;

export type RailWindow = { start: number; end: number; days: number };

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
    const label =
      o.modes.join("/") + (o.submodes.length ? ` (${o.submodes.join(", ")})` : "");
    parts.push(`<span class="mode">${esc(label)}</span>`);
  }

  const bands = bandFamilies(o.bands);
  if (bands.length) {
    // Contiguous runs collapse: 160m..10m reads "160-10m", not nine tokens.
    const label =
      bands.length > 2
        ? `${bands[0].replace(/m$/, "")}-${bands[bands.length - 1]}`
        : bands.join("/");
    parts.push(esc(label));
  }

  if (o.sponsor) parts.push(esc(o.sponsor));

  return parts.join('<span class="dot"> · </span>');
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
// The rail
// ---------------------------------------------------------------------------

/**
 * The rail's window: whole UTC days, starting at midnight today.
 *
 * Day-aligned rather than starting at `now`, because the cells are labelled
 * with day names and a cell labelled "Sat 15" that actually spans 02:12 Sat to
 * 02:12 Sun is a chart that lies. Eight cells, not seven: the section promises
 * a rolling seven days from this moment, so the last contest in it can land
 * anywhere inside the eighth calendar day.
 */
export function railWindow(nowMs: number): RailWindow {
  const d = new Date(nowMs);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = 8;
  return { start, end: start + days * DAY_MS, days };
}

/**
 * Where an instant sits across the rail: 0 at the window's left edge, 1 at its
 * right.
 *
 * The now-line, every bar and the day cells are all placed from this one
 * function, so "the same fraction" means the same offset in the same box. That
 * is the entire claim the chart makes, and it is only true if nothing else
 * computes a position of its own.
 */
export function railFraction(instantMs: number, win: RailWindow): number {
  return (instantMs - win.start) / (win.end - win.start);
}

/** Which day cell an instant lands in, 0-based; -1 outside the window. */
export function railSlot(instantMs: number, win: RailWindow): number {
  const f = railFraction(instantMs, win);
  if (f < 0 || f >= 1) return -1;
  return Math.floor(f * win.days);
}

/** Clamp a span to the window and express it as percentages of the window. */
function railGeometry(
  o: Occurrence,
  win: RailWindow,
): { left: number; width: number; clipL: boolean; clipR: boolean } {
  const { start, end } = spanOf(o);
  const s = Math.max(start.getTime(), win.start);
  const e = Math.min(end.getTime(), win.end);
  const left = railFraction(s, win);
  return {
    left: left * 100,
    width: Math.max(railFraction(e, win) - left, 0) * 100,
    clipL: start.getTime() < win.start,
    clipR: end.getTime() > win.end,
  };
}

function railRow(o: Occurrence, win: RailWindow): string {
  const g = railGeometry(o, win);
  const cls = ["bar", g.clipL ? "clip-l" : "", g.clipR ? "clip-r" : ""]
    .filter(Boolean)
    .join(" ");
  // Decorative: every fact it encodes is already in the text of the row.
  //
  // `data-d` is the row's own duration bucket and the stylesheet colours the
  // bar from it -- the rail's spectral ramp. Taken from `durationBucketOf()`
  // rather than recomputed from the geometry, because the geometry is CLAMPED
  // to the window: a 48-hour contest that starts on the last day of the rail
  // draws as a 12-hour sliver, and colouring it from what is drawn would tell
  // the reader it is a 12-hour contest. Colour states the contest; width states
  // the part of it you can see.
  return (
    `<div class="track" aria-hidden="true">` +
    `<div class="${cls}" data-d="${durationBucketOf(o.duration_hours)}" ` +
    `style="--s:${g.left.toFixed(3)}%;--w:${g.width.toFixed(3)}%"></div>` +
    `</div>`
  );
}

/**
 * The day labels, and the now-line, above the bars.
 *
 * The ruler is a sibling of the rows rather than their parent, so it carries no
 * width of its own: both read the `--axis` template in the stylesheet, which is
 * declared exactly once. Each cell also carries the UTC instant it starts at,
 * because the client relabels these in the reader's zone when the toggle flips
 * -- the cells stay where they are, being instants, and only their names change.
 */
function ruler(win: RailWindow, nowMs: number): string {
  const cells: string[] = [];
  for (let i = 0; i < win.days; i++) {
    const at = win.start + i * DAY_MS;
    const dow = new Date(at).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    cells.push(
      `<div class="ruler-day${weekend ? " we" : ""}" ` +
        `data-day="${isoAttr(new Date(at))}">` +
        `${esc(dayCellLabel(at, i, "UTC"))}</div>`,
    );
  }
  const nowPct = railFraction(nowMs, win) * 100;
  return (
    `<div class="ruler" aria-hidden="true">` +
    `<div class="ruler-pad"></div>` +
    `<div class="ruler-track">${cells.join("")}` +
    `<div class="now-line" style="left:${nowPct.toFixed(3)}%"></div>` +
    `</div>` +
    `<div class="ruler-pad"></div>` +
    `</div>`
  );
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
): string {
  const win = railWindow(nowMs);

  const body = next7.length
    ? `<div class="rail" style="--days:${win.days}">` +
      ruler(win, nowMs) +
      `<ol class="rows">` +
      next7
        .map((o) => {
          const { start } = spanOf(o);
          const rel = relative(start.getTime() - nowMs);
          return (
            `<li class="row">` +
            nameCell(o, params) +
            railRow(o, win) +
            `<div class="row-count${rel.soon ? " soon" : ""}" ` +
            `data-countdown="start" data-until="${isoAttr(start)}">` +
            `${esc(rel.text)}</div>` +
            `</li>`
          );
        })
        .join("") +
      `</ol></div>`
    : empty;

  return (
    `<section aria-labelledby="lg-week">` +
    `<h2 class="legend" id="lg-week">Next 7 days` +
    `<span class="count">${next7.length}</span></h2>` +
    body +
    `</section>`
  );
}

function laterSection(
  view: NowView,
  empty: string,
  params: URLSearchParams,
): string {
  if (!view.later.length) {
    return empty
      ? `<section aria-labelledby="lg-later">` +
        `<h2 class="legend" id="lg-later">${esc(view.laterLabel)}` +
        `<span class="count">0</span></h2>${empty}</section>`
      : "";
  }

  const rows = view.later
    .map((o) => {
      const { start } = spanOf(o);
      const rel = relative(start.getTime() - view.now);
      return (
        `<li class="row">` +
        nameCell(o, params) +
        `<div class="track" aria-hidden="true"></div>` +
        `<div class="row-count" data-countdown="start" ` +
        `data-until="${isoAttr(start)}">${esc(rel.text)}</div>` +
        `</li>`
      );
    })
    .join("");

  return (
    `<section aria-labelledby="lg-later">` +
    `<h2 class="legend" id="lg-later">${esc(view.laterLabel)}` +
    `<span class="count">${view.later.length}</span></h2>` +
    `<ol class="rows">${rows}</ol>` +
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

function sections(view: NowView, input: LandingInput): string {
  const { filters, params } = input;
  const nothing = view.totalConsidered === 0;
  const what = describeSelection(filters);

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
    (view.weekApplies ? weekSection(view.next7, view.now, weekEmpty, params) : "") +
    laterSection(view, laterEmpty, params)
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
