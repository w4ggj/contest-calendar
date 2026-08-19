/**
 * The palette, the display switch, and the rail's duration ramp.
 *
 * These run inside workerd against the real rendered page for the same reason
 * everything else here does: this is the runtime that serves it.
 *
 * What is worth testing about a stylesheet is narrow, and it is not "does it
 * look right" -- no test can answer that, and the screenshots that settled the
 * look are not reproducible in CI. What IS testable is the set of claims the
 * design makes that would break silently:
 *
 *   - a colour that encodes data has a stop for every value the data can take,
 *   - the encoded colour describes the CONTEST, not the clipped bar,
 *   - contrast ratios I picked by eye actually meet the numbers,
 *   - the theme switch cannot get stuck one-way,
 *   - and the page is still complete with JavaScript off.
 *
 * The first two are the CATALOG_MODES lesson applied to colour: a controlled
 * vocabulary needs something that fails when a member is added and the table
 * that maps it is not.
 */

import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

import { CSS } from "../src/render/theme.js";
import { THEME_BOOT } from "../src/render/client.js";
import { DURATION_BUCKETS, durationBucketOf } from "../src/schedule.js";

const BASE = "https://contestcal.test";
const page = async (path = "/") => await (await SELF.fetch(BASE + path)).text();

// ---------------------------------------------------------------------------
// Colour maths, written here rather than imported: a contrast assertion that
// used the same helper the stylesheet was built with would only prove the two
// agree. WCAG 2.x relative luminance, sRGB.
// ---------------------------------------------------------------------------

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The tokens of one theme: the dark block, or either copy of the light one. */
function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    out[name] = value;
  }
  return out;
}

const DARK = tokens(CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("*, *::before")));
const LIGHT_BLOCKS = [...CSS.matchAll(/\{\s*color-scheme:\s*light;([\s\S]*?)\n\s*\}/g)].map(
  (m) => m[1],
);

// ---------------------------------------------------------------------------

describe("the duration ramp is a mapping, not a decoration", () => {
  it("has a stop for every bucket, in both themes", () => {
    // Adding a fifth bucket to DURATION_BUCKETS without adding its colour would
    // not fail anywhere: the bar would silently inherit the --d2 default and
    // report a 2-12 hour contest in the colour of a 2-12 hour contest. This is
    // the test that makes that a build failure instead.
    const buckets = Object.keys(DURATION_BUCKETS);

    for (const key of buckets) {
      expect(CSS, `no bar rule for the ${key} bucket`).toContain(`.bar[data-d="${key}"]`);
      expect(CSS, `the ${key} chip carries no ramp colour`).toContain(
        `.chip:has(input[name="duration"][value="${key}"])`,
      );
    }

    // ...and one --dN per bucket, in the dark palette and in every light copy.
    for (let i = 1; i <= buckets.length; i++) {
      expect(DARK[`--d${i}`], `dark theme has no --d${i}`).toMatch(/^#[0-9A-F]{6}$/i);
      for (const block of LIGHT_BLOCKS) {
        expect(tokens(block)[`--d${i}`], `a light block has no --d${i}`).toMatch(
          /^#[0-9A-F]{6}$/i,
        );
      }
    }
  });

  it("colours the bar from the contest's length, not the length it can draw", async () => {
    // The geometry is clamped to the seven-day window, so a 48-hour contest
    // starting on the rail's last day draws as a 12-hour sliver. Colouring from
    // what is drawn would tell the reader it is a 12-hour contest -- an
    // overstatement of exactly the kind the catalog rules forbid.
    //
    // Checked against the row's own rendered duration text rather than against
    // the value that produced the attribute, so the two independent renderings
    // of one fact have to agree.
    const html = await page("/");
    const rows = html.split('<li class="row').slice(1);
    expect(rows.length).toBeGreaterThan(0);

    let checked = 0;
    for (const row of rows) {
      const bar = /data-d="([^"]+)"/.exec(row);
      const dur = /class="dur">([^<]+)</.exec(row);
      if (!bar || !dur) continue; // rows past the rail carry no bar

      const m = /(?:(\d+)h)?\s*(?:(\d+)m)?/.exec(dur[1].trim())!;
      const hours = Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
      expect(bar[1], `row reading "${dur[1]}" is coloured as ${bar[1]}`).toBe(
        durationBucketOf(hours),
      );
      checked++;
    }
    expect(checked, "no bars on the page to check").toBeGreaterThan(0);
  });
});

