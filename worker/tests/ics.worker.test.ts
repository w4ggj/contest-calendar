/**
 * The iCal feed, checked by parsing it back.
 *
 * The parser below is written from RFC 5545 rather than imported from
 * `src/ics.ts`, deliberately. A generator checked with regexes against its own
 * output tests that it does what it does; unfolding and unescaping the stream
 * back into properties tests that a client can *read* it, which is the only
 * property that matters for a file nobody looks at again after subscribing.
 *
 * ## On "tested against Google, Apple and Outlook"
 *
 * Nothing here subscribes a real Google, Apple or Outlook account. That needs a
 * publicly reachable HTTPS URL, and this Worker is not deployed yet -- the three
 * clients only fetch feeds they can reach, and none of them will poll
 * `localhost`. Claiming otherwise in a test name would be the kind of green
 * check that proves nothing, which this repo already refuses elsewhere.
 *
 * What IS pinned here is every requirement the three clients place on the bytes,
 * each traceable to a spec clause rather than to folklore: CRLF terminators and
 * 75-octet folding (RFC 5545 §3.1), the required VCALENDAR and VEVENT
 * properties (§3.6), TEXT escaping (§3.3.11), UTC-only DATE-TIME (§3.3.5 form
 * 2), and the absence of the two constructs the clients genuinely implement
 * differently -- VTIMEZONE and RRULE. A feed that satisfies all of those is
 * one where a client disagreeing with it is the client's bug, not ours.
 *
 * The remaining step is a real subscription in all three, once there is a public
 * URL. `HANDOVER.md` carries it as the open item it is.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://contestcal.test";

async function ics(path: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}${path}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/calendar");
  return res.text();
}

// ---------------------------------------------------------------------------
// An independent RFC 5545 reader
// ---------------------------------------------------------------------------

interface Prop {
  name: string;
  params: string;
  value: string;
}

/**
 * Unfold per §3.1: a CRLF followed by a single space or tab is a continuation
 * and the whole sequence -- CRLF and the leading whitespace -- is removed.
 */
function unfold(text: string): string[] {
  const raw = text.split("\r\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  // The stream ends with CRLF, so the split leaves a trailing empty element.
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** Reverse of §3.3.11 TEXT escaping. */
function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const next = value[++i];
    out += next === "n" || next === "N" ? "\n" : next;
  }
  return out;
}

function parseLine(line: string): Prop {
  // name[;params]:value -- the colon that ends the name is the first one not
  // inside a quoted parameter value.
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  expect(colon, `no property/value separator in ${JSON.stringify(line)}`).toBeGreaterThan(0);
  const head = line.slice(0, colon);
  const semi = head.indexOf(";");
  return {
    name: semi === -1 ? head : head.slice(0, semi),
    params: semi === -1 ? "" : head.slice(semi + 1),
    value: line.slice(colon + 1),
  };
}

interface Calendar {
  props: Prop[];
  events: Prop[][];
}

function parse(text: string): Calendar {
  const lines = unfold(text);
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines[lines.length - 1]).toBe("END:VCALENDAR");

  const cal: Calendar = { props: [], events: [] };
  let current: Prop[] | null = null;
  for (const line of lines.slice(1, -1)) {
    if (line === "BEGIN:VEVENT") {
      expect(current, "nested VEVENT").toBeNull();
      current = [];
      continue;
    }
    if (line === "END:VEVENT") {
      expect(current, "END:VEVENT without BEGIN").not.toBeNull();
      cal.events.push(current!);
      current = null;
      continue;
    }
    (current ?? cal.props).push(parseLine(line));
  }
  expect(current, "unterminated VEVENT").toBeNull();
  return cal;
}

const get = (props: Prop[], name: string): string | undefined =>
  props.find((p) => p.name === name)?.value;

const text = (props: Prop[], name: string): string =>
  unescapeText(get(props, name) ?? "");

// ---------------------------------------------------------------------------

