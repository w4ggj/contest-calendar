/**
 * HTML escaping, in its own module.
 *
 * Small enough to have lived in `landing.ts`, and it did -- until `filters.ts`
 * needed it too and the two files began importing each other. A cycle between
 * two renderers is the kind of thing that works until a bundler decides the
 * evaluation order, so the shared piece moved down here instead.
 */

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
