/**
 * The month grid: `/month`.
 *
 * The schedule at `/` answers "what can I work this weekend". This answers a
 * different question the same reader has: "I am free on the 14th and the 22nd —
 * is anything on?" A list cannot answer that at a glance and a grid can, which
 * is the whole reason this view exists.
 *
 * Four decisions here are load-bearing.
 *
 * **A contest appears in EVERY day it is running, not just the day it starts.**
 * CQ WW runs Saturday 0000Z to Sunday 2359Z. A reader who is free on the Sunday
 * needs to see it in Sunday's cell; a grid that only marks start days would
 * answer "no, nothing on Sunday" — which is false, and false in the exact way
 * this view was asked for to prevent. Continuation days are marked so the
 * repeat cannot be misread as a second running.
 *
 * **Cells are UTC days, and the page says so.** This site server-renders UTC and
 * converts times to local in the browser; a *cell assignment* cannot be
 * converted after the fact without rebuilding the grid, so converting the times
 * inside a UTC-bucketed cell would produce a row of local times sitting under
 * the wrong date. Sponsors publish in UTC, so UTC is also the honest bucket —
 * but a reader several zones away is entitled to know that, and the page tells
 * them rather than leaving it to be discovered.
 *
 * **Weeks start Monday.** Not the US convention, and chosen deliberately: it
 * keeps Saturday and Sunday adjacent. Nearly every contest in the catalog runs
 * across a weekend, and with a Sunday-first grid that weekend is split between
 * the last cell of one row and the first cell of the next — the one shape this
 * view exists to show, broken in half. Monday-first makes a weekend contest two
 * neighbouring cells.
 *
 * **It works with JavaScript off.** The grid is server-rendered HTML with real
 * links; nothing here depends on the client bundle.
 */

import type { Occurrence } from "../../../engine/src/recurrence.js";
import {
  type Filters,
  filterWithNotes,
  occurrencesInRange,
} from "../schedule.js";
import { detailHref, relink } from "./filters.js";
import { SITE_NAME, esc } from "./html.js";
import { isoAttr } from "./landing.js";
import { pageLinks } from "./pages.js";
import { ICON_LINKS } from "./icon.js";
import { CSS } from "./theme.js";
import { CLIENT_JS, THEME_BOOT } from "./client.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Monday first. See the header comment — this keeps the weekend together. */
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface MonthInput {
  /** Year and 1-based month the grid is showing. */
  year: number;
  month: number;
  nowMs: number;
  filters: Filters;
  params: URLSearchParams;
}

/**
 * Parse `?m=YYYY-MM`, or fall back to the month containing `nowMs`.
 *
 * Returns null for a malformed or out-of-range value rather than silently
 * showing a different month than the one asked for: a link that 400s is honest,
 * a link that quietly shows August when it said 2026-13 is not.
 */
