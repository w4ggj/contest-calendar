/**
 * The contest detail view: `/contest/:id`.
 *
 * Everything the catalog holds about one contest, and the one page on this site
 * where its provenance is the subject rather than a flag in the margin. The
 * schedule answers "what can I work this weekend"; this answers "what is this,
 * what do I send, when does it actually run, and how do you know".
 *
 * Three things it is built around.
 *
 * **The rule, in plain language.** "Last full weekend of November" is the one
 * thing no other contest calendar can show, because no other one stores rules --
 * they store dates. It is stated at the top, with the clock line beneath it, and
 * both come from the recurrence the engine actually expands rather than from
 * next year's dates.
 *
 * **A field that is empty says so.** An absent "Exchange" row reads as "there is
 * nothing to send", which is a different claim from "we have not read it off the
 * sponsor's page yet". Same rule the iCal feed follows for the same reason: 24
 * of the catalog's records carry no exchange, and pretending otherwise is how a
 * gap becomes a wrong answer.
 *
 * **The reader's filters survive the trip.** Someone who narrowed to CW on 20m in
 * October built that view by hand and it lives in the URL. Every link here that
 * goes back to the schedule carries their query with it, so arriving from a
 * filtered view and returning to it does not need the back button to restore
 * form state it often does not.
 */

import {
  eligibilityFor,
  type Contest,
  type Occurrence,
} from "../../../engine/src/recurrence.js";
import {
  describeRule,
  describeSchedule,
  nextOccurrences,
} from "../schedule.js";
import { relink } from "./filters.js";
import { SITE_NAME, esc } from "./html.js";
import {
  googleSubscribeHref,
  humanDuration,
  isoAttr,
  relative,
  zDate,
  zTime,
} from "./landing.js";
import { pageLinks } from "./pages.js";
import { ICON_LINKS } from "./icon.js";
import { CSS } from "./theme.js";
import { CLIENT_JS, THEME_BOOT } from "./client.js";

/** How many runnings ahead to show. Enough to see the pattern, not a table. */
const RUNNINGS = 6;

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/**
 * A field the catalog has not recorded.
 *
 * Rendered rather than omitted, and worded so it cannot be read as a fact about
 * the contest. "Bands: —" would be a claim; "not read off the sponsor's page
 * yet" is what is actually true.
 */
function unrecorded(what: string): string {
  return `<span class="unrec">${esc(what)}</span>`;
}

function row(term: string, value: string): string {
  return `<dt>${esc(term)}</dt><dd>${value}</dd>`;
}

/** "1500 W", "5 W", or nothing where the sponsor states no ceiling. */
function watts(max: unknown): string {
  return typeof max === "number" ? ` <span class="w">${max} W</span>` : "";
}

function externalLink(href: string, label: string): string {
  return (
    `<a href="${esc(href)}" target="_blank" rel="noopener external">${esc(label)}` +
    `<span class="ext" aria-hidden="true">↗</span></a>`
  );
}

/** The host, for a link whose label should be the sponsor's site not a URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/**
 * When the contest runs, as the rule states it rather than as one year's dates.
 *
 * A `wall_clock` record's clock line carries no `Z` and names its zone instead:
 * ARS Spartan Sprint is 2000 in New York, which is 0000Z in winter and 2300Z in
 * summer, and printing either one as "the" time would be wrong for half the
 * year.
 */
