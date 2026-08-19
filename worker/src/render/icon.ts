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
 * is the honest colour rather than a decorative one. It is also the choice that
 * survives both tab strips — `#FF9E2C` sits at 4.5:1 against the dark theme's
 * `#050B12` and stays legible on white — so the icon does not need to know
 * which theme the *page* is in, only which the *browser chrome* is.
 *
 * That last distinction is why the media query is inside the SVG: a browser's
 * tab strip follows the OS, not the reader's stored choice on this site. The
 * dark-strip variant lightens slightly rather than switching hue, because an
 * icon that changes colour is an icon someone stops recognising.
 */

/** Amber on transparent: the rail's bars, shortest to longest. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<style>
  .b { fill: #E8862B }
  @media (prefers-color-scheme: dark) { .b { fill: #FF9E2C } }
</style>
<rect class="b" x="3"  y="20" width="5" height="9"  rx="1.5"/>
<rect class="b" x="10" y="15" width="5" height="14" rx="1.5"/>
<rect class="b" x="17" y="9"  width="5" height="20" rx="1.5"/>
<rect class="b" x="24" y="3"  width="5" height="26" rx="1.5"/>
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
  `<link rel="apple-touch-icon" href="/favicon.svg">` +
  // Colours the browser chrome itself on Android, which is the other half of
  // "dark icon on a dark background" — the strip the icon sits in.
  `<meta name="theme-color" content="#050B12" media="(prefers-color-scheme: dark)">` +
  `<meta name="theme-color" content="#EDF1F6" media="(prefers-color-scheme: light)">`;
