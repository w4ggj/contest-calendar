"""
Sponsor rules-link checker.

The calendar's value depends on every contest deep-linking to its sponsor's own
rules. Those links point at 60-odd volunteer-run society sites, so they rot --
domains lapse, committees restructure, CMSs get replaced. This finds breakage
before users do.

Run monthly in CI. Treat failures as data-quality bugs, not cosmetic ones: a
dead rules link is the one thing that makes the calendar less trustworthy than
just reading the sponsor's site directly.

Usage:
    python check_links.py                # check current year
    python check_links.py 2027           # check a future year's resolved URLs
"""

import sys
from pathlib import Path

# Allow running directly (python scripts/validate.py) without installing.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from urllib.parse import urlparse

from contestcal import load_catalog
from contestcal.recurrence import resolve_rules_url

TIMEOUT = 20
UA = "TavaOne-ContestCalendar-LinkCheck/1.0 (+https://tavaone.com; W4GGJ)"

# Delay between successive requests to the SAME host. Society sites are small
# and often shared-hosted; hammering them concurrently gets you 503s that look
# like broken links but are really rate limiting. Be a good citizen -- these are
# volunteer-run servers doing us a favour by publishing rules at all.
PER_HOST_DELAY = 2.0
RETRY_STATUSES = {429, 503}


def _request(url: str, method: str) -> int:
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.status


def check(url: str) -> tuple[str, int | str]:
    """
    HEAD the URL, falling back to GET -- many older society sites reject HEAD.

    Retries once on 429/503, which are almost always rate limiting rather than a
    genuinely dead page.
    """
    if not url:
        return url, "no url"

    for attempt in range(2):
        for method in ("HEAD", "GET"):
            try:
                return url, _request(url, method)
            except urllib.error.HTTPError as e:
                if method == "HEAD" and e.code in (403, 405, 501):
                    continue  # retry same attempt with GET
                if e.code in RETRY_STATUSES and attempt == 0:
                    time.sleep(5)
                    break  # outer retry
                return url, e.code
            except Exception as e:  # noqa: BLE001
                if attempt == 0:
                    time.sleep(2)
                    break
                return url, type(e).__name__
    return url, "failed"


def check_host_group(urls: list[str]) -> list[tuple[str, int | str]]:
    """Check every URL on one host serially, spacing requests politely."""
    out = []
    for i, u in enumerate(urls):
        if i:
            time.sleep(PER_HOST_DELAY)
        out.append(check(u))
    return out


def main() -> int:
    year = int(sys.argv[1]) if len(sys.argv) > 1 else date.today().year

    catalog = load_catalog()

    targets = []
    for c in catalog:
        url = resolve_rules_url(c, year)
        targets.append((c["id"], c.get("sponsor", ""), url))

    # Dedupe -- several contests share one rules page (Rookie Roundup x3).
    unique_urls = sorted({u for _, _, u in targets if u})
    by_host: dict[str, list[str]] = defaultdict(list)
    for u in unique_urls:
        by_host[urlparse(u).netloc].append(u)

    print(
        f"Checking {len(unique_urls)} unique sponsor links "
        f"across {len(by_host)} hosts for {year}"
    )
    print("(parallel across hosts, serial within each host)\n")

    status_by_url: dict[str, int | str] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for group in pool.map(check_host_group, by_host.values()):
            status_by_url.update(dict(group))

    ok, broken = [], []
    for cid, sponsor, url in targets:
        status = status_by_url.get(url, "no url")
        (ok if status == 200 else broken).append((cid, sponsor, url, status))

    for cid, sponsor, url, status in broken:
        print(f"  BROKEN [{status}]  {cid}")
        print(f"                    {url}")

    print(f"\n  {len(ok)} live, {len(broken)} broken")

    if broken:
        print(
            "\n  Fix by: locating the sponsor's current rules page, updating\n"
            "  rules_url / rules_url_pattern, and refreshing rules_url_checked.\n"
            "  If a sponsor has gone dark entirely, set an archived snapshot in\n"
            "  rules_url_archived and flag the contest as possibly inactive."
        )
    return 1 if broken else 0


if __name__ == "__main__":
    raise SystemExit(main())
