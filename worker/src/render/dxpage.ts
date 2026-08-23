/**
 * `/dx` — the DXpeditions, in three groups.
 *
 * The groups are the point. A DXpedition is in one of three states and they are
 * not variations of each other: it is coming with dates, it is coming without
 * them, or it has been and gone. A single list sorted by date would put a
 * permitted-but-unscheduled operation next to one starting on Tuesday and imply
 * they are equally actionable.
 *
 * **Announced without dates is not a defect, it is the normal state.** Teams
 * announce a month or a season first and publish days a few weeks out. Those
 * records are listed here with the window exactly as the team stated it, and
 * they are deliberately absent from the calendar — see `datedDXpeditions()`.
 *
 * **Finished operations are kept.** The team's own site usually goes dark or
 * turns into a QRT notice within months, so this page ends up being the
 * surviving statement of when an entity was last on the air. That is worth more
 * than a tidy list.
 */

import {
  type DXpedition,
  DXPEDITIONS,
  datedDXpeditions,
  hasEnded,
  spanOf,
  undatedDXpeditions,
} from "../dx.js";
import { relink } from "./filters.js";
import { SITE_NAME, esc, masthead } from "./html.js";
import { isoAttr } from "./landing.js";
import { pageLinks } from "./pages.js";
import { ICON_LINKS } from "./icon.js";
import { CSS } from "./theme.js";
import { CLIENT_JS, THEME_BOOT } from "./client.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function human(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

function days(d: DXpedition): number {
  const { from, to } = spanOf(d);
  return Math.round((to + 1 - from) / 86_400_000);
}

function card(d: DXpedition, nowMs: number): string {
  const ended = hasEnded(d, nowMs);
  const live = !ended && spanOf(d).from <= nowMs;
  const when =
    d.precision === "exact"
      ? `<time datetime="${d.start}">${esc(human(d.start))}</time> → ` +
        `<time datetime="${d.end}">${esc(human(d.end))}</time>` +
        `<span class="dot"> · </span>${days(d)} days`
      : `${esc(MONTHS[Number(d.start.slice(5, 7)) - 1])} ${esc(d.start.slice(0, 4))}` +
        `<span class="dx-prov">dates not yet published</span>`;

  return (
    `<article class="dx-card${ended ? " over" : ""}" id="${esc(d.id)}">` +
    `<h3><span class="dx-call">${esc(d.callsign)}</span> ${esc(d.name)}` +
    (live ? `<span class="row-count soon">on the air now</span>` : "") +
    `</h3>` +
    `<p class="dx-when">${when}</p>` +
    `<p class="dx-sum">${esc(d.summary)}</p>` +
    `<dl class="spec">` +
    `<dt>Entity</dt><dd>${esc(d.entity)}${
      d.iota ? ` <span class="sub">IOTA ${esc(d.iota)}</span>` : ""
    }</dd>` +
    `<dt>Team</dt><dd>${esc(d.team)}</dd>` +
    `<dt>Bands</dt><dd>${
      d.bands.length
        ? esc(d.bands.join(", "))
        : `<span class="unrec">not read off the team's own band plan yet</span>`
    }</dd>` +
    `<dt>Modes</dt><dd>${
      d.modes.length
        ? esc(d.modes.join(", "))
        : `<span class="unrec">not recorded yet</span>`
    }</dd>` +
    `<dt>Where this comes from</dt><dd><q>${esc(d.source_note)}</q></dd>` +
    (d.note ? `<dt>Recorded caveats</dt><dd>${esc(d.note)}</dd>` : "") +
    `</dl>` +
    `<p class="dx-links"><a class="btn" href="${esc(d.url)}" target="_blank" ` +
    `rel="noopener external">The team's own site ↗</a></p>` +
    (ended
      ? `<p class="note">This operation has finished. The record is kept because ` +
        `a team's site often goes dark or turns into a QRT notice within months, ` +
        `and this is then the surviving statement of when it ran.</p>`
      : "") +
    `</article>`
  );
}

function group(title: string, blurb: string, items: string[]): string {
  if (!items.length) return "";
  return (
    `<section class="dt-sec">` +
    `<h2>${esc(title)}</h2>` +
    `<p class="note">${blurb}</p>` +
    items.join("") +
    `</section>`
  );
}

export function renderDx(nowMs: number, params: URLSearchParams): string {
  const dated = datedDXpeditions().sort(
    (a, b) => spanOf(a).from - spanOf(b).from,
  );
  const upcoming = dated.filter((d) => !hasEnded(d, nowMs));
  const over = dated.filter((d) => hasEnded(d, nowMs)).reverse();
  const undated = undatedDXpeditions().filter((d) => !hasEnded(d, nowMs));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DXpeditions · ${esc(SITE_NAME)}</title>
<meta name="description" content="${DXPEDITIONS.length} DXpeditions, each read from the team's own site rather than an announcement list. Dates, entity, bands and what is still unannounced.">
<meta name="color-scheme" content="dark light">
${ICON_LINKS}
<style>${CSS}</style>
<script>${THEME_BOOT}</script>
</head>
<body data-now="${isoAttr(new Date(nowMs))}">
${masthead(false, "Skip to the DXpeditions")}
<main class="shell doc wide" id="main">
  <p class="backlink"><a href="${esc(relink(params, [], {}, "/"))}">← Back to the schedule</a></p>

  <h1>DXpeditions</h1>
  <p class="mo-sub">One-shot operations, not contests — so they carry no
  recurrence rule and no exchange, and they are held separately from the
  ${"contest catalog"}. Every one is read from <strong>the team's own site</strong>;
  the announcement lists that aggregate them are useful for learning an
  operation exists and are not used as the source of its dates.</p>

  ${group(
    "Coming up",
    "Dates published by the team. These appear on the month grid.",
    upcoming.map((d) => card(d, nowMs)),
  )}

  ${group(
    "Announced, dates still to come",
    "The normal state of a DXpedition until a few weeks out: a month or a " +
      "season is announced and the days follow. These are <strong>not</strong> " +
      "drawn on the calendar — putting them on specific days would invent the " +
      "one fact a reader came for. They move across the day the team publishes " +
      "dates.",
    undated.map((d) => card(d, nowMs)),
  )}

  ${group(
    "Been and gone",
    "Kept rather than deleted. A team's site usually goes dark or turns into a " +
      "QRT notice within months of the operation, so this becomes the surviving " +
      "statement of when the entity was last on the air.",
    over.map((d) => card(d, nowMs)),
  )}

  <footer class="foot">
    <p>Dates are read from each team's own announcement — not copied from any
    third-party DX bulletin or announcement list.</p>
    <p class="links">${pageLinks()}</p>
  </footer>
</main>

<script>${CLIENT_JS}</script>
</body>
</html>`;
}
