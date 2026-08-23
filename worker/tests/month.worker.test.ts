/**
 * The month grid at `/month`.
 *
 * The schedule answers "what can I work this weekend". This answers "I am free
 * on the 14th and the 22nd — is anything on?", which a list cannot answer at a
 * glance. Three of its decisions are the kind that look like styling and are
 * not, so they are pinned here rather than left to a future tidy-up:
 *
 * A contest is shown on EVERY day it runs, not only the day it starts. A grid
 * that marked start days only would tell a reader who is free on Sunday that
 * nothing is on, while CQ WW is on the air — the exact wrong answer this view
 * was asked for to prevent.
 *
 * Cells are UTC days. The site converts times to local in the browser, but a
 * cell ASSIGNMENT cannot be converted after the fact, so the grid says which
 * clock it is bucketed by instead of quietly picking one.
 *
 * Weeks start Monday, so Saturday and Sunday are adjacent. Sunday-first splits
 * every weekend contest across two rows, which is the one shape this view
 * exists to show.
 */

import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

import { parseMonth } from "../src/render/month.js";

const BASE = "https://contestcal.test";
const get = async (path: string) => await SELF.fetch(BASE + path);
const page = async (path: string) => await (await get(path)).text();

/** The `<td>` for one ISO day, or "" if the grid has no such cell. */
function cellFor(html: string, iso: string): string {
  const re = new RegExp(
    `<td class="[^"]*">\\s*<p class="mo-dn">\\s*<time datetime="${iso}">[\\s\\S]*?</td>`,
  );
  return re.exec(html)?.[0] ?? "";
}

function namesIn(cell: string): string[] {
  return [...cell.matchAll(/<span class="mo-n">([^<]*)<\/span>/g)].map((m) => m[1]);
}

