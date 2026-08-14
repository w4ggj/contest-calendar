/**
 * iCal feed.
 *
 * The feature that makes people keep this: subscribe once, contests appear in
 * the phone calendar forever. Which also means a wrong date here is worse than
 * a wrong date anywhere else -- the user has stopped checking by then.
 *
 * Deliberately emits UTC instants only (`DTSTART:...Z`), never floating times
 * and never a VTIMEZONE block. Google, Apple and Outlook disagree about
 * VTIMEZONE handling; they agree about UTC. The engine has already resolved
 * every sponsor-anchored wall clock to a real instant, so there is nothing left
 * for a calendar client to interpret.
 */

import type { Occurrence } from "../../engine/src/recurrence.js";
import { occurrenceUid } from "./serialize.js";

const PRODID = "-//contestcal//Amateur Radio Contest Calendar//EN";

/** RFC 5545 escaping: backslash, semicolon, comma, and newline. */
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
 * Fold to 75 octets per RFC 5545.
 *
 * Folds on octets rather than characters: a multi-byte character split across
 * a fold boundary is invalid, and contest names carry accents and umlauts
 * (AGCW, OK1WC, SARL). Counts UTF-8 length and never breaks mid-sequence.
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

function describe(o: Occurrence): string {
  const parts: string[] = [];
  if (o.sponsor) parts.push(`Sponsor: ${o.sponsor}`);
  if (o.modes.length) parts.push(`Modes: ${o.modes.join(", ")}`);
  if (o.bands.length) parts.push(`Bands: ${o.bands.join(", ")}`);
  parts.push(`Duration: ${o.duration_hours}h`);
  if (o.exchange) parts.push(`Exchange: ${o.exchange}`);
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
  /** Fingerprint of catalog + filters, so clients can tell feeds apart. */
  version?: string;
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
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.calendarName ?? "Amateur Radio Contests")}`,
    "X-WR-TIMEZONE:UTC",
    "X-PUBLISHED-TTL:PT12H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
  ];

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
    if (o.rules_url) lines.push(fold(`URL:${o.rules_url}`));
    // No ORGANIZER: it requires a CAL-ADDRESS, and a synthetic mailto makes
    // some clients render the event as a meeting invitation from a stranger.
    // DESCRIPTION carries the sponsor instead.
    lines.push(`CATEGORIES:${esc(o.modes.join(",") || "Contest")}`);
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings. Clients are lenient; validators are not.
  return `${lines.join("\r\n")}\r\n`;
}
