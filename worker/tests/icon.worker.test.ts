import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

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

  it("puts the icon on every page, not just the calendar", async () => {
    for (const route of ["/", "/month", "/contest/cq-ww-cw", "/about"]) {
      const html = await (await SELF.fetch(BASE + route)).text();
      expect(html, `${route} has no icon`).toContain('rel="icon"');
      expect(html, `${route} has no theme-color`).toContain("theme-color");
    }
  });
});