function ruleSection(contest: Contest): string {
  const windows = describeSchedule(contest);
  const clock = windows
    .map(
      (w, i) =>
        `<li class="clock">${esc(w)}` +
        (windows.length > 1 ? `<span class="sess">session ${i + 1}</span>` : "") +
        `</li>`,
    )
    .join("");

  const notes: string[] = [];

  if (contest.timezone) {
    notes.push(
      `Times are the sponsor's own clock in <code>${esc(contest.timezone)}</code>, ` +
        `so the UTC instant moves an hour across a daylight-saving boundary. The ` +
        `runnings below are the resolved instants.`,
    );
  } else if (contest.local_rolling) {
    notes.push(
      `This contest starts at that clock time <strong>wherever you are</strong>. ` +
        `There is no single UTC instant for it, so nothing here is converted.`,
    );
  } else {
    notes.push(`Times are UTC, as the sponsor states them.`);
  }

  if (contest.sessions?.length) {
    notes.push(
      `${contest.sessions.length} sessions run off the one anchor day; each is a ` +
        `separate running with its own log.`,
    );
  }

  const manualYears = Object.keys(contest.recurrence.dates ?? {}).sort();
  if (manualYears.length) {
    notes.push(
      `The sponsor announces these dates a year at a time and there is no rule to ` +
        `derive, so this calendar holds only the years they have published: ` +
        `${esc(manualYears.join(", "))}.`,
    );
  }

  return (
    `<section class="dt-sec" aria-labelledby="h-rule">` +
    `<h2 id="h-rule">When it runs</h2>` +
    `<p class="rule-plain">${esc(describeRule(contest.recurrence))}</p>` +
    `<ul class="clocks">${clock}</ul>` +
    notes.map((n) => `<p class="note">${n}</p>`).join("") +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Next runnings
// ---------------------------------------------------------------------------

function running(o: Occurrence, nowMs: number): string {
  const start = (o.start ?? o.start_wall)!;
  const end = (o.end ?? o.end_wall)!;
  const due = o.log_due;

  // A rolling contest has no instant, so it gets a wall reading and no <time>:
  // the client script converts every <time> it finds, and converting this one
  // is precisely the category error the engine refuses to make.
  const when = o.local_rolling
    ? `<span class="rolling">${esc(zTime(start).replace("Z", ""))} your local time</span>` +
      `<span class="arrow"> → </span>${esc(zTime(end).replace("Z", ""))} local`
    : `<time datetime="${isoAttr(start)}" data-t="start">${esc(zTime(start))} ` +
      `${esc(zDate(start))}</time><span class="arrow"> → </span>` +
      `<time datetime="${isoAttr(end)}" data-t="end">${esc(zTime(end))} ${esc(zDate(end))}</time>`;

  const rel = relative(start.getTime() - nowMs);
  const ahead =
    start.getTime() > nowMs
      ? `<span class="row-count${rel.soon ? " soon" : ""}" data-countdown="start" ` +
        `data-until="${isoAttr(start)}">${esc(rel.text)}</span>`
      : end.getTime() > nowMs
        ? `<span class="row-count soon">on the air now</span>`
        : "";

  return (
    `<li class="run">` +
    `<p class="run-when">${when}` +
    `<span class="dot"> · </span><span class="dur">${esc(humanDuration(o.duration_hours))}</span>` +
    `<span class="yr">${start.getUTCFullYear()}</span></p>` +
    ahead +
    (due
      ? `<p class="run-due">Logs due <time datetime="${isoAttr(due)}" data-t="due">` +
        `${esc(zTime(due))} ${esc(zDate(due))}</time></p>`
      : "") +
    `</li>`
  );
}

/**
 * Why there is nothing ahead, when there is nothing ahead.
 *
 * An empty list with no explanation reads as a bug in this site. Both reasons a
 * contest can have no future runnings are facts about the sponsor, and both are
 * worth saying: the record was closed off at a year, or the sponsor publishes
 * dates annually and has not published the next one.
 */
function noRunnings(contest: Contest): string {
  if (typeof contest.active_until === "number") {
    return (
      `<p class="empty-line">This calendar holds runnings through ` +
      `<strong>${contest.active_until}</strong> and none after it — the record is ` +
      `closed, not missing. The note below says what the sponsor announced.</p>`
    );
  }
  const years = Object.keys(contest.recurrence.dates ?? {}).sort();
  if (years.length) {
    return (
      `<p class="empty-line">The sponsor sets this date each year rather than by a ` +
      `rule, and has published through <strong>${esc(years[years.length - 1])}</strong>. ` +
      `Years they have not announced are absent rather than guessed.</p>`
    );
  }
  return (
    `<p class="empty-line">No running falls in the next five years. If that looks ` +
    `wrong, the rule above is what this calendar is working from.</p>`
  );
}

// ---------------------------------------------------------------------------
// Taking it away
// ---------------------------------------------------------------------------

/** Google's event template wants `YYYYMMDDTHHMMSSZ`, with no punctuation. */
function gcalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * A Google Calendar "add this event" link for one running, or null.
 *
 * Null in the two cases where a link would state something untrue:
 *
 * **No next running.** Nothing to add. The runnings section already explains
 * why -- the record is closed off at a year, or the sponsor publishes annually
 * and has not published the next one -- and a dead button beside that
 * explanation would contradict it.
 *
 * **A rolling contest.** `local_rolling` means the contest starts at a clock
 * time wherever the operator is, so it has NO single instant; the occurrence
 * carries a wall reading and `start` is null. A Google Calendar event is an
 * instant by construction, so building one here would invent a fact the engine
 * deliberately refuses to invent -- the same category error `running()` avoids
 * by not wrapping a rolling time in `<time>`. No record uses `local_rolling`
 * today; this is guarded because one silently would produce a wrong hour.
 */
export function googleCalendarHref(
  contest: Contest,
  next: Occurrence | undefined,
  origin: string,
): string | null {
  if (!next || next.local_rolling) return null;
  if (!next.start || !next.end) return null;

  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: contest.name,
    dates: `${gcalStamp(next.start)}/${gcalStamp(next.end)}`,
    // The sponsor's own rules are the thing a reader will actually want once
    // the event fires, so the description carries them plus this record.
    details:
      `${contest.sponsor}\n\n` +
      (contest.rules_url ? `Rules: ${contest.rules_url}\n` : "") +
      `Details: ${origin}/contest/${contest.id}`,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

function takeSection(
  contest: Contest,
  next: Occurrence | undefined,
  origin: string,
): string {
  const ics = `/api/ics?id=${encodeURIComponent(contest.id)}`;
  const feed = `${origin}${ics}`;
  const gcal = googleCalendarHref(contest, next, origin);

  // Ordered by what a reader most likely wants: the next running in their
  // calendar now, then every running kept current, then the same feed for the
  // three clients that take it directly, then the raw record.
  return (
    `<section class="dt-sec" aria-labelledby="h-take">` +
    `<h2 id="h-take">Take it with you</h2>` +
    `<p class="dt-take">` +
    (gcal
      ? `<a class="btn" href="${esc(gcal)}" target="_blank" ` +
        `rel="noopener external">Add to Google Calendar</a>`
      : "") +
    `<a class="btn" href="${esc(googleSubscribeHref(feed))}" target="_blank" ` +
    `rel="noopener external">Subscribe (Google)</a>` +
    `<a class="btn" href="${ics}">Subscribe (iCal)</a>` +
    `<a class="btn ghost" href="/api/contests/${encodeURIComponent(contest.id)}">` +
    `This record as JSON</a>` +
    `</p>` +
    // Three buttons that all put this contest in a calendar do different
    // things, and the differences are the reason there are three. Saying so is
    // cheaper than letting a reader find out by picking the wrong one.
    (gcal
      ? `<p class="note"><strong>Add to Google Calendar</strong> puts the next ` +
        `running in as a single event, straight away. <strong>Subscribe ` +
        `(Google)</strong> takes every running of this contest and keeps them ` +
        `current — but <strong>Google polls external calendars on its own ` +
        `schedule, often 8–24 hours, and it cannot be forced</strong>, so a new ` +
        `subscription will not appear immediately. Use the first if you want ` +
        `this running in your calendar now.</p>`
      : `<p class="note"><strong>Subscribe (Google)</strong> takes every running ` +
        `of this contest and keeps them current, but <strong>Google polls ` +
        `external calendars on its own schedule, often 8–24 hours, and it ` +
        `cannot be forced</strong>.</p>`) +
    `<p class="note"><strong>Subscribe (iCal)</strong> is the same feed for ` +
    `Apple Calendar, Outlook and Thunderbird, which take this address ` +
    `directly. It carries this contest's runnings for the next twelve months ` +
    `as UTC instants, and its identifiers are stable across deploys, so ` +
    `re-subscribing does not duplicate anything: ` +
    `<code class="feed">${esc(feed)}</code></p>` +
    `</section>`
  );
}

function runningsSection(contest: Contest, nowMs: number): string {
  const next = nextOccurrences(contest.id, nowMs, RUNNINGS);
  return (
    `<section class="dt-sec" aria-labelledby="h-next">` +
    `<h2 id="h-next">Next runnings</h2>` +
    (next.length
      ? `<ol class="runs">${next.map((o) => running(o, nowMs)).join("")}</ol>`
      : noRunnings(contest)) +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// What you send, and on what
// ---------------------------------------------------------------------------

function operatingSection(contest: Contest, entity: string): string {
  const rows: string[] = [];

  const modes = contest.modes ?? [];
  rows.push(
    row(
      "Modes",
      modes.length
        ? esc(modes.join(" / ")) +
            (contest.submodes?.length
              ? ` <span class="sub">${esc(contest.submodes.join(", "))}</span>`
              : "")
        : unrecorded("not read off the sponsor's page yet"),
    ),
  );

  // The record's own band list, then the families a filter would match it on.
  // Empty means unrecorded, and every band filter therefore hides this contest
  // -- which is a thing the reader is entitled to know while looking at it.
  const bands = contest.bands ?? [];
  rows.push(
    row(
      "Bands",
      (bands.length
        ? `<span class="bandlist">${bands.map((b) => `<span class="band">${esc(b)}</span>`).join("")}</span>`
        : unrecorded(
            "not read off the sponsor's page yet — so every band filter on the schedule hides this contest",
          )) +
        (contest.bands_note
          ? `<p class="sub">${esc(contest.bands_note)}</p>`
          : ""),
    ),
  );

  rows.push(
    row(
      "Exchange",
      contest.exchange
        ? esc(contest.exchange)
        : unrecorded("not recorded yet"),
    ),
  );

  const power = (contest.power_categories ?? []) as { name: string; max_watts?: number | null }[];
  if (power.length) {
    rows.push(
      row(
        "Power categories",
        power
          .map((p) => `<span class="pw">${esc(p.name)}${watts(p.max_watts)}</span>`)
          .join(""),
      ),
    );
  }

  const logBits: string[] = [];
  if (contest.log_format) logBits.push(esc(String(contest.log_format)));
  if (typeof contest.log_deadline_days === "number") {
    logBits.push(
      `due ${contest.log_deadline_days} day${contest.log_deadline_days === 1 ? "" : "s"} after the end`,
    );
  }
  if (contest.log_submit_url) {
    logBits.push(externalLink(String(contest.log_submit_url), hostOf(String(contest.log_submit_url))));
  }
  rows.push(
    row("Logs", logBits.length ? logBits.join(" · ") : unrecorded("no deadline or format recorded")),
  );

  // Eligibility is computed for the entity the reader's query names, defaulting
  // to the same one the schedule uses. Not a boolean: "you may work them but
  // cannot submit" is a different answer from "you cannot enter", and operators
  // need the difference.
  const elig = eligibilityFor(contest, entity);
  const eligText =
    elig.scope === "worldwide"
      ? "Anyone, anywhere."
      : `${esc(elig.reason || elig.scope)}`;
  rows.push(
    row(
      "Who can enter",
      `${eligText}` +
        (elig.works && elig.works !== "everyone"
          ? ` <span class="sub">You ${esc(elig.works)}.</span>`
          : "") +
        (contest.eligibility?.note
          ? `<p class="sub">${esc(contest.eligibility.note)}</p>`
          : ""),
    ),
  );

  return (
    `<section class="dt-sec" aria-labelledby="h-op">` +
    `<h2 id="h-op">Operating</h2>` +
    `<dl class="spec">${rows.join("")}</dl>` +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where this record came from, in the sponsor's own wording.
 *
 * The whole project rests on this section being true, so it is a section rather
 * than a tooltip. `source_note` is the sentence the rule was read from -- often
 * quoted in the sponsor's own language with a translation after -- which is what
 * makes a date arguable rather than merely asserted.
 */
function provenanceSection(contest: Contest): string {
  const rows: string[] = [];

  rows.push(
    row(
      "Checked against the sponsor",
      contest.verified
        ? `<strong>Yes.</strong> The rule on this page was read off ` +
            `${esc(contest.sponsor ?? "the sponsor")}'s own published rules.` +
            (contest.rules_url_checked
              ? ` Link last confirmed ${esc(String(contest.rules_url_checked))}.`
              : "")
        : `<span class="flag">unverified</span> — these dates have not yet been ` +
            `checked against ${esc(contest.sponsor ?? "the sponsor")}'s own page. ` +
            `Treat the sponsor's rules as authoritative.`,
    ),
  );

  if (contest.source_note) {
    rows.push(row("What the source says", `<q>${esc(String(contest.source_note))}</q>`));
  }
  if (contest.note) {
    rows.push(row("Recorded caveats", esc(String(contest.note))));
  }
  if (contest.rules_url_archived) {
    rows.push(
      row(
        "Archived copy",
        externalLink(String(contest.rules_url_archived), "as it read when it was verified"),
      ),
    );
  }

  return (
    `<section class="dt-sec" aria-labelledby="h-prov">` +
    `<h2 id="h-prov">Where this comes from</h2>` +
    `<dl class="spec">${rows.join("")}</dl>` +
    `<p class="note">Something wrong? <a href="/contact">How to report it</a> — a link ` +
    `to the sponsor's own page is all it takes.</p>` +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export interface DetailInput {
  contest: Contest;
  nowMs: number;
  /** The reader's query, carried through so returning keeps their view. */
  params: URLSearchParams;
  entity: string;
  /**
   * This deployment's origin, e.g. "https://contest-calendar.jleone0.workers.dev".
   *
   * Needed because two things on this page have to be absolute: Google's
   * add-event link is a URL on Google's servers that points back here, and the
   * feed address a reader pastes into a subscribe box is useless as a relative
   * path. Taken from the request rather than hard-coded so `wrangler dev` and
   * production each describe themselves correctly.
   */
  origin: string;
}

export function renderDetail(input: DetailInput): string {
  const { contest, nowMs, params, entity, origin } = input;
  const back = relink(params, [], {}, "/");
  const rule = describeRule(contest.recurrence);
  const next = nextOccurrences(contest.id, nowMs, 1)[0];

  // A description has no page around it either. Say what the contest is, who
  // runs it and when it next runs -- the three things a search result should
  // carry -- and fall back to the rule when the record has no summary.
  const description =
    (contest.summary ? `${String(contest.summary)} ` : "") +
    `${contest.name} is run by ${contest.sponsor ?? "its sponsor"}: ${rule}.` +
    (next ? ` Next running ${zDate((next.start ?? next.start_wall)!)} ${(next.start ?? next.start_wall)!.getUTCFullYear()}.` : "");

  const flags = contest.verified
    ? ""
    : ` <span class="flag" title="Not yet checked against the sponsor's own published rules.">unverified</span>`;

  const rulesLink = contest.rules_url
    ? `<a class="btn primary" href="${esc(String(contest.rules_url))}" target="_blank" ` +
      `rel="noopener external">Rules at ${esc(hostOf(String(contest.rules_url)))}` +
      `<span class="ext" aria-hidden="true">↗</span></a>`
    : `<span class="flag muted">no sponsor rules URL recorded</span>`;

  const sponsorLine = [
    contest.sponsor_home
      ? externalLink(String(contest.sponsor_home), String(contest.sponsor ?? ""))
      : esc(contest.sponsor ?? ""),
    contest.country ? esc(String(contest.country)) : "",
  ]
    .filter(Boolean)
    .join(`<span class="dot"> · </span>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(contest.name)} · ${esc(SITE_NAME)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="dark light">
${ICON_LINKS}
<link rel="alternate" type="text/calendar" href="/api/ics?id=${encodeURIComponent(contest.id)}" title="${esc(contest.name)}">
<style>${CSS}</style>
<script>${THEME_BOOT}</script>
</head>
<body data-now="${isoAttr(new Date(nowMs))}">
<main class="shell doc" id="main">
  <p class="backlink"><a href="${esc(back)}">← Back to the schedule</a></p>

  <article class="detail">
    <header class="dt-head">
      <p class="dt-sponsor">${sponsorLine}</p>
      <h1>${esc(contest.name)}${flags}</h1>
      ${contest.summary ? `<p class="lede">${esc(String(contest.summary))}</p>` : ""}
      <p class="dt-cta">${rulesLink}<span class="dt-cta-note">The rules are the sponsor's. This page holds the dates and the facts.</span></p>
      ${
        contest.verified
          ? ""
          : `<p class="caveat">These dates have not been checked against ` +
            `${esc(contest.sponsor ?? "the sponsor")}'s own published rules yet. ` +
            `They are computed from the rule below, which is what the catalog ` +
            `holds — but the sponsor's page wins.</p>`
      }
    </header>

    ${ruleSection(contest)}
    ${runningsSection(contest, nowMs)}
    ${operatingSection(contest, entity)}
    ${provenanceSection(contest)}

    ${takeSection(contest, next, origin)}
  </article>

  <div class="controls dt-controls">
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

  <footer class="foot">
    <p>Dates are computed from a recurrence rule taken from the sponsor's own
    published rules — not copied from any third-party calendar.</p>
    <p class="links">${pageLinks()}</p>
    <p class="links"><a href="${esc(back)}">Schedule</a></p>
    <p>Catalog published under CC BY 4.0. Sponsors' rules text remains theirs.</p>
  </footer>
</main>

<script>${CLIENT_JS}</script>
</body>
</html>`;
}
