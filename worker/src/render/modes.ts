/**
 * Mode chips: the one place a mode gets a colour.
 *
 * Colour here is a mapping, like the duration ramp: each token in the
 * controlled mode vocabulary owns one hue, and the chip always prints the
 * token as text, so the hue is a second channel and never the only one.
 *
 * `Record<ModeFamily, ...>` is the build-time guard. Adding a token to
 * MODE_FAMILIES without adding its colours here is a type error, and
 * `theme.worker.test.ts` fails on the same reasoning as DURATION_BUCKETS.
 *
 * Hue is kept off the three roles that already mean something: amber is time,
 * cyan is interactive, and the cool-to-hot ramp is length. Chips are tinted
 * pills with a bordered edge and sit in a text column, the duration stripe is
 * a bar on the cell's edge -- different shapes, so the two never read as one
 * scale. Every foreground clears 7:1 against its own chip background (AAA),
 * and the test recomputes that rather than trusting this table.
 */

import type { ModeFamily } from "../schedule.js";
import { esc } from "./html.js";

export interface Swatch { fg: string; bg: string; bd: string }

export const MODE_COLORS: Record<ModeFamily, { dark: Swatch; light: Swatch }> = {
  "CW":      { dark: { fg: "#F391DF", bg: "#361A41", bd: "#A761A0" }, light: { fg: "#8A0F71", bg: "#FCE2F7", bd: "#B863A7" } },
  "SSB":     { dark: { fg: "#F29A8C", bg: "#361F23", bd: "#A76962" }, light: { fg: "#932210", bg: "#FCE6E2", bd: "#BD7064" } },
  "AM":      { dark: { fg: "#D7B588", bg: "#302E2A", bd: "#947F62" }, light: { fg: "#674922", bg: "#F7F0E7", bd: "#A18C71" } },
  "FM":      { dark: { fg: "#B89FF4", bg: "#1D1A48", bd: "#7A6AAF" }, light: { fg: "#4E17CF", bg: "#EAE2FC", bd: "#8C68E1" } },
  "RTTY":    { dark: { fg: "#30E89C", bg: "#123F39", bd: "#24A474" }, light: { fg: "#0B603D", bg: "#E2FCF1", bd: "#619E85" } },
  "Digital": { dark: { fg: "#9AACF4", bg: "#122248", bd: "#6475AF" }, light: { fg: "#1639C5", bg: "#E2E7FC", bd: "#687FDB" } },
  "FT8/FT4": { dark: { fg: "#A5E830", bg: "#293F23", bd: "#73A42B" }, light: { fg: "#3E5C0A", bg: "#F2FCE2", bd: "#869C60" } },
  "Mixed":   { dark: { fg: "#ABB9C9", bg: "#1F2D3B", bd: "#738190" }, light: { fg: "#405064", bg: "#EBEFF2", bd: "#84909D" } },
};

/** One palette's rules. Called twice for light, like LIGHT in theme.ts. */
export function modeRules(theme: "dark" | "light", scope = ""): string {
  return (Object.keys(MODE_COLORS) as ModeFamily[])
    .map((m) => {
      const s = MODE_COLORS[m][theme];
      return `${scope}.mchip[data-m="${m}"] { --mf: ${s.fg}; --mb: ${s.bg}; --mbd: ${s.bd}; }`;
    })
    .join("\n");
}

/** The record's own modes, one chip each, then its submodes as plain text.
 *  A token outside the vocabulary still renders -- uncoloured, never dropped. */
export function modeChips(modes: readonly string[], submodes: readonly string[] = []): string {
  const chips = modes
    .map((m) => {
      const known = Object.prototype.hasOwnProperty.call(MODE_COLORS, m);
      return `<span class="mchip"${known ? ` data-m="${esc(m)}"` : ""}>${esc(m)}</span>`;
    })
    .join("");
  const sub = submodes.length ? `<span class="msub">${esc(submodes.join(", "))}</span>` : "";
  return `<span class="mchips">${chips}${sub}</span>`;
}
