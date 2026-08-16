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
import { allSponsors, buildNowView } from "./schedule.js";
import { renderLanding } from "./render/landing.js";

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

function notFound(path: string): Response {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Not here · Contest Calendar</title>` +
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
          }),
        );
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
