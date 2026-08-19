/**
 * The Worker's own surface, exercised through real requests inside workerd.
 *
 * Every assertion here is about something a caller can observe: status codes,
 * headers, the shape of the JSON, the text of the page. Nothing reaches into
 * module internals -- those are the parity suite's job.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  esc,
  humanDuration,
  railFraction,
  railSlot,
  railWindow,
  relative,
} from "../src/render/landing.js";
import { CLIENT_JS } from "../src/render/client.js";
import { dayCellLabel } from "../src/render/daylabel.js";
import { CSS } from "../src/render/theme.js";

const BASE = "https://contestcal.test";

async function get(path: string): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`);
}

describe("GET /api/health", () => {
  it("reports the active resolver and passes its self-check", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    // The endpoint exists so an operator can answer "which resolver is serving
    // my contest times?" without reading logs. If this name is ever wrong, the
    // endpoint is worse than absent.
    expect(body.runtime.resolver).toBe("intl");
    expect(body.runtime.pinned).toBe(true);
    expect(body.runtime.compatibilityDate).toBe("2026-08-13");
    expect(body.zoneResolverSelfCheck.pass).toBe(true);
    expect(body.catalog.contests).toBeGreaterThan(0);
    expect(typeof body.catalog.version).toBe("string");
  });
});

describe("GET /api/contests", () => {
  it("returns a year of occurrences with the query echoed back", async () => {
    const res = await get("/api/contests?year=2026");
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.query.kind).toBe("year");
    expect(body.query.year).toBe(2026);
    expect(body.count).toBe(body.occurrences.length);
    expect(body.count).toBeGreaterThan(0);

    const first = body.occurrences[0];
    expect(first.uid).toMatch(/@contestcal$/);
    expect(first.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(first.mode_families)).toBe(true);
  });

  it("rejects an unknown filter value instead of silently ignoring it", async () => {
    // Silently returning everything for `?mode=nonsense` is the failure mode
    // that makes a filtered feed quietly wrong.
    const res = await get("/api/contests?year=2026&mode=nonsense");
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(String(body.error)).toMatch(/nonsense/);
  });

  it("rejects a year outside the engine's range", async () => {
    expect((await get("/api/contests?year=1700")).status).toBe(400);
  });
});

describe("GET /api/contests/:id", () => {
  it("404s for an unknown id, with a way forward", async () => {
    const res = await get("/api/contests/not-a-real-contest");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(String(body.hint ?? "")).toContain("/api/search");
  });

  it("returns upcoming runnings of a known contest", async () => {
    const list = (await (await get("/api/contests?year=2026")).json()) as any;
    const id = list.occurrences[0].contest_id;

    const res = await get(`/api/contests/${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.contest.id).toBe(id);
    expect(body.next.length).toBeGreaterThan(0);
    // Provenance travels with the record, including when it is unflattering.
    expect(body.contest).toHaveProperty("verified");
    expect(body.contest).toHaveProperty("rules_url");
    expect(typeof body.rule.plain).toBe("string");
  });
});

describe("GET /api/ics", () => {
  // Conformance -- folding, escaping, UTC instants, filters, horizon -- lives in
  // `ics.worker.test.ts`, which parses the feed back rather than pattern-matching
  // it. What belongs here is the API surface: that the route is wired and that a
  // dated query is honoured rather than ignored.
  it("is routed and served as a calendar", async () => {
    const res = await get("/api/ics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    expect((await res.text()).startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });

  it("honours ?year= instead of quietly serving the default window", async () => {
    // This is the regression that hid here for a release: `handleIcs` ignored
    // every range parameter, and the old test only passed because the fixed
    // window happened to contain the year it asked for. A query that is
    // accepted and then discarded is worse than one that 400s.
    const res = await get("/api/ics?year=2029");
    expect(res.status).toBe(200);
    for (const line of (await res.text()).split("\r\n")) {
      if (line.startsWith("DTSTART:")) expect(line.slice(8, 12)).toBe("2029");
    }
  });
});

describe("GET /api/search", () => {
  it("finds a contest by a fragment of its name", async () => {
    const res = await get("/api/search?q=cw");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results.length).toBeGreaterThan(0);
  });
});

describe("GET /", () => {
  it("renders the landing view complete, without JavaScript", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Next 7 days");
    // The times themselves must be in the served markup. If they only appear
    // after the client script runs, the page is a spinner with extra steps.
    expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}T/);
    expect(html).toContain('data-countdown=');
    // The toggle stays hidden until the client proves it can convert.
    expect(html).toMatch(/id="tzbar"[^>]*hidden/);
  });

  it("never emits a bare local-time string for a client to parse", async () => {
    // `new Date("2026-03-08T02:30")` applies the reader's own zone. Every
    // machine-readable timestamp on the page must carry Z.
    const html = await (await get("/")).text();
    const stamps = html.match(/(datetime|data-until|data-day)="([^"]+)"/g) ?? [];
    expect(stamps.length).toBeGreaterThan(0);
    for (const s of stamps) {
      expect(s, `${s} is not a UTC instant`).toMatch(/T[\d:.]+Z"$/);
    }
  });

  it("escapes catalog text before it reaches the markup", () => {
    // The catalog is ours, so nothing hostile is in it today -- but it is
    // hand-edited JSON containing ampersands and quotes, and an unescaped `&`
    // in a sponsor name is a broken page, not a security story.
    expect(esc(`Bob & "Ted's" <club>`)).toBe(
      "Bob &amp; &quot;Ted&#39;s&quot; &lt;club&gt;",
    );
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("carries no unescaped angle brackets inside a contest name", async () => {
    const html = await (await get("/")).text();
    // Names sit inside the anchor; anything between the anchor's `>` and its
    // `</a>` is contest text and must contain no raw markup.
    const names = [...html.matchAll(/class="row-name"><a href="[^"]*">(.*?)<\/a>/g)];
    expect(names.length).toBeGreaterThan(0);
    for (const [, name] of names) {
      expect(name, `unescaped markup in ${JSON.stringify(name)}`).not.toMatch(/[<>]/);
    }
  });
});

describe("how the page says times out loud", () => {
  it("writes durations the way rules do", () => {
    // A 30-minute sprint and a 48-hour contest are different animals, and
    // "0.5 hours" reads like a rounding error rather than a sprint.
    expect(humanDuration(0.5)).toBe("30m");
    expect(humanDuration(1)).toBe("1h");
    expect(humanDuration(1.5)).toBe("1h 30m");
    expect(humanDuration(48)).toBe("48h");
  });

  it("is specific about how far away something is", () => {
    expect(relative(12 * 60_000).text).toBe("in 12 min");
    expect(relative(3 * 3_600_000).text).toBe("in 3h");
    expect(relative(3.5 * 3_600_000).text).toBe("in 3h 30m");
    expect(relative(4 * 86_400_000).text).toBe("in 4 days");
    expect(relative(86_400_000).text).toBe("in 1 day");
    // "soon" is what turns the countdown amber; six hours is the window in
    // which an operator would actually change their evening.
    expect(relative(3 * 3_600_000).soon).toBe(true);
    expect(relative(9 * 3_600_000).soon).toBe(false);
  });
});

describe("the 7-day rail", () => {
  it("starts at a UTC midnight, so its day labels are not a lie", () => {
    // A cell labelled "Sat 15" that actually spans 0212Z Sat to 0212Z Sun is a
    // chart that misreads by up to a day, which is worse than no chart.
    const win = railWindow(Date.parse("2026-08-13T22:14:37.512Z"));
    expect(new Date(win.start).toISOString()).toBe("2026-08-13T00:00:00.000Z");
    expect(win.end - win.start).toBe(win.days * 86_400_000);
  });

  it("is wide enough to hold anything the section promises", () => {
    // The section promises a rolling seven days from *now*, so the last
    // occurrence in it can land inside the eighth calendar day.
    const now = Date.parse("2026-08-13T23:59:59.000Z");
    const win = railWindow(now);
    expect(win.end).toBeGreaterThanOrEqual(now + 7 * 86_400_000);
  });

  it("positions every bar inside the rail", async () => {
    const html = await (await get("/")).text();
    const bars = [...html.matchAll(/--s:([\d.]+)%;--w:([\d.]+)%/g)];
    expect(bars.length).toBeGreaterThan(0);
    for (const [, s, w] of bars) {
      const left = Number(s);
      const width = Number(w);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(100.001);
    }
  });

  it("maps a known instant to its own day slot", () => {
    // The failure this pins: the day labels and the bars were laid out in two
    // different boxes, so a contest at 2000Z on the rail's first day appeared
    // under the label for the third. The mapping itself was never wrong -- but
    // nothing asserted what fraction an instant was supposed to land at, so
    // there was nothing to check the drawing against.
    const win = railWindow(Date.parse("2026-08-14T03:04:00Z"));
    const at2000 = win.start + 20 * 3_600_000;

    expect(railSlot(at2000, win)).toBe(0);
    expect(railFraction(at2000, win) * 100).toBeCloseTo(10.4167, 3);
    // Inside the first eighth of the rail, nowhere near the third.
    expect(railFraction(at2000, win)).toBeLessThan(1 / 8);

    // Each boundary lands exactly on its cell edge, first to last.
    for (let i = 0; i < win.days; i++) {
      const midnight = win.start + i * 86_400_000;
      expect(railFraction(midnight, win) * 100).toBeCloseTo(i * 12.5, 9);
      expect(railSlot(midnight, win)).toBe(i);
    }
    expect(railSlot(win.end, win)).toBe(-1);
    expect(railSlot(win.start - 1, win)).toBe(-1);
  });

  it("places the page's own bars where the mapping says", async () => {
    const html = await (await get("/")).text();
    const now = Date.parse(html.match(/data-now="([^"]+)"/)![1]);
    const win = railWindow(now);

    const rail = html.slice(html.indexOf('class="rail"'));
    const bars = [
      ...rail.matchAll(/datetime="([^"]+)" data-t="start"[\s\S]*?--s:([\d.]+)%/g),
    ];
    expect(bars.length).toBeGreaterThan(0);

    for (const [, iso, left] of bars) {
      const expected = railFraction(Date.parse(iso), win) * 100;
      expect(
        Math.abs(Number(left) - expected),
        `bar for ${iso} drawn at ${left}%, mapping says ${expected.toFixed(3)}%`,
      ).toBeLessThan(0.002);
    }
  });

  it("lays the ruler and the rows out on one axis, declared once", () => {
    // Two grids that merely happen to carry the same template drift the moment
    // one of them is edited -- which is what happened: a later `.ruler` rule
    // won over the media query at equal specificity, so the labels spanned the
    // whole card while the bars stayed in the middle column.
    const blocks = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const axis = blocks.filter(
      ([, sel, body]) =>
        /grid-template-columns/.test(body) && /\.(ruler|row)(?![\w-])/.test(sel),
    );

    expect(axis.length, "the rail's axis is declared in more than one place").toBe(1);
    expect(axis[0][1]).toContain(".ruler");
    expect(axis[0][1]).toContain(".row");
    expect(axis[0][2]).toMatch(/grid-template-columns:\s*var\(--axis\)/);
  });

  it("puts the now-line where now actually is, not at the left edge", async () => {
    const html = await (await get("/")).text();
    const m = html.match(/class="now-line" style="left:([\d.]+)%"/);
    expect(m, "no now-line in the rendered rail").not.toBeNull();
    // 0% would mean the rail restarts at whatever moment the page was
    // requested -- which is what made the day labels wrong.
    expect(Number(m![1])).toBeLessThan(12.5);
  });
});

describe("the rail's day labels", () => {
  const NBSP = "\u00A0";

  it("names the reader's date once the toggle flips, not UTC's", () => {
    // 0304Z Friday 14 August: UTC has rolled over, New York has not -- it is
    // 2304 on Thursday the 13th there. A rail headed "Today 14" in local mode
    // is labelling a day the reader has not reached.
    const win = railWindow(Date.parse("2026-08-14T03:04:00Z"));

    const utc = dayCellLabel(win.start, 0, "UTC");
    const local = dayCellLabel(win.start, 0, "America/New_York");
    expect(utc).toBe(`Today${NBSP}14`);
    expect(local).toBe(`Today${NBSP}13`);
    expect(local, "the first day label is identical in both modes").not.toBe(utc);

    // The weekday moves with it, so the cell cannot half-agree with itself.
    const next = win.start + 86_400_000;
    expect(dayCellLabel(next, 1, "UTC")).toBe(`Sat${NBSP}15`);
    expect(dayCellLabel(next, 1, "America/New_York")).toBe(`Fri${NBSP}14`);

    // East of Greenwich the dates already agree, and nothing should change.
    expect(dayCellLabel(win.start, 0, "Asia/Tokyo")).toBe(`Today${NBSP}14`);
  });

  it("hands the client the instants and the same function to relabel them", async () => {
    const html = await (await get("/")).text();

    const cells = [...html.matchAll(/class="ruler-day[^"]*" data-day="([^"]+)"/g)];
    expect(cells.length).toBe(8);
    // Cell boundaries are UTC midnights and travel as instants, so relabelling
    // never has to parse a local-time string.
    for (const [, iso] of cells) expect(iso).toMatch(/T00:00:00\.000Z$/);

    // The client relabels with the server's function, shipped as source. A
    // second copy of this logic is a second implementation of a date.
    expect(CLIENT_JS).toContain(dayCellLabel.toString());
    expect(CLIENT_JS).toMatch(/textContent = dayCellLabel\(/);
  });
});

describe("routing", () => {
  it("404s an unknown path as HTML", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("refuses methods other than GET and HEAD", async () => {
    const res = await SELF.fetch(`${BASE}/`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("answers HEAD with the GET headers and no body", async () => {
    const res = await SELF.fetch(`${BASE}/api/health`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});
