/**
 * Styles for the landing view.
 *
 * DESIGN DIRECTION -- "panadapter"
 * --------------------------------
 * The page is read as an instrument, not a document. Three ideas carry it:
 *
 * 1. The hero is a UTC readout, set large in tabular mono like a rig's
 *    frequency display, with the operator's local time small beneath it. That
 *    is the thesis of the whole product: contest time is UTC time, and every
 *    other calendar makes you convert in your head.
 *
 * 2. The signature is a shared 7-day time rail. Every contest bar is positioned
 *    against the SAME axis as the day ruler above it, so the page is a chart
 *    you read down rather than a list. Only a calendar that stores durations can
 *    draw this; ours does.
 *
 * 3. That rail is a waterfall. A panadapter plots time against frequency and
 *    encodes strength as colour, which is structurally what the rail already
 *    is -- so the bars are coloured on a spectral ramp, cool for short and hot
 *    for long, and the operator reading this at 0300Z has seen that ramp all
 *    weekend.
 *
 * The ramp is not decoration, and the test for that is what happens without it.
 * Width alone encodes duration, but width SATURATES: a two-hour sprint across a
 * seven-day rail is 1.2% wide, which is the 3px floor -- indistinguishable from
 * a four-hour one. "I have two hours free tonight" is the question the brief
 * says no other calendar can answer, and it is precisely the question the bar
 * geometry cannot answer. Colour is a second channel for the case where the
 * first one runs out. Its four stops ARE `DURATION_BUCKETS`, so the "I have"
 * filter chips carry the same four colours and the legend is a control the
 * reader already has.
 *
 * Colour roles are strict, which is what keeps three hues from becoming a
 * palette:
 *
 *     AMBER IS TIME       now-line, live lamp, countdowns, date filters
 *     CYAN IS INTERACTIVE links, focus, chosen filters
 *     THE RAMP IS LENGTH  contest bars and the duration chips, nothing else
 *
 * Amber sits at orange rather than yellow specifically so it cannot be read as
 * the ramp's hot end.
 *
 * The two themes are two different instruments, not one inverted:
 *
 *   dark  -- a waterfall's noise floor. Blue-black, not neutral charcoal,
 *            because that is the colour a panadapter actually sits at, and
 *            the bars are spectral traces over it.
 *   light -- an IARU band chart printed on paper. Cool white stock, chart
 *            annotation red, and a SINGLE-INK ramp running pale to dense,
 *            because a printed chart has one ink and shows magnitude by
 *            density. A spectral ramp on white is a screenshot of a screen,
 *            not a chart. "Legible at arm's length on a phone in a park" is in
 *            the brief and it is a daylight requirement, so light is a real
 *            design rather than a courtesy.
 *
 * Type is the system stack on purpose. The page inlines its CSS and its script
 * to save a round trip on a phone with two bars of signal, and a display face
 * would cost either an external request or a base64 blob in every response.
 * The personality is carried by mono almost everywhere -- every label, time,
 * count and control is monospaced, and the proportional face appears only for
 * contest names and prose. An instrument's silkscreen is monospaced too.
 */

/**
 * Light tokens, declared once and used twice: `prefers-color-scheme` for the
 * reader who has never touched the switch, and `[data-theme="light"]` for the
 * one who has. Two copies of a palette drift the first time one is edited.
 */
const LIGHT = String.raw`
  color-scheme: light;

  --bg:        #EDF1F6;
  --panel:     #FFFFFF;
  --panel-2:   #E3EAF2;
  --rule:      #AEBECE;
  --rule-soft: #D4DEE8;

  --ink:       #0C1620;
  --ink-dim:   #44566A;
  --ink-faint: #55697E;

  --amber:     #B03A00;
  --amber-dim: #C98A5E;
  --cyan:      #075E80;
  --cyan-dim:  #7FAABE;
  --cyan-deep: #D6E6EE;

  /* One ink, four densities. Ordered by weight, not by hue. */
  --d1: #4A7DBA;
  --d2: #2C86AE;
  --d3: #17608A;
  --d4: #06304F;
`;

