import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

import { SITE_NAME } from "../src/render/html.js";

/**
 * Read a PNG's corner pixels, to check the maskable claim against the bytes.
 *
 * Only has to handle the PNGs this repo generates, which is what makes it
 * short: every row is written with filter type 0, so the scanlines are raw
 * RGBA and there is no Paeth predictor to undo. That assumption is asserted
 * rather than trusted -- if the generator ever starts filtering, this fails
 * loudly instead of reading noise.
 */
async function pixelsOf(bytes: Uint8Array): Promise<{
  width: number;
  height: number;
  at: (x: number, y: number) => [number, number, number];
}> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);

  const idat: number[] = [];
  let i = 8;
  while (i < bytes.length) {
    const len = view.getUint32(i);
    const tag = String.fromCharCode(...bytes.slice(i + 4, i + 8));
    if (tag === "IDAT") idat.push(...bytes.slice(i + 8, i + 8 + len));
    i += 12 + len;
  }

  const stream = new Blob([new Uint8Array(idat)]).stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const stride = width * 4 + 1;
  return {
    width,
    height,
    at(x: number, y: number): [number, number, number] {
      expect(raw[y * stride], "generator started filtering rows").toBe(0);
      const o = y * stride + 1 + x * 4;
      return [raw[o], raw[o + 1], raw[o + 2]];
    },
  };
}

async function cornerPixels(
  bytes: Uint8Array,
): Promise<Record<string, [number, number, number]>> {
  const px = await pixelsOf(bytes);
  const m = 4;
  return {
    "top-left": px.at(m, m),
    "top-right": px.at(px.width - 1 - m, m),
    "bottom-left": px.at(m, px.height - 1 - m),
    "bottom-right": px.at(px.width - 1 - m, px.height - 1 - m),
  };
}

/** The pixel at the middle of the mark, for proving an icon is not blank. */
async function centrePixel(bytes: Uint8Array): Promise<[number, number, number]> {
  const px = await pixelsOf(bytes);
  // The tallest bar's centre: x = 26.5/32 of the box, scaled by the 62% inset.
  const x = Math.round(px.width * (0.5 + 0.62 * (26.5 / 32 - 0.5)));
  const y = Math.round(px.height * 0.5);
  return px.at(x, y);
}

/**
 * The icon, at every path something actually asks for.
 *
 * There was a good SVG mark and a <link> declaring it, and that is not the same
 * as being reachable. A declaration only reaches things that PARSE THE PAGE;
 * crawlers, link previewers, feed readers and iOS ask for fixed root paths
 * regardless of what the head says, and those were answering 404. A site with a
 * perfectly good icon still shows a blank square in a search result if
 * /favicon.ico is missing.
 */
