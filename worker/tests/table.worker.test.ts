/**
 * The schedule table: grouping, sorting, the card twin, and the CSV export.
 *
 * Grouping is the claim that matters. A contest that runs four times in a week
 * is one entry with four sessions; if a regression split it back into rows the
 * page would still render and the count in the heading would quietly double.
 */

import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

import { csvField, CSV_COLUMNS } from "../src/api.js";
import { DEFAULT_SORT, parseSort } from "../src/render/landing.js";

const BASE = "https://contestcal.test";
const get = async (path: string) => await SELF.fetch(BASE + path);
const page = async (path: string) => await (await get(path)).text();

const rowNames = (html: string) =>
  [...html.matchAll(/<tr class="crow"><th scope="row" class="c-name"><span class="row-name"><a [^>]*>([^<]*)</g)].map(
    (m) => m[1],
  );

describe("parseSort", () => {
  it("defaults to date ascending and ignores unknown keys", () => {
    expect(parseSort(new URLSearchParams())).toEqual(DEFAULT_SORT);
    expect(parseSort(new URLSearchParams("sort=nonsense&dir=desc"))).toEqual(DEFAULT_SORT);
    expect(parseSort(new URLSearchParams("sort=band&dir=desc"))).toEqual({ key: "band", dir: "desc" });
    expect(parseSort(new URLSearchParams("sort=band&dir=sideways"))).toEqual({ key: "band", dir: "asc" });
  });
});

describe("the landing table", () => {
  it("has the nine columns, each a sort link", async () => {
    const html = await page("/");
    const head = /<thead>(.*?)<\/thead>/s.exec(html)![1];
    const labels = [...head.matchAll(/<a href="[^"]*sort=[^"]*">([^<]*)/g)].map((m) => m[1]);
    expect(labels).toEqual([
      "Contest", "Date", "Start", "End", "Duration", "Mode", "Band", "Sponsor", "Starts in",
    ]);
  });

  it("has one row per contest and removes the rail", async () => {
    const html = await page("/");
    for (const section of html.split("<table").slice(1)) {
      const names = rowNames(section.split("</table>")[0]);
      expect(new Set(names).size, "a contest appears in two rows of one table").toBe(names.length);
    }
    expect(html).not.toContain('class="ruler');
    expect(html).not.toContain('class="track');
  });

  it("shows a sort affordance on every column, not only the active one", async () => {
    const html = await page("/?sort=sponsor");
    const head = /<thead>(.*?)<\/thead>/s.exec(html)![1];
    const inds = [...head.matchAll(/class="sort-ind"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(inds).toHaveLength(9);
    expect(inds.filter((x) => x.includes("⇅"))).toHaveLength(8);
  });

  it("marks the active column with aria-sort and flips direction on the next link", async () => {
    const html = await page("/?sort=sponsor&dir=asc");
    expect(html).toMatch(/<th scope="col" class="c-sp" aria-sort="ascending"><a href="[^"]*dir=desc/);
  });

  it("changes the order when sorted by contest name", async () => {
    const asc = rowNames(/<table.*?<\/table>/s.exec(await page("/?sort=contest&dir=asc"))![0]);
    const desc = rowNames(/<table.*?<\/table>/s.exec(await page("/?sort=contest&dir=desc"))![0]);
    if (asc.length > 1) {
      expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, "en", { numeric: true })));
      expect(desc).toEqual([...asc].reverse());
    }
  });

  it("clamps the sponsor to two lines and keeps the full name as a title", async () => {
    const html = await page("/");
    const cells = [...html.matchAll(/<td class="c-sp"><span class="clamp2" title="([^"]+)">([^<]+)<\/span>/g)];
    expect(cells.length).toBeGreaterThan(0);
    for (const [, title, text] of cells) expect(title).toBe(text);
  });

  it("sets each mode as its own chip, so a multi-mode cell wraps between modes", async () => {
    const html = await page("/");
    const cell = /<td class="c-mode">((?:(?!<\/td>).)*)<\/td>/s.exec(html)![1];
    expect(cell).toContain('<span class="mchips">');
    expect(cell).not.toContain("<wbr>");
  });

  it("renders the card twin alongside, so CSS alone decides which shows", async () => {
    const html = await page("/");
    expect(html).toContain('<ol class="gcards">');
    expect((html.match(/<li class="gcard">/g) ?? []).length).toBe(
      (html.match(/<tr class="crow"/g) ?? []).length,
    );
  });

  it("puts CSV and print above the first table, ahead of the footer", async () => {
    const html = await page("/?mode=CW");
    expect(html).toMatch(/href="\/api\/csv\?[^"]*mode=CW[^"]*" download/);
    expect(html.indexOf('class="tbl-tools"')).toBeLessThan(html.indexOf('<table class="ctab">'));
    expect(html.indexOf('id="printbtn"')).toBeLessThan(html.indexOf('<footer'));
    expect(html).toContain("<noscript>");
    expect(html).toMatch(/<button type="button" class="linkbtn" id="printbtn" hidden>/);
  });
});

describe("the month table", () => {
  it("lists the month's sessions in the same table", async () => {
    const html = await page("/month?m=2026-11");
    expect(html).toContain('id="lg-month-table"');
    expect(html).toContain('<table class="ctab">');
  });
});

describe("csvField", () => {
  it("quotes separators and neutralises spreadsheet formulas", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("@x")).toBe("'@x");
  });
});

describe("/api/csv", () => {
  it("is an attachment with a header row and CRLF endings", async () => {
    const res = await get("/api/csv?mode=CW");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    const lines = text.split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(Number(res.headers.get("x-csv-rows"))).toBe(lines.filter(Boolean).length - 1);
  });

  it("answers on /contests.csv and honours the filter", async () => {
    const all = Number((await get("/contests.csv")).headers.get("x-csv-rows"));
    const one = Number((await get("/contests.csv?id=cq-ww-cw&from=2026-11-01&to=2026-12-31")).headers.get("x-csv-rows"));
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThanOrEqual(all);
  });
});
