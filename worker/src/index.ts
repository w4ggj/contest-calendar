/**
 * The Worker: one deployable serving both the API and the landing page.
 *
 * `./runtime.js` is imported first and for its side effects. It pins the
 * timezone resolver and self-checks it against known-good vectors BEFORE any
 * request is served or any occurrence is expanded. Do not reorder these
 * imports, and do not import anything above it that touches the engine.
 */

import "./runtime.js";

import {
  errorResponse,
  handleContest,
  handleContests,
  handleHealth,
  handleIcs,
  handleMeta,
  handleSearch,
  parseFilters,
  parsePageWindow,
} from "./api.js";
import { allSponsors, buildNowView, contestById } from "./schedule.js";
import { SITE_NAME } from "./render/html.js";
import { renderDetail } from "./render/detail.js";
import { renderLanding } from "./render/landing.js";
import { parseMonth, renderMonth } from "./render/month.js";
import { FAVICON_SVG, ICON_LINKS } from "./render/icon.js";
import {
  APPLE_TOUCH_PNG_B64,
  FAVICON_ICO_B64,
} from "./render/icon-raster.js";
import { findPage, renderPage } from "./render/pages.js";

/**
 * The landing page is cached for a minute at the edge and revalidated in the
 * background for an hour. A contest calendar changes on the scale of days; the
 * short TTL is only so the "on the air now" section cannot go visibly stale,
 * and `stale-while-revalidate` means nobody ever waits for a cold render.
 */
const PAGE_CACHE = "public, max-age=60, stale-while-revalidate=3600";

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": status === 200 ? PAGE_CACHE : "no-store",
      // No inline-script nonce: the page's one script is inlined deliberately
      // (see render/client.ts), so 'unsafe-inline' is the honest declaration
      // rather than a nonce that would have to be threaded through the cache.
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
        // `form-action 'self'`, not 'none': the filter panel is a real GET form
        // and the page has to keep working with JavaScript off, which means the
        // browser has to be allowed to submit it. 'self' is still the whole
        // restriction -- it can post nowhere but back to this Worker.
        "img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * A base64 constant, served as bytes.
 *
 * The icons are inlined as base64 rather than shipped as files because this
 * Worker's entire deployable is source -- there is no asset pipeline to put a
 * binary through, and a constant in a .ts file is reviewable in a diff. They
 * are generated from the same geometry as FAVICON_SVG by
 * scratchpad/make_icons.py; regenerate rather than hand-edit.
 */
function binary(b64: string, type: string): Response {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      "content-type": type,
      // Immutable: the mark does not change, and an icon re-fetched on every
      // navigation is the cheapest possible waste.
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}