describe("GET /api/ics — structure a client has to be able to read", () => {
  it("round-trips through an independent parser", async () => {
    const body = await ics("/api/ics");
    const cal = parse(body);

    expect(cal.events.length).toBeGreaterThan(100);
    // §3.6: VERSION and PRODID are the two required VCALENDAR properties.
    expect(get(cal.props, "VERSION")).toBe("2.0");
    expect(get(cal.props, "PRODID")).toContain("contestcal");

    for (const ev of cal.events) {
      // §3.6.1: UID and DTSTAMP are required in every VEVENT; DTSTART is
      // required in a VCALENDAR without METHOD, which is exactly this one.
      expect(get(ev, "UID"), "every event needs a UID").toBeTruthy();
      expect(get(ev, "DTSTAMP")).toMatch(/^\d{8}T\d{6}Z$/);
      expect(get(ev, "DTSTART")).toMatch(/^\d{8}T\d{6}Z$/);
      expect(get(ev, "DTEND")).toMatch(/^\d{8}T\d{6}Z$/);
    }
  });

  it("terminates every line with CRLF and folds at 75 octets", async () => {
    const body = await ics("/api/ics");

    // A lone LF passes in most clients and fails in validators, which is the
    // worst combination for a feed someone subscribes to once.
    expect(body.split("\r\n").length - 1).toBe(body.split("\n").length - 1);
    expect(body.endsWith("\r\n")).toBe(true);

    const enc = new TextEncoder();
    for (const line of body.split("\r\n")) {
      expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("never splits a multi-byte character across a fold", async () => {
    // AGCW's contests carry umlauts, so this is a real path, not a synthetic
    // one: a fold that counts characters instead of octets produces a line
    // over 75 bytes, and a fold that slices bytes produces mojibake.
    const cal = parse(await ics("/api/ics?q=AGCW"));
    expect(cal.events.length).toBeGreaterThan(0);
    for (const ev of cal.events) {
      expect(text(ev, "SUMMARY")).not.toContain("�");
      expect(text(ev, "DESCRIPTION")).not.toContain("�");
    }
  });

  it("escapes TEXT values so they unescape to the original", async () => {
    const cal = parse(await ics("/api/ics"));

    // Exchanges are the field most likely to carry a comma or a semicolon --
    // "RST + QSO number starting with 001 + name". If escaping were wrong, the
    // raw value would show a bare comma and the parsed one would be truncated.
    const withComma = cal.events.filter((ev) =>
      text(ev, "DESCRIPTION").includes(","),
    );
    expect(withComma.length).toBeGreaterThan(0);
    for (const ev of withComma) {
      const raw = get(ev, "DESCRIPTION")!;
      expect(raw).not.toMatch(/(^|[^\\]),/);
      expect(unescapeText(raw)).toContain(",");
    }

    // DESCRIPTION is multi-line and the newlines must survive as \n escapes,
    // not as folds -- a fold is whitespace, an escaped newline is content.
    const multiline = cal.events.find((ev) => text(ev, "DESCRIPTION").includes("\n"));
    expect(multiline, "no multi-line description in the feed").toBeTruthy();
  });

  it("keeps CATEGORIES a list rather than one comma-laden value", async () => {
    // The separator in a multi-value property is a BARE comma. Escaping it --
    // which is what happens if the whole property value is run through the TEXT
    // escaper once -- turns "CW,SSB" into a single category named "CW,SSB".
    // Six catalog records list more than one mode -- ARRL 10-Meter is CW/SSB.
    const cal = parse(await ics("/api/ics"));
    const multi = cal.events.find((ev) => (get(ev, "CATEGORIES") ?? "").includes(","));
    expect(multi, "no multi-mode contest in the feed to check").toBeTruthy();
    expect(get(multi!, "CATEGORIES")).not.toContain("\\,");
    expect(get(multi!, "CATEGORIES")!.split(",").length).toBeGreaterThan(1);
  });
});

describe("GET /api/ics — the three things clients disagree about", () => {
  it("emits UTC instants only: no floating times, no VTIMEZONE", async () => {
    const body = await ics("/api/ics");
    expect(body).not.toContain("VTIMEZONE");
    expect(body).not.toContain("TZID");

    // §3.3.5 form 2 is the only DATE-TIME form here. Form 1 (no Z) is floating
    // and means "the reader's own zone", which is how a 1300Z contest lands at
    // 1300 local in three different countries.
    for (const ev of parse(body).events) {
      expect(get(ev, "DTSTART")!.endsWith("Z")).toBe(true);
      expect(get(ev, "DTEND")!.endsWith("Z")).toBe(true);
    }
  });

  it("expands instants instead of emitting RRULEs", async () => {
    // The engine's rule types do not map onto iCal's recurrence model, and
    // clients expand RRULEs themselves and disagree at the month boundaries
    // this catalog cares most about. CWT runs weekly, so if anything were ever
    // going to be collapsed into an RRULE it would be this one.
    const body = await ics("/api/ics?q=CWT");
    expect(body).not.toContain("RRULE");
    expect(body).not.toContain("RDATE");
    expect(body).not.toContain("EXDATE");

    const starts = parse(body).events.map((ev) => get(ev, "DTSTART"));
    expect(starts.length).toBeGreaterThan(100);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("carries no METHOD, because a subscription is not a scheduling message", async () => {
    // METHOD belongs to iTIP (RFC 5546). Declaring one asks a client to treat
    // these events as invitations from an organiser rather than as a published
    // calendar.
    const body = await ics("/api/ics");
    expect(body).not.toContain("METHOD:");
  });

  it("asks for refresh in both the standard and the Microsoft spelling", async () => {
    const cal = parse(await ics("/api/ics"));
    // RFC 7986 §5.7 for clients that read the standard property; X-PUBLISHED-TTL
    // for the ones that only ever read Microsoft's.
    expect(cal.props.find((p) => p.name === "REFRESH-INTERVAL")?.value).toBe("PT12H");
    expect(get(cal.props, "X-PUBLISHED-TTL")).toBe("PT12H");
  });

  it("serves the same feed at a .ics path", async () => {
    // Several clients decide how to handle a subscription URL by looking at its
    // extension, and a URL ending in `.ics` is the form every one of them
    // accepts. Same handler, so the two cannot drift.
    const viaApi = await ics("/api/ics?mode=CW");
    const viaExt = await ics("/contests.ics?mode=CW");
    const uids = (t: string) => parse(t).events.map((ev) => get(ev, "UID"));
    expect(uids(viaExt)).toEqual(uids(viaApi));
  });
});

describe("GET /api/ics — what the subscriber gets to read", () => {
  it("puts the sponsor's rules URL, modes, bands and exchange in every event", async () => {
    const cal = parse(await ics("/api/ics?q=CQ WW"));
    expect(cal.events.length).toBeGreaterThan(0);

    for (const ev of cal.events) {
      const d = text(ev, "DESCRIPTION");
      expect(d).toContain("Sponsor:");
      expect(d).toContain("Modes:");
      expect(d).toContain("Bands:");
      expect(d).toContain("Exchange:");
      expect(d).toMatch(/Rules: https?:\/\//);
      // URL is also a property in its own right, for clients that render a
      // link button rather than making the description clickable.
      expect(get(ev, "URL")).toMatch(/^https?:\/\//);
    }
  });

  it("says out loud that a contest is unverified", async () => {
    // The feed is where provenance matters most: the subscriber never sees the
    // page, so an unverified date that looks identical to a verified one is a
    // confident wrong answer.
    const cal = parse(await ics("/api/ics?q=CQ WW"));
    const unverified = cal.events.filter((ev) => get(ev, "STATUS") === "TENTATIVE");
    expect(unverified.length).toBeGreaterThan(0);
    for (const ev of unverified) {
      expect(text(ev, "SUMMARY")).toContain("(unverified)");
      expect(text(ev, "DESCRIPTION")).toContain("UNVERIFIED");
    }
    // And that a verified one is marked confirmed rather than left blank.
    const verified = parse(await ics("/api/ics?q=CWT")).events;
    expect(verified.length).toBeGreaterThan(0);
    expect(verified.every((ev) => get(ev, "STATUS") === "CONFIRMED")).toBe(true);
  });

  it("does not let unrecorded bands read as no bands", async () => {
    // Empty `bands` means we have not read the sponsor's page, not that the
    // contest has none. The web page says so in a caveat; the feed has to say
    // it in the event or the omission is silently misleading.
    const cal = parse(await ics("/api/ics?q=SARL&range=365d"));
    expect(cal.events.length).toBeGreaterThan(0);
    expect(text(cal.events[0], "DESCRIPTION")).toContain(
      "Bands: not yet read off the sponsor's own rules",
    );

    // Same for the exchange, which 32 of the 84 records do not carry: an
    // absent line reads as "nothing to send", which is a different claim.
    const arrl = parse(await ics("/api/ics?q=Sweepstakes"));
    expect(arrl.events.length).toBeGreaterThan(0);
    expect(text(arrl.events[0], "DESCRIPTION")).toContain("Exchange: not recorded yet");
  });

  it("states the duration the way the page does, not as a raw float", async () => {
    // Found by subscribing the deployed feed in Google Calendar and reading the
    // event: `Duration: 47.983333333333334h`. Harmless, and exactly the kind of
    // thing that only shows up once a human looks at the rendered result.
    const cal = parse(await ics("/api/ics?range=365d"));
    expect(cal.events.length).toBeGreaterThan(0);

    const durations = cal.events.map(
      (ev) => /^Duration: (.+)$/m.exec(text(ev, "DESCRIPTION"))?.[1] ?? "",
    );
    expect(durations.every((d) => /^(\d+h( \d+m)?|\d+m)$/.test(d))).toBe(true);

    // The near-48h contests are the ones that produced the float, so pin one.
    const cqww = parse(await ics("/api/ics?q=CQ WW&range=365d"));
    expect(cqww.events.length).toBeGreaterThan(0);
    expect(text(cqww.events[0], "DESCRIPTION")).toContain("Duration: 47h 59m");
  });

  it("marks contests transparent so a subscriber does not look busy", async () => {
    const cal = parse(await ics("/api/ics"));
    expect(cal.events.every((ev) => get(ev, "TRANSP") === "TRANSPARENT")).toBe(true);
  });

  it("names the calendar after the filter that built it", async () => {
    const plain = parse(await ics("/api/ics"));
    expect(text(plain.props, "X-WR-CALNAME")).toBe("Amateur Radio Contests");

    const cw = parse(await ics("/api/ics?mode=CW&band=20m"));
    const name = text(cw.props, "X-WR-CALNAME");
    expect(name).toContain("CW");
    expect(name).toContain("20m");
    // The description states the horizon, so two subscriptions in the same
    // client are distinguishable six months later.
    expect(text(cw.props, "X-WR-CALDESC")).toContain("Rolling window");
  });
});

describe("GET /api/ics — filters, the same ones the page uses", () => {
  it("filters by mode, and widens the way the page does", async () => {
    const cal = parse(await ics("/api/ics?mode=Digital"));
    expect(cal.events.length).toBeGreaterThan(0);
    for (const ev of cal.events) {
      const modes = get(ev, "CATEGORIES")!.split(",");
      // `Digital` as a query matches Digital, RTTY, FT8/FT4 and Mixed -- the
      // filter widens, the record never does.
      expect(
        modes.some((m) => ["Digital", "RTTY", "FT8/FT4", "Mixed"].includes(m)),
      ).toBe(true);
    }
  });

  it("filters by band, duration, sponsor and search text", async () => {
    const byBand = parse(await ics("/api/ics?band=160m"));
    expect(byBand.events.length).toBeGreaterThan(0);

    const short = parse(await ics("/api/ics?duration=lt2"));
    expect(short.events.length).toBeGreaterThan(0);
    for (const ev of short.events) {
      const start = Date.parse(get(ev, "DTSTART")!.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        "$1-$2-$3T$4:$5:$6Z",
      ));
      const end = Date.parse(get(ev, "DTEND")!.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        "$1-$2-$3T$4:$5:$6Z",
      ));
      expect((end - start) / 3_600_000).toBeLessThan(2);
    }

    const bySponsor = parse(await ics("/api/ics?sponsor=ARRL"));
    expect(bySponsor.events.length).toBeGreaterThan(0);
    for (const ev of bySponsor.events) {
      expect(text(ev, "DESCRIPTION")).toContain("Sponsor: ARRL");
    }

    const byQuery = parse(await ics("/api/ics?q=sprint"));
    expect(byQuery.events.length).toBeGreaterThan(0);
  });

  it("rejects an unknown filter value rather than serving everything", async () => {
    // The failure this prevents is specific: someone subscribes to a "CW only"
    // feed, fat-fingers the mode, and quietly receives all 84 contests forever.
    const res = await SELF.fetch(`${BASE}/api/ics?mode=CQ`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("unknown mode");
    expect(body.hint).toContain("CW");
  });

  it("gives every event a stable, unique UID", async () => {
    // A changed UID makes a client treat the event as a new one, so an unstable
    // UID turns every subscriber's calendar into duplicates.
    const first = parse(await ics("/api/ics?range=90d")).events.map((ev) => get(ev, "UID"));
    const second = parse(await ics("/api/ics?range=90d")).events.map((ev) => get(ev, "UID"));
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);

    // And the UID must not depend on the filter: the same running of the same
    // contest has to be one event whether you subscribed to everything or to CW.
    const cw = new Set(parse(await ics("/api/ics?range=90d&mode=CW")).events.map((ev) => get(ev, "UID")));
    expect([...cw].every((uid) => first.includes(uid!))).toBe(true);
  });
});

describe("GET /api/ics — the horizon", () => {
  it("defaults to the last 30 days and the next 12 months", async () => {
    const res = await SELF.fetch(`${BASE}/api/ics`);
    const [fromIso, toIso] = res.headers.get("x-ics-window")!.split("/");
    const span = (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
    expect(Math.round(span)).toBe(395);

    // The window is what makes the feed complete: every contest in the catalog
    // runs at least once a year, so a twelve-month horizon contains all of
    // them. Spot-check with the one people plan a year around.
    const body = await res.text();
    expect(body).toContain("CQ Worldwide DX Contest");
  });

  it("keeps a preset range rolling rather than expiring", async () => {
    const res = await SELF.fetch(`${BASE}/api/ics?range=7d`);
    const [fromIso, toIso] = res.headers.get("x-ics-window")!.split("/");
    // A named range means exactly that range: no 30-day backfill, or a feed
    // called "Next 7 days" would carry five weeks of history.
    expect(Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000)).toBe(7);
    expect(Date.parse(fromIso)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(parse(await res.text()).events.length).toBeGreaterThan(0);
  });

  it("pins a fixed span for ?year= and ?from=/?to=", async () => {
    // A dated query is a download, not a subscription, so it does not move with
    // the clock and can be cached for a day rather than an hour.
    const res = await SELF.fetch(`${BASE}/api/ics?year=2027`);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    const cal = parse(await res.text());
    expect(text(cal.props, "X-WR-CALDESC")).toContain("Fixed snapshot of 2027");
    for (const ev of cal.events) {
      expect(get(ev, "DTSTART")!.slice(0, 4)).toBe("2027");
    }

    const ranged = await SELF.fetch(`${BASE}/api/ics?from=2027-03-01&to=2027-03-31`);
    const window = ranged.headers.get("x-ics-window")!;
    expect(window.startsWith("2027-03-01")).toBe(true);
    for (const ev of parse(await ranged.text()).events) {
      expect(get(ev, "DTSTART")!.slice(0, 6)).toBe("202703");
    }
  });

  it("stays a valid calendar when a filter matches nothing", async () => {
    // A subscription must not break because its filter went quiet; the client
    // would surface an error the user cannot act on. RFC 5545 §3.6 does say a
    // VCALENDAR carries at least one component, and this is the one case where
    // that cannot be honoured -- the alternative is inventing an event, which
    // would put a placeholder in someone's real calendar. Empty and honest.
    const res = await SELF.fetch(`${BASE}/api/ics?q=zzzqx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ics-events")).toBe("0");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).not.toContain("BEGIN:VEVENT");
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
