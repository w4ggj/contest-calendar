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
export const SITE_NAME = "Amateur Radio Contest Calendar";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
