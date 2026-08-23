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

    // The start day is marked as the start; the rest continue. Asserted on
    // VK9XY'S OWN entry rather than on the whole cell: C8K runs 9-20 November
    // and is a continuation on both of these days, so a cell-level check said
    // nothing about VK9XY once a second operation overlapped it.
    const entryFor = (iso: string) =>
      /<li class="mo-ev dx( cont)?">(?:(?!<\/li>)[\s\S])*?VK9XY[\s\S]*?<\/li>/
        .exec(cellFor(iso))?.[0] ?? "";
    // Both halves must MATCH something first: an empty string trivially
    // satisfies not.toContain("cont"), so without this the start-day assertion
    // would pass on a regex that found nothing at all.
    expect(entryFor("2026-11-16"), "no VK9XY entry on its start day").not.toBe("");
    expect(entryFor("2026-11-20"), "no VK9XY entry on a later day").not.toBe("");
    expect(entryFor("2026-11-16"), "start day").not.toContain("cont");
    expect(entryFor("2026-11-20"), "a later day").toContain("cont");

    // ...and the day really does carry a second operation, which is what made
    // the old cell-level assertion meaningless.
    expect(cellFor("2026-11-16")).toContain("C8K");
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
          .toMatch(/unrecorded|not recorded|band plan/i);
      }
      expect(d.source_note.length, `${d.id} has no provenance`).toBeGreaterThan(40);
      expect(d.url_checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("shows DXpeditions on the schedule, in a section of their own", async () => {
    const html = await page("/");
    expect(html).toContain('id="lg-dx"');
    expect(html).toContain("RI1FJL");
    // Directly under the live contests: an operation on the air right now is
    // the most perishable thing on the page.
    const live = html.indexOf('id="lg-live"') >= 0
      ? html.indexOf('id="lg-live"')
      : 0;
    expect(html.indexOf('id="lg-dx"')).toBeGreaterThan(live);
    expect(html.indexOf('id="lg-dx"')).toBeLessThan(html.indexOf('id="lg-week"'));
  });

  it("keeps DXpeditions out of the contest counts and the rail", async () => {
    // The tally says CONTESTS and a reader adds it up; and the rail is a
    // duration chart, where a nineteen-day operation drawn on a seven-day axis
    // is a full-width bar that says nothing.
    const html = await page("/");
    const rail = /<div class="rail"[\s\S]*?<\/ol>/.exec(html)?.[0] ?? "";
    expect(rail, "a DXpedition reached the 7-day rail").not.toContain("RI1FJL");

    const tot = Number(/<li class="tot"><b>(\d+)<\/b>/.exec(html)![1]);
    const week = Number(/id="lg-week">Next 7 days<span class="count">(\d+)</.exec(html)![1]);
    const dx = Number(/id="lg-dx">DXpeditions<span class="count">(\d+)</.exec(html)![1]);
    expect(dx).toBeGreaterThan(0);
    // The total counts contests only, so adding the DX count must exceed it.
    expect(tot).toBeGreaterThanOrEqual(week);
    expect(tot + dx).toBeGreaterThan(tot);
  });

  it("emits no <time> for a DXpedition's day range", async () => {
    // The client converts every <time> it finds. A DXpedition has no instant --
    // it is a range of whole UTC days -- so a bare date would be parsed in the
    // reader's own zone and could land a day out, and a fabricated T00:00:00Z
    // would invent an hour the team never published. The existing
    // "never emits a bare local-time string" test caught this when the first
    // version used <time datetime="2026-08-13">.
    const html = await page("/");
    const section = /<section aria-labelledby="lg-dx">[\s\S]*?<\/section>/.exec(html)![0];
    expect(section).not.toContain("<time");
    expect(section).toContain('<span class="dxd">2026-08-13</span>');
  });

  it("does not filter DXpeditions by the contest filters", async () => {
    // A band filter would hide every one of them, because none has had its band
    // plan read and empty means unrecorded -- the reader would lose a rare
    // entity over a gap in THIS catalog rather than anything about the
    // operation. The page says it is unfiltered rather than leaving it to be
    // discovered.
    for (const q of ["/", "/?mode=CW", "/?band=20m", "/?mode=SSB&band=40m"]) {
      const html = await page(q);
      expect(html, `${q}: DXpeditions vanished under a filter`).toContain("RI1FJL");
    }
    expect(await page("/")).toContain("not filtered by your selection");
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

  it("never lists a record as both plotted and unscheduled", () => {
    // Adding the `approximate` level turned undatedDXpeditions()'s negative
    // predicate into a bug the moment it was written -- `!== "exact"` would
    // have put an approximate operation on the calendar AND under "dates still
    // to come", which are contradictory claims about the same record.
    const plotted = new Set(datedDXpeditions().map((d) => d.id));
    for (const d of undatedDXpeditions()) {
      expect(plotted.has(d.id), `${d.id} is both plotted and unscheduled`)
        .toBe(false);
      expect(d.precision).toBe("month");
    }
    // Together they account for everything: no record falls through.
    expect(plotted.size + undatedDXpeditions().length).toBe(DXPEDITIONS.length);
  });

  it("marks an approximate window instead of passing it off as published", async () => {
    // RI1FJL is the case that forced the level to exist: the team published a
    // departure, a crossing and a duration, not days. It IS plotted -- refusing
    // to show an operation on the air right now fails the reader -- but it must
    // never look like a schedule the team issued.
    const approx = DXPEDITIONS.filter((d) => d.precision === "approximate");
    expect(approx.length).toBeGreaterThan(0);
    for (const d of approx) {
      expect(d.note, `${d.id} does not show its arithmetic`)
        .toMatch(/departure|crossing|duration|arithmetic/i);
    }
    const grid = await page("/month?m=2026-08");
    expect(grid).toContain("RI1FJL");
    expect(grid).toContain("approximate dates");

    // ...and /dx shows its WINDOW, not the month-precision wording. The first
    // version branched on exact-vs-everything-else and printed "dates not yet
    // published" over a record that was on the air with a window in it.
    const dx = await page("/dx");
    const card = /id="ri1fjl-2026"[\s\S]*?<\/article>/.exec(dx)![0];
    expect(card).toContain("Aug 2026");
    expect(card).not.toContain("dates not yet published");
    expect(card).toContain("approximate");
  });

  it("has a coherent span for every record", () => {
    for (const d of DXPEDITIONS) {
      const { from, to } = spanOf(d);
      expect(to, `${d.id} ends before it starts`).toBeGreaterThan(from);
      expect(d.start <= d.end, `${d.id} start after end`).toBe(true);
      expect(["exact", "approximate", "month"]).toContain(d.precision);
    }
  });
});
