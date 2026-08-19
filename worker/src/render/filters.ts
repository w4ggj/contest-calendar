/**
 * The filter panel, and the directions shown when it finds nothing.
 *
 * A plain `<form method="get" action="/">`. That single choice satisfies four
 * of the brief's requirements at once and satisfies them for a reader with
 * JavaScript disabled: submitting writes the state into the URL, so the view is
 * shareable; reloading re-reads it; the back button walks the history the
 * browser already kept; and none of it needs a script. `client.ts` adds exactly
 * one thing on top -- submitting on change, so the Apply button is not
 * necessary -- and the page is identical without it.
 *
 * Every control's `name` is the same one the API takes, so the URL in the
 * address bar is also a valid `/api/contests` query and a valid `/api/ics`
 * subscription. The "Subscribe to this view" link at the foot of the panel is
 * that fact made visible.
 */

import {
  BAND_FAMILIES,
  contestById,
  DURATION_BUCKETS,
  MODE_FAMILIES,
  RANGE_PRESETS,
  type Filters,
  type NowView,
} from "../schedule.js";
import { esc } from "./html.js";

// ---------------------------------------------------------------------------
// Query strings
// ---------------------------------------------------------------------------

function href(base: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

/**
 * A link that keeps the reader's current query except `drop`, then sets `set`.
 *
 * Every link the page offers -- widen the range, drop the mode filter,
 * subscribe to this view -- is built here, so a suggestion can never silently
 * discard the rest of what someone asked for.
 */
export function relink(
  params: URLSearchParams,
  drop: string[],
  set: Record<string, string> = {},
  base = "/",
): string {
  const out = new URLSearchParams();
  const dropped = new Set([...drop, ...Object.keys(set)]);
  for (const [k, v] of params) {
    if (dropped.has(k) || !v) continue;
    out.append(k, v);
  }
  for (const [k, v] of Object.entries(set)) if (v) out.append(k, v);
  return href(base, out);
}

/**
 * A row's link to the contest detail view, carrying the reader's query.
 *
 * Lives here rather than in `detail.ts` because the landing view needs it and
 * `detail.ts` needs the landing view's time formatting -- and a cycle between
 * two renderers works until a bundler picks an evaluation order. `html.ts`
 * exists for the same reason.
 *
 * The query travels so that arriving from a filtered schedule and going back to
 * it is lossless without relying on the back button to restore form state.
 */
export function detailHref(id: string, params: URLSearchParams): string {
  return relink(params, [], {}, `/contest/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function chips(
  name: string,
  options: readonly { value: string; label: string }[],
  selected: Set<string>,
): string {
  return options
    .map((o) => {
      const on = selected.has(o.value.toLowerCase());
      const id = `f-${name}-${o.value.replace(/[^a-z0-9]/gi, "")}`.toLowerCase();
      return (
        `<span class="chip${on ? " on" : ""}">` +
        `<input type="checkbox" id="${esc(id)}" name="${esc(name)}" ` +
        `value="${esc(o.value)}"${on ? " checked" : ""}>` +
        `<label for="${esc(id)}">${esc(o.label)}</label>` +
        `</span>`
      );
    })
    .join("");
}

function fieldset(legend: string, body: string): string {
  return (
    `<fieldset class="fs">` +
    `<legend>${esc(legend)}</legend>` +
    `<div class="chips">${body}</div>` +
    `</fieldset>`
  );
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface FilterPanelInput {
  view: NowView;
  filters: Filters;
  params: URLSearchParams;
  sponsors: string[];
}

/** How many facets the reader has narrowed by. Drives the summary line. */
export function activeCount(filters: Filters, params: URLSearchParams): number {
  let n = 0;
  if (filters.modes?.length) n++;
  if (filters.bands?.length) n++;
  if (filters.durations?.length) n++;
  if (filters.sponsors?.length) n++;
  if (filters.q?.trim()) n++;
  if (params.get("range") || params.get("from") || params.get("to")) n++;
  return n;
}

export function renderFilters(input: FilterPanelInput): string {
  const { view, filters, params, sponsors } = input;

  const lower = (xs?: string[]) =>
    new Set((xs ?? []).map((x) => x.toLowerCase()));

  const active = activeCount(filters, params);
  const rangeId = view.window.id;

  const rangeChips = [{ value: "", label: "Default" }, ...Object.entries(RANGE_PRESETS).map(
    ([id, r]) => ({ value: id, label: r.label }),
  )]
    .map((o) => {
      const on = o.value === rangeId || (o.value === "" && rangeId === "");
      const id = `f-range-${o.value || "default"}`;
      return (
        `<span class="chip${on ? " on" : ""}">` +
        `<input type="radio" id="${esc(id)}" name="range" value="${esc(o.value)}"` +
        `${on ? " checked" : ""}>` +
        `<label for="${esc(id)}">${esc(o.label)}</label>` +
        `</span>`
      );
    })
    .join("");

  const custom = rangeId === "custom";

  return (
    `<details class="panel"${active ? " open" : ""}>` +
    `<summary>` +
    `<span class="panel-title">Filters</span>` +
    `<span class="panel-state">${
      active
        ? `${active} active<span class="dot"> · </span>${view.totalConsidered} contest${
            view.totalConsidered === 1 ? "" : "s"
          }`
        : "All contests"
    }</span>` +
    `</summary>` +

    `<form class="filters" method="get" action="/" role="search">` +

    `<div class="f-search">` +
    `<label for="f-q">Search name or sponsor</label>` +
    `<input type="search" id="f-q" name="q" value="${esc(filters.q ?? "")}" ` +
    `placeholder="sprint, CQ, RSGB…" autocomplete="off">` +
    `</div>` +

    fieldset(
      "Mode",
      chips(
        "mode",
        MODE_FAMILIES.map((m) => ({ value: m, label: m })),
        lower(filters.modes),
      ),
    ) +

    fieldset(
      "Band",
      chips(
        "band",
        BAND_FAMILIES.map((b) => ({ value: b, label: b })),
        lower(filters.bands),
      ),
    ) +

    fieldset(
      "I have",
      chips(
        "duration",
        Object.entries(DURATION_BUCKETS).map(([id, d]) => ({
          value: id,
          label: d.label,
        })),
        new Set(filters.durations ?? []),
      ),
    ) +

    fieldset("Dates", rangeChips) +

    `<div class="f-dates${custom ? " on" : ""}">` +
    `<span class="f-dates-label">or a specific span</span>` +
    `<label for="f-from">From</label>` +
    `<input type="date" id="f-from" name="from" value="${
      custom ? esc(isoDay(view.window.from)) : ""
    }">` +
    `<label for="f-to">To</label>` +
    `<input type="date" id="f-to" name="to" value="${
      custom ? esc(isoDay(view.window.to)) : ""
    }">` +
    `</div>` +

    `<div class="f-sponsor">` +
    `<label for="f-sponsor">Sponsor</label>` +
    `<select id="f-sponsor" name="sponsor">` +
    `<option value="">Any sponsor</option>` +
    sponsors
      .map((s) => {
        const on = (filters.sponsors ?? []).some(
          (x) => x.toLowerCase() === s.toLowerCase(),
        );
        return `<option value="${esc(s)}"${on ? " selected" : ""}>${esc(s)}</option>`;
      })
      .join("") +
    `</select>` +
    `</div>` +

    `<div class="f-actions">` +
    `<button type="submit" class="btn primary">Apply</button>` +
    (active ? `<a class="btn" href="/">Clear all</a>` : "") +
    `<a class="btn ghost" href="${esc(
      relink(params, [], {}, "/api/ics"),
    )}">Subscribe to this view</a>` +
    `</div>` +

    `</form>` +
    `</details>`
  );
}

