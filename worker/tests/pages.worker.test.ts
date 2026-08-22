/**
 * The sponsor link's target, and the three standing pages.
 *
 * Two claims worth pinning. First, that the contest name leaves this site in a
 * new tab and cannot reach back through `window.opener` -- `target="_blank"`
 * without `rel="noopener"` is the well-known version of that bug, and it is
 * invisible until someone looks at the markup.
 *
 * Second, that /about, /data and /contact stay reachable and stay OUT of the
 * way. The design decision they encode is that the calendar keeps `/` to itself
 * with no nav bar in front of it, so a test that only checked "the pages exist"
 * would miss the half that matters.
 */

import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

import { SITE_NAME } from "../src/render/html.js";
import { STATIC_PAGES } from "../src/render/pages.js";

const BASE = "https://contestcal.test";
const get = async (path: string) => await SELF.fetch(BASE + path);
const page = async (path: string) => await (await get(path)).text();

describe("links to the sponsor's rules", () => {
  it("opens in a new tab, with noopener, wherever one appears", async () => {
    // Every link that leaves this site does both or neither: _blank so the
    // reader's filtered view is not thrown away, and noopener so the page we
    // opened gets no `window.opener` handle back on ours.
    //
    // Checked across the routes that carry outbound links rather than on `/`
    // alone. The schedule no longer has any -- the contest name goes to this
    // site's own detail view now, and the sponsor's rules link went with it,
    // to the top of that page -- so pinning this to `/` would have quietly
    // stopped testing anything the day the link moved.
    const routes = ["/", "/contest/cq-ww-cw", "/data", "/contact"];
    let seen = 0;

    for (const route of routes) {
      const html = await page(route);
      const links = [...html.matchAll(/<a href="https?:\/\/[^"]+"[^>]*>/g)].map((m) => m[0]);
      for (const a of links) {
        seen++;
        expect(a, `${route}: external link without target`).toContain('target="_blank"');
        expect(a, `${route}: target=_blank without noopener`).toContain("noopener");
      }
    }

    expect(seen, "no external links found on any route").toBeGreaterThan(0);
  });

  it("keeps the schedule's rows pointing at this site", async () => {
    // One link per row, and it is ours. The mobile pass gave `.row-name a` a
    // 44px hit area; a second inline link in the same row would put two of
    // them within a few pixels of each other.
    const html = await page("/");
    const names = [...html.matchAll(/class="row-name">(.*?)<\/h3>/g)].map((m) => m[1]);
    expect(names.length, "no contest rows on the page").toBeGreaterThan(0);
    for (const cell of names) {
      expect([...cell.matchAll(/<a /g)].length, `row has more than one link: ${cell}`).toBe(1);
      expect(cell, "row name leaves the site").toMatch(/<a href="\/contest\//);
    }
  });

  it("keeps every internal link in place", async () => {
    // The footer, the filter form and the pages are all this site. Opening
    // those in new tabs would litter the reader with windows.
    const html = await page("/");
    for (const a of html.matchAll(/<a href="\/[^"]*"[^>]*>/g)) {
      expect(a[0], "internal link opens a new tab").not.toContain("_blank");
    }
  });
});

describe("the site's icon", () => {
  it("is declared on every page, so no browser falls back to its own", async () => {
    // There was none: no rel="icon" anywhere and /favicon.ico a 404, so every
    // browser drew its placeholder -- which on a dark tab strip is a dark blob
    // on a dark background.
    for (const route of ["/", "/contest/cq-ww-cw", "/about", "/data", "/contact", "/nope"]) {
      const html = await page(route);
      expect(html, `${route} declares no icon`).toContain('rel="icon" href="/favicon.svg"');
    }
  });

  it("serves the icon as SVG, cached hard", async () => {
    const res = await get("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const svg = await res.text();
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("does not ask the OS what colour to be", async () => {
    // The first version keyed the icon on prefers-color-scheme so it could
    // lighten on a dark tab strip. Wrong signal: that reports the OS, and the
    // tab strip need not agree with it -- Chrome can be dark on a light
    // Windows, and a reader can set THIS SITE dark while the OS stays light.
    // Then the icon picks the variant for a strip it is not sitting in, which
    // is how an icon ends up dark on dark: the failure it existed to fix.
    const svg = await (await get("/favicon.svg")).text();
    expect(svg).not.toContain("prefers-color-scheme");
    // AMBER IS TIME, and the icon names a clock. One amber, legible on a white
    // strip and a near-black one, because that is the only property that
    // matters at 16px.
    expect(svg.toUpperCase()).toContain("#E8862B");
  });

  it("lets the theme script own the browser chrome colour", async () => {
    // A media-query theme-color cannot follow a STORED three-state choice, so
    // a reader on a light PC who chose dark got light chrome around a dark
    // page. One meta, resolved by the same head script that sets data-theme.
    const html = await page("/");
    expect((html.match(/<meta name="theme-color"/g) ?? []).length, "one meta, not two").toBe(1);
    expect(html).not.toContain('theme-color" content="#050B12" media=');
    expect(html).toContain('name="theme-color" content="#050B12"');

    // And the head script writes it, before first paint, on the same
    // resolution order the stylesheet uses.
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head, "the boot script does not touch the chrome colour")
      .toContain("meta[name=theme-color]");
    // ...and the meta comes first, or the script has nothing to write to.
    expect(head.indexOf("<meta name=\"theme-color\""))
      .toBeLessThan(head.indexOf("meta[name=theme-color]"));
  });
});

describe("what the page calls itself", () => {
  it("names the subject in the title, on every route", async () => {
    // A <title> has no page around it to supply context: it is what a search
    // result, a bookmark and a pasted link show. "Contest Calendar" alone could
    // be chess or fishing.
    expect(SITE_NAME).toContain("Amateur Radio");

    const routes = ["/", ...STATIC_PAGES.map((p) => `/${p.slug}`), "/nope"];
    for (const route of routes) {
      const title = /<title>([^<]+)<\/title>/.exec(await page(route));
      expect(title, `${route} has no title`).not.toBeNull();
      expect(title![1], `${route} title omits the subject`).toContain(SITE_NAME);
    }
  });

  it("says what it is in a description, on every page", async () => {
    for (const route of ["/", ...STATIC_PAGES.map((p) => `/${p.slug}`)]) {
      const meta = /<meta name="description" content="([^"]{40,})">/.exec(await page(route));
      expect(meta, `${route} has no usable description`).not.toBeNull();
    }
  });

  it("keeps the masthead heading short and the subject beneath it", async () => {
    // The fix for a name that does not say who it is for is a second line, not
    // a longer heading. A heading that has to explain itself is doing the
    // tagline's job badly, and on a phone it is the thing that wraps.
    const landing = await page("/");
    const h1s = [...landing.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
    expect(h1s.length, "the schedule should have exactly one h1").toBe(1);

    const heading = h1s[0][1].trim();
    expect(heading.split(/\s+/).length, `heading is a sentence: ${heading}`).toBeLessThan(4);

    // And the descriptive phrase is present, as its own element rather than
    // appended to the heading.
    const tag = /<p class="tag">([\s\S]*?)<\/p>/.exec(landing);
    expect(tag, "no subject line under the heading").not.toBeNull();
    expect(tag![1].toLowerCase()).toContain("amateur radio");
    expect(heading.toLowerCase()).not.toContain("amateur");
  });
});

describe("the standing pages", () => {
  it("serves each one, with its own title and description", async () => {
    for (const p of STATIC_PAGES) {
      const res = await get(`/${p.slug}`);
      expect(res.status, `/${p.slug}`).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain(`<title>${p.title} · ${SITE_NAME}</title>`);
      // Decoded rather than compared raw: the description goes through the
      // escaper on the way out, and an apostrophe leaves as an entity.
      const meta = /<meta name="description" content="([^"]+)">/.exec(html);
      expect(meta, `/${p.slug} has no description`).not.toBeNull();
      expect(meta![1].replace(/&#39;/g, "'").replace(/&amp;/g, "&")).toBe(p.description);
      expect(html, `/${p.slug} renders no heading`).toMatch(/<h1>[^<]+<\/h1>/);
    }
  });

  it("is reachable from the footer of the calendar, and from each other", async () => {
    const landing = await page("/");
    for (const p of STATIC_PAGES) {
      expect(landing, `footer does not link /${p.slug}`).toContain(`<a href="/${p.slug}">`);
    }

    // On a page, its own entry stops being a link but stays in the list: the
    // set of pages should read the same wherever you are standing.
    for (const p of STATIC_PAGES) {
      const html = await page(`/${p.slug}`);
      expect(html).toContain(`<span aria-current="page">${p.label}</span>`);
      for (const other of STATIC_PAGES) {
        if (other.slug === p.slug) continue;
        expect(html, `/${p.slug} does not link /${other.slug}`).toContain(
          `<a href="/${other.slug}">`,
        );
      }
      expect(html, `/${p.slug} has no way back to the schedule`).toContain('<a href="/">');
    }
  });

  it("does not put a nav bar in front of the calendar", async () => {
    // The whole point of small pages instead of a site: someone arriving to
    // find out what is on the air right now gets the schedule, not prose, and
    // the masthead stays the three things that are about the data itself.
    // Sliced to the next landmark rather than matched with a balanced-tag
    // regex, which cannot be written: the masthead has nested elements and a
    // non-greedy `</div></div>` would stop at the first inner close and quietly
    // stop checking the links, which are the whole point.
    const landing = await page("/");
    const start = landing.indexOf('<div class="strip">');
    const end = landing.indexOf("<header");
    expect(start, "no masthead on the page").toBeGreaterThan(-1);
    expect(end, "no hero after the masthead").toBeGreaterThan(start);
    const strip = landing.slice(start, end);
    for (const p of STATIC_PAGES) {
      expect(strip, `masthead links /${p.slug}`).not.toContain(`/${p.slug}`);
    }

    // And the pages carry no masthead of their own -- one back link only.
    for (const p of STATIC_PAGES) {
      const html = await page(`/${p.slug}`);
      expect(html, `/${p.slug} grew a masthead`).not.toContain('class="strip"');
      expect(html).toContain('class="backlink"');
    }
  });

  it("is complete without JavaScript", async () => {
    // Same rule as the landing view. These pages have no clock to tick and no
    // countdown to update, so they ship no client bundle at all -- but they
    // still need the synchronous theme boot, or a reader who chose Light gets a
    // dark flash on the way here.
    for (const p of STATIC_PAGES) {
      const html = await page(`/${p.slug}`);
      const scripts = [...html.matchAll(/<script>/g)];
      expect(scripts.length, `/${p.slug} ships more than the theme boot`).toBe(1);
      expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("</head>"));
    }
  });

  it("still 404s for anything else", async () => {
    // The route is a lookup, not a prefix match: a wildcard here would turn
    // every typo into a blank page instead of the 404 that says so.
    for (const path of ["/aboutus", "/data/catalog", "/contacts"]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });
});

/**
 * Getting this calendar into someone else's calendar.
 *
 * Apple Calendar, Outlook and Thunderbird take the feed address directly.
 * Google does not, twice over: it treats a downloaded .ics as a one-off import
 * rather than a subscription, and ITS DOCUMENTED SUBSCRIBE DEEP LINK DOES NOT
 * WORK. Both facts are load-bearing and neither is guessable from the docs.
 */
describe("the masthead", () => {

  it("makes the masthead title a link home that clears the filters", async () => {
    // A reader will try the title first -- it is what every site puts a home
    // link on. It goes to a CLEAN schedule with no query, and that is the point
    // rather than an oversight: every other link on this site preserves the
    // reader's filters, so without this there is no way back to the whole
    // calendar short of editing the URL.
    const plain = await page("/");
    expect(plain).toContain('<h1><a href="/">Contest Calendar</a></h1>');

    // Still bare with filters applied. If this ever starts carrying the query
    // it stops being the reset and becomes a link to the page you are on.
    const filtered = await page("/?mode=CW&band=20m");
    expect(filtered).toContain('<h1><a href="/">Contest Calendar</a></h1>');
    expect(filtered).not.toContain('<h1><a href="/?mode=CW');

    // The masthead is the landing page's alone -- the month grid and a contest
    // record open with a backlink that DOES preserve filters, which is the
    // other half of the pair.
    expect(await page("/month")).toContain("Back to the schedule");
    expect(await page("/contest/cq-ww-cw?mode=CW")).toContain('href="/?mode=CW"');
  });
});

describe("subscribing from the index", () => {
  it("ships no Google subscribe deep link, on any route", async () => {
    // calendar.google.com/calendar/r?cid=<percent-encoded https url> is the
    // documented way to add a calendar by URL. It was shipped here on
    // 2026-08-21 in exactly that form and the owner's Google account answered
    // "unable to add to calendar". It was removed the same day.
    //
    // This test is the memory of that. The link looks correct, every reference
    // describes it, and re-adding it is the obvious thing for the next person
    // to try -- so the build fails instead.
    for (const route of ["/", "/contest/cq-ww-cw", "/contest/rca-nacional-40m"]) {
      const html = await page(route);
      expect(html, `${route}: Google cid subscribe link is back`)
        .not.toContain("calendar/r?cid=");
      expect(html, `${route}: Google cid subscribe link is back`)
        .not.toContain("cid=");
    }
  });

  it("keeps the iCal feed and names the manual Google route", async () => {
    // The feed itself is fine in Google -- it was verified end to end on
    // 2026-08-16, 699 events. Only the one-click route is broken, so the page
    // has to say which box to paste into or a reader concludes the feed is bad.
    const html = await page("/");
    expect(html).toContain('<a href="/api/ics">Subscribe (iCal)</a>');
    expect(html).toContain("Apple Calendar, Outlook and Thunderbird");
    expect(html).toContain("From URL");
    expect(html).toContain(`<code class="feed">${BASE}/api/ics</code>`);
  });

  it("warns that Google's polling cannot be hurried", async () => {
    // A reader who pastes the feed in, sees nothing for a day and concludes it
    // is broken is the failure this sentence exists to prevent.
    const html = await page("/");
    expect(html).toContain("8–24");
    expect(html).toMatch(/cannot be forced/);
  });
});
