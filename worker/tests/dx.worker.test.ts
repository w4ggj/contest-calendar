/**
 * DXpeditions.
 *
 * A different kind of record from a contest, added because they drive a lot of
 * activity and belong on an operator's calendar. Three of the rules that keep
 * them honest are pinned here, and each one exists because the obvious
 * implementation gets it wrong.
 *
 * **A month-precision announcement is never drawn on a calendar.** Teams
 * announce "March 2027" long before they announce days. Plotting that across
 * thirty-one cells claims a month of operating nobody announced; plotting it on
 * a guessed fortnight invents the one fact a reader came for.
 *
 * **A finished operation is kept, not deleted.** The team's own site usually
 * goes dark or turns into a QRT notice within months -- desecheo2026.com
 * already reads "Officially QRT" with its own dates gone -- so this record ends
 * up being the surviving statement of when the entity was last on the air.
 *
 * **They stay out of the contest catalog.** The engine, the parity suite and
 * every "N contests" count must be untouched by adding one.
 */

import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

import { CATALOG } from "../src/catalog.js";
import {
  DXPEDITIONS,
  datedDXpeditions,
  dxInRange,
  hasEnded,
  spanOf,
  undatedDXpeditions,
} from "../src/dx.js";

const BASE = "https://contestcal.test";
const page = async (p: string) => await (await SELF.fetch(BASE + p)).text();

describe("DXpeditions", () => {
  it("serves /dx and groups by what a reader can act on", async () => {
    const r = await SELF.fetch(BASE + "/dx");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Coming up");
    expect(html).toContain("Announced, dates still to come");
    for (const d of DXPEDITIONS) {
      expect(html, `${d.id} missing from /dx`).toContain(d.callsign);
    }
  });

  it("never plots a month-precision announcement on the calendar", async () => {
    // VP0SG is permitted for "March 2027" with no days published. It must be
    // listed and must not appear in any cell of the March 2027 grid.
    const undated = undatedDXpeditions();
    expect(undated.length, "no month-precision record to test with")
      .toBeGreaterThan(0);

    for (const d of undated) {
      expect(datedDXpeditions()).not.toContain(d);
      expect(dxInRange(Date.parse("2020-01-01"), Date.parse("2035-01-01")))
        .not.toContain(d);
    }

    const march = await page("/month?m=2027-03");
    const grid = /<table class="mo-grid">[\s\S]*?<\/table>/.exec(march)![0];
    for (const d of undated) {
      expect(grid, `${d.callsign} was plotted despite having no dates`)
        .not.toContain(d.callsign);
    }
    // ...but it is on /dx, with the window as the team stated it.
    const dx = await page("/dx");
    expect(dx).toContain("dates not yet published");
    expect(dx).toContain("March 2027");
  });

  it("plots a dated operation on every day it covers", async () => {
    // VK9XY runs 16 Nov to 4 Dec 2026. A reader free on any of those days
    // should see it, the same rule the contests follow and for a stronger
    // reason: a rare entity may not be back for a decade.
    const nov = await page("/month?m=2026-11");
    const grid = /<table class="mo-grid">[\s\S]*?<\/table>/.exec(nov)![0];

    const cellFor = (iso: string) =>
      new RegExp(
        `<td class="[^"]*">\\s*<p class="mo-dn">\\s*<time datetime="${iso}">[\\s\\S]*?</td>`,
      ).exec(grid)?.[0] ?? "";

    expect(cellFor("2026-11-16"), "start day").toContain("VK9XY");
    expect(cellFor("2026-11-20"), "a middle day").toContain("VK9XY");
    expect(cellFor("2026-11-30"), "a later day").toContain("VK9XY");
    // The day before it starts must be clear, or the range is off by one.
    expect(cellFor("2026-11-15")).not.toContain("VK9XY");

    // The start day is marked as the start; the rest continue.
    expect(cellFor("2026-11-16")).not.toContain("mo-ev dx cont");
    expect(cellFor("2026-11-20")).toContain("cont");
  });

  it("keeps a finished operation rather than deleting it", () => {
    const future = Date.parse("2030-01-01");
    for (const d of DXPEDITIONS) {
      expect(hasEnded(d, future), `${d.id} should read as ended by 2030`).toBe(true);
    }
    // Still present: the record outlives the team's website.
    expect(DXPEDITIONS.length).toBeGreaterThan(0);
  });

  it("does not touch the contest catalog", async () => {
    // The whole reason they live in their own file. Adding a DXpedition must
    // not change a contest count, a contest date, or the engine.
    const ids = new Set(CATALOG.map((c) => c.id));
    for (const d of DXPEDITIONS) {
      expect(ids.has(d.id), `${d.id} leaked into the contest catalog`).toBe(false);
    }
    // The landing page still counts contests, not contests plus DXpeditions.
    const home = await page("/");
    const desc = /<meta name="description" content="([^"]+)">/.exec(home)![1];
    expect(desc).toMatch(new RegExp(`^${CATALOG.length} amateur radio contests`));
  });

  it("records what it has not read, rather than guessing it", () => {
    // Same invariant as the contest catalog: an empty band list means nobody
    // has read the team's band plan, not that the operation has no bands. An
    // invented band list on a nineteen-day operation would be read as a plan.
    for (const d of DXPEDITIONS) {
      expect(Array.isArray(d.bands)).toBe(true);
      if (!d.bands.length) {
        expect(d.note, `${d.id} has no bands and does not say so`)
          .toMatch(/not recorded|band plan/i);
      }
      expect(d.source_note.length, `${d.id} has no provenance`).toBeGreaterThan(40);
      expect(d.url_checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("is reachable from the schedule and the month grid", async () => {
    expect(await page("/")).toContain('href="/dx"');
    expect(await page("/month?m=2026-11")).toContain('href="/dx"');
  });

  it("links out to the team, not to an announcement list", async () => {
    // The sourcing rule, enforced on the rendered page. NG3K, DX-World, DXZone
    // and the rest are how you learn an operation exists; they are never the
    // source of its dates, and this page must not send a reader to one as if
    // they were.
    const html = await page("/dx");
    const external = [...html.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => !u.includes("contestcal.test"));
    expect(external.length).toBeGreaterThan(0);
    for (const u of external) {
      expect(u, `${u} is an aggregator`).not.toMatch(
        /ng3k\.com|dx-world\.net|dxzone\.com|dxping\.com|425dxn|brokensignal/i,
      );
    }
    for (const d of DXPEDITIONS) {
      expect(external, `${d.id} does not link its own team`).toContain(d.url);
    }
  });

  it("has a coherent span for every record", () => {
    for (const d of DXPEDITIONS) {
      const { from, to } = spanOf(d);
      expect(to, `${d.id} ends before it starts`).toBeGreaterThan(from);
      expect(d.start <= d.end, `${d.id} start after end`).toBe(true);
      expect(["exact", "month"]).toContain(d.precision);
    }
  });
});