// ---------------------------------------------------------------------------
// Empty states are directions, not apologies
// ---------------------------------------------------------------------------

/** "No RTTY contests" -- the reader's own filters read back to them. */
export function describeSelection(filters: Filters): string {
  const bits: string[] = [];
  if (filters.modes?.length) bits.push(filters.modes.join("/"));
  if (filters.bands?.length) bits.push(filters.bands.join("/"));
  if (filters.durations?.length) {
    bits.push(
      filters.durations
        .map((d) => DURATION_BUCKETS[d as keyof typeof DURATION_BUCKETS]?.label ?? d)
        .join(" or ")
        .toLowerCase(),
    );
  }
  if (filters.sponsors?.length) bits.push(filters.sponsors.join("/"));
  if (filters.ids?.length) {
    bits.push(filters.ids.map((id) => contestById(id)?.name ?? id).join("/"));
  }
  const noun = bits.length ? `${bits.join(" ")} contests` : "contests";
  return filters.q?.trim() ? `${noun} matching “${filters.q.trim()}”` : noun;
}

/**
 * The one change most likely to turn nothing into something, as a link that
 * makes it.
 *
 * Ordered by how much it costs the reader: widening time costs them nothing
 * they asked for, dropping a facet costs them one. An apology would offer
 * neither.
 */
