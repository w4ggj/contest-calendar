/**
 * iCal feed.
 *
 * The feature that makes people keep this: subscribe once, contests appear in
 * the phone calendar forever. Which also means a wrong date here is worse than
 * a wrong date anywhere else -- the user has stopped checking by then.
 *
 * Three decisions shape the whole file, and all three are about the fact that
 * Google Calendar, Apple Calendar and Outlook do not agree with each other.
 *
 * **Expanded UTC instants, never RRULE.** The engine's rule types do not map
 * onto iCal's recurrence model: "fourth full weekend of June" is not an RRULE,
 * and the nearest expressible approximation (`BYDAY=SA;BYSETPOS=4`) is wrong in
 * the 17 months across 2026-2035 where a month ends on a Saturday. Even where a
 * rule does map, clients expand RRULEs themselves and disagree at the edges.
 * Expanding here means every client is handed the same instants the API and the
 * web page show, and the interpretation happens in one implementation that has
 * a parity suite behind it rather than in three that do not.
 *
 * **UTC instants only** (`DTSTART:...Z`) -- never a floating time, never a
 * VTIMEZONE block. The three clients disagree about VTIMEZONE; they agree about
 * `Z`. The engine has already resolved every sponsor-anchored wall clock
 * through the pinned resolver, so there is nothing left for a client to get
 * wrong. An operator-anchored (`local_rolling`) contest has no UTC instant at
 * all and is skipped rather than invented.
 *
 * **No METHOD.** `METHOD` is an iTIP property (RFC 5546) and belongs to
 * scheduling messages -- invitations, replies, cancellations. A subscription
 * feed is not a scheduling message, and a stream that declares one invites a
 * client to treat its events as invitations from an organiser. Omitted
 * deliberately; the previous version sent `METHOD:PUBLISH`.
 */

import type { Occurrence } from "../../engine/src/recurrence.js";
import { humanDuration } from "./render/landing.js";
import { occurrenceUid } from "./serialize.js";

const PRODID = "-//contestcal//Amateur Radio Contest Calendar//EN";

/**
 * RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, newline.
 *
 * Applies to ONE text value. A multi-value property (CATEGORIES) escapes each
 * value separately and joins with bare commas -- escaping the separator turns a
 * list of categories into a single category whose name contains commas.
 */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function stamp(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * Fold to 75 octets per RFC 5545 §3.1.
 *
 * Folds on octets rather than characters: a multi-byte character split across a
 * fold boundary is invalid, and contest names carry accents and umlauts (AGCW,
 * OK1WC, SARL). Counts UTF-8 length and never breaks mid-sequence.
 */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  // Iterate by code point, not code unit, so surrogate pairs stay together.
  for (const ch of line) {
    const size = enc.encode(ch).length;
    // Continuation lines start with a space, which costs one of the 75.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = ch;
      bytes = size;
    } else {
      current += ch;
      bytes += size;
    }
  }
  if (current) out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join("\r\n");
}

/**
 * The event body.
 *
 * A subscriber never sees the web page, so everything they would need to decide
 * "do I want to be at the radio for this" travels in the description: who runs
 * it, what modes and bands, what you exchange, when logs are due, and a link to
 * the sponsor's own rules. Free-text `submodes` and `bands_note` are included
 * beside their controlled fields -- they are exactly the specifics the closed
 * vocabularies drop, and in a calendar there is no filter for them to confuse.
 */