function notFound(path: string): Response {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      ICON_LINKS +
      `<title>Not here · ${SITE_NAME}</title>` +
      `<style>body{background:#0B0E11;color:#C9D2D8;font:16px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;` +
      `margin:0;display:grid;place-items:center;min-height:100vh;padding:2rem;text-align:center}` +
      `a{color:#5FD3E8}code{color:#E8A33D}</style></head><body><div>` +
      `<p>No route matches <code>${path.replace(/[<&]/g, "")}</code>.</p>` +
      `<p><a href="/">Contests on the air now</a> · <a href="/api/meta">what this serves</a></p>` +
      `</div></body></html>`,
    404,
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Everything downstream is a pure function of (catalog, now, query), so
    // HEAD is GET with the body dropped and nothing else needs to know.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD", "cache-control": "no-store" },
      });
    }

    // One `now` for the whole request. Reading the clock twice inside a render
    // is how a contest ends up "live" in one section and "starts in 0 min" in
    // another.
    const nowMs = Date.now();

    try {
      let response: Response;

      if (path === "/") {
        const filters = parseFilters(url.searchParams);
        const window = parsePageWindow(url.searchParams, nowMs);
        const view = buildNowView(nowMs, filters, filters.entity, window);
        response = html(
          renderLanding(view, {
            filters,
            params: url.searchParams,
            sponsors: allSponsors(),
            origin: url.origin,
          }),
        );
      } else if (path === "/month") {
        // The month grid. Same filters as the schedule, so a reader who
        // narrowed to CW keeps that view when they switch to the calendar.
        const filters = parseFilters(url.searchParams);
        const when = parseMonth(url.searchParams.get("m"), nowMs);
        if (!when) {
          // A malformed `m` is a 400 rather than a silent fallback to this
          // month: showing August under a URL that said 2026-13 is the kind of
          // quiet wrong answer this project spends its effort avoiding.
          response = new Response("Bad month. Use ?m=YYYY-MM.", {
            status: 400,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        } else {
          response = html(
            renderMonth({
              year: when.year,
              month: when.month,
              nowMs,
              filters,
              params: url.searchParams,
            }),
          );
        }
      } else if (path.startsWith("/contest/")) {
        // The detail view. Singular, so it cannot be mistaken for the API's
        // `/api/contests/:id` or for `/contests.ics`, both of which serve the
        // same record in another format.
        const id = decodeURIComponent(path.slice("/contest/".length));
        const contest = contestById(id);
        if (!contest) {
          response = notFound(path);
        } else {
          // Parsed, not merely echoed: the filters on this URL are carried back
          // to the schedule by every link on the page, and a value the schedule
          // would reject with a 400 must not be handed back to the reader as a
          // link that 400s.
          parseFilters(url.searchParams);
          response = html(
            renderDetail({
              contest,
              nowMs,
              params: url.searchParams,
              entity: url.searchParams.get("entity") ?? "K",
              origin: url.origin,
            }),
          );
          // Nothing here is a function of `now` except the countdowns, which
          // the client ticks -- but "next runnings" does move, so this is
          // cached harder than the schedule and softer than the prose pages.
          response.headers.set(
            "cache-control",
            "public, max-age=600, stale-while-revalidate=86400",
          );
        }
      } else if (path === "/api/health") {
        response = handleHealth();
      } else if (path === "/api/meta") {
        response = handleMeta();
      } else if (path === "/api/contests") {
        response = handleContests(url, nowMs);
      } else if (path.startsWith("/api/contests/")) {
        response = handleContest(
          decodeURIComponent(path.slice("/api/contests/".length)),
          url,
          nowMs,
        );
      } else if (path === "/api/search") {
        response = handleSearch(url, nowMs);
      } else if (path === "/api/ics" || path === "/contests.ics") {
        response = handleIcs(url, nowMs);
      } else if (findPage(path.slice(1))) {
        // /about, /data, /contact. Static prose, so they can be cached harder
        // than the landing view -- nothing in them is a function of `now`.
        response = html(renderPage(findPage(path.slice(1))!));
        response.headers.set(
          "cache-control",
          "public, max-age=3600, stale-while-revalidate=86400",
        );
      } else if (path === "/favicon.svg") {
        // Immutable: the mark does not change, and a tab icon re-fetched on
        // every navigation is the cheapest possible waste.
        response = new Response(FAVICON_SVG, {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=604800, immutable",
          },
        });
      } else if (path === "/favicon.ico") {
        // Served even though every page declares its icon in <head>, because
        // the declaration only reaches things that parse the page. Crawlers,
        // link previewers, feed readers and a few browsers ask for this path
        // unconditionally, and it was answering 404 -- which is how a site with
        // a perfectly good icon still shows a blank square in a search result.
        response = binary(FAVICON_ICO_B64, "image/x-icon");
      } else if (path === "/apple-touch-icon.png"
        || path === "/apple-touch-icon-precomposed.png") {
        // iOS asks for both spellings before it gives up and screenshots the
        // page, and it asks for them at the ROOT regardless of what the <head>
        // says. Both answer.
        response = binary(APPLE_TOUCH_PNG_B64, "image/png");
      } else if (path === "/robots.txt") {
        response = new Response("User-agent: *\nAllow: /\n", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      } else {
        response = notFound(path);
      }

      if (request.method === "HEAD") {
        return new Response(null, {
          status: response.status,
          headers: response.headers,
        });
      }
      return response;
    } catch (err) {
      // Every handler throws ApiError for anything it can describe; anything
      // else reaching here is a real fault, and errorResponse logs it.
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler;