describe("the month grid", () => {
  it("renders seven Monday-first columns with the weekend adjacent", async () => {
    const html = await page("/month?m=2026-11");
    const head = /<thead>[\s\S]*?<\/thead>/.exec(html)![0];
    const cols = [...head.matchAll(/<abbr title="[^"]*">([^<]+)<\/abbr>/g)].map((m) => m[1]);
    expect(cols).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

    // Saturday and Sunday are the last two, so a weekend contest is two
    // neighbouring cells rather than the ends of two different rows.
    expect(cols.slice(5)).toEqual(["Sat", "Sun"]);
    const weekendHeaders = (head.match(/class="we"/g) ?? []).length;
    expect(weekendHeaders).toBe(2);
  });

  it("shows a weekend contest on BOTH its days, the second marked as continuing",
    async () => {
      // CQ WW CW 2026 runs 0000Z Sat 28 November to 2359Z Sun 29 November.
      const html = await page("/month?m=2026-11");

      const sat = cellFor(html, "2026-11-28");
      const sun = cellFor(html, "2026-11-29");
      expect(sat, "no cell for 28 November").not.toBe("");
      expect(sun, "no cell for 29 November").not.toBe("");

      expect(namesIn(sat)).toContain("CQ Worldwide DX Contest, CW");
      expect(namesIn(sun)).toContain("CQ Worldwide DX Contest, CW");

      // Saturday is the start and carries no continuation marker. Sunday is the
      // same running continuing, and says so -- otherwise the grid reads as two
      // separate contests that happen to share a name.
      expect(sat).not.toContain("mo-ev cont");
      expect(sun).toContain("mo-ev cont");
      expect(sun).toContain("continues: ");
    });

  it("shows names only, with no clock anywhere in the grid", async () => {
    // A month cell is a few centimetres wide and holds up to six contests. A
    // time against each one is the first thing to wrap or truncate the name,
    // and the reader's question at this zoom is "is anything on that Saturday",
    // not "at what hour" -- which is one tap away, on a page that can answer it
    // properly with the local/UTC toggle beside it.
    //
    // Asserted as the ABSENCE of a pattern rather than the presence of a
    // layout, because that is the thing that would creep back: one more useful
    // detail per cell, each defensible on its own.
    const html = await page("/month?m=2026-11");
    const grid = /<table class="mo-grid">[\s\S]*?<\/table>/.exec(html)![0];

    expect(grid).not.toMatch(/\d{3,4}Z/);      // 0000Z, 1200Z
    expect(grid).not.toMatch(/\d{1,2}:\d{2}/); // 00:00, 9:30

    // The names really are there -- otherwise this passes by rendering nothing.
    expect(grid).toContain("CQ Worldwide DX Contest, CW");
    expect((grid.match(/<span class="mo-n">/g) ?? []).length).toBeGreaterThan(20);

    // And no time controls, for the same reason: converting the times while
    // leaving cells on their UTC dates is half a conversion, which is worse
    // than none.
    expect(html).not.toContain('id="tzbar"');
    expect(html).not.toContain("Show times in");
  });

  it("shows a contest once per day, even when it runs twice that day", async () => {
    // Removing the clock made this visible. CWops Test runs two sessions per UTC
    // day (1300Z and 1900Z on the Wednesday); with times on the page they were
    // two distinguishable lines, and without them they were the SAME TITLE
    // PRINTED TWICE -- which reads as a rendering bug rather than as a fact
    // about the contest.
    //
    // So a contest is one line per day and says how many times it runs.
    const html = await page("/month?m=2026-11");
    const cell = cellFor(html, "2026-11-04");
    expect(cell, "no cell for 4 November").not.toBe("");

    const cwt = namesIn(cell).filter((n) => n.includes("CWops Test"));
    expect(cwt, "CWops Test should appear once, not once per session")
      .toHaveLength(1);
    expect(cell).toContain("&times;2");
    expect(cell).toContain("2 sessions");

    // The day count agrees with what is drawn. Counting occurrences instead of
    // contests would say 3 over a cell showing 2 lines.
    const shown = namesIn(cell).length;
    const badge = /<span class="mo-c">(\d+)<\/span>/.exec(cell);
    expect(Number(badge![1])).toBe(shown);
  });

  it("pulls in a contest that starts in the previous month", async () => {
    // The grid's first row reaches back to the Monday on or before the 1st. A
    // contest running across that boundary has to appear there, or the first
    // week of the month is silently wrong.
    const html = await page("/month?m=2026-11");
    const lead = cellFor(html, "2026-10-26");
    expect(lead, "no leading cell from October").not.toBe("");
    // Leading and trailing cells are dimmed as not-this-month.
    expect(/<td class="[^"]*\bout\b[^"]*"/.test(html)).toBe(true);
  });

  it("describes the month without overclaiming, and counts contests", async () => {
    const html = await page("/month?m=2026-11");
    const d = /<meta name="description" content="([^"]*)">/.exec(html)![1];

    // Same overclaim just removed from the landing page: this said "Every
    // amateur radio contest running in November 2026", and the catalog is
    // explicitly not every contest.
    expect(d).not.toMatch(/(every|all)\s+amateur radio contest/i);
    expect(d).toMatch(/^\d+ amateur radio contests? running in November 2026/);
    expect(d.length).toBeLessThanOrEqual(160);

    // The number is DISTINCT CONTESTS, not occurrences. Counting occurrences
    // said 89 for a month in which CWops Test alone contributes eight.
    const n = Number(/^(\d+)/.exec(d)![1]);
    const ids = new Set(
      [...html.matchAll(/href="\/contest\/([^"?]+)/g)].map((m) => m[1]),
    );
    expect(n).toBeLessThan(89);
    expect(n).toBeLessThanOrEqual(ids.size);
    expect(html).toContain(`${n} contests running this month`);
  });

  it("says which clock the cells are bucketed by", async () => {
    // A reader several zones west sees a 2200Z contest sitting on a date that
    // is the evening before where they are. That is correct and surprising, so
    // the page states it rather than letting it be discovered.
    const html = await page("/month?m=2026-11");
    expect(html).toContain("Days are UTC");
  });

  it("carries the reader's filters into the grid and out of it", async () => {
    const all = await page("/month?m=2026-11");
    const cw = await page("/month?m=2026-11&mode=CW");

    const count = (h: string) => (h.match(/<span class="mo-n">/g) ?? []).length;
    expect(count(cw)).toBeGreaterThan(0);
    expect(count(cw)).toBeLessThan(count(all));

    // Every way out of this page keeps the query, the same as the detail view:
    // a reader who narrowed to CW and pages to December stays narrowed.
    expect(cw).toContain('href="/month?mode=CW&amp;m=2026-12"');
    expect(cw).toContain('href="/month?mode=CW&amp;m=2026-10"');
    expect(cw).toContain('href="/?mode=CW"');
  });

  it("says what a band filter had to hide", async () => {
    // Empty `bands` means unrecorded, not unbanded, so every band filter
    // necessarily drops such a record. Same invariant the schedule prints.
    //
    // January, because that is where an empty-band record actually falls: the
    // JARL New Year QSO Party, whose rules say "all amateur bands" and so have
    // no list to record. A month without one would pass this test vacuously.
    const html = await page("/month?m=2026-01&band=20m");
    expect(html).toContain("recorded their bands");
    expect(html).toContain("New Year QSO Party");
  });

  it("refuses a malformed month rather than showing a different one", async () => {
    for (const bad of ["2026-13", "26-01", "banana", "2026-00", "1200-01"]) {
      const r = await get(`/month?m=${encodeURIComponent(bad)}`);
      expect(r.status, bad).toBe(400);
    }
    expect((await get("/month?m=2026-11")).status).toBe(200);
    // No `m` at all is the current month, not an error.
    expect((await get("/month")).status).toBe(200);
  });

  it("parses months without a request", () => {
    const now = Date.UTC(2026, 7, 21);
    expect(parseMonth(null, now)).toEqual({ year: 2026, month: 8 });
    expect(parseMonth("2027-01", now)).toEqual({ year: 2027, month: 1 });
    expect(parseMonth("2026-13", now)).toBeNull();
    expect(parseMonth("2026-1", now)).toBeNull();
    expect(parseMonth("", now)).toEqual({ year: 2026, month: 8 });
  });

  it("is reachable from the schedule, carrying the query", async () => {
    const html = await page("/?mode=CW");
    expect(html).toContain("Month view");
    expect(html).toContain('href="/month?mode=CW"');
  });

  it("links each contest to its detail page, not the sponsor", async () => {
    // Same rule as the schedule rows: the name goes to this site's own record,
    // so the reader's query survives and the sponsor link is one deliberate
    // click away rather than an accidental exit.
    const html = await page("/month?m=2026-11");
    expect(html).toContain('href="/contest/cq-ww-cw?m=2026-11"');
    // Nothing in the grid leaves the site, so nothing needs target=_blank.
    const grid = /<table class="mo-grid">[\s\S]*?<\/table>/.exec(html)![0];
    expect(grid).not.toContain("http://");
    expect(grid).not.toContain("https://");
  });

  it("renders an empty grid without breaking", async () => {
    // NO MONTH IS EVER EMPTY of its own accord -- rule-based recurrences expand
    // for any year, so even February 2099 holds 62 contests. The empty case is
    // reachable only through a filter, which is also the way a reader will
    // actually meet it: one contest, in a month it does not run.
    const r = await get("/month?m=2026-01&id=ww-digi");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("0 contests running this month");
    // The grid is still a grid: an empty month must not collapse to nothing,
    // or the reader cannot tell "nothing on" from "page broken".
    expect(html).toContain("mo-grid");
    expect((html.match(/<td class="mo-day/g) ?? []).length).toBeGreaterThan(27);
  });
});