function describe(o: Occurrence): string {
  const parts: string[] = [];
  if (o.sponsor) parts.push(`Sponsor: ${o.sponsor}`);

  const modes = o.modes.join(", ");
  const submodes = o.submodes?.length ? ` (${o.submodes.join(", ")})` : "";
  if (modes) parts.push(`Modes: ${modes}${submodes}`);

  if (o.bands.length) {
    parts.push(`Bands: ${o.bands.join(", ")}`);
  } else {
    // Empty bands means unrecorded, not unbanded. The web page says so in a
    // caveat; the feed has to say it here or the omission reads as "no bands".
    parts.push("Bands: not yet read off the sponsor's own rules");
  }
  if (o.bands_note) parts.push(`Band note: ${o.bands_note}`);

  // Shared with the page's formatter rather than interpolated raw: 47.98333333
  // hours is `duration_hours` for a contest that ends a minute before midnight,
  // and a subscriber reading "47.983333333333334h" learns nothing the page's
  // "47h 59m" does not tell them better. Sharing it also keeps the two surfaces
  // from disagreeing about the same contest.
  parts.push(`Duration: ${humanDuration(o.duration_hours)}`);
  if (o.exchange) {
    parts.push(`Exchange: ${o.exchange}`);
  } else {
    // 32 of 84 records carry no exchange yet. Same reasoning as bands: the
    // omission has to be visible, or a subscriber reads "no exchange line" as
    // "nothing to send" rather than "we have not read it off the rules".
    parts.push("Exchange: not recorded yet — see the sponsor's rules below");
  }

  if (!o.can_enter && o.eligibility_reason) {
    parts.push(`Eligibility: ${o.eligibility_reason}`);
  } else if (o.works && o.works !== "everyone") {
    parts.push(`Works: ${o.works}`);
  }

  const logDue = o.log_due;
  if (logDue) parts.push(`Logs due: ${logDue.toISOString().slice(0, 10)}`);
  if (o.note) parts.push(`Note: ${o.note}`);

  if (!o.verified) {
    // Say so in the feed itself. A calendar that admits uncertainty is more
    // trustworthy than one that does not, and the subscriber never sees the UI.
    parts.push(
      "UNVERIFIED: these dates have not yet been checked against the " +
        "sponsor's own published rules. Confirm before you rely on them.",
    );
  }
  if (o.rules_url) parts.push(`Rules: ${o.rules_url}`);
  return parts.join("\n");
}

export interface IcsOptions {
  /** Shown as X-WR-CALNAME; reflects the filters, so a CW-only subscription
   *  does not appear in the client as plain "Contests". */
  calendarName?: string;
  /** X-WR-CALDESC -- the filters and the horizon, in words, so a subscriber
   *  can tell two subscriptions apart six months later. */
  calendarDescription?: string;
  now?: Date;
}

export function buildIcs(
  occurrences: Occurrence[],
  opts: IcsOptions = {},
): string {
  const dtstamp = stamp(opts.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    fold(`X-WR-CALNAME:${esc(opts.calendarName ?? "Amateur Radio Contests")}`),
    "X-WR-TIMEZONE:UTC",
    // Two spellings of the same request. REFRESH-INTERVAL is the standard one
    // (RFC 7986); X-PUBLISHED-TTL is the older Microsoft property. Clients that
    // honour a refresh hint at all honour one or the other, and clients that
    // ignore both poll on their own schedule -- which the rolling horizon in
    // `handleIcs` is sized for.
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];
  if (opts.calendarDescription) {
    lines.push(fold(`X-WR-CALDESC:${esc(opts.calendarDescription)}`));
  }

  for (const o of occurrences) {
    // An operator-anchored contest has no UTC instant. Writing one would put a
    // wrong time in every subscriber's calendar, which is precisely the failure
    // the engine refuses to make -- so skip it rather than invent one. None
    // exist in the catalog today; the path is here because the model allows it.
    if (o.start === null || o.end === null) continue;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${occurrenceUid(o)}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${stamp(o.start)}`);
    lines.push(`DTEND:${stamp(o.end)}`);
    lines.push(fold(`SUMMARY:${esc(o.verified ? o.name : `${o.name} (unverified)`)}`));
    lines.push(fold(`DESCRIPTION:${esc(describe(o))}`));
    if (o.rules_url) {
      // URI value type (RFC 5545 §3.3.13): not TEXT, so not escaped.
      lines.push(fold(`URL:${o.rules_url}`));
    }
    // No ORGANIZER: it requires a CAL-ADDRESS, and a synthetic mailto makes
    // some clients render the event as a meeting invitation from a stranger.
    // DESCRIPTION carries the sponsor instead.

    // CATEGORIES is multi-value: escape each mode, join with a BARE comma.
    lines.push(
      fold(
        `CATEGORIES:${(o.modes.length ? o.modes : ["Contest"])
          .map(esc)
          .join(",")}`,
      ),
    );

    // The calendar vocabulary already has a word for "we have not confirmed
    // this", so provenance rides a standard property rather than only prose.
    lines.push(`STATUS:${o.verified ? "CONFIRMED" : "TENTATIVE"}`);

    // A contest is not an appointment. Marking it opaque would make a
    // subscriber look busy to their colleagues for 48 hours every November.
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings. Clients are lenient; validators are not.
  return `${lines.join("\r\n")}\r\n`;
}
