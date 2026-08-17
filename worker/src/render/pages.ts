/**
 * The three standing pages: /about, /data, /contact.
 *
 * They exist because three questions get asked of a calendar like this and none
 * of them fit in a footer line: where do the dates come from, may I use the
 * data, and how do I report a date that is wrong. Answering them on the landing
 * view would push the schedule below the fold, which is the one thing the
 * design will not trade.
 *
 * Deliberately NOT a nav bar. The calendar stays at `/` with nothing in front of
 * it -- someone arriving to find out what is on the air right now should never
 * land on prose. These pages are reachable from the footer and from each other,
 * and every one of them carries a link back to the schedule.
 *
 * Same stylesheet as the landing view, and the same synchronous theme boot, so a
 * reader who chose Light does not get a dark flash on the way to /about. No
 * client bundle: there is no clock to tick and no countdown to update here, and
 * the page is complete without JavaScript for the same reason the landing view
 * is.
 */

import { CATALOG, CATALOG_SIZE } from "../catalog.js";
import { SITE_NAME, esc } from "./html.js";
import { CSS } from "./theme.js";
import { THEME_BOOT } from "./client.js";

const VERIFIED = CATALOG.filter((c) => c.verified).length;
const SPONSORS = new Set(CATALOG.map((c) => c.sponsor).filter(Boolean)).size;

/** Where corrections go. One channel, publicly readable, with a trail. */
const REPO = "https://github.com/w4ggj/contest-calendar";
const ISSUES = `${REPO}/issues`;

export interface StaticPage {
  slug: string;
  title: string;
  description: string;
  /** Footer/masthead label. Short enough to sit on a phone line. */
  label: string;
  body: string;
}

// ---------------------------------------------------------------------------

const ABOUT: StaticPage = {
  slug: "about",
  title: "About",
  label: "About",
  description:
    "How this calendar computes contest dates from each sponsor's own published rules, and why it is built as a rules engine rather than a table of dates.",
  body: `
<h1>About</h1>

<p class="lede">This is an amateur radio contest calendar that stores
<em>rules</em>, not dates. Every contest is held as the recurrence its sponsor
published — “the last full weekend of July”, “the third Saturday in May” — and
the dates you see are computed from that rule when you load the page.</p>

<h2>Where the dates come from</h2>

<p>Each record is built from one place: the sponsoring organisation’s own
published rules. Not from any third-party contest calendar, and not from a
listing that was itself compiled from one. The WA7BNM Contest Calendar is the
definitive resource in this hobby and its terms prohibit automated access and
republication; this project respects that completely and compiles independently
from primary sources instead.</p>

<p>So every record carries its provenance with it:</p>

<dl class="defs">
  <dt>rules link</dt>
  <dd>A deep link to the sponsor’s own rules page. Every contest name on the
  schedule is that link — it opens in a new tab, because you are leaving this
  site for theirs.</dd>

  <dt>the rule, in their wording</dt>
  <dd>The recurrence is recorded as the sponsor phrased it, so a date that looks
  wrong can be checked against the sentence it came from.</dd>

  <dt>verified</dt>
  <dd>Whether that rule was read directly off the sponsor’s page. Anything not
  yet checked is labelled <span class="flag">unverified</span> on the schedule
  rather than quietly shown as fact. ${VERIFIED} of ${CATALOG_SIZE} records are
  verified today.</dd>
</dl>

<h2>Why a rules engine</h2>

<p>A table of dates has a horizon: it covers the years someone typed in. A rule
does not, so this calendar answers 2031 as readily as this weekend. When a
sponsor changes a rule, one record changes rather than every future row.</p>

<p>It also forces the awkward cases into the open. A <strong>full weekend</strong>
is a Saturday and Sunday with both days inside the month — when a month ends on
a Saturday, that Saturday does not begin one. Between 2026 and 2035 this shifts
dates in seventeen months. A calendar that reads “first Saturday” is wrong about
twice a year, and nobody notices until somebody misses a contest.</p>

<h2>Times</h2>

<p>Times are UTC, which is how contest rules are written and how operators talk.
The page shows UTC by default and can convert to your own zone; every time on it
is emitted with a machine-readable UTC instant, so the schedule is correct before
any script runs.</p>

<p>Two kinds of contest are not simply UTC, and they need opposite treatment. A
contest a sponsor runs at a clock time in <em>their</em> zone has one correct UTC
instant that moves an hour across a daylight-saving boundary — those are resolved
through the zone, not hardcoded. A contest that starts at a clock time wherever
<em>you</em> are has no single UTC instant at all; it sweeps the globe with local
dawn, so it is shown as a wall clock and never converted.</p>

<h2>What it does not claim</h2>

<p>The catalog is honest about its own gaps, because a missing contest is worse
than a flagged one. Coverage outside North America and Europe is still thin, and
where a band or mode could not be read off the sponsor’s page the field is left
empty rather than guessed — which means a filter on that field necessarily
excludes the record. When that happens the page says so underneath the filters
instead of letting the contest disappear.</p>

<p>Sponsors’ rules text is theirs. This catalog holds facts and its own
summaries, and links out for the authoritative wording.</p>
`,
};

