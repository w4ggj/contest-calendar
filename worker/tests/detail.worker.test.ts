/**
 * The contest detail view.
 *
 * Two kinds of claim are pinned here and they fail for different reasons.
 *
 * The first is that the page says what the catalog holds and no more. A field
 * nobody has read off the sponsor's page must render as "not recorded yet"
 * rather than be omitted, because an absent Exchange row reads as "there is
 * nothing to send" -- a claim about the contest rather than about our coverage.
 * Same for bands, where the consequence is sharper: an empty band list means
 * every band filter on the schedule hides this contest, and the reader is
 * entitled to know that while looking at it.
 *
 * The second is that the rule is stated in a person's language. `describeRule`
 * had four holes in it, all of them live in the catalog and all of them
 * invisible while the rule only appeared in a JSON field nobody read: WIA's
 * `nearest_weekday` printed the rule TYPE out loud, NZART's April-and-August
 * sprints claimed to run every Tuesday of the year, BFRA's `n: -2` came out as
 * "-2th full weekend of November", and ARRL RTTY Roundup's New Year exception
 * was not mentioned at all. The catalog-wide test below is the one that keeps
 * them closed: it fails on any record whose rule renders as its own type.
 */

import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

import { CATALOG } from "../src/catalog.js";
import { SITE_NAME } from "../src/render/html.js";
import { CSS } from "../src/render/theme.js";
import {
  describeRule,
  describeSchedule,
  contestById,
  nextOccurrences,
} from "../src/schedule.js";
import { googleCalendarHref } from "../src/render/detail.js";

const BASE = "https://contestcal.test";
const get = async (path: string) => await SELF.fetch(BASE + path);
const page = async (path: string) => await (await get(path)).text();

const RULE_TYPES = [
  "nth_full_weekend", "nth_weekday", "fixed_date", "nearest_weekday",
  "monthly_nth_weekday", "weekly", "multi_weekend", "composite", "manual",
];

describe("the rule, in plain language", () => {
  it("never prints a rule type out loud, for any record in the catalog", () => {
    // The general form of all four bugs above: a rule the switch does not
    // handle falls through and the page tells the reader "nearest_weekday".
    for (const c of CATALOG) {
      const plain = describeRule(c.recurrence);
      for (const t of RULE_TYPES) {
        expect(plain, `${c.id} renders as its rule type`).not.toContain(t);
      }
      expect(plain, `${c.id} has no plain-language rule`).not.toBe("");
    }
  });

  it("names the day WIA's rule is anchored to", () => {
    // "Weekend in August closest to the 15th" -- the rule type had no case.
    expect(describeRule(contestById("wia-remembrance-day")!.recurrence)).toBe(
      "Saturday nearest August 15",
    );
  });

  it("keeps the months on a rule that only runs in some of them", () => {
    // NZART: "each Tuesday in April and August". Dropping the months turned a
    // six-running-a-year sprint into a weekly one.
    expect(describeRule(contestById("nzart-sprint-cw")!.recurrence)).toBe(
      "Every Tuesday in April and August",
    );
  });

  it("counts backwards past last, the way BFRA states it", () => {
    // "The weekend before the last full weekend of November", encoded n = -2.
    expect(describeRule(contestById("bfra-lz-dx")!.recurrence)).toBe(
      "Second-to-last full weekend of November",
    );
  });

  it("states the exception, and what happens instead", () => {
    // exclude_dates does not skip the running -- the engine pushes the anchor
    // a week. A phrase that said only "except 1 January" would describe a rule
    // this calendar does not implement.
    const plain = describeRule(contestById("arrl-rtty-roundup")!.recurrence);
    expect(plain).toContain("First full weekend of January");
    expect(plain).toContain("1 January");
    expect(plain).toContain("the weekend after");
  });

  it("states the clock the way a rules page does", () => {
    // Read off the offsets, so it holds for every year rather than for the
    // next one. CQ WW anchors on the Saturday of a full weekend.
    expect(describeSchedule(contestById("cq-ww-cw")!)).toEqual([
      "0000Z Saturday → 2359Z Sunday",
    ]);
  });

  it("gives a contest with sessions one line per session", () => {
    // CWT is four one-hour runnings off a Wednesday anchor, two of which land
    // on the Thursday. Collapsing them to a single window would claim a
    // nineteen-hour contest.
    const cwt = describeSchedule(contestById("cwops-cwt")!);
    expect(cwt).toHaveLength(4);
    expect(cwt[0]).toBe("1300Z → 1400Z Wednesday");
    expect(cwt[3]).toBe("0700Z → 0800Z Thursday");
  });

  it("does not put a Z on a time that is not UTC", () => {
    // ARS Spartan Sprint is 2000 in New York: 0000Z in winter, 2300Z in
    // summer. Printing either as "the" time is wrong half the year.
    const spartan = describeSchedule(contestById("ars-spartan-sprint")!);
    expect(spartan[0]).not.toContain("Z");
    expect(spartan[0]).toContain("2000");
  });
});

