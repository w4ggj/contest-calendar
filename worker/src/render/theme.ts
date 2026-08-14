/**
 * Styles for the landing view.
 *
 * DESIGN DIRECTION -- "backlit panel"
 * -----------------------------------
 * The page is read as an instrument, not a document. Two ideas carry it:
 *
 * 1. The hero is a UTC readout, set large in tabular mono like a rig's
 *    frequency display, with the operator's local time small beneath it. That
 *    is the thesis of the whole product: contest time is UTC time, and every
 *    other calendar makes you convert in your head.
 *
 * 2. The signature is a shared 7-day time rail. Every contest bar is positioned
 *    against the SAME axis as the day ruler above it, so the page is a chart
 *    you read down rather than a list. A 2-hour sprint is a sliver and a 48-hour
 *    contest is a slab -- which answers "I have two hours free tonight" at a
 *    glance, the question the brief says no other calendar can answer. Only a
 *    calendar that stores durations can draw this; ours does.
 *
 * Palette is an unlit LCD panel: cool dark slate, backlit cool white, one amber
 * and one cyan. The roles are strict and that is what keeps it from being
 * decoration -- AMBER IS TIME (now, live, countdowns, the now-line), CYAN IS
 * CONTESTS (spans, links). Nothing else is coloured.
 *
 * Light theme is not an afterthought: "legible at arm's length on a phone in a
 * park" is in the brief, and that is a daylight requirement. It reads as a
 * printed band-plan chart on paper rather than an inverted dark theme.
 */