export const CSS = String.raw`
:root {
  color-scheme: dark;

  /* -- the noise floor -------------------------------------------------- */
  --bg:        #050B12;
  --panel:     #0A1520;
  --panel-2:   #11202E;
  --rule:      #1E3145;
  --rule-soft: #16232F;

  --ink:       #D5E3F0;
  --ink-dim:   #869CB2;
  --ink-faint: #6B8299;

  /* AMBER IS TIME. CYAN IS INTERACTIVE. THE RAMP IS LENGTH. */
  --amber:     #FF9E2C;
  --amber-dim: #8A5A16;
  --cyan:      #4FD3E8;
  --cyan-dim:  #2A6B78;
  --cyan-deep: #10323C;

  /* Waterfall: cool trace to hot trace, one stop per duration bucket. */
  --d1: #4C86E6;
  --d2: #22B8CE;
  --d3: #43CE72;
  --d4: #F0DC4A;

  --font-ui: ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", "SF Mono", "JetBrains Mono", "Roboto Mono", Menlo, Consolas, monospace;

  --gap: 1rem;
  --radius: 2px;

  --shell: 78rem;
}

/* The reader who has not chosen follows the system. ':not([data-theme])' is
   what lets an explicit choice of dark survive a light system setting -- without
   it the media query would win and the switch would only work one way. */
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) { ${LIGHT} }
}
:root[data-theme="light"] { ${LIGHT} }

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: 16px;
  line-height: 1.45;
  /* No page-wide texture. There was a faint scan rule here, left from the older
     direction; with the rail carrying real spectral colour it was one accessory
     too many, and it repainted the full page height for something nobody was
     meant to notice. */
}

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

/* The name and what it is, stacked. The heading stays two words -- a heading
   that has to explain itself is doing the tagline's job badly -- and the
   subject line sits under it, smaller and in sentence case so it reads as
   prose against the uppercase labels either side of it. */
.ident { display: flex; flex-direction: column; gap: .3rem; margin-right: auto; }
.ident h1 {
  margin: 0;
  font: 700 .84rem/1.2 var(--font-mono);
  letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink);
}
/* The title is a link home, and it goes to a CLEAN schedule -- no query. That
   is the one control on the site that discards the reader's filters, and it is
   deliberate: everything else preserves them, so without this there is no way
   back to the whole calendar except editing the URL. A site title going home is
   also what a reader will try first.
   It does not look like a link at rest, because a masthead that reads as body
   copy in link colour is a masthead nobody trusts. Cyan on hover and focus,
   which is where this site says interactive. */
.ident h1 a { color: inherit; text-decoration: none; }
.ident h1 a:hover { color: var(--cyan); }
.ident .tag {
  margin: 0;
  font: 400 .72rem/1.4 var(--font-ui);
  letter-spacing: 0; text-transform: none;
  color: var(--ink-faint);
}

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

/* A trace, coloured by how long the contest runs. 'data-d' is the row's own
   duration bucket, straight off durationBucketOf() -- so the bar cannot claim
   a length the row's text does not, and the four stops are the four the filter
   offers. The bright edge is the leading edge: the moment it starts, which is
   the thing you are actually scanning for. */
.bar {
  position: absolute; top: .25rem; bottom: .25rem;
  left: var(--s); width: var(--w);
  min-width: 3px;
  --trace: var(--d2);
  background: color-mix(in srgb, var(--trace) 22%, transparent);
  border-left: 2px solid var(--trace);
  border-radius: 0 1px 1px 0;
}
.bar[data-d="lt2"]   { --trace: var(--d1); }
.bar[data-d="2-12"]  { --trace: var(--d2); }
.bar[data-d="12-24"] { --trace: var(--d3); }
.bar[data-d="gte24"] { --trace: var(--d4); }
.bar.clip-l { border-left-style: dashed; }
.bar.clip-r::after {
  content: ""; position: absolute; right: -1px; top: 0; bottom: 0; width: 4px;
  background: repeating-linear-gradient(
    to bottom, var(--trace) 0 2px, transparent 2px 4px
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
  /* The label is right-aligned over the whole meter, so once a contest passes
     roughly three-quarters elapsed the fill runs underneath it and the reading
     sits on the hatch. Wide meters hide this; a 343px phone does not -- "74%
     elapsed" was unreadable on the second contest on screen. A halo in the
     panel colour is what a chart does with a label it cannot move, and it
     costs no markup and no geometry the server would have to compute. */
  text-shadow: 0 0 3px var(--panel), 0 0 3px var(--panel), 0 0 6px var(--panel);
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

.controls {
  display: flex; gap: .5rem 1.75rem; flex-wrap: wrap;
  margin: 1.25rem 0 0;
}
.tzbar {
  display: flex; align-items: center; gap: .5rem; flex-wrap: wrap;
  font: 500 0.72rem/1 var(--font-mono);
  letter-spacing: .1em; text-transform: uppercase; color: var(--ink-faint);
}
.tzbtn, .thbtn {
  font: inherit; letter-spacing: inherit; text-transform: inherit;
  background: var(--panel-2); color: var(--ink-dim);
  border: 1px solid var(--rule); border-radius: var(--radius);
  padding: .4em .7em; cursor: pointer;
}
/* The times toggle is about time, so its chosen state is amber. The display
   toggle is not about time -- it is a control, so it lights cyan. Two toggles
   side by side that lit the same colour would make the roles decorative. */
.tzbtn[aria-pressed="true"] { color: var(--amber); border-color: var(--amber-dim); background: transparent; }
.thbtn[aria-pressed="true"] { color: var(--cyan); border-color: var(--cyan-dim); background: var(--cyan-deep); }
.tzbtn:hover, .thbtn:hover { color: var(--ink); }
/* Hidden until the client script proves it can convert. Without JS the page is
   UTC and says so, rather than offering a toggle that does nothing. The display
   switch is hidden on the same principle but for its own reason: with no script
   there is nothing to remember a choice, and 'prefers-color-scheme' is already
   being honoured, so an inert switch would be the only broken thing on a page
   that otherwise works completely without JavaScript. */
.tzbar[hidden] { display: none; }

/* -- the filter panel --------------------------------------------------

   Colour discipline holds here too: AMBER IS TIME, CYAN IS CONTESTS. So the
   date-range chips light amber when chosen and everything that selects
   contests -- mode, band, duration, sponsor, the search box -- lights cyan.
   The panel is not a third thing with a palette of its own; it is the same two
   ideas, in control form. Unchosen chips carry no hue at all, which is what
   makes a chosen one readable at a glance on a phone.

   A <details> element rather than a scripted drawer: it opens, closes and
   remembers
   nothing, which is correct, because the URL is what remembers. It is rendered
   open whenever a filter is active so a shared link explains itself.          */

.panel {
  border: 1px solid var(--rule);
  background: var(--panel);
  margin: 1.5rem 0 0;
}
.panel > summary {
  display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap;
  padding: .7rem .9rem;
  cursor: pointer;
  font: 600 .74rem/1 var(--font-mono);
  letter-spacing: .16em; text-transform: uppercase;
  color: var(--ink-dim);
}
/* A flex summary loses the native disclosure triangle, and a summary with no
   marker reads as a heading rather than a control -- so it is drawn back. On the
   one page whose whole UI is a form, "this opens" has to be visible. */
.panel > summary { list-style: none; }
.panel > summary::-webkit-details-marker { display: none; }
.panel > summary::before { content: "\25B8"; color: var(--ink-faint); }
.panel[open] > summary::before { content: "\25BE"; }
.panel > summary:hover { color: var(--ink); }
.panel > summary:hover::before { color: var(--ink-dim); }
.panel > summary:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }
.panel-state { color: var(--ink-faint); letter-spacing: .1em; }
.panel-state .dot { color: var(--rule); }
.panel[open] > summary { border-bottom: 1px solid var(--rule-soft); }

.filters {
  display: grid; gap: 1rem;
  padding: 1rem .9rem 1.1rem;
}
.filters label { color: var(--ink-faint); }

.f-search { display: grid; gap: .35rem; }
.f-search label, .f-sponsor label, .f-dates-label, .fs legend {
  font: 600 .68rem/1 var(--font-mono);
  letter-spacing: .16em; text-transform: uppercase;
  color: var(--ink-faint);
  padding: 0;
}
.filters input[type="search"],
.filters input[type="date"],
.filters select {
  font: 500 .9rem/1.3 var(--font-ui);
  background: var(--bg); color: var(--ink);
  border: 1px solid var(--rule); border-radius: var(--radius);
  padding: .5em .6em;
  min-width: 0; max-width: 32rem;
}
.filters input:focus-visible, .filters select:focus-visible {
  outline: 2px solid var(--cyan); outline-offset: 1px; border-color: var(--cyan-dim);
}

.fs { border: 0; margin: 0; padding: 0; display: grid; gap: .45rem; }
.chips { display: flex; flex-wrap: wrap; gap: .35rem; }

/* The input is the control and stays reachable by keyboard; the label is what
   is drawn. Never display:none on the input -- that removes it from the tab
   order and from every screen reader, and this form is the whole UI for a
   reader without JavaScript. */
.chip { position: relative; display: inline-flex; }
.chip input {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: pointer;
}
.chip label {
  display: inline-block;
  font: 500 .82rem/1 var(--font-mono);
  color: var(--ink-dim);
  background: var(--panel-2);
  border: 1px solid var(--rule); border-radius: var(--radius);
  padding: .5em .7em;
  cursor: pointer;
  white-space: nowrap;
}
.chip:hover label { color: var(--ink); border-color: var(--ink-faint); }
.chip.on label {
  color: var(--cyan); border-color: var(--cyan-dim);
  background: var(--cyan-deep);
}
.chip input:focus-visible + label { outline: 2px solid var(--cyan); outline-offset: 1px; }

/* Dates are time, so they are amber. */
.filters .fs:has(input[name="range"]) .chip.on label {
  color: var(--amber); border-color: var(--amber-dim);
  background: transparent;
}

/* The duration chips ARE the rail's legend. Same four stops, same order, so
   choosing "under 2 hours" and then scanning the rail for that colour is one
   idea rather than two. Declared after the generic '.chip.on' above, and more
   specific than it, so the ramp wins for these four and nothing else. */
.chip:has(input[name="duration"][value="lt2"])   { --trace: var(--d1); }
.chip:has(input[name="duration"][value="2-12"])  { --trace: var(--d2); }
.chip:has(input[name="duration"][value="12-24"]) { --trace: var(--d3); }
.chip:has(input[name="duration"][value="gte24"]) { --trace: var(--d4); }

.filters .fs:has(input[name="duration"]) .chip label {
  border-left: 3px solid var(--trace);
}
.filters .fs:has(input[name="duration"]) .chip.on label {
  color: var(--ink); border-color: var(--trace);
  background: color-mix(in srgb, var(--trace) 18%, transparent);
}

.f-dates {
  display: flex; align-items: center; gap: .5rem; flex-wrap: wrap;
  color: var(--ink-faint);
}
.f-dates label {
  font: 500 .78rem/1 var(--font-mono);
  letter-spacing: .08em; text-transform: uppercase;
}
.f-sponsor { display: grid; gap: .35rem; }

.f-actions { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.btn {
  font: 600 .74rem/1 var(--font-mono);
  letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink-dim); text-decoration: none;
  background: var(--panel-2);
  border: 1px solid var(--rule); border-radius: var(--radius);
  padding: .65em .95em; cursor: pointer;
}
.btn:hover { color: var(--ink); border-color: var(--ink-faint); }
.btn.primary { color: var(--cyan); border-color: var(--cyan-dim); }
.btn.ghost { background: transparent; border-color: var(--rule-soft); }
.btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 1px; }

/* Hidden only once the script has taken over submission. Without JS it is the
   only way to apply a filter, so it is visible by default and stays that way
   if anything goes wrong. */
.filters.enhanced .btn.primary { display: none; }

/* -- what the data could not answer ------------------------------------ */

.caveat {
  margin: .9rem 0 0;
  padding: .6rem .8rem;
  border-left: 2px solid var(--rule);
  font: 500 .8rem/1.55 var(--font-mono);
  color: var(--ink-faint);
  max-width: 78ch;
}

/* -- the standing pages ------------------------------------------------

   /about, /data and /contact are prose, and prose is the one thing on this
   site that is not an instrument reading. So they drop the mono furniture and
   set body copy in the system UI stack at a comfortable measure -- the mono
   stays for headings, labels and code, which is where it carries meaning.

   Deliberately no masthead: a nav bar across the top of the calendar would put
   something in front of the schedule on every load, and the schedule is the
   whole product. One back link, and the footer. */

/* Narrower than the schedule's shell and centred on the page: the calendar
   wants the width for its rail, prose wants a measure. Left-aligned inside the
   full shell, the column sat against one edge with a third of the page empty
   beside it. */
.doc { padding-top: 2.5rem; max-width: 74ch; }

/* The masthead name on pages whose own h1 belongs to something else -- a
   contest, a month. Identical to the h1 version on purpose: it is the same bar,
   and only the document outline underneath it differs. */
.ident .ident-name {
  margin: 0;
  font: 700 .84rem/1.2 var(--font-mono);
  letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink);
}
.ident .ident-name a { color: inherit; text-decoration: none; }
.ident .ident-name a:hover { color: var(--cyan); }

/* The month grid and a contest record run to the SCHEDULE'S width on desktop,
   so moving between the three views does not move the page's edges. The prose
   pages (/about, /data, /contact) keep the 74ch measure -- they are reading,
   and a line is not more readable for having room.
   Nothing here touches mobile: a max-width above the viewport does nothing, so
   the narrow layout is untouched by construction. */
.doc.wide { max-width: var(--shell); }
.doc.wide .detail { max-width: none; }

/* The prose inside a wide record runs full width too. Owner's call, and it
   REVERSES what shipped a few hours earlier on the same day.

   The first version held the source note to a 78ch measure, on the ordinary
   typographic argument that a 200-character line is hard to read. What that
   argument missed is where these notes actually sit: in a definition list,
   beside rows that are two words long. Capping only the long values gave one
   list two different right edges, which does not read as a considered measure
   -- it reads as a bug. And a contest record is reference material to scan
   rather than an essay to read, which is the case the measure argument is
   weakest against.

   dt-cta-note keeps its own 34ch. That is a caption beside a button rather than
   part of the record, and it was narrow before any of this. */

.backlink {
  margin: 0 0 2rem;
  font: 500 .74rem/1 var(--font-mono);
  letter-spacing: .1em; text-transform: uppercase;
}

.prose { max-width: 68ch; color: var(--ink-dim); }
.prose h1 {
  margin: 0 0 1.5rem;
  font: 700 clamp(1.8rem, 6vw, 2.6rem)/1.1 var(--font-mono);
  letter-spacing: -.02em; color: var(--ink);
}
.prose h2 {
  margin: 2.5rem 0 .9rem;
  font: 600 .78rem/1.3 var(--font-mono);
  letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-faint);
  padding-top: .9rem; border-top: 1px solid var(--rule);
}
.prose p { margin: 0 0 1rem; font: 400 .95rem/1.7 var(--font-ui); }
.prose .lede { font-size: 1.08rem; color: var(--ink); margin-bottom: 1.6rem; }
.prose strong { color: var(--ink); font-weight: 600; }
.prose em { font-style: italic; }
.prose code {
  font: 500 .85em/1 var(--font-mono);
  color: var(--amber);
  background: var(--panel-2);
  border-radius: var(--radius);
  padding: .15em .4em;
}
.prose .flag { display: inline-block; vertical-align: baseline; }

/* Term-and-answer rather than a bulleted list: every one of these is a name
   followed by what it means, and a list would hide that shape. */
.defs { margin: 0 0 1.2rem; display: grid; gap: .85rem; }
.defs dt {
  font: 600 .78rem/1.3 var(--font-mono);
  letter-spacing: .06em; color: var(--ink);
}
.defs dd {
  margin: .3rem 0 0; padding-left: .9rem;
  border-left: 1px solid var(--rule);
  font: 400 .92rem/1.65 var(--font-ui);
}

/* -- the contest detail view -------------------------------------------

   One contest, and the page where this project's argument is actually visible:
   the rule it stores, the clock the sponsor wrote, and the sentence the record
   was read from.

   Colour discipline holds and decides the one real choice here. AMBER IS TIME,
   so the plain-language rule is amber -- it is a statement about when, and it
   is the largest thing on the page after the name for the same reason the UTC
   readout is on the schedule. CYAN IS INTERACTIVE, so the sponsor's rules link
   is the only cyan button above the fold. The duration ramp does NOT appear
   here: there is one contest, so there is nothing to compare a length against,
   and spending --d1..--d4 on a page with a single duration would make the ramp
   decorative -- which is the one thing it is not allowed to become. */

.detail { max-width: 68ch; color: var(--ink-dim); }

.dt-sponsor {
  margin: 0 0 .5rem;
  font: 500 .74rem/1.4 var(--font-mono);
  letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink-faint);
}
.dt-sponsor .dot { color: var(--rule); }

.detail h1 {
  margin: 0 0 1rem;
  font: 700 clamp(1.6rem, 5.5vw, 2.3rem)/1.15 var(--font-mono);
  letter-spacing: -.02em; color: var(--ink);
}
.detail h1 .flag { vertical-align: middle; font-size: .42em; }

.detail .lede {
  margin: 0 0 1.4rem;
  font: 400 1.05rem/1.6 var(--font-ui); color: var(--ink);
}

.dt-cta { margin: 0 0 .5rem; display: flex; gap: .8rem; align-items: center; flex-wrap: wrap; }
.dt-cta-note {
  font: 500 .72rem/1.4 var(--font-mono);
  color: var(--ink-faint); max-width: 34ch;
}

.dt-sec { margin: 2.4rem 0 0; }
.dt-sec h2 {
  margin: 0 0 .9rem;
  font: 600 .78rem/1.3 var(--font-mono);
  letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-faint);
  padding-top: .9rem; border-top: 1px solid var(--rule);
}

/* The rule is the headline fact, and it is a fact about time. */
.rule-plain {
  margin: 0 0 .8rem;
  font: 600 clamp(1.05rem, 3.6vw, 1.35rem)/1.35 var(--font-mono);
  color: var(--amber);
}

.clocks { list-style: none; margin: 0 0 1rem; padding: 0; display: grid; gap: .35rem; }
.clock {
  font: 500 .92rem/1.5 var(--font-mono);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.clock .sess {
  margin-left: .7rem;
  font-size: .74rem; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-faint);
}

.detail .note {
  margin: 0 0 .6rem;
  font: 500 .8rem/1.6 var(--font-mono); color: var(--ink-faint);
}
.detail .note code { color: var(--amber); }
.detail .note strong { color: var(--ink-dim); }
/* The feed address is one long unbroken token, which is the shape that pushes a
   phone into horizontal scroll. Break it anywhere rather than let it set the
   page width -- a reader is going to select and copy it, not read it. */
.detail .note code.feed { overflow-wrap: anywhere; user-select: all; }

/* One running per line: when it opens and closes, how long, and how far off.
   Tabular numerals because these are read as a column even though each is a
   sentence. */
.runs { list-style: none; margin: 0; padding: 0; display: grid; gap: .1rem; }
.run {
  padding: .55rem 0;
  border-bottom: 1px solid var(--rule-soft);
  display: grid; gap: .15rem;
}
@media (min-width: 640px) {
  .run { grid-template-columns: minmax(0, 1fr) 8.5rem; align-items: baseline; }
  .run .row-count { text-align: right; }
  .run-due { grid-column: 1 / -1; }
}
.run-when {
  margin: 0;
  font: 500 .9rem/1.5 var(--font-mono); color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.run-when .dur { color: var(--ink-faint); }
.run-when .arrow { color: var(--ink-faint); padding: 0 .15em; }
.run-when .dot { color: var(--rule); }
.run-when .rolling { color: var(--amber); }
.run-when .yr {
  margin-left: .6rem; color: var(--ink-faint);
  font-size: .76rem; letter-spacing: .08em;
}
.run-due {
  margin: 0;
  font: 500 .76rem/1.5 var(--font-mono); color: var(--ink-faint);
}
.empty-line {
  margin: 0; padding: .7rem .9rem;
  border-left: 2px solid var(--rule);
  font: 400 .92rem/1.65 var(--font-ui); color: var(--ink-dim);
}
.empty-line strong { color: var(--ink); font-weight: 600; }

/* Term and answer, the same shape as the standing pages' definitions -- these
   are all "field: what the sponsor says". */
.spec { margin: 0; display: grid; gap: .9rem; }
.spec dt {
  font: 600 .72rem/1.3 var(--font-mono);
  letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink-faint);
}
.spec dd {
  margin: .3rem 0 0; padding-left: .9rem;
  border-left: 1px solid var(--rule);
  font: 400 .93rem/1.65 var(--font-ui); color: var(--ink);
}
.spec dd .sub {
  display: block; margin-top: .3rem;
  font: 500 .8rem/1.55 var(--font-mono); color: var(--ink-faint);
}
.spec dd q {
  display: block; quotes: none;
  font: 400 .9rem/1.7 var(--font-ui); color: var(--ink-dim);
}
.spec dd strong { color: var(--ink); font-weight: 600; }

/* Catalog prose is the only text on this site that is not ours to reflow, and
   it carries bare URLs: the longest unbroken token in the catalog today is a
   109-character LABRE rules PDF link inside a source note. At 320px that is a
   horizontal scrollbar on a page whose mobile pass was measured specifically to
   have none, so every block that renders catalog text breaks inside a word
   rather than pushing the viewport. */
.spec dd, .spec dd q, .detail .note, .empty-line, .dt-sponsor {
  overflow-wrap: anywhere;
}

/* A field nobody has read off the sponsor's page yet. Set apart from data on
   purpose: an empty field rendered like a value is a claim we cannot make. */
.unrec { font-style: italic; color: var(--ink-faint); }

.bandlist { display: flex; flex-wrap: wrap; gap: .3rem; }
.band, .pw {
  font: 500 .74rem/1 var(--font-mono);
  color: var(--ink-dim);
  border: 1px solid var(--rule); border-radius: var(--radius);
  padding: .4em .55em;
}
.pw { margin: 0 .3rem .3rem 0; display: inline-block; }
.pw .w { color: var(--ink-faint); }

.dt-take { margin: 0 0 .8rem; display: flex; gap: .6rem; flex-wrap: wrap; }

/* The two switches sit at the foot of this page rather than in a masthead:
   there is no readout here for them to belong to, and putting controls above
   the contest would be a nav bar by another name. */
/* The time and theme controls sit at the TOP of a contest page, on the backlink
   row -- moved there 2026-08-21 because at the bottom they were below the fold
   on every phone and most desktops, so changing the clock meant scrolling past
   the thing you wanted to read in a different clock. Beside the backlink rather
   than stacked above the heading, so they cost no vertical space: the same
   arrangement the schedule uses, where the controls sit alongside the readout
   instead of pushing the contests down. */
.dt-top {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: .5rem 1.5rem; flex-wrap: wrap;
  margin: 0 0 2rem;
}
.dt-top .backlink { margin: 0; }
.dt-controls { margin: 0; }

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
/* The Google polling delay. Dimmer than the footer's own prose because it is a
   caveat on the line above it, not a claim of its own -- but it has to be here,
   because a reader who subscribes and sees nothing for a day concludes the feed
   is broken, and no button anywhere can hurry Google along. */
.foot .feed-note { color: var(--ink-faint); }
.foot .feed-note strong { color: var(--ink-dim); }

/* -- phone -------------------------------------------------------------

   Build-mobile-first is the brief, and these are the three places it did not
   actually hold once the page was opened on one.                          */

@media (max-width: 599px) {
  /* The readout is the hero, but on a 360x780 phone it was pushing the first
     contest row to ~430px -- the page's whole job is below the fold on the
     device the brief names. Tightened, not shrunk: the UTC clock stays the
     largest thing on the page. */
  .readout { padding: 1.1rem 0 1.1rem; }
  .utc { font-size: clamp(2.9rem, 15vw, 5rem); }
  /* Three counts, three columns. As a flex row at 360px they came to 341px
     against 313px of room, so "13 later this month" dropped to a second line
     on its own and read as a separate fact rather than the third of three.
     Closing the gap until they fit was worse: the labels then butted together
     into "ON THE AIR NEXT 7 DAYS LATER THIS MONTH", one run of words with
     nothing saying where each ends. A column each fixes both -- the label
     wraps inside its own column instead of stealing the next one's line, and
     the column edge is what separates them. */
  .tally { display: grid; grid-template-columns: repeat(3, 1fr); gap: .6rem; }
  .tally span { font-size: .64rem; letter-spacing: .1em; }

  /* Eight day labels across ~328px gives each one 41px, and "Today 15" needs
     58px -- so every label was being clipped by the cell's own overflow rule,
     including the one that says which day is today. Thin the ticks instead:
     label every other cell and let it spill into the blank neighbour, which is
     what a chart does when the axis runs out of room. The gridlines still mark
     all eight days, so nothing is lost but ink. */
  .ruler-day { font-size: .58rem; letter-spacing: .02em; padding-left: .2rem; overflow: visible; }
  .ruler-day:nth-child(even) { font-size: 0; }

  /* A bar is the only thing here that cannot be read by touching it, so give
     it the height back that the ruler gave up. */
  .track, .meter { height: 1.6rem; }

  /* The masthead wrapped to three lines at 390px -- 95px of chrome above the
     hero -- and each line ended on a dangling "/", because a separator that
     means "these are on one line" is nonsense once they are not. Drop the
     separators, let the gap do the separating, and pull the tracking in
     enough that the name and the count share a line: two lines, 40px. The
     55px that buys back is a third of a contest row, at the top of the page
     where a phone can least afford it. */
  .strip-in { gap: .35rem .9rem; font-size: .62rem; letter-spacing: .08em; }
  .strip-in .sep { display: none; }

  /* The ident is two lines by construction, so it cannot give a line back; it
     gives size instead, and the tagline wraps to two rather than pushing the
     iCal and API links onto a row of their own. */
  .ident { gap: .2rem; margin-right: 0; }
  .ident h1 { font-size: .74rem; letter-spacing: .1em; }
  .ident .tag { font-size: .68rem; line-height: 1.35; }

  /* Measured: the full tagline wraps to two lines at 360 and at 320, which put
     20px back on top of the hero the mobile pass had just taken off. The clause
     that goes is the provenance one, because the footer states it again on every
     page; what stays is the half that says who the site is for, which is the
     whole reason the line exists. */
  .tag-more { display: none; }
}

/* Touch, not screen width: a 13" laptop with a touchscreen needs these too, and
   a desktop at a narrow window does not. 44px is the WCAG 2.5.5 target size. */
@media (pointer: coarse) {
  .tzbtn, .thbtn, .btn, .chip label, .filters input, .filters select {
    min-height: 44px;
  }
  /* Both axes. Measured at 390px: "UTC" came out 41.8 wide and "CW" 35.7 --
     tall enough and still too small to hit, because a target is an area. */
  .tzbtn, .thbtn, .btn, .chip label {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 44px;
  }
  .panel > summary { padding: 1rem .9rem; }
  /* The chip's input is absolutely positioned over its label and inherits the
     new height, so the hit area is the whole chip rather than the text inside
     it -- which is the difference between tapping "CW" and tapping near it. */
  .chips { gap: .5rem; }
  .f-actions { gap: .6rem; }

  /* Inline links are one line tall by construction: 21px for a contest name,
     16px in the masthead, 19px in the footer. Padding them out to 44 would
     space the schedule like a list of buttons and cost a row of contests per
     screenful. So grow the hit area and leave the box alone -- the ::after is
     44px regardless of the text's own height, centred on it, and bounded
     horizontally by the link so neighbours on a line keep their own edges.

     The contest name is the page's primary target -- 25 per screenful, each
     the link to the sponsor's rules this whole project exists to point at --
     and it was the smallest thing on the page a thumb had to hit. */
  .strip-in a, .foot .links a, .row-name a { position: relative; }
  .strip-in a::after, .foot .links a::after, .row-name a::after {
    content: ""; position: absolute;
    left: 0; right: 0; top: 50%; height: 44px;
    transform: translateY(-50%);
  }
}

/* ---------------------------------------------------------------------------
   The month grid
   ---------------------------------------------------------------------------
   Colour stays inside the three roles the rest of the site uses. The weekend
   and out-of-month tints are SURFACE changes, not a fourth colour role -- the
   weekend is not a new kind of meaning, it is the same cell shaded. Today is
   marked in amber because amber is time here, and today is a fact about time.
   Nothing in this grid is cyan except the links, which are interactive. */

.vh {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0;
}

.mo-head {
  display: flex; flex-wrap: wrap; gap: .8rem 1.2rem;
  align-items: baseline; justify-content: space-between;
  margin: 0 0 .4rem;
}
.mo-head h1 { margin: 0; font-size: 1.5rem; letter-spacing: -.01em; }
.mo-nav { display: flex; gap: .5rem; flex-wrap: wrap; margin: 0; }
.mo-sub { margin: 0 0 1rem; max-width: 70ch;
  font: 500 .8rem/1.6 var(--font-mono); color: var(--ink-faint); }
.mo-sub strong { color: var(--ink-dim); }
.viewswitch { margin: .6rem 0 0; }

/* The page body must never scroll sideways, so the grid scrolls inside itself.
   A month is seven columns whatever the viewport is: collapsing it to a list on
   a phone would throw away the one thing this view exists to show. */
.mo-wrap { overflow-x: auto; margin: 0 0 1.4rem; }
.mo-grid {
  width: 100%; min-width: 44rem;
  border-collapse: collapse; table-layout: fixed;
  font: 500 .8rem/1.4 var(--font-mono);
}
.mo-grid th {
  padding: .35rem .5rem; text-align: left;
  font-weight: 600; color: var(--ink-faint);
  border-bottom: 1px solid var(--rule);
}
.mo-grid th abbr { text-decoration: none; }
.mo-grid th.we { color: var(--ink-dim); }

.mo-day {
  vertical-align: top; width: 14.28%; height: 6.5rem;
  padding: .3rem .35rem;
  border: 1px solid var(--rule-soft);
  background: var(--panel);
}
.mo-day.we { background: var(--panel-2); }
.mo-day.out { opacity: .45; }
.mo-day.today { outline: 2px solid var(--amber); outline-offset: -2px; }

.mo-dn {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: .4rem; margin: 0 0 .25rem; color: var(--ink-faint);
}
.mo-day.today .mo-dn time { color: var(--amber); font-weight: 700; }
.mo-c {
  font-size: .7rem; color: var(--ink-faint);
  border: 1px solid var(--rule-soft); border-radius: 999px;
  padding: 0 .3rem;
}

.mo-evs { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: .15rem; }
.mo-ev a {
  display: flex; gap: .3rem; align-items: baseline;
  padding: .1rem .25rem; border-radius: 3px;
  color: var(--ink-dim); text-decoration: none;
  border-left: 2px solid var(--cyan-dim);
  background: var(--panel-2);
}
.mo-day.we .mo-ev a { background: var(--panel); }
.mo-ev a:hover { color: var(--ink); border-left-color: var(--cyan); }
.mo-ev a:focus-visible { outline: 2px solid var(--cyan); outline-offset: 1px; }
.mo-n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* "x2" where a contest runs more than one session in the same UTC day. Without
   the clock on the page those sessions would otherwise be the same title
   printed twice, which reads as a bug rather than as a fact about the contest. */
.mo-x { color: var(--ink-faint); font-size: .7rem; flex: none; }

/* A day the contest continues into is not a second running of it, and the grid
   must not read as though it were. Dimmer, and marked. */
.mo-ev.cont a { border-left-style: dotted; opacity: .8; }
.cont-mark { color: var(--ink-faint); font-size: .7rem; flex: none; }
.mo-ev.unver a { border-left-color: var(--rule); }

@media (max-width: 640px) {
  .mo-grid { min-width: 40rem; font-size: .72rem; }
  .mo-day { height: 5.5rem; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
  .lamp { opacity: 1; }
}
`;