export function widening(
  filters: Filters,
  params: URLSearchParams,
  view: NowView,
): { text: string; href: string } | null {
  const order = Object.keys(RANGE_PRESETS);
  const current = view.window.id;

  if (current !== "custom") {
    // "" is the default window, which is roughly a month; find the first preset
    // that reaches further than what is showing.
    const at = current ? order.indexOf(current) : order.indexOf("30d");
    const next = order[at + 1];
    if (next) {
      return {
        text: `Widen to ${RANGE_PRESETS[next].label.toLowerCase()}`,
        href: relink(params, ["from", "to"], { range: next }),
      };
    }
  } else {
    return {
      text: "Look at the next 12 months instead",
      href: relink(params, ["from", "to"], { range: "365d" }),
    };
  }

  // Time is already as wide as the page offers, so the next cheapest thing is
  // one facet. Drop the narrowest first -- sponsor before mode, because a
  // sponsor filter usually removes more than it keeps.
  for (const [key, label] of [
    ["sponsor", "sponsor"],
    ["q", "search"],
    ["duration", "duration"],
    ["band", "band"],
    ["mode", "mode"],
  ] as const) {
    const has =
      key === "q" ? Boolean(filters.q?.trim()) : params.getAll(key).some(Boolean);
    if (has) {
      return {
        text: `Drop the ${label} filter`,
        href: relink(params, [key, `${key}s`]),
      };
    }
  }
  return null;
}

/**
 * The empty state itself.
 *
 * Names what was looked for, where, and what to do -- in that order, in one
 * sentence, per the brief's example. It never says "sorry" and it never says
 * "no results found", which tells the reader nothing they did not already know.
 */
export function emptyState(
  filters: Filters,
  params: URLSearchParams,
  view: NowView,
  where: string,
): string {
  const what = describeSelection(filters);
  const next = widening(filters, params, view);

  const second = next
    ? `<a href="${esc(next.href)}">${esc(next.text)}</a>, or ` +
      `<a href="/">clear the filters</a>.`
    : `The catalog runs on rules, not a list — take ` +
      `<a href="/api/contests?year=${new Date(view.now).getUTCFullYear()}">the whole year</a>, ` +
      `or subscribe to <a href="/api/ics">the feed</a> and stop checking.`;

  return (
    `<div class="empty">` +
    `<p>No ${esc(what)} ${esc(where)}.</p>` +
    `<p>${second}</p>` +
    `</div>`
  );
}

/**
 * What a band filter could not judge.
 *
 * Empty `bands` in the catalog means unrecorded, not unbanded, so a band filter
 * has to drop those records -- and dropping them silently is the failure this
 * whole project is built to avoid. Naming them costs one line and keeps the
 * page honest about the edge of its own data.
 */
export function unrecordedNote(view: NowView, params: URLSearchParams): string {
  if (!view.unrecordedBands.length) return "";
  const names = view.unrecordedBands;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    `<p class="caveat">` +
    `${names.length === 1 ? "One contest is" : `${names.length} contests are`} ` +
    `not shown because we have not read ${
      names.length === 1 ? "its" : "their"
    } bands off the sponsor's own rules yet: ${esc(list)}. ` +
    `<a href="${esc(relink(params, ["band", "bands"]))}">Clear the band filter</a> to see ` +
    `${names.length === 1 ? "it" : "them"}.` +
    `</p>`
  );
}
