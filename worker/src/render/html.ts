/**
 * HTML escaping, in its own module.
 *
 * Small enough to have lived in `landing.ts`, and it did -- until `filters.ts`
 * needed it too and the two files began importing each other. A cycle between
 * two renderers is the kind of thing that works until a bundler decides the
 * evaluation order, so the shared piece moved down here instead.
 */

/**
 * What the site is called in a <title>, and so in a search result, a bookmark
 * and a pasted link preview.
 *
 * Spelled out rather than "Contest Calendar": the short name is fine in the
 * masthead, where the page around it supplies the context, but a title has no
 * page around it. "Contest Calendar" alone could be chess, or fishing.
 *
 * The masthead deliberately does NOT use this -- the heading there stays short
 * and the subject moves to the line beneath it, which is a different job.
 */
import { CATALOG_SIZE } from "../catalog.js";

export const SITE_NAME = "Amateur Radio Contest Calendar";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The site identity bar, and the home link inside it.
 *
 * On three pages now, so it lives here rather than being pasted into each --
 * the same reason esc() moved into this file.
 *
 * `asHeading` is a semantics switch, not a style one. On the schedule the site
 * IS the subject of the page, so the name is the h1. On a contest record the
 * subject is the contest and on the month grid it is the month, and the site
 * name being a SECOND h1 there would give those pages two competing top-level
 * headings -- which is wrong for a screen reader walking the outline and wrong
 * for anything reading the document structure. So elsewhere it renders as a
 * paragraph that merely looks like the masthead.
 *
 * The link is bare `/` on every page. It is the site's one reset: everything
 * else preserves the reader's filters, and without this there is no way back to
 * the whole calendar short of editing the URL.
 */
export function masthead(asHeading: boolean, skipLabel: string): string {
  const name = `<a href="/">Contest Calendar</a>`;
  return (
    `<a class="skip" href="#main">${esc(skipLabel)}</a>\n` +
    `<div class="strip">` +
    `<div class="strip-in">` +
    `<div class="ident">` +
    (asHeading ? `<h1>${name}</h1>` : `<p class="ident-name">${name}</p>`) +
    `<p class="tag">Amateur radio contests<span class="tag-more">` +
    ` &mdash; all ${CATALOG_SIZE} computed from sponsors&rsquo; own published rules` +
    `</span></p>` +
    `</div>` +
    `<a href="/api/ics">iCal feed</a>` +
    `<span class="sep">/</span>` +
    `<a href="/api/contests">API</a>` +
    `</div></div>`
  );
}