describe("the palette meets the numbers it was chosen against", () => {
  const cases: [string, Record<string, string>][] = [
    ["dark", DARK],
    ...LIGHT_BLOCKS.map((b, i) => [`light[${i}]`, tokens(b)] as [string, Record<string, string>]),
  ];

  it("keeps body text at 4.5:1 and every ramp stop at 3:1", () => {
    // Picked by eye, so worth checking by arithmetic. --ink-faint is the one
    // that matters: it carries the small mono labels, which is most of the
    // page's furniture, and it is the token most tempting to dim too far.
    for (const [name, t] of cases) {
      for (const token of ["--ink", "--ink-dim", "--ink-faint", "--amber", "--cyan"]) {
        expect(
          contrast(t[token], t["--bg"]),
          `${name} ${token} on --bg`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // Bars and chip edges are graphics, not text: WCAG 1.4.11 asks 3:1.
      for (let i = 1; i <= Object.keys(DURATION_BUCKETS).length; i++) {
        expect(
          contrast(t[`--d${i}`], t["--bg"]),
          `${name} --d${i} on --bg`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("does not reach for the warm-cream default in either direction", () => {
    // The light theme was a cream #F2F0EA with a warm-brown accent, which is the
    // house style of every generated page rather than a choice about band charts.
    // Pinned as a hex check because that is the part that regressed: a paper
    // white is cool, and the accent is a chart annotation rather than a brown.
    for (const [name, t] of cases) {
      const bg = t["--bg"];
      const [r, , b] = [0, 2, 4].map((i) => parseInt(bg.slice(1 + i, 3 + i), 16));
      expect(r, `${name} --bg ${bg} is warmer than it is cool`).toBeLessThanOrEqual(b);
    }
  });
});

describe("the display switch", () => {
  it("cannot get stuck one way", () => {
    // The bug this prevents: with a bare `:root` inside the media query, the
    // system's light preference and the reader's explicit dark choice sit at
    // equal specificity and the later one wins -- so on a light phone the Dark
    // button does nothing, and the switch appears broken exactly where it is
    // needed most.
    const mq = /@media \(prefers-color-scheme: light\) \{([\s\S]*?)\n\}/.exec(CSS);
    expect(mq, "no prefers-color-scheme block").not.toBeNull();
    expect(mq![1]).toContain(":root:not([data-theme])");
    expect(mq![1]).not.toMatch(/(^|\s):root\s*\{/);

    // And the explicit choice is honoured in both directions.
    expect(CSS).toContain(':root[data-theme="light"]');
  });

  it("declares the light palette once, not twice", () => {
    // Two hand-maintained copies of a palette drift on the first edit. They are
    // interpolated from one constant; this is what proves it stayed that way.
    expect(LIGHT_BLOCKS.length).toBe(2);
    expect(LIGHT_BLOCKS[0]).toBe(LIGHT_BLOCKS[1]);
  });

  it("applies a stored choice before the first paint", async () => {
    // A theme applied after paint is a white flash at 0300Z, which is the thing
    // the reader picked dark to avoid. So it has to be a synchronous script in
    // the head -- not in the deferred bundle at the end of the body.
    const html = await page("/");
    const boot = html.indexOf(THEME_BOOT);
    expect(boot, "theme boot script is not on the page").toBeGreaterThan(-1);
    expect(boot).toBeLessThan(html.indexOf("</head>"));

    // And it stays small, because it blocks. The cap was 300 while this script
    // did one job; on 2026-08-19 it took on a second that also has to happen
    // before first paint -- resolving the browser chrome's theme-color, which a
    // media query cannot do for a STORED three-state choice. The number is a
    // proxy for "does nothing but resolve the theme", so it moved once, with a
    // reason, rather than being raised whenever it is hit. Anything that pushes
    // this toward a kilobyte belongs in the deferred bundle instead.
    expect(THEME_BOOT.length, "the boot script is big enough to be blocking").toBeLessThan(450);

    // Both jobs, and nothing else: no fetch, no engine, no catalog.
    expect(THEME_BOOT).toContain("data-theme");
    expect(THEME_BOOT).toContain("theme-color");
    expect(THEME_BOOT).not.toContain("fetch");
  });

  it("is not offered when there is nothing to remember it", async () => {
    // Same rule as the UTC/local toggle: with no script the page is already
    // correct -- prefers-color-scheme is being honoured -- and an inert switch
    // would be the only broken control on a page that otherwise works fully
    // without JavaScript.
    const html = await page("/");
    expect(html).toMatch(/id="themebar"[^>]*hidden/);
    expect(html).toMatch(/id="tzbar"[^>]*hidden/);
  });
});

describe("the phone", () => {
  it("sizes touch targets by input type, not by screen width", async () => {
    // A narrow desktop window is not a phone and a touchscreen laptop is not
    // wide-therefore-mouse. `pointer: coarse` asks the question that actually
    // decides whether 44px is needed.
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(CSS);
    expect(coarse, "no coarse-pointer block").not.toBeNull();
    expect(coarse![1]).toMatch(/min-height:\s*44px/);
    for (const sel of [".tzbtn", ".thbtn", ".btn", ".chip label"]) {
      expect(coarse![1], `${sel} has no touch size`).toContain(sel);
    }
  });

  it("gives inline links a 44px hit area without a 44px box", () => {
    // Contest names, masthead links and footer links are one line tall by
    // construction. Padding them to 44 would space the schedule like a list of
    // buttons and cost a row of contests per screenful, so the hit area grows
    // and the box does not. Verified by hit-testing at 390px: elementFromPoint
    // 20px above and below each link's centre returns the link.
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(CSS)![1];
    expect(coarse).toMatch(/min-width:\s*44px/);
    for (const sel of [".strip-in a", ".foot .links a", ".row-name a"]) {
      expect(coarse, `${sel} has no extended hit area`).toContain(`${sel}::after`);
    }
    expect(coarse).toMatch(/height:\s*44px/);
  });

  it("stops the rail's day labels being clipped by their own cells", () => {
    // Eight labels across a 360px phone gives each 41px and "Today 15" needs
    // 58px, so every label was being cut off -- including the one naming today.
    const narrow = /@media \(max-width: 599px\) \{([\s\S]*?)\n\}/.exec(CSS);
    expect(narrow, "no narrow-screen block").not.toBeNull();
    expect(narrow![1]).toMatch(/\.ruler-day\s*\{[^}]*overflow:\s*visible/);
    expect(narrow![1]).toContain(".ruler-day:nth-child(even)");
  });

  it("gives each tally count its own column rather than a shared line", () => {
    // As a flex row the three counts measured 341px against 313px of room at
    // 360px, so the third dropped to a line of its own and read as a separate
    // fact. Closing the gap until they fit ran the labels together into "ON
    // THE AIR NEXT 7 DAYS LATER THIS MONTH". Columns are what fixes both.
    const narrow = /@media \(max-width: 599px\) \{([\s\S]*?)\n\}/.exec(CSS)![1];
    expect(narrow).toMatch(/\.tally\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
  });

  it("keeps the elapsed reading legible once the fill runs under it", () => {
    // The label is right-aligned over the whole meter, so past ~75% elapsed it
    // sits on the hatch. A 343px phone made that unreadable where a 730px
    // desktop meter hid it. No markup and no server-side geometry: a halo.
    expect(CSS).toMatch(/\.meter-text\s*\{[^}]*text-shadow:[^;]*var\(--panel\)/);
  });
});