describe("GET /contest/:id", () => {
  it("serves the contest, and 404s an id that is not one", async () => {
    const ok = await get("/contest/cq-ww-cw");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/html");

    const missing = await get("/contest/no-such-contest");
    expect(missing.status).toBe(404);
  });

  it("leads with the rule and the sponsor's own rules link", async () => {
    const html = await page("/contest/cq-ww-cw");
    expect(html).toContain("Last full weekend of November");
    expect(html).toContain("0000Z Saturday → 2359Z Sunday");

    // The sponsor holds the rules. That link is the first thing on the page,
    // and it leaves this site, so it carries both halves of the outbound rule.
    const rules = /<a class="btn primary" href="([^"]+)"([^>]*)>/.exec(html);
    expect(rules, "no rules link on the detail page").not.toBeNull();
    expect(rules![1]).toBe(contestById("cq-ww-cw")!.rules_url);
    expect(rules![2]).toContain('target="_blank"');
    expect(rules![2]).toContain('rel="noopener external"');
  });

  it("names the contest and the site in the title and description", async () => {
    const html = await page("/contest/cq-ww-cw");
    const title = /<title>([^<]+)<\/title>/.exec(html)!;
    expect(title[1]).toContain("CQ Worldwide DX Contest");
    expect(title[1]).toContain(SITE_NAME);
    expect(/<meta name="description" content="([^"]{40,})">/.test(html)).toBe(true);
  });

  it("is complete with no JavaScript: every time is a UTC instant", async () => {
    // Same rule as the schedule. The client script converts and ticks; it does
    // not supply anything, and a page that renders blank without it would be a
    // regression against the whole design.
    const html = await page("/contest/cq-ww-cw");
    const times = [...html.matchAll(/<time datetime="([^"]+)"/g)].map((m) => m[1]);
    expect(times.length, "no machine-readable times").toBeGreaterThan(0);
    for (const t of times) {
      expect(t, "a time that is not a UTC instant").toMatch(/Z$/);
      expect(Number.isNaN(Date.parse(t))).toBe(false);
    }
  });
});

