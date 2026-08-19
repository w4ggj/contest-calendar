/**
 * The landing view's client script, inlined into the page.
 *
 * Everything here is enhancement. The server has already rendered every time
 * as UTC with a machine-readable `datetime` attribute, so with JavaScript off
 * the page is complete and correct -- just always in UTC, which is the zone
 * contest rules are written in anyway.
 *
 * What it adds:
 *   - the reader's local time under the UTC readout,
 *   - a UTC/local toggle for the times in the list,
 *   - countdowns that tick.
 *
 * Written as a plain string rather than a bundled module because it is ~2 kB
 * and inlining removes a round trip on the one page most likely to be opened
 * on a phone with two bars of signal.
 *
 * Rules it must obey, same as the server:
 *   - never parse a local-time string; every timestamp read here is a full ISO
 *     instant ending in Z,
 *   - never convert a `local_rolling` row -- those have no instant, and the
 *     server marks them with .rolling rather than emitting a <time>.
 *
 * The rail's day labels are the one thing here that is not formatting-only, so
 * they use the server's own `dayCellLabel`, interpolated below as source rather
 * than retyped. A second copy would be a second implementation of a date.
 */

import { dayCellLabel } from "./daylabel.js";

/**
 * The stored display choice, applied before the first paint.
 *
 * This is the one script on the page that has to be in `<head>` and has to be
 * synchronous. Everything else here is enhancement that can arrive late; a
 * theme that arrives late is a white page flashed at someone who chose dark,
 * which on a phone at 0300Z in a dark shack is the exact thing they chose dark
 * to avoid. Deliberately tiny, and deliberately does nothing when no choice has
 * been stored -- then the stylesheet's `prefers-color-scheme` is left to answer,
 * which is the right answer for everyone who has not touched the switch.
 */
export const THEME_BOOT = String.raw`
try {
  var t = localStorage.getItem("contestcal:theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
`;

