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
  relative,
} from "../src/render/landing.js";
import { CLIENT_JS } from "../src/render/client.js";
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