describe("what the record does not say", () => {
  it("says a missing exchange is unrecorded, not absent", async () => {
    // 24 records carry no exchange. Omitting the row would say "nothing to
    // send", which is a different claim from "we have not read it".
    const html = await page("/contest/arrl-rtty-roundup");
    expect(contestById("arrl-rtty-roundup")!.exchange).toBeUndefined();
    expect(html).toContain("Exchange");
    expect(html).toContain("not recorded yet");
  });

  it("says out loud that unrecorded bands are hidden by every band filter", async () => {
    // jarl-new-year-qso-party: JARL states only "All bands and Modes permitted
    // for JA amateur radio stations", so there is no band list to record and
    // inferring one from the Japanese band plan would be this catalog writing
    // a rule JARL did not. Empty bands means unrecorded, not unbanded -- and
    // the consequence for the reader is that a band filter drops it.
    //
    // This was sarl-hf-phone until 2026-08-19, when SARL's rules became
    // readable again at mysarl.org.za and its bands were recorded. One record
    // is in this state now, which is the point: the fixture has to be a record
    // that is ACTUALLY unrecorded, or the test stops proving anything.
    expect(contestById("jarl-new-year-qso-party")!.bands).toEqual([]);
    const html = await page("/contest/jarl-new-year-qso-party");
    expect(html).toContain("every band filter on the schedule hides this contest");
  });

  it("says plainly when a record has not been checked against the sponsor", async () => {
    const html = await page("/contest/agcw-zap-merit");
    expect(contestById("agcw-zap-merit")!.verified).toBe(false);
    expect(html).toContain("unverified");
    expect(html).toContain("have not been checked against");
  });

  it("quotes the source the record was read from", async () => {
    // The sentence a date can be argued with. Without it the page asserts.
    const contest = contestById("wia-remembrance-day")!;
    const html = await page("/contest/wia-remembrance-day");
    expect(html).toContain("Where this comes from");
    expect(html).toContain("Weekend in August closest to the 15th");
    expect(contest.source_note).toBeTruthy();
  });

  it("explains an empty schedule rather than showing an empty list", async () => {
    // FISTS suspended its sprints; the record is closed at 2025. A list with
    // nothing in it and no sentence reads as a bug in this site.
    const html = await page("/contest/fists-sprint-winter-sat");
    expect(html).toContain("Next runnings");
    expect(html).toContain("2025");
    expect(html).toContain("closed, not missing");
  });

  it("says a manual record only holds the years the sponsor published", async () => {
    // RAC announces a date a year at a time and no ordinal fits the eight they
    // have published, so years they have not announced are simply absent.
    const html = await page("/contest/rac-canada-winter");
    expect(html).toContain("a year at a time");
    expect(html).toContain("2026");
  });
});