const DATA: StaticPage = {
  slug: "data",
  title: "Data",
  label: "Data",
  description:
    "The contest catalog is published under CC BY 4.0, and served as JSON and as an iCal feed. What is in a record and how to fetch it.",
  body: `
<h1>Data</h1>

<p class="lede">The catalog is <strong>${CATALOG_SIZE} contest definitions from
${SPONSORS} sponsors</strong>, published under
<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener external">CC BY 4.0<span class="ext" aria-hidden="true">↗</span></a>.
Use it, build on it, ship it in your own project — attribution is the only
condition. It is a compilation of public facts and it should stay open.</p>

<h2>Subscribe</h2>

<p>The iCal feed takes the same filters as the page, so a URL that shows what you
want on screen is also the feed that puts it in your calendar.</p>

<dl class="defs">
  <dt><a href="/api/ics">/api/ics</a></dt>
  <dd>Every contest, or add filters: <code>?mode=CW&amp;band=20m</code>. Also
  served at <a href="/contests.ics">/contests.ics</a>.</dd>
</dl>

<p>The feed emits expanded UTC instants rather than recurrence rules and carries
no timezone definitions, because the three big calendar clients disagree about
both. Each event’s identifier is stable across deploys — a changed identifier
would turn every subscriber’s calendar into duplicates.</p>

<h2>JSON</h2>

<dl class="defs">
  <dt><a href="/api/contests">/api/contests</a></dt>
  <dd>Occurrences in a window. <code>?year=2030</code> for a whole year;
  <code>?from=</code> and <code>?to=</code> for a range.</dd>

  <dt><a href="/api/search?q=sprint">/api/search?q=</a></dt>
  <dd>Search names and sponsors.</dd>

  <dt><a href="/api/meta">/api/meta</a></dt>
  <dd>The controlled vocabularies — every mode and band a filter accepts — plus
  the catalog’s fingerprint.</dd>

  <dt><a href="/api/health">/api/health</a></dt>
  <dd>What the runtime resolved, including which timezone resolver is active.</dd>
</dl>

<h2>What a record says</h2>

<p><strong>Modes and bands are controlled sets.</strong> A field that is free
text is a field nothing can query, so the specifics a small vocabulary drops —
“PSK31”, “RTTY 75 baud”, “10 GHz through light” — are kept beside it as notes,
displayed and never filtered on.</p>

<p><strong>Filtering widens; the record does not.</strong> A record says exactly
what the sponsor permits. As a <em>query</em>, <code>Digital</code> matches
Digital, RTTY and FT8/FT4, and every specific mode also matches
<code>Mixed</code> — so a search for digital modes finds the FT8 events without
any RTTY-only contest ever being described as anything but RTTY.</p>

<p><strong>Empty bands means unrecorded, not unbanded.</strong> Every band filter
therefore excludes such a record. Anything that filters is expected to say so
rather than let the contest vanish, which is what the note under the filter panel
on the schedule is for.</p>

<h2>Source</h2>

<p>The engine, the catalog and the provenance registry are all in one repository:
<a href="${REPO}" target="_blank" rel="noopener external">${esc(REPO.replace("https://", ""))}<span class="ext" aria-hidden="true">↗</span></a>.
Code is MIT. The registry records which sponsor page each record was read from
and when the link was last confirmed live.</p>
`,
};