export const CSS = String.raw`
:root {
  color-scheme: dark light;

  /* -- unlit LCD glass ------------------------------------------------- */
  --bg:        #0B0F14;
  --panel:     #121A23;
  --panel-2:   #182230;
  --rule:      #24303F;
  --rule-soft: #1A242F;

  --ink:       #DDE7F1;
  --ink-dim:   #8397AC;
  --ink-faint: #5A6B7D;

  /* AMBER IS TIME. CYAN IS CONTESTS. Nothing else gets colour. */
  --amber:     #FFB000;
  --amber-dim: #8A6212;
  --cyan:      #56C7DC;
  --cyan-dim:  #2A5F6B;
  --cyan-deep: #1D4652;

  --font-ui: ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", "SF Mono", "JetBrains Mono", "Roboto Mono", Menlo, Consolas, monospace;

  --gap: 1rem;
  --radius: 2px;

  --shell: 78rem;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg:        #F2F0EA;
    --panel:     #FBFAF7;
    --panel-2:   #F0EDE5;
    --rule:      #C9C4B6;
    --rule-soft: #DFDACF;

    --ink:       #1A1D21;
    --ink-dim:   #55606C;
    --ink-faint: #7B8794;

    --amber:     #9A5B00;
    --amber-dim: #D8A24A;
    --cyan:      #0E6377;
    --cyan-dim:  #8FC2CE;
    --cyan-deep: #C3DEE5;
  }
}

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: 16px;
  line-height: 1.45;
  /* Faint horizontal scan rule, like a panel's brushed face. One decoration,
     kept below the threshold of noticing. */
  background-image: repeating-linear-gradient(
    to bottom, transparent 0 3px, rgba(255,255,255,0.012) 3px 4px
  );
}

@media (prefers-color-scheme: light) { body { background-image: none; } }

a { color: var(--cyan); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { color: var(--ink); }

:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
  border-radius: var(--radius);
}

.shell { max-width: var(--shell); margin: 0 auto; padding: 0 1rem; }

.skip {
  position: absolute; left: -9999px; top: 0;
  background: var(--amber); color: #000; padding: .6rem 1rem; z-index: 50;
  font: 600 0.85rem/1 var(--font-mono);
}
.skip:focus { left: .5rem; top: .5rem; }

/* -- masthead strip ---------------------------------------------------- */

.strip {
  border-bottom: 1px solid var(--rule);
  background: var(--panel);
}
.strip-in {
  max-width: var(--shell); margin: 0 auto; padding: .5rem 1rem;
  display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap;
  font: 500 0.7rem/1.4 var(--font-mono);
  letter-spacing: .16em; text-transform: uppercase;
  color: var(--ink-faint);
}
.strip-in strong { color: var(--ink-dim); font-weight: 600; }
.strip-in .sep { color: var(--rule); }

/* -- hero: the readout ------------------------------------------------- */

.readout {
  border-bottom: 1px solid var(--rule);
  padding: 1.75rem 0 1.5rem;
}
.readout-grid {
  display: grid; gap: 1.25rem;
  grid-template-columns: 1fr;
  align-items: end;
}
@media (min-width: 640px) {
  .readout-grid { grid-template-columns: auto 1fr; gap: 2.5rem; }
}

.utc {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(3.25rem, 13vw, 5rem);
  line-height: .92;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--amber);
  margin: 0;
  display: flex; align-items: baseline; gap: .1em;
}
.utc .z {
  font-size: .34em; letter-spacing: .2em; font-weight: 500;
  color: var(--amber-dim); align-self: flex-start; padding-top: .35em;
}
.utc-date {
  font: 500 0.78rem/1.4 var(--font-mono);
  letter-spacing: .2em; text-transform: uppercase;
  color: var(--ink-faint); margin: .5rem 0 0;
}

.local { margin: 0; }
.local-time {
  font: 600 1.5rem/1.1 var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ink); margin: 0;
  /* Rendered empty and filled by the client. Holds its height so the readout
     does not jump when the local clock arrives -- and stays empty, rather than
     showing a placeholder dash, when there is no JS to fill it. */
  min-height: 1.65rem;
}
.local-label {
  font: 500 0.72rem/1.5 var(--font-mono);
  letter-spacing: .16em; text-transform: uppercase;
  color: var(--ink-faint); margin: .25rem 0 0;
}
.local-label b { color: var(--ink-dim); font-weight: 600; }

.tally {
  margin: .9rem 0 0; padding: 0; list-style: none;
  display: flex; gap: 1.5rem; flex-wrap: wrap;
  font: 500 0.78rem/1.3 var(--font-mono);
  letter-spacing: .06em;
}
.tally b {
  display: block; font-size: 1.45rem; font-weight: 600; color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.tally .on b { color: var(--amber); }
.tally span { color: var(--ink-faint); text-transform: uppercase; letter-spacing: .16em; font-size: .7rem; }

/* -- section legends --------------------------------------------------- */

.legend {
  display: flex; align-items: center; gap: .75rem;
  margin: 2.25rem 0 .85rem;
  font: 600 0.72rem/1 var(--font-mono);
  letter-spacing: .22em; text-transform: uppercase;
  color: var(--ink-dim);
}
.legend::after {
  content: ""; flex: 1; height: 1px; background: var(--rule);
}
.legend .count {
  color: var(--ink-faint); letter-spacing: .1em; font-weight: 500;
}
.legend.on { color: var(--amber); }
.legend.on::after { background: linear-gradient(to right, var(--amber-dim), var(--rule) 40%); }

/* -- the shared axis --------------------------------------------------- */

/* The day ruler and every row are laid out on ONE axis, declared here and
   nowhere else.
   They are necessarily separate boxes -- a ruler, then a list of rows -- so the
   only thing holding a label above the bar it names is that both read this
   variable. Declaring grid-template-columns directly on .ruler or .row
   anywhere else re-opens the bug this replaced: a later .ruler rule won over
   the media query at equal specificity, the labels stretched across the whole
   card while the bars stayed in the middle column, and a Friday contest sat
   under Sunday's label.
   Fixed lengths rather than content-sized ones, so two grids reading the same
   template cannot resolve to different widths even in principle. */
:root { --axis: 1fr; }
@media (min-width: 860px) { :root { --axis: 20rem minmax(0, 1fr) 8.5rem; } }

.ruler, .row { display: grid; grid-template-columns: var(--axis); }
@media (min-width: 860px) { .ruler, .row { align-items: center; } }

/* -- rows -------------------------------------------------------------- */

.rows { list-style: none; margin: 0; padding: 0; }

.row {
  border-top: 1px solid var(--rule-soft);
  padding: .7rem 0;
  gap: .15rem .9rem;
}
.row:last-child { border-bottom: 1px solid var(--rule-soft); }

.row-main { min-width: 0; }

.row-name {
  margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.25;
  letter-spacing: -0.005em;
}
.row-name a { color: var(--ink); text-decoration: none; }
.row-name a:hover, .row-name a:focus-visible { color: var(--cyan); text-decoration: underline; }
/* The name links off-site to the sponsor's own rules. Mark it, quietly --
   an unmarked outbound link on a calendar row reads as "detail page". */
.row-name .ext {
  font-size: .7em; color: var(--ink-faint);
  margin-left: .25em; vertical-align: .15em;
}
.row-name a:hover .ext, .row-name a:focus-visible .ext { color: var(--cyan); }

.row-meta {
  margin: .2rem 0 0;
  font: 500 0.74rem/1.5 var(--font-mono);
  letter-spacing: .04em;
  color: var(--ink-faint);
  display: flex; flex-wrap: wrap; gap: .1rem .5rem;
}
.row-meta .dot { color: var(--rule); }
.row-meta .mode { color: var(--ink-dim); }

.row-when {
  margin: .25rem 0 0;
  font: 500 0.76rem/1.5 var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ink-dim);
  letter-spacing: .01em;
}
.row-when .dur { color: var(--ink-faint); }
.row-when .arrow { color: var(--ink-faint); padding: 0 .15em; }
/* An operator-anchored contest starts at a wall clock wherever you are: there
   is no single instant, so the row must not be converted or aligned to the
   rail. Set in amber -- it is a statement about time, not about a contest. */
.row-when .rolling { color: var(--amber); }

/* Unverified is stated, never hidden. A calendar that admits uncertainty is
   more trustworthy than one that does not. */
.flag {
  font: 600 0.66rem/1 var(--font-mono);
  letter-spacing: .12em; text-transform: uppercase;
  color: var(--amber); border: 1px solid var(--amber-dim);
  padding: .2em .4em; border-radius: var(--radius);
  white-space: nowrap;
}
.flag.muted { color: var(--ink-faint); border-color: var(--rule); }

.row-count {
  font: 600 0.8rem/1.3 var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ink-dim);
  letter-spacing: .02em;
}
@media (min-width: 860px) { .row-count { text-align: right; } }
.row-count .unit { color: var(--ink-faint); font-weight: 500; }
.row-count.soon { color: var(--amber); }

/* -- the signature: a shared 7-day rail -------------------------------- */

/* --days is set on .rail by the renderer: the window is whole UTC days from
   midnight today, so the cells line up with real day boundaries rather than
   with the moment the page happened to be requested. The ruler and every row
   read it, which is what keeps the bars on the same axis as the labels. */
.rail { --days: 8; }

/* Columns come from --axis above, deliberately not from here. */
.ruler { gap: 0 .9rem; margin: 0 0 .1rem; }
.ruler-pad { display: none; }
@media (min-width: 860px) { .ruler-pad { display: block; } }

.ruler-track {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  border-bottom: 1px solid var(--rule);
}
.ruler-day {
  font: 500 0.62rem/1 var(--font-mono);
  letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink-faint);
  padding: 0 0 .3rem .3rem;
  border-left: 1px solid var(--rule-soft);
  overflow: hidden; white-space: nowrap;
}
.ruler-day:first-child { border-left: 0; padding-left: 0; }
.ruler-day.we { color: var(--ink-dim); }

/* The now-line: amber, because amber is time. */
.now-line {
  position: absolute; top: 0; bottom: -1px; width: 1px;
  background: var(--amber);
  box-shadow: 0 0 6px var(--amber);
}
.now-line::before {
  content: ""; position: absolute; top: 0; left: -2px;
  width: 5px; height: 5px; background: var(--amber);
  clip-path: polygon(50% 100%, 0 0, 100% 0);
}

.track {
  position: relative;
  height: 1.35rem;
  margin: .35rem 0 .15rem;
  /* Day gridlines, so a bar can be read against the ruler without a mouse.
     No background-size: in a repeating gradient the percentage already
     resolves against the element, and setting a tile as well divides twice. */
  background-image: repeating-linear-gradient(
    to right, var(--rule-soft) 0 1px, transparent 1px calc(100% / var(--days))
  );
}
@media (min-width: 860px) { .track { margin: 0; } }

.bar {
  position: absolute; top: .25rem; bottom: .25rem;
  left: var(--s); width: var(--w);
  min-width: 3px;
  background: var(--cyan-deep);
  border-left: 2px solid var(--cyan);
  border-radius: 0 1px 1px 0;
}
.bar.clip-l { border-left-style: dashed; }
.bar.clip-r::after {
  content: ""; position: absolute; right: -1px; top: 0; bottom: 0; width: 4px;
  background: repeating-linear-gradient(
    to bottom, var(--cyan) 0 2px, transparent 2px 4px
  );
}

/* -- live rows --------------------------------------------------------- */

.row.live { background: linear-gradient(to right, rgba(255,176,0,.05), transparent 60%); }
.row.live .row-name a { color: var(--ink); }

.lamp {
  display: inline-block; width: .55em; height: .55em;
  border-radius: 50%; background: var(--amber);
  box-shadow: 0 0 8px var(--amber);
  margin-right: .5em; vertical-align: baseline;
  animation: breathe 2.6s ease-in-out infinite;
}
@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

/* An elapsed meter, not a position-in-the-week bar. Different question, so
   deliberately a different object: how much of this have I already missed. */
.meter {
  position: relative; height: 1.35rem; margin: .35rem 0 .15rem;
  background: var(--panel-2);
  border: 1px solid var(--rule);
}
@media (min-width: 860px) { .meter { margin: 0; } }
.meter-fill {
  position: absolute; inset: 0 auto 0 0; width: var(--pct);
  background: repeating-linear-gradient(
    135deg, var(--amber-dim) 0 3px, transparent 3px 6px
  );
  border-right: 2px solid var(--amber);
}
.meter-text {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: flex-end; padding-right: .5rem;
  font: 600 0.68rem/1 var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: .1em; color: var(--ink-dim);
}

/* -- empty states are directions, not apologies ------------------------ */

.empty {
  border: 1px dashed var(--rule);
  padding: 1.1rem 1rem;
  color: var(--ink-dim);
  font-size: .92rem;
}
.empty p { margin: 0; }
.empty p + p { margin-top: .4rem; color: var(--ink-faint); font-size: .86rem; }

/* -- controls ---------------------------------------------------------- */

.tzbar {
  display: flex; align-items: center; gap: .5rem; flex-wrap: wrap;
  margin: 1.25rem 0 0;
  font: 500 0.72rem/1 var(--font-mono);
  letter-spacing: .1em; text-transform: uppercase; color: var(--ink-faint);
}
.tzbtn {
  font: inherit; letter-spacing: inherit; text-transform: inherit;
  background: var(--panel-2); color: var(--ink-dim);
  border: 1px solid var(--rule); border-radius: var(--radius);
  padding: .4em .7em; cursor: pointer;
}
.tzbtn[aria-pressed="true"] { color: var(--amber); border-color: var(--amber-dim); background: transparent; }
.tzbtn:hover { color: var(--ink); }
/* Hidden until the client script proves it can convert. Without JS the page is
   UTC and says so, rather than offering a toggle that does nothing. */
.tzbar[hidden] { display: none; }

/* -- footer ------------------------------------------------------------ */

.foot {
  margin: 3rem 0 0; padding: 1.25rem 0 2.5rem;
  border-top: 1px solid var(--rule);
  font: 500 0.74rem/1.6 var(--font-mono);
  color: var(--ink-faint);
  display: grid; gap: .5rem;
}
.foot p { margin: 0; max-width: 60ch; }
.foot .links { display: flex; gap: 1rem; flex-wrap: wrap; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
  .lamp { opacity: 1; }
}
`;
