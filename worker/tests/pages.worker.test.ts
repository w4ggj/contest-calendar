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