const CONTACT: StaticPage = {
  slug: "contact",
  title: "Contact",
  label: "Corrections",
  description:
    "How to report a contest date, band, mode or rules link that is wrong, and what to include so it can be fixed at source.",
  body: `
<h1>Corrections</h1>

<p class="lede">If a date here is wrong, it is worth telling us — somebody is
going to plan a weekend around it. Corrections go to
<a href="${ISSUES}" target="_blank" rel="noopener external">the issue tracker<span class="ext" aria-hidden="true">↗</span></a>,
which keeps the report, the sponsor’s page and the fix together in public.</p>

<h2>What to include</h2>

<dl class="defs">
  <dt>The contest and what it shows</dt>
  <dd>Its name here, and the date or detail you are looking at.</dd>

  <dt>The sponsor’s own page</dt>
  <dd>The single most useful thing in the report. A record can only be fixed from
  the sponsoring organisation’s own published rules — a correction sourced from
  another calendar cannot be accepted, however right it is, because the whole
  catalog’s value rests on knowing where each fact came from.</dd>

  <dt>What the rule actually says</dt>
  <dd>The sentence, in the sponsor’s wording. “Third full weekend, not third
  Saturday” is the difference between a calendar that is right every year and one
  that is right most years.</dd>
</dl>

<h2>Missing contests</h2>

<p>Coverage is uneven and openly so, thinnest outside North America and Europe.
If your society or club runs a contest that is not here, a link to its rules page
is all that is needed to add it — and a contest nobody has sourced is invisible
to every operator in that region, which is the gap most worth closing.</p>

<h2>Sponsors</h2>

<p>If you run a contest listed here and something is recorded wrongly, or you
would rather it were not listed at all, say so and it will be dealt with. The
catalog holds dates, bands, modes and exchanges as facts and links to your page
for the rules themselves; it does not reproduce your rules text.</p>
`,
};

export const STATIC_PAGES: StaticPage[] = [ABOUT, DATA, CONTACT];

const BY_SLUG = new Map(STATIC_PAGES.map((p) => [p.slug, p]));

/**
 * The footer's page links, shared by the landing view and the pages themselves.
 *
 * `current` marks the page you are on: it stays in the list as plain text rather
 * than disappearing, so the set of pages reads the same everywhere.
 */
export function pageLinks(current?: string): string {
  return STATIC_PAGES.map((p) =>
    p.slug === current
      ? `<span aria-current="page">${esc(p.label)}</span>`
      : `<a href="/${p.slug}">${esc(p.label)}</a>`,
  ).join("");
}

export function findPage(slug: string): StaticPage | undefined {
  return BY_SLUG.get(slug);
}

export function renderPage(page: StaticPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} · ${esc(SITE_NAME)}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="color-scheme" content="dark light">
<link rel="alternate" type="text/calendar" href="/api/ics" title="Amateur radio contests">
<style>${CSS}</style>
<script>${THEME_BOOT}</script>
</head>
<body>
<main class="shell doc" id="main">
  <p class="backlink"><a href="/">← Contests on the air now</a></p>
  <article class="prose">${page.body}</article>

  <footer class="foot">
    <p class="links">${pageLinks(page.slug)}</p>
    <p>Catalog published under CC BY 4.0. Sponsors’ rules text remains theirs.</p>
  </footer>
</main>
</body>
</html>`;
}