export function parseMonth(
  raw: string | null,
  nowMs: number,
): { year: number; month: number } | null {
  if (!raw) {
    const d = new Date(nowMs);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (year < 1990 || year > 2100) return null;
  return { year, month };
}

/** `YYYY-MM`, for links. */
function monthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, by: number) {
  const i = (year * 12 + (month - 1)) + by;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** UTC midnight of a Y/M/D, as ms. */
function dayMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

/** 0=Mon .. 6=Sun, matching the engine's own weekday numbering. */
function mondayFirstIndex(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

const DAY = 86_400_000;

/**
 * Every UTC day an occurrence touches, as `YYYY-MM-DD` keys.
 *
 * A rolling contest has no instant and falls back to its wall reading, the same
 * way the schedule rows do. That is a wall clock rather than a UTC one, so the
 * day it lands in is approximate for such a record — but no record uses
 * `local_rolling` today, and dropping it from the grid entirely would be worse
 * than placing it on the day its own wall clock names.
 */
function daysTouched(o: Occurrence): string[] {
  const start = (o.start ?? o.start_wall)!;
  const end = (o.end ?? o.end_wall)!;
  const out: string[] = [];
  let t = Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
  );
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  // A guard, not an expectation: a malformed record with end before start would
  // otherwise spin here rather than fail visibly.
  for (let i = 0; t <= last && i < 400; i++, t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function timeLabel(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(
    d.getUTCMinutes(),
  ).padStart(2, "0")}Z`;
}

/**
 * One contest inside one day cell.
 *
 * `first` distinguishes the day it starts from the days it continues into. Both
 * are shown — see the header comment — but they are not the same fact, and a
 * reader scanning for "what starts on the 14th" should not have to guess.
 */
function entry(o: Occurrence, first: boolean, params: URLSearchParams): string {
  const start = (o.start ?? o.start_wall)!;
  const end = (o.end ?? o.end_wall)!;
  const span =
    `${esc(o.name)} — ${timeLabel(start)} ` +
    `${new Date(start).toISOString().slice(0, 10)} to ${timeLabel(end)} ` +
    `${new Date(end).toISOString().slice(0, 10)}`;

  return (
    `<li class="mo-ev${first ? "" : " cont"}${o.verified ? "" : " unver"}">` +
    `<a href="${esc(detailHref(o.contest_id, params))}" title="${span}">` +
    (first
      ? `<span class="mo-t">${esc(timeLabel(start))}</span>`
      : `<span class="mo-t cont-mark" aria-hidden="true">↳</span>` +
        `<span class="vh">continues: </span>`) +
    `<span class="mo-n">${esc(o.name)}</span></a></li>`
  );
}

function cell(
  key: string,
  day: number,
  weekday: number,
  inMonth: boolean,
  todayKey: string,
  events: { o: Occurrence; first: boolean }[],
  params: URLSearchParams,
): string {
  const classes = [
    "mo-day",
    weekday >= 5 ? "we" : "",
    inMonth ? "" : "out",
    key === todayKey ? "today" : "",
    events.length ? "has" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    `<td class="${classes}">` +
    `<p class="mo-dn"><time datetime="${key}">${day}</time>` +
    (key === todayKey ? `<span class="vh"> (today)</span>` : "") +
    (events.length
      ? `<span class="mo-c">${events.length}</span>`
      : "") +
    `</p>` +
    (events.length
      ? `<ul class="mo-evs">${events
          .map((e) => entry(e.o, e.first, params))
          .join("")}</ul>`
      : "") +
    `</td>`
  );
}

export function renderMonth(input: MonthInput): string {
  const { year, month, nowMs, filters, params } = input;

  const first = dayMs(year, month, 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = dayMs(year, month, daysInMonth) + DAY - 1;

  // The grid runs from the Monday on or before the 1st to the Sunday on or
  // after the last, so the leading and trailing cells belong to the
  // neighbouring months. Those are queried too -- a contest that starts on 31
  // August and runs into September must appear in the September grid's leading
  // cell, or the grid lies about the first week of the month.
  const gridStart = first - mondayFirstIndex(first) * DAY;
  const lastDayMs = dayMs(year, month, daysInMonth);
  const gridEnd = lastDayMs + (6 - mondayFirstIndex(lastDayMs)) * DAY + DAY - 1;

  const outcome = filterWithNotes(
    occurrencesInRange(gridStart, gridEnd, filters.entity ?? "K"),
    filters,
  );

  // day key -> the contests running that day, start days first.
  const byDay = new Map<string, { o: Occurrence; first: boolean }[]>();
  for (const o of outcome.kept) {
    const days = daysTouched(o);
    days.forEach((key, i) => {
      const list = byDay.get(key) ?? [];
      list.push({ o, first: i === 0 });
      byDay.set(key, list);
    });
  }
  for (const list of byDay.values()) {
    list.sort((a, b) =>
      a.first === b.first
        ? a.o.name < b.o.name
          ? -1
          : a.o.name > b.o.name
            ? 1
            : 0
        : a.first
          ? -1
          : 1,
    );
  }

  const todayKey = new Date(nowMs).toISOString().slice(0, 10);
  const rows: string[] = [];
  for (let t = gridStart; t <= gridEnd; t += 7 * DAY) {
    const cells: string[] = [];
    for (let d = 0; d < 7; d++) {
      const ms = t + d * DAY;
      const date = new Date(ms);
      const key = date.toISOString().slice(0, 10);
      cells.push(
        cell(
          key,
          date.getUTCDate(),
          d,
          date.getUTCMonth() + 1 === month && date.getUTCFullYear() === year,
          todayKey,
          byDay.get(key) ?? [],
          params,
        ),
      );
    }
    rows.push(`<tr>${cells.join("")}</tr>`);
  }

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const nowM = new Date(nowMs);
  const thisMonth = { year: nowM.getUTCFullYear(), month: nowM.getUTCMonth() + 1 };
  const link = (y: number, m: number) =>
    esc(relink(params, [], { m: monthParam(y, m) }, "/month"));

  const shown = outcome.kept.length;
  const title = `${MONTHS[month - 1]} ${year}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(SITE_NAME)}</title>
<meta name="description" content="Every amateur radio contest running in ${esc(
    title,
  )}, laid out as a month grid so you can see which days and weekends are busy.">