describe("the reader's filters survive the trip", () => {
  it("carries the query into the detail link on every row", async () => {
    const html = await page("/?mode=CW&range=365d");
    const links = [...html.matchAll(/class="row-name"><a href="([^"]+)"/g)].map((m) => m[1]);
    expect(links.length, "no rows on the filtered schedule").toBeGreaterThan(0);
    for (const href of links) {
      expect(href).toMatch(/^\/contest\//);
      expect(href, "row link dropped the reader's filters").toContain("mode=CW");
      expect(href).toContain("range=365d");
    }
  });

  it("carries it back again from the detail page", async () => {
    // Arriving from a filtered view and returning to it should not depend on
    // the back button restoring form state it often does not.
    const html = await page("/contest/cq-ww-cw?mode=CW&band=20m");
    expect(html).toContain('href="/?mode=CW&amp;band=20m"');
  });

  it("rejects a filter value the schedule would reject", async () => {
    // The query is handed back as a link. A value that 400s on `/` must not be
    // rendered here as a link that 400s when the reader follows it home.
    const bad = await get("/contest/cq-ww-cw?mode=CQ");
    expect(bad.status).toBe(400);
  });
});

describe("subscribing to one contest", () => {
  it("names the record exactly, not by substring", async () => {
    // `q=bartg-sprint` also matches BARTG Sprint 75 and BARTG Sprint PSK63 --
    // five records in the catalog have an id or name containing another one.
    // A per-contest subscription that quietly carries a second contest is the
    // failure this whole project is arranged around avoiding, so the feed link
    // filters on the exact id.
    const html = await page("/contest/bartg-sprint");
    expect(html).toContain('href="/api/ics?id=bartg-sprint"');

    const feed = await (await get("/api/ics?id=bartg-sprint")).text();
    const summaries = new Set(
      [...feed.matchAll(/SUMMARY:(.*)\r\n/g)].map((m) => m[1].replace(/\\,/g, ",")),
    );
    const only = contestById("bartg-sprint")!.name;
    const alsoMatchesQ = ["bartg-sprint75", "bartg-sprint-psk63"].map(
      (id) => contestById(id)!.name,
    );
    expect(summaries.size, "no events in the per-contest feed").toBeGreaterThan(0);
    for (const s of summaries) {
      expect(s, "another contest rode along in the feed").toContain(only);
      for (const other of alsoMatchesQ) expect(s).not.toContain(other);
    }
  });

  it("calls the subscription by the contest's name", async () => {
    // What a calendar client shows six months after someone added it. An id
    // would be accurate and unreadable.
    const feed = await (await get("/api/ics?id=cq-ww-cw")).text();
    expect(feed).toContain("X-WR-CALNAME:Amateur Radio Contests (CQ Worldwide DX Contest");
  });

  it("refuses an id nobody has, rather than serving everything", async () => {
    // The same reasoning as `?mode=CQ`: a parameter that behaves like no filter
    // is how someone believes they have subscribed to one contest and has not.
    expect((await get("/api/ics?id=not-a-contest")).status).toBe(404);
    expect((await get("/?id=not-a-contest")).status).toBe(404);
  });

  it("filters the schedule to that contest too", async () => {
    // Same parameter, same meaning, on all three surfaces.
    const body = (await (await get("/api/contests?id=cq-ww-cw&year=2027")).json()) as {
      count: number;
      occurrences: { contest_id: string }[];
    };
    expect(body.count).toBeGreaterThan(0);
    for (const o of body.occurrences) expect(o.contest_id).toBe("cq-ww-cw");
  });
});

describe("what it does not become", () => {
  it("stays off the schedule's masthead", async () => {
    // Same decision the standing pages encode: `/` keeps itself, and nothing
    // goes in front of the calendar. The detail view is reached from a row.
    const html = await page("/");
    const strip = /<div class="strip">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)![1];
    expect(strip).not.toContain("/contest/");
  });

  it("ships no rail, and no filter form", async () => {
    // The rail compares contests against one shared axis. There is one contest
    // here, so there is nothing to compare -- and a filter panel on a page
    // about a single record would filter nothing.
    const html = await page("/contest/cq-ww-cw");
    expect(html).not.toContain('class="rail"');
    expect(html).not.toContain("<form");
  });

  it("cannot be pushed sideways by a long URL in a source note", async () => {
    // Catalog prose is the only text here that is not ours to reflow, and it
    // carries bare URLs -- the longest unbroken token in the catalog today is
    // 109 characters. At 320px that is a horizontal scrollbar on a page whose
    // mobile pass was measured to have none.
    const longest = Math.max(
      ...CATALOG.flatMap((c) =>
        [c.source_note, c.note, c.exchange, c.summary, c.bands_note]
          .filter((v): v is string => typeof v === "string")
          .flatMap((v) => v.split(/\s+/).map((w) => w.length)),
      ),
    );
    expect(longest, "expected a long unbreakable token in the catalog").toBeGreaterThan(60);
    expect(CSS).toMatch(/\.spec dd[^{]*\{[^}]*overflow-wrap: anywhere;/);
  });

  it("caches longer than the schedule and shorter than the prose", async () => {
    // Nothing here is a function of `now` except the countdowns, which the
    // client ticks -- but "next runnings" does move.
    const res = await get("/contest/cq-ww-cw");
    expect(res.headers.get("cache-control")).toContain("max-age=600");
  });

  it("carries no unescaped markup from the catalog", async () => {
    // Source notes are hand-edited prose full of quotes and ampersands, and
    // they are the longest catalog text on any page of this site.
    for (const id of ["cq-ww-cw", "wia-remembrance-day", "rac-canada-winter"]) {
      const html = await page(`/contest/${id}`);
      const quoted = [...html.matchAll(/<q>(.*?)<\/q>/g)].map((m) => m[1]);
      for (const q of quoted) {
        expect(q, `unescaped markup in ${id}`).not.toMatch(/[<>]/);
      }
    }
  });

  /**
   * Google treats a downloaded .ics as a one-off IMPORT, not a subscription, so
   * "Subscribe (iCal)" does nothing useful for a Google Calendar user -- which
   * is what prompted this. The page therefore offers both paths and says which
   * is which, because a button that silently does the wrong thing is worse than
   * one that is missing.
   */
  describe("taking it with you", () => {
    it("offers Google an add-event link, absolute and pointing back here", async () => {
      const html = await page("/contest/cq-ww-cw");
      const m = /<a class="btn" href="(https:\/\/calendar\.google\.com[^"]+)"([^>]*)>/
        .exec(html);
      expect(m, "no Google Calendar link on the detail page").not.toBeNull();

      const u = new URL(m![1].replace(/&amp;/g, "&"));
      expect(u.pathname).toBe("/calendar/render");
      expect(u.searchParams.get("action")).toBe("TEMPLATE");
      expect(u.searchParams.get("text")).toBe(contestById("cq-ww-cw")!.name);

      // Google's stamp format is YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ. Anything
      // else is accepted by the URL and then silently misread as all-day.
      const dates = u.searchParams.get("dates")!;
      expect(dates).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);

      // ...and the instants are the ones this site shows, not a re-derivation.
      const next = nextOccurrences("cq-ww-cw", Date.now(), 1)[0];
      const [from, to] = dates.split("/");
      expect(from).toBe(next.start!.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""));
      expect(to).toBe(next.end!.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""));

      // The description has to survive leaving this page, so it carries the
      // sponsor's rules and a way back to the record. Relative would be useless
      // inside a Google Calendar event.
      const details = u.searchParams.get("details")!;
      expect(details).toContain(contestById("cq-ww-cw")!.rules_url);
      expect(details).toContain("/contest/cq-ww-cw");
      expect(details).toContain(BASE);

      // It leaves this site, so it carries both halves of the outbound rule.
      expect(m![2]).toContain('target="_blank"');
      expect(m![2]).toContain('rel="noopener external"');
    });

    it("keeps the plain feed address and the two routes that work", async () => {
      const html = await page("/contest/cq-ww-cw");
      // Apple, Outlook and Thunderbird take this directly; a relative path
      // would be worthless pasted into any of them.
      expect(html).toContain(`<code class="feed">${BASE}/api/ics?id=cq-ww-cw</code>`);
      expect(html).toContain(">Subscribe (iCal)<");
      expect(html).toContain(">Add to Google Calendar<");

      // Google's one-click subscribe was tried against a real account and
      // refused, so it is gone and the manual box is named instead.
      expect(html).not.toContain("calendar/r?cid=");
      expect(html).toContain("From URL");
      expect(html).toContain("single event");
      expect(html).toContain("8–24");
    });

    it("omits the Google link when there is no instant to add", async () => {
      // rca-nacional-40m holds 2025 dates only, so it has no next running. A
      // dead button beside "the sponsor publishes annually" would contradict
      // the sentence next to it.
      const html = await page("/contest/rca-nacional-40m");
      expect(nextOccurrences("rca-nacional-40m", Date.now(), 1)).toHaveLength(0);
      expect(html).not.toContain("calendar/render?action=TEMPLATE");
      expect(html).not.toContain(">Add to Google Calendar<");

      // Both SUBSCRIBE routes stay, and deliberately. A feed with nothing in it
      // yet is exactly when a subscription is worth more than a one-off: when
      // the sponsor publishes next year's date and it is encoded here, everyone
      // subscribed gets it without coming back. Only the add-one-event link
      // needs an instant, so only it is conditional.
      expect(html).toContain(">Subscribe (iCal)<");
      expect(html).not.toContain("calendar.google.com");
    });

    it("refuses a Google link for a rolling contest, which has no instant", () => {
      // local_rolling means the contest starts at a clock time wherever the
      // operator is, so `start` is null and there is no instant to put in a
      // calendar. No record uses it today, which is exactly why this is a unit
      // test on the builder rather than a page assertion -- the guard has to
      // exist BEFORE the first rolling record does.
      const contest = contestById("cq-ww-cw")!;
      const real = nextOccurrences("cq-ww-cw", Date.now(), 1)[0];
      expect(googleCalendarHref(contest, real, BASE)).toContain("calendar.google.com");

      const rolling = { ...real, local_rolling: true } as typeof real;
      expect(googleCalendarHref(contest, rolling, BASE)).toBeNull();

      const instantless = { ...real, start: null, end: null } as unknown as typeof real;
      expect(googleCalendarHref(contest, instantless, BASE)).toBeNull();

      expect(googleCalendarHref(contest, undefined, BASE)).toBeNull();
    });
  });

});
