/**
 * Filters and search, exercised as a reader without JavaScript would meet them.
 *
 * Every assertion below goes through a real request to the Worker and reads the
 * HTML it served. That is deliberate: the claim being tested is not "the filter
 * function works" but "the page is usable with scripting off", and the only
 * evidence for that is what arrives in the response body.
 *
 * The vocabulary tests are the third of the three mirrors. `CATALOG_MODES` and
 * `CATALOG_BANDS` are asserted against the catalog in both engines' suites;
 * here they are asserted against the FILTERS, which is the other way a
 * vocabulary goes wrong -- a mode nothing can filter for, or a filter no record
 * can satisfy.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { CATALOG_BANDS, CATALOG_MODES } from "../../engine/src/recurrence.js";
import { CATALOG } from "../src/catalog.js";
import {
  BAND_FAMILIES,
  bandFamilies,
  DURATION_BUCKETS,
  MODE_FAMILIES,
  modeFamilies,
  RANGE_PRESETS,
} from "../src/schedule.js";
import { CSS } from "../src/render/theme.js";

const BASE = "https://contestcal.test";

async function get(path: string): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`);
}

async function page(path: string): Promise<string> {
  const res = await get(path);
  expect(res.status, `${path} did not render`).toBe(200);
  return res.text();
}

// ---------------------------------------------------------------------------
// The filters and the catalog must agree about the vocabulary
// ---------------------------------------------------------------------------

describe("filter vocabulary", () => {
  it("offers exactly the modes the catalog records", () => {
    // A mode in the catalog with no filter is a contest nobody can find; a
    // filter with no records behind it is a dead control. Neither is visible
    // from inside either list alone.
    expect([...MODE_FAMILIES]).toEqual([...CATALOG_MODES]);
  });

  it("offers a band filter reachable from every band the catalog records", () => {
    // Not equality: the ladder is deliberately collapsed above 6m, so 2m
    // through 3cm all answer to VHF+. What must hold is that no recorded band
    // is unreachable.
    const unreachable = CATALOG_BANDS.filter((b) => bandFamilies([b]).length === 0);
    expect(unreachable).toEqual([]);
  });

  it("has no band filter that nothing in the catalog can match", () => {
    const reachable = new Set(CATALOG.flatMap((c) => bandFamilies(c.bands ?? [])));
    const dead = BAND_FAMILIES.filter((b) => !reachable.has(b));
    expect(dead, `filters no record can satisfy: ${dead.join(", ")}`).toEqual([]);
  });

  it("widens Digital to cover RTTY and FT8/FT4, and narrows FT8/FT4 to itself", () => {
    // The decision the brief asked for, asserted rather than described:
    // someone filtering "Digital" expects FT8 results and gets them; someone
    // filtering "FT8/FT4" asked a narrower question and gets a narrower answer.
    expect(modeFamilies(["RTTY"])).toContain("Digital");
    expect(modeFamilies(["FT8/FT4"])).toContain("Digital");
    expect(modeFamilies(["Digital"])).not.toContain("FT8/FT4");
    expect(modeFamilies(["Digital"])).not.toContain("RTTY");
  });

  it("shows a Mixed contest to anyone filtering a specific mode, not the reverse", () => {
    // A Mixed contest genuinely permits CW, so a CW operator wants to see it.
    // A CW-only contest is not what someone asking for Mixed meant.
    expect(modeFamilies(["Mixed"])).toContain("CW");
    expect(modeFamilies(["Mixed"])).toContain("SSB");
    expect(modeFamilies(["CW"])).not.toContain("Mixed");
  });

  it("publishes on /api/meta the same vocabulary it enforces", async () => {
    const body = (await (await get("/api/meta")).json()) as any;
    expect(body.modes).toEqual([...MODE_FAMILIES]);
    expect(body.bands).toEqual([...BAND_FAMILIES]);
    expect(body.ranges.map((r: any) => r.id)).toEqual(Object.keys(RANGE_PRESETS));
  });
});

describe("a record is shown as itself", () => {
  it("does not render an RTTY-only contest as RTTY/Digital", async () => {
    // The ARRL RTTY Roundup allows RTTY only -- ARRL's own words. The page used
    // to print the FILTER's widened view of the record, which claimed
    // otherwise; a row that overstates what a sponsor permits is worse than no
    // row at all.
    const html = await page("/?q=roundup&range=365d");
    expect(html).not.toContain(">RTTY/Digital<");
  });
});

// ---------------------------------------------------------------------------
// The form, without JavaScript
// ---------------------------------------------------------------------------

describe("the filter form", () => {
  it("is a GET form the Worker handles, and the CSP allows submitting it", async () => {
    const res = await get("/");
    const html = await res.text();

    expect(html).toContain('<form class="filters" method="get" action="/"');
    // `form-action 'none'` would block the submission outright, and the page
    // has to work with scripting off -- so this header is load-bearing, not
    // boilerplate.
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
  });

  it("ships every control in the markup rather than building it from script", async () => {
    const html = await page("/");
    for (const m of MODE_FAMILIES) expect(html).toContain(`name="mode" value="${m}"`);
    for (const b of BAND_FAMILIES) expect(html).toContain(`name="band" value="${b}"`);
    for (const d of Object.keys(DURATION_BUCKETS)) {
      expect(html).toContain(`name="duration" value="${d}"`);
    }
    for (const r of Object.keys(RANGE_PRESETS)) {
      expect(html).toContain(`name="range" value="${r}"`);
    }
    expect(html).toContain('name="q"');
    expect(html).toContain('name="sponsor"');
  });

  it("checks the boxes the URL asked for, so a shared link explains itself", async () => {
    const html = await page("/?mode=CW&band=20m&duration=lt2");
    expect(html).toMatch(/name="mode" value="CW" checked/);
    expect(html).toMatch(/name="band" value="20m" checked/);
    expect(html).toMatch(/name="duration" value="lt2" checked/);
    // And the panel opens itself, rather than hiding the reason the page looks
    // the way it does behind a closed disclosure.
    expect(html).toContain('<details class="panel" open>');
  });

  it("leaves the panel closed when nothing is filtered", async () => {
    expect(await page("/")).toContain('<details class="panel">');
  });

  it("keeps every checkbox focusable rather than hiding it from the keyboard", () => {
    // Styling checkboxes as chips is only acceptable while the input is still
    // there. `display: none` would take the whole form away from a screen
    // reader and from anyone tabbing -- on a page where this form IS the UI.
    expect(CSS).toContain(".chip input {");
    expect(CSS).not.toMatch(/\.chip input\s*\{[^}]*display:\s*none/);
  });

  it("offers this exact view as a subscription", async () => {
    // The filter params are the API's params, so the URL in the address bar is
    // already a valid feed. The link is that fact made usable.
    const html = await page("/?mode=CW&band=20m");
    expect(html).toMatch(/href="\/api\/ics\?[^"]*mode=CW/);
  });

  it("rejects an unknown range instead of quietly serving the default", async () => {
    // Same rule as the API: a typo'd param that behaves like no filter is how
    // someone believes they are looking at a filtered view and is not.
    expect((await get("/?range=forever")).status).toBe(400);
  });

  it("renders a filter that matches nothing without failing", async () => {
    expect((await get("/?mode=FT8%2FFT4&band=160m&duration=lt2")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

describe("date ranges", () => {
  it("changes what the page covers and names the range it is on", async () => {
    const html = await page("/?range=365d");
    expect(html).toMatch(/name="range" value="365d" checked/);
    expect(html).toContain("Next 12 months");
  });

  it("accepts an explicit span and echoes it back into the date inputs", async () => {
    const html = await page("/?from=2026-12-01&to=2026-12-31");
    expect(html).toContain('id="f-from" name="from" value="2026-12-01"');
    expect(html).toContain('id="f-to" name="to" value="2026-12-31"');
  });

  it("does not report an empty week to someone who asked about December", async () => {
    // The rail covers seven days from now. A window months out has no
    // seven-day section to be empty, and "nothing in the next 7 days" there
    // answers a question nobody asked.
    const html = await page("/?from=2027-12-01&to=2027-12-31");
    expect(html).not.toContain("in the next 7 days");
  });

  it("returns more contests as the range widens", async () => {
    const count = (html: string) =>
      (html.match(/<li class="row/g) ?? []).length;
    const week = count(await page("/?range=7d"));
    const year = count(await page("/?range=365d"));
    expect(year).toBeGreaterThan(week);
  });
});

// ---------------------------------------------------------------------------
// Empty states are directions, not apologies
// ---------------------------------------------------------------------------

describe("empty states", () => {
  // A search term nothing can match, rather than a filter combination that
  // happens to be empty today. The NCCC RTTY Sprint runs weekly on 160m for
  // thirty minutes, so "no RTTY contest under two hours" is true until it is
  // suddenly not, and a test that quietly starts passing for the wrong reason
  // is worse than no test.
  const NOTHING = "/?mode=RTTY&q=zzzqx&range=7d";

  it("names what was looked for and where, in the brief's own shape", async () => {
    // "No RTTY contests in the next 7 days. Try widening the date range."
    const html = await page(NOTHING);
    expect(html).toMatch(/No RTTY contests[^<]*in the next 7 days\./);
  });

  it("names the window the reader asked about, not the rail it sits in", async () => {
    // The seven-day rail still renders for a twelve-month query, but when
    // nothing matched anywhere, "nothing in the next 7 days" answers a narrower
    // question than the URL asked and hints at results further down that do not
    // exist.
    const html = await page("/?mode=RTTY&q=zzzqx&range=365d");
    expect(html).toMatch(/No RTTY contests[^<]*in the next 12 months\./);
    expect(html).not.toContain("in the next 7 days.");
  });

  it("never apologises", async () => {
    const html = await page(NOTHING);
    expect(html).not.toMatch(/sorry|unfortunately|no results found|nothing found/i);
  });

  it("offers the widening as a link that keeps the rest of the query", async () => {
    // A suggestion that silently drops the reader's other filters is not a
    // direction, it is a reset button wearing a sentence.
    const html = await page(NOTHING);
    const link = /href="\/\?([^"]*range=30d[^"]*)"/.exec(html);
    expect(link, "no widening link in the empty state").toBeTruthy();
    expect(link![1]).toContain("mode=RTTY");
    expect(link![1]).toContain("q=zzzqx");
  });

  it("points down the page instead of widening when there ARE later results", async () => {
    // Offering to widen a range that already contains what someone wants is
    // advice that makes the page worse.
    const html = await page("/?mode=Mixed&range=365d");
    if (html.includes("in the next 7 days")) {
      expect(html).toContain('href="#lg-later"');
    }
  });
});

// ---------------------------------------------------------------------------
// The edge of the data, declared
// ---------------------------------------------------------------------------

describe("unrecorded bands", () => {
  const unbanded = CATALOG.filter((c) => !(c.bands ?? []).length);

  it("has at least one record whose bands we could not read", () => {
    // If this ever fails because the last blocked source was sourced, delete
    // the tests below with it -- do not weaken them.
    expect(unbanded.length).toBeGreaterThan(0);
  });

  it("says so rather than letting a band filter hide the record", async () => {
    // Empty `bands` means "not read off the sponsor's page yet", so every band
    // filter necessarily excludes such a contest. Excluding it silently is the
    // exact failure this project exists to avoid; one line of prose is the fix.
    const html = await page(
      `/?band=20m&range=365d&q=${encodeURIComponent(unbanded[0].name)}`,
    );
    expect(html).toContain('class="caveat"');
    expect(html).toContain(unbanded[0].name);
  });

  it("stays quiet when no band filter is active", async () => {
    expect(await page("/")).not.toContain('class="caveat"');
  });
});