<meta name="color-scheme" content="dark light">
${ICON_LINKS}
<link rel="alternate" type="text/calendar" href="/api/ics" title="Amateur radio contests">
<style>${CSS}</style>
<script>${THEME_BOOT}</script>
</head>
<body data-now="${isoAttr(new Date(nowMs))}">
<main class="shell doc" id="main">
  <p class="backlink"><a href="${esc(relink(params, ["m"], {}, "/"))}">← Back to the schedule</a></p>

  <div class="mo-head">
    <h1>${esc(title)}</h1>
    <p class="mo-nav">
      <a class="btn" href="${link(prev.year, prev.month)}" rel="prev">← ${esc(
        MONTHS[prev.month - 1],
      )}</a>
      ${
        year === thisMonth.year && month === thisMonth.month
          ? ""
          : `<a class="btn ghost" href="${link(
              thisMonth.year,
              thisMonth.month,
            )}">This month</a>`
      }
      <a class="btn" href="${link(next.year, next.month)}" rel="next">${esc(
        MONTHS[next.month - 1],
      )} →</a>
    </p>
  </div>

  <p class="mo-sub">${shown} contest${shown === 1 ? "" : "s"} running this month.
  <strong>Days are UTC</strong> — a contest opening 2200Z sits on the UTC date,
  which may be the evening before where you are. Times shown are UTC too; a
  contest running across midnight appears on every day it is on the air, with
  <span class="cont-mark" aria-hidden="true">↳</span> marking the days it
  continues into rather than starts.</p>

  ${
    outcome.unrecordedBands.length
      ? `<p class="caveat">Hidden by the band filter because this catalog has not
         recorded their bands yet, not because they do not use them:
         ${esc(outcome.unrecordedBands.join(", "))}.</p>`
      : ""
  }

  <div class="mo-wrap">
  <table class="mo-grid">
    <caption class="vh">Contests in ${esc(title)}, by day</caption>
    <thead><tr>${DAY_NAMES.map(
      (d, i) =>
        `<th scope="col" class="${i >= 5 ? "we" : ""}"><abbr title="${d}day">${d}</abbr></th>`,
    ).join("")}</tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>
  </div>

  <footer class="foot">
    <p>Dates are computed from recurrence rules taken from each sponsor's own
    published rules — not copied from any third-party calendar.</p>
    <p class="links">${pageLinks()}</p>
  </footer>
</main>

<script>${CLIENT_JS}</script>
</body>
</html>`;
}