describe("the icon", () => {
  const BASE = "https://contestcal.test";

  it("answers every path that is requested without being declared", async () => {
    const want: [string, string, number][] = [
      ["/favicon.svg", "image/svg+xml", 8],
      ["/favicon.ico", "image/x-icon", 8],
      ["/apple-touch-icon.png", "image/png", 8],
      ["/apple-touch-icon-precomposed.png", "image/png", 8],
    ];
    for (const [path, type, min] of want) {
      const r = await SELF.fetch(BASE + path);
      expect(r.status, `${path} status`).toBe(200);
      expect(r.headers.get("content-type"), `${path} type`).toContain(type);
      const buf = new Uint8Array(await r.arrayBuffer());
      expect(buf.length, `${path} is empty`).toBeGreaterThan(min);
      expect(r.headers.get("cache-control"), `${path} cache`).toContain("immutable");
    }
  });

  it("serves real image bytes, not a base64 string", async () => {
    // The failure this catches is returning the constant itself, which is a
    // 200 with a plausible content-type and a broken image.
    const ico = new Uint8Array(
      await (await SELF.fetch(BASE + "/favicon.ico")).arrayBuffer(),
    );
    // ICONDIR: reserved 0, type 1 (icon), one image.
    expect([...ico.slice(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
    // ...wrapping a PNG, which is the form every browser since Vista reads.
    expect([...ico.slice(22, 26)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const png = new Uint8Array(
      await (await SELF.fetch(BASE + "/apple-touch-icon.png")).arrayBuffer(),
    );
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // 180x180, which is what iOS asks for.
    const w = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    const h = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    expect([w, h]).toEqual([180, 180]);
  });

  it("does not offer iOS an SVG, which iOS will not render", async () => {
    // This pointed at /favicon.svg. An iPhone home screen then showed a
    // screenshot of the page instead of the mark -- the one place an icon most
    // needs to be a recognisable shape.
    const html = await (await SELF.fetch(BASE + "/")).text();
    const touch = /<link rel="apple-touch-icon"[^>]*>/.exec(html);
    expect(touch, "no apple-touch-icon declared").not.toBeNull();
    expect(touch![0]).toContain(".png");
    expect(touch![0]).not.toContain(".svg");
  });

  it("gives Android a name and icons of its own, not the live page title", async () => {
    // The mobile finding, and it is worse than a missing icon. Without a
    // manifest an Android home-screen shortcut takes its LABEL from <title> --
    // which here is live ("1 contest on the air now - Amateur Radio Contest
    // Calendar") and is then frozen at whatever the count happened to be.
    const r = await SELF.fetch(BASE + "/manifest.webmanifest");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/manifest+json");

    const m = JSON.parse(await r.text());
    expect(m.name).toBe(SITE_NAME);
    expect(m.short_name.length, "short_name will truncate on a home screen")
      .toBeLessThanOrEqual(12);
    expect(m.short_name).not.toMatch(/\d/);      // no live count in the label
    expect(m.start_url).toBe("/");

    // "browser", deliberately: a manifest that says "standalone" invites Chrome
    // to offer an install prompt and open the site chrome-less. Nobody asked
    // for an app; this is here for the icon and the name.
    expect(m.display).toBe("browser");

    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const i of m.icons.filter((x: { purpose?: string }) => x.purpose)) {
      expect(i.purpose).toContain("maskable");
    }
  });

  it("serves the manifest's icons at the sizes it claims", async () => {
    // A manifest naming an icon that 404s is worse than no manifest: Chrome
    // silently falls back and the label problem stays.
    for (const [path, size] of [["/icon-192.png", 192], ["/icon-512.png", 512]] as const) {
      const r = await SELF.fetch(BASE + path);
      expect(r.status, path).toBe(200);
      const b = new Uint8Array(await r.arrayBuffer());
      expect([...b.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
      const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
      expect([w, h], `${path} is not ${size}x${size}`).toEqual([size, size]);
    }
  });

  it("keeps the maskable claim honest", async () => {
    // "maskable" is a claim about SAFE AREA: it promises the mark survives a
    // circular crop. Declaring it while drawing to the edge is how an icon ends
    // up with its corners sliced off on one launcher and not another. The
    // generator pads to 62% of the canvas; this checks the bytes agree.
    const b = new Uint8Array(
      await (await SELF.fetch(BASE + "/icon-192.png")).arrayBuffer(),
    );
    // Every corner must be the site's ground, never the amber mark: those are
    // exactly the pixels a circular crop removes.
    const corners = await cornerPixels(b);
    for (const [where, [r, g, bl]] of Object.entries(corners)) {
      expect([r, g, bl], `${where} carries the mark and would be clipped`)
        .toEqual([0x05, 0x0b, 0x12]);
    }

    // ...and non-vacuous: the CENTRE really is the mark. Without this, a
    // generator that emitted a plain dark square would pass -- blank corners on
    // a blank icon.
    const centre = await centrePixel(b);
    expect(centre, "the icon has no mark in it").not.toEqual([0x05, 0x0b, 0x12]);
  });

  it("puts the icon on every page, not just the calendar", async () => {
    for (const route of ["/", "/month", "/contest/cq-ww-cw", "/about"]) {
      const html = await (await SELF.fetch(BASE + route)).text();
      expect(html, `${route} has no icon`).toContain('rel="icon"');
      expect(html, `${route} has no theme-color`).toContain("theme-color");
    }
  });
});