export const CLIENT_JS = String.raw`
(function () {
  "use strict";

  var doc = document;
  var STORE = "contestcal:tz";

  // ---- zone detection --------------------------------------------------
  // Only enable the toggle once we have actually converted something. A
  // "show local time" button that then shows UTC is worse than no button.
  var zone = null;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (e) {
    zone = null;
  }

  var timeFmt = null;
  var dateFmt = null;
  if (zone) {
    try {
      timeFmt = new Intl.DateTimeFormat(undefined, {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone
      });
      dateFmt = new Intl.DateTimeFormat(undefined, {
        weekday: "short", day: "numeric", month: "short", timeZone: zone
      });
    } catch (e2) {
      timeFmt = null;
    }
  }
  var canConvert = !!timeFmt;

  // Short zone label: "CDT", "AEST". Falls back to the IANA name.
  var zoneLabel = zone || "local";
  if (canConvert) {
    try {
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone, timeZoneName: "short"
      }).formatToParts(new Date());
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "timeZoneName") { zoneLabel = parts[i].value; break; }
      }
    } catch (e3) { /* keep the IANA name */ }
  }

  function localTime(d) { return timeFmt.format(d); }
  function localDate(d) { return dateFmt.format(d); }

  // The server's own day-label function, shipped as source. Not a copy of it --
  // the same one, so a label can never mean something different up here.
  var dayCellLabel = ${dayCellLabel.toString()};

  // ---- UTC formatting (must match the server's, or the toggle flickers) --
  var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function p2(n) { return n < 10 ? "0" + n : "" + n; }
  function utcTime(d) { return p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + "Z"; }
  function utcDate(d) { return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; }

  // ---- mode ------------------------------------------------------------
  var mode = "utc";
  try {
    var saved = localStorage.getItem(STORE);
    if (saved === "local" && canConvert) mode = "local";
  } catch (e4) { /* private mode: stay on UTC */ }

  // The rail's cells are UTC days and stay put in either mode -- they are
  // instants, and so are the bars drawn against them. What changes is the name:
  // at 0304Z Friday a reader in New York is still on Thursday, and a rail
  // headed "Today 14" would be labelling a day they have not reached.
  function paintRuler() {
    var cells = doc.querySelectorAll(".ruler-day[data-day]");
    var tz = mode === "local" && canConvert ? zone : "UTC";
    for (var i = 0; i < cells.length; i++) {
      var t = Date.parse(cells[i].getAttribute("data-day"));
      if (isNaN(t)) continue;
      cells[i].textContent = dayCellLabel(t, i, tz);
    }
  }

  function paintTimes() {
    var nodes = doc.querySelectorAll("time[datetime][data-t]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var d = new Date(el.getAttribute("datetime"));
      if (isNaN(d.getTime())) continue;

      // Whether the date is shown at all is the server's decision: it omits the
      // date on an end time that lands on the start's day. Read that back off
      // the rendered text rather than re-deriving it, so the two agree.
      var hadDate = /[A-Za-z]{3}\s+\d/.test(el.textContent);

      if (mode === "local") {
        el.textContent = hadDate ? localTime(d) + " " + localDate(d) : localTime(d);
      } else {
        el.textContent = hadDate ? utcTime(d) + " " + utcDate(d) : utcTime(d);
      }
    }
    paintRuler();
    doc.body.setAttribute("data-tz", mode);
  }

  function setMode(next) {
    mode = next;
    try { localStorage.setItem(STORE, next); } catch (e5) { /* ignore */ }
    var btns = doc.querySelectorAll(".tzbtn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-tz") === next ? "true" : "false");
    }
    paintTimes();
  }

  // ---- display: auto / light / dark ------------------------------------
  // Three states rather than two, because a two-state switch is a trap: flip it
  // once and the page stops following the system forever, with no way back. The
  // stored value is only ever "light" or "dark" -- auto is the ABSENCE of a
  // choice, so it is stored by removing the key, and a reader who picks auto
  // goes back to being someone the head script leaves alone.
  var THEME_STORE = "contestcal:theme";
  var themePref = "auto";
  try {
    var savedTheme = localStorage.getItem(THEME_STORE);
    if (savedTheme === "light" || savedTheme === "dark") themePref = savedTheme;
  } catch (e6) { /* private mode: auto, and the switch still works this visit */ }

  function setTheme(next) {
    themePref = next;
    if (next === "auto") doc.documentElement.removeAttribute("data-theme");
    else doc.documentElement.setAttribute("data-theme", next);
    try {
      if (next === "auto") localStorage.removeItem(THEME_STORE);
      else localStorage.setItem(THEME_STORE, next);
    } catch (e7) { /* ignore */ }
    var tb = doc.querySelectorAll(".thbtn");
    for (var i = 0; i < tb.length; i++) {
      tb[i].setAttribute("aria-pressed", tb[i].getAttribute("data-theme-set") === next ? "true" : "false");
    }
  }

  var themebar = doc.getElementById("themebar");
  if (themebar) {
    themebar.hidden = false;
    themebar.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".thbtn") : null;
      if (b) setTheme(b.getAttribute("data-theme-set"));
    });
    setTheme(themePref);
  }

  // ---- countdowns ------------------------------------------------------
  function rel(ms) {
    var min = Math.round(ms / 60000);
    if (min < 1) return "any moment";
    if (min < 60) return "in " + min + " min";
    var h = Math.floor(min / 60);
    if (h < 24) { var r = min % 60; return r ? "in " + h + "h " + r + "m" : "in " + h + "h"; }
    var d = Math.round(h / 24);
    return "in " + d + " day" + (d === 1 ? "" : "s");
  }

  function left(ms) {
    var min = Math.round(ms / 60000);
    if (min < 60) return min + " min left";
    var h = Math.floor(min / 60);
    if (h < 24) { var r = min % 60; return r ? h + "h " + r + "m left" : h + "h left"; }
    var d = Math.round(h / 24);
    return d + " day" + (d === 1 ? "" : "s") + " left";
  }

  function tickCountdowns(now) {
    var nodes = doc.querySelectorAll("[data-countdown]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var t = new Date(el.getAttribute("data-until")).getTime();
      if (isNaN(t)) continue;
      var delta = t - now;
      if (delta <= 0) {
        // The row's own state changed under us. Say so rather than counting
        // into negative numbers; a reload will re-partition it properly.
        el.textContent = el.getAttribute("data-countdown") === "end" ? "just finished" : "starting now";
        el.classList.add("soon");
        continue;
      }
      el.textContent = el.getAttribute("data-countdown") === "end" ? left(delta) : rel(delta);
      if (delta < 6 * 3600000) el.classList.add("soon");
    }
  }

  // ---- clocks ----------------------------------------------------------
  var utcEl = doc.querySelector('[data-clock="utc"]');
  var utcDateEl = doc.querySelector('[data-clock="utc-date"]');
  var localEl = doc.querySelector('[data-clock="local"]');
  var localZoneEl = doc.querySelector('[data-clock="local-zone"]');

  function tickClock() {
    var now = new Date();
    if (utcEl) utcEl.textContent = p2(now.getUTCHours()) + p2(now.getUTCMinutes());
    if (utcDateEl) utcDateEl.textContent = utcDate(now) + " " + now.getUTCFullYear();
    if (canConvert && localEl) {
      localEl.textContent = localTime(now);
      if (localZoneEl) localZoneEl.textContent = zoneLabel + " · " + zone;
    }
    tickCountdowns(now.getTime());
  }

  // ---- wire up ---------------------------------------------------------
  if (canConvert) {
    var bar = doc.getElementById("tzbar");
    if (bar) {
      bar.hidden = false;
      bar.addEventListener("click", function (ev) {
        var btn = ev.target.closest ? ev.target.closest(".tzbtn") : null;
        if (!btn) return;
        setMode(btn.getAttribute("data-tz"));
      });
    }
    setMode(mode);
  } else if (localEl) {
    // No usable zone: drop the empty placeholder rather than leave a dash.
    localEl.textContent = "";
  }

  // ---- filters ---------------------------------------------------------
  // The form already works: it is a GET form, so submitting writes the state
  // into the URL and the browser handles sharing, reload and the back button.
  // Two things are added here, and the page is correct without either.
  var form = doc.querySelector("form.filters");
  if (form) {
    // 1. Drop empty controls before submitting, so the URL that gets shared is
    //    the query someone actually made rather than every field on the form.
    form.addEventListener("submit", function () {
      var blanks = form.querySelectorAll("input[type=search], input[type=date], select");
      for (var i = 0; i < blanks.length; i++) {
        if (!blanks[i].value) blanks[i].disabled = true;
      }
      var range = form.querySelector('input[name="range"]:checked');
      if (range && !range.value) range.disabled = true;
    });

    // 2. Apply on change, and hide the Apply button -- but only once we know
    //    the browser can submit programmatically. Hiding a button we then
    //    cannot replace would leave the filters unusable, which is worse than
    //    an extra click.
    if (typeof form.requestSubmit === "function") {
      form.classList.add("enhanced");
      form.addEventListener("change", function () {
        form.requestSubmit();
      });
    }
  }

  tickClock();
  setInterval(tickClock, 30000);

  // Coming back to a backgrounded tab is the common case on a phone: the page
  // may be hours stale, and a stale contest calendar is the failure mode this
  // whole project exists to avoid.
  doc.addEventListener("visibilitychange", function () {
    if (!doc.hidden) tickClock();
  });
})();
`;
