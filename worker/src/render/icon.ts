/**
 * The site's icon.
 *
 * There was none: no `rel="icon"` anywhere and `/favicon.ico` a 404, so every
 * browser fell back to its own placeholder — which on a dark tab strip is a
 * dark blob on a dark background, and unreadable.
 *
 * SVG rather than a PNG or an .ico, for three reasons that matter here. It is
 * ~400 bytes and inlines into the Worker like everything else, so it adds no
 * build step and no binary asset to a repo whose entire deployable is source.
 * It scales to whatever the tab strip, bookmark bar or phone home screen asks
 * for. And it can carry its own media query, which is the point below.
 *
 * **The mark is the rail.** Four bars of increasing height, which is the one
 * shape this site already draws: the seven-day rail with its duration ramp, a
 * sprint at the left and a 48-hour contest at the right. It is not a radio
 * tower or a calendar page — either would say "generic" — and at 16px an
 * abstract bar chart still reads as *something*, where a drawing of an antenna
 * becomes three grey pixels.
 *
 * **Amber, because amber is time.** The palette's rule holds here: amber is the
 * UTC readout, the now-line, the countdowns. The icon names a clock, so amber
 * is the honest colour rather than a decorative one.
 *
 * **One colour, and no media query — corrected 2026-08-19.** The first version
 * carried `prefers-color-scheme` inside the SVG so it could lighten on a dark
 * tab strip. That was keyed on the wrong signal. `prefers-color-scheme` reports
 * the OS preference, and a browser's tab strip does not have to agree with it:
 * Chrome can be themed dark on a light Windows, and the reader can set THIS
 * SITE dark while the OS stays light. In any of those the icon picks the
 * variant for a strip it is not sitting in, which is how an icon ends up dark
 * on dark — the failure the icon existed to fix.
 *
 * So it does not ask. `#E8862B` is a mid-amber that holds against both a white
 * strip and a near-black one, which is the only property that actually matters
 * for a 16px mark. It is also what the file already argued for one paragraph
 * further down: an icon that changes colour is an icon someone stops
 * recognising.
 */

/** Amber on transparent: the rail's bars, shortest to longest. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect fill="#E8862B" x="3"  y="20" width="5" height="9"  rx="1.5"/>
<rect fill="#E8862B" x="10" y="15" width="5" height="14" rx="1.5"/>
<rect fill="#E8862B" x="17" y="9"  width="5" height="20" rx="1.5"/>
<rect fill="#E8862B" x="24" y="3"  width="5" height="26" rx="1.5"/>
</svg>`;

/**
 * What every page puts in its <head>.
 *
 * One SVG covers the tab, the bookmark and the phone home screen. Declaring it
 * also stops the browser's unprompted request for `/favicon.ico`, which was
 * answering 404 on every cold page load.
 */
export const ICON_LINKS =
  `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` +
  // iOS DOES NOT RENDER AN SVG APPLE-TOUCH-ICON. This pointed at
  // /favicon.svg, which meant "Add to Home Screen" on an iPhone fell back
  // to a screenshot of the page rather than the mark -- the one place the
  // icon most needs to be a recognisable shape. It is a 180px PNG now.
  `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">` +
  // Declared even though browsers request it unprompted, so the format is
  // stated rather than sniffed.
  `<link rel="icon" sizes="32x32" href="/favicon.ico" type="image/x-icon">` +
  // ONE theme-color, set by script rather than by media query -- and the same
  // correction as the icon above, for the same reason.
  //
  // The first version shipped two of these keyed on `prefers-color-scheme`,
  // which reports the OS. But this site's theme is a THREE-STATE choice the
  // reader stores, so on a light PC with the site set to dark the browser
  // painted its chrome `#EDF1F6` around a `#050B12` page. `THEME_BOOT` already
  // reads the stored choice before first paint to set `data-theme`; it now
  // writes this too, so the chrome and the page cannot disagree.
  //
  // The static value is the dark one because that is what the stylesheet's
  // bare `:root` declares -- with scripting off the page renders dark unless
  // the OS says light, and this at least matches the majority case rather than
  // contradicting it.
  `<meta name="theme-color" content="#050B12">`;
