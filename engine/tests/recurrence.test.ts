/**
 * Test suite for the contest recurrence engine -- TypeScript.
 *
 * A one-for-one mirror of tests/test_recurrence.py. Same assertions, same
 * sponsor-published dates, same names. Two engines checked against the same
 * evidence is the only thing that keeps them from drifting, and drift here
 * means the website and the dataset disagree about when a contest starts.
 *
 * The critical tests are the sponsor-validation ones: we encode a rule in the
 * sponsor's own words, generate a date, and assert it matches a date that
 * sponsor published independently. That is what proves the catalog is an
 * independent compilation and not a copy of anyone else's.
 *
 * Run:  npm test
 */

import { describe, expect, test } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR, loadCatalog, loadRegistry } from "../src/catalog.js";
import {
  CATALOG_BANDS,
  CATALOG_MODES,
  type Contest,
  eligibilityFor,
  expand,
  expandYear,
  filterByEligibility,
  fullWeekendsInMonth,
  isoDate,
  resolveAnchors,
  resolveRulesUrl,
  saturdaysInMonth,
  weekdayOf,
} from "../src/recurrence.js";

const catalog = loadCatalog();

const MODES = new Set<string>(CATALOG_MODES);
const BANDS = new Set<string>(CATALOG_BANDS);

const byId = (cid: string): Contest => {
  const c = catalog.find((x) => x.id === cid);
  if (!c) throw new Error(`no such contest: ${cid}`);
  return c;
};

/** "YYYY-MM-DD" for a calendar date, mirroring Python's date() comparisons. */
const D = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const at = (y: number, m: number, d: number, h = 0, mi = 0): number =>
  Date.UTC(y, m - 1, d, h, mi);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// The full-weekend definition -- the subtlest part of the whole engine
// ---------------------------------------------------------------------------

test("full weekend excludes month-ending Saturday", () => {
  // January 2026 ends on Saturday the 31st. That Saturday does NOT begin a full
  // weekend, because Feb 1 falls outside January. A naive "count the Saturdays"
  // implementation gets this wrong and silently shifts contest dates.
  expect(saturdaysInMonth(2026, 1)).toHaveLength(5);
  expect(fullWeekendsInMonth(2026, 1)).toHaveLength(4);
  const last = fullWeekendsInMonth(2026, 1).at(-1)!;
  expect(isoDate(last)).toBe(D(2026, 1, 24));
});

test("full weekend edge occurs regularly", () => {
  // This edge case is not exotic -- it happens ~17 times in a decade.
  let count = 0;
  for (let y = 2026; y <= 2035; y++) {
    for (let m = 1; m <= 12; m++) {
      if (saturdaysInMonth(y, m).length !== fullWeekendsInMonth(y, m).length) {
        count++;
      }
    }
  }
  expect(count).toBe(17);
});

// ---------------------------------------------------------------------------
// Sponsor validation -- ARRL
// ---------------------------------------------------------------------------

const ARRL_2026: Record<string, string> = {
  "arrl-straight-key-night": D(2026, 1, 1),
  "arrl-rtty-roundup": D(2026, 1, 3),
  "arrl-january-vhf": D(2026, 1, 17),
  "arrl-dx-cw": D(2026, 2, 21),
  "arrl-dx-ssb": D(2026, 3, 7),
  "arrl-rookie-roundup-ssb": D(2026, 4, 19),
  "arrl-digital": D(2026, 6, 6),
  "arrl-june-vhf": D(2026, 6, 13),
  "arrl-kids-day-jun": D(2026, 6, 20),
  "arrl-field-day": D(2026, 6, 27),
  "arrl-iaru-hf": D(2026, 7, 11),
  "arrl-222-and-up": D(2026, 8, 1),
  "arrl-10ghz-leg1": D(2026, 8, 15),
  "arrl-rookie-roundup-rtty": D(2026, 8, 16),
  "arrl-september-vhf": D(2026, 9, 12),
  "arrl-10ghz-leg2": D(2026, 9, 19),
  "arrl-sweepstakes-cw": D(2026, 11, 7),
  "arrl-sweepstakes-ssb": D(2026, 11, 21),
  "arrl-160m": D(2026, 12, 4),
  "arrl-10m": D(2026, 12, 12),
  "arrl-rookie-roundup-cw": D(2026, 12, 20),
};

test.each(Object.entries(ARRL_2026).sort())(
  "ARRL dates match published table: %s",
  (cid, expected) => {
    // Generated from ARRL's rules; checked against ARRL's own 2026 date table.
    const occ = expand(byId(cid), 2026);
    expect(occ.length, `${cid} produced no occurrence`).toBeGreaterThan(0);
    expect(isoDate(occ[0].start!)).toBe(expected);
  },
);

test("RTTY Roundup never falls on January first", () => {
  // ARRL: 'first full weekend of January, but never on January 1'. Exercised in
  // any year where Jan 1 is itself a Saturday.
  const c = byId("arrl-rtty-roundup");
  for (let y = 2026; y <= 2045; y++) {
    const anchor = resolveAnchors(c.recurrence, y)[0];
    expect(
      anchor.getUTCMonth() === 0 && anchor.getUTCDate() === 1,
    ).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Sponsor validation -- RSGB (second continent, second organisation)
// ---------------------------------------------------------------------------

test("RSGB IOTA matches published 2026 dates", () => {
  // RSGB rules: 'the contest always takes place over the last FULL weekend of
  // July'. RSGB independently publishes Sat 25 - Sun 26 July 2026, 1200-1200.
  const occ = expand(byId("rsgb-iota"), 2026)[0];
  expect(isoDate(occ.start!)).toBe(D(2026, 7, 25));
  expect(isoDate(occ.end!)).toBe(D(2026, 7, 26));
  expect([occ.start!.getUTCHours(), occ.end!.getUTCHours()]).toEqual([12, 12]);
  expect(occ.duration_hours).toBe(24);
});

test("IOTA log deadline computed", () => {
  // RSGB requires logs within 5 days of the contest end.
  const occ = expand(byId("rsgb-iota"), 2026)[0];
  expect(occ.log_due).not.toBeNull();
  expect((occ.log_due!.getTime() - occ.end!.getTime()) / DAY_MS).toBe(5);
});

// ---------------------------------------------------------------------------
// High-frequency recurrence
// ---------------------------------------------------------------------------

test("weekly contest expands across year", () => {
  // CWops CWT: four sessions per week -> ~208 occurrences.
  const occ = expand(byId("cwops-cwt"), 2026);
  expect(occ.length).toBeGreaterThanOrEqual(205);
  expect(occ.length).toBeLessThanOrEqual(212);
  expect(occ.every((o) => o.start!.getUTCFullYear() === 2026)).toBe(true);
});

test("monthly contest yields twelve", () => {
  const occ = expand(byId("ars-spartan-sprint"), 2026);
  expect(occ).toHaveLength(12);
  expect(new Set(occ.map((o) => o.start!.getUTCMonth())).size).toBe(12);
});

test("no occurrence leaks outside requested year", () => {
  for (const year of [2026, 2027, 2030]) {
    for (const o of expandYear(catalog, year)) {
      expect((o.start ?? o.start_wall)!.getUTCFullYear()).toBe(year);
    }
  }
});

// ---------------------------------------------------------------------------
// Rules links
// ---------------------------------------------------------------------------

test("year-versioned URL pattern resolves", () => {
  // RSGB versions rules by year; links must follow or they rot each January.
  const c = byId("rsgb-iota");
  expect(resolveRulesUrl(c, 2026).endsWith("/2026/riota.shtml")).toBe(true);
  expect(resolveRulesUrl(c, 2031).endsWith("/2031/riota.shtml")).toBe(true);
});

test("stable slug URL is year-independent", () => {
  const c = byId("arrl-field-day");
  expect(resolveRulesUrl(c, 2026)).toBe(resolveRulesUrl(c, 2035));
});

test("every verified contest has a rules link", () => {
  const missing = catalog
    .filter((c) => c.verified && !(c.rules_url || c.rules_url_pattern))
    .map((c) => c.id);
  expect(missing, `verified contests missing rules link: ${missing}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

test("domestic-only contest blocked for DX", () => {
  const afs = byId("rsgb-afs-cw");
  expect(eligibilityFor(afs, "K").can_enter).toBe(false);
  expect(eligibilityFor(afs, "G").can_enter).toBe(true);
});

test("US-only contest blocked for DX", () => {
  const ss = byId("arrl-sweepstakes-cw");
  expect(eligibilityFor(ss, "K").can_enter).toBe(true);
  expect(eligibilityFor(ss, "G").can_enter).toBe(false);
});

test("two-sided contest reports who you work", () => {
  // ARRL DX: a K station may enter, but works DX only.
  const e = eligibilityFor(byId("arrl-dx-cw"), "K");
  expect(e.can_enter).toBe(true);
  expect(e.works).toContain("DX");
});

test("blocked contests carry an explanation", () => {
  // Silently hiding a contest is worse than hiding it with a reason.
  for (const c of catalog) {
    const e = eligibilityFor(c, "K");
    if (!e.can_enter) {
      expect(e.reason, `${c.id} filtered with no reason given`).toBeTruthy();
    }
  }
});

test("filter is symmetric across entities", () => {
  const occ = expandYear(catalog, 2026, "K");
  const kCan = filterByEligibility(occ, "K").length;
  const gOcc = expandYear(catalog, 2026, "G");
  const gCan = filterByEligibility(gOcc, "G").length;
  expect(kCan).toBeLessThan(occ.length);
  expect(gCan).toBeLessThan(gOcc.length);
});

test("include ineligible returns everything", () => {
  const occ = expandYear(catalog, 2026, "K");
  expect(filterByEligibility(occ, "K", true)).toHaveLength(occ.length);
});

// ---------------------------------------------------------------------------
// Catalog integrity
// ---------------------------------------------------------------------------

test("contest ids unique", () => {
  const ids = catalog.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("every contest expands without error", () => {
  for (const c of catalog) {
    for (const y of [2026, 2027, 2028]) expand(c, y);
  }
});

test("end always after start", () => {
  for (const o of expandYear(catalog, 2026)) {
    const s = (o.start ?? o.start_wall)!.getTime();
    const e = (o.end ?? o.end_wall)!.getTime();
    expect(e, `${o.contest_id} ends before it starts`).toBeGreaterThan(s);
  }
});

test("registry flags derived sources", () => {
  // Guard rail: the registry must keep naming sources that are downstream of
  // contestcalendar.com, so nobody reintroduces them as 'primary' later.
  const derived = loadRegistry().known_derived_sources.map((d) => d.name);
  expect(derived.some((n) => n.includes("Corral"))).toBe(true);
  expect(derived.some((n) => n.includes("SM3CER"))).toBe(true);
});

const REGISTRY_TIERS = [
  "tier_1_major_international",
  "tier_2_european_societies",
  "tier_3_other_regions",
  "tier_4_specialty_clubs",
];

/** sponsor string -> "tier|org". The registry declares this join. */
function registryOwner(reg: Record<string, any>): Map<string, string> {
  const owner = new Map<string, string>();
  for (const tier of REGISTRY_TIERS) {
    for (const org of reg[tier]) {
      for (const sponsor of org.catalog_sponsors) {
        expect(owner.has(sponsor), `${sponsor} claimed by two orgs`).toBe(false);
        owner.set(sponsor, `${tier}|${org.org}`);
      }
    }
  }
  return owner;
}

function tally(rows: Contest[]): [number, number, number] {
  return [
    rows.length,
    rows.filter((c) => c.verified).length,
    rows.filter((c) => c.active_until !== undefined).length,
  ];
}

test("registry coverage is current", () => {
  // The `coverage` block and every per-org `encoded` count are generated from
  // the catalog by scripts/coverage.py. This recomputes them from scratch
  // rather than importing that script: a generator that checks its own output
  // is grading its own homework.
  //
  // Stale counts are the specific failure being guarded. The registry's
  // hand-written `estimated_total` figures went stale silently -- 10-10 was
  // listed at four QSO Parties and runs three -- and a sourcing pass planned
  // against numbers that were never true wastes the pass. Anything stating how
  // much of the catalog exists therefore has to be derived from the catalog.
  const reg = loadRegistry() as Record<string, any>;
  const owner = registryOwner(reg);
  const regions: Record<string, string> = Object.fromEntries(
    Object.entries(reg.region_map as Record<string, string>).filter(
      ([k]) => !k.startsWith("$"),
    ),
  );
  const cov = reg.coverage;

  for (const c of catalog) {
    expect(owner.has(c.sponsor ?? ""), `${c.id}: sponsor unregistered`).toBe(true);
    expect(regions[c.country ?? ""], `${c.id}: country not in region_map`).toBeDefined();
  }

  expect([cov.total_encoded, cov.total_verified, cov.total_retired]).toEqual(
    tally(catalog),
  );
  expect(cov.sponsors_missing_from_registry).toEqual([]);
  expect(cov.unverified_ids).toEqual(
    catalog
      .filter((c) => !c.verified)
      .map((c) => c.id)
      .sort(),
  );

  for (const tier of REGISTRY_TIERS) {
    for (const org of reg[tier]) {
      const rows = catalog.filter(
        (c) => owner.get(c.sponsor ?? "") === `${tier}|${org.org}`,
      );
      const [encoded, verified] = tally(rows);
      expect(org.encoded, `${org.org}: encoded`).toBe(encoded);
      expect(org.encoded_verified, `${org.org}: encoded_verified`).toBe(verified);
    }

    const row = cov.by_tier[tier];
    const rows = catalog.filter((c) =>
      owner.get(c.sponsor ?? "")!.startsWith(`${tier}|`),
    );
    expect([row.encoded, row.verified, row.retired], tier).toEqual(tally(rows));
    expect(row.orgs, tier).toBe(reg[tier].length);
    expect(row.orgs_worked, tier).toBe(
      reg[tier].filter((o: any) => o.encoded > 0).length,
    );
  }

  for (const country of Object.keys(regions)) {
    const rows = catalog.filter((c) => c.country === country);
    if (rows.length) {
      const row = cov.by_country[country];
      expect([row.encoded, row.verified, row.retired], country).toEqual(tally(rows));
    } else {
      expect(cov.by_country[country], country).toBeUndefined();
    }
  }

  for (const region of new Set(Object.values(regions))) {
    const rows = catalog.filter((c) => regions[c.country ?? ""] === region);
    if (rows.length) {
      const row = cov.by_region[region];
      expect([row.encoded, row.verified, row.retired], region).toEqual(tally(rows));
    } else {
      // A region with nothing in it is invisible to every operator who lives
      // there, so it is named out loud rather than merely absent.
      expect(cov.by_region[region], region).toBeUndefined();
      expect(cov.thin.regions_with_nothing, region).toContain(region);
    }
  }

  const thin = cov.thin;
  const biggest = (Object.entries(cov.by_region) as [string, any][]).reduce((a, b) =>
    b[1].encoded > a[1].encoded ? b : a,
  );
  expect(thin.largest_region).toBe(biggest[0]);
  expect(thin.largest_region_share_pct).toBe(
    Math.round((1000.0 * biggest[1].encoded) / catalog.length) / 10,
  );
  expect(thin.tiers_barely_started).toEqual(
    REGISTRY_TIERS.filter(
      (t) => reg[t].length > 1 && reg[t].filter((o: any) => o.encoded > 0).length <= 1,
    ).sort(),
  );
  expect(thin.orgs_blocked_at_source).toEqual(
    REGISTRY_TIERS.flatMap((t) =>
      reg[t].filter((o: any) => o.status === "blocked").map((o: any) => o.org as string),
    ).sort(),
  );
});

// ---------------------------------------------------------------------------
// Tier 4 sponsor validation -- high-frequency club contests
// ---------------------------------------------------------------------------

test("CWT has four weekly sessions", () => {
  // cwops.org: four one-hour tests weekly -- Wed 1300Z/1900Z, Thu 0300Z/0700Z.
  // An earlier stub had only three, silently dropping ~52 sessions a year.
  const occ = expand(byId("cwops-cwt"), 2026);
  expect(occ.length).toBeGreaterThanOrEqual(205);
  expect(occ.length).toBeLessThanOrEqual(212);
  const firstWeek = occ.filter(
    (o) => o.start!.getUTCMonth() === 0 && o.start!.getUTCDate() <= 8,
  );
  expect(firstWeek).toHaveLength(4);
  expect(firstWeek.map((o) => o.start!.getUTCHours()).sort((a, b) => a - b))
    .toEqual([3, 7, 13, 19]);
});

test("SST runs Monday and Friday", () => {
  // k1usn.com: twice weekly at 0000Z Mondays and 2000Z Fridays.
  const occ = expand(byId("k1usn-sst"), 2026);
  expect(occ.length).toBeGreaterThanOrEqual(100);
  expect(occ.length).toBeLessThanOrEqual(106);
  expect(new Set(occ.map((o) => weekdayOf(o.start!)))).toEqual(new Set([0, 4]));
});

test("SKCC WES second Saturday", () => {
  // skccgroup.com: 1200 UTC on the 2nd Saturday, ending 2359 UTC Sunday.
  const occ = expand(byId("skcc-wes"), 2026);
  expect(occ).toHaveLength(12);
  expect(occ.every((o) => weekdayOf(o.start!) === 5)).toBe(true);
  expect(
    occ.every((o) => o.start!.getUTCDate() >= 8 && o.start!.getUTCDate() <= 14),
  ).toBe(true);
  const sep = occ.find((o) => o.start!.getUTCMonth() === 8)!;
  expect(isoDate(sep.start!)).toBe(D(2026, 9, 12)); // SKCC's published date
});

test("SKCC SKS fourth Wednesday", () => {
  // skccgroup.com: fourth Wednesday of each month at 0000 UTC, two hours.
  const occ = expand(byId("skcc-sks"), 2026);
  expect(occ).toHaveLength(12);
  expect(occ.every((o) => weekdayOf(o.start!) === 2)).toBe(true);
  const aug = occ.find((o) => o.start!.getUTCMonth() === 7)!;
  expect(isoDate(aug.start!)).toBe(D(2026, 8, 26)); // SKCC's published date
  expect(aug.duration_hours).toBe(2);
});

const NAQP_2026: Record<string, string[]> = {
  "naqp-cw": [D(2026, 1, 10), D(2026, 8, 1)],
  "naqp-ssb": [D(2026, 1, 17), D(2026, 8, 15)],
  "naqp-rtty": [D(2026, 2, 28), D(2026, 7, 18)],
};

test.each(Object.entries(NAQP_2026).sort())(
  "NAQP matches NCJ published dates: %s",
  (cid, expected) => {
    const occ = expand(byId(cid), 2026);
    expect(occ.map((o) => isoDate(o.start!))).toEqual(expected);
  },
);

test("NAQP RTTY uses last Saturday not last full weekend", () => {
  // NCJ: the winter RTTY running starts on the LAST SATURDAY in February. In
  // 2026 that is Feb 28, whose Sunday falls in March -- so it is explicitly NOT
  // the last full weekend (Feb 21). Proves the two rules are distinct.
  const occ = expand(byId("naqp-rtty"), 2026);
  const feb = occ.find((o) => o.start!.getUTCMonth() === 1)!;
  expect(isoDate(feb.start!)).toBe(D(2026, 2, 28));
  expect(isoDate(feb.start!)).not.toBe(D(2026, 2, 21));
  expect(feb.end!.getUTCMonth()).toBe(2); // spills into March
});

test("NAQP is twelve hours", () => {
  for (const cid of Object.keys(NAQP_2026)) {
    for (const o of expand(byId(cid), 2026)) {
      expect(o.duration_hours).toBeGreaterThan(11.9);
      expect(o.duration_hours).toBeLessThan(12.1);
    }
  }
});

// ---------------------------------------------------------------------------
// CQ Magazine -- the eight CQ contests.
//
// CQ is the one sponsor in this catalog that publishes almost no recurrence
// wording at all. Its five rules pages state the period ("Starts 00:00:00 UTC
// Saturday Ends 23:59:59 UTC Sunday") and that year's dates, and stop there. A
// sweep of every archived rules document on CQ's own five sites for 2016-2026
// turned up exactly one recurrence sentence, in the 2016 WPX rules:
//
//     "Each contest mode is a separate event running from 0000 UTC Saturday
//      until 2359 UTC Sunday. SSB is the last full weekend of March and CW is
//      the last full weekend of May."
//
// So seven of the eight rules are held to CQ's own published dates rather than
// to CQ's prose, and these tables are what makes that safe. Two independent
// CQ-published fields are checked: the contest dates CQ prints in the header of
// each year's rules, and the explicit log deadline CQ prints inside them.
// ---------------------------------------------------------------------------

// Dates CQ printed in the header of its own rules for that year. For CQ 160
// that is the 2200Z Friday start ("CW: 2200Z January 23 to 2200Z January 25");
// for the rest it is the 0000Z Saturday start.
const CQ_PRINTED_DATES: Record<string, [number, string][]> = {
  "cq-160-cw": [
    [2016, D(2016, 1, 29)], [2017, D(2017, 1, 27)],
    [2018, D(2018, 1, 26)], [2019, D(2019, 1, 25)],
    [2020, D(2020, 1, 24)], [2021, D(2021, 1, 29)],
    [2022, D(2022, 1, 28)], [2023, D(2023, 1, 27)],
    [2024, D(2024, 1, 26)], [2025, D(2025, 1, 24)],
    [2026, D(2026, 1, 23)],
  ],
  "cq-160-ssb": [
    [2016, D(2016, 2, 26)], [2017, D(2017, 2, 24)],
    [2018, D(2018, 2, 23)], [2019, D(2019, 2, 22)],
    [2020, D(2020, 2, 21)], [2021, D(2021, 2, 26)],
    [2022, D(2022, 2, 25)], [2023, D(2023, 2, 24)],
    [2024, D(2024, 2, 23)], [2025, D(2025, 2, 21)],
    [2026, D(2026, 2, 27)],
  ],
  "cq-wpx-ssb": [
    [2021, D(2021, 3, 27)], [2023, D(2023, 3, 25)],
    [2024, D(2024, 3, 30)], [2025, D(2025, 3, 29)],
    [2026, D(2026, 3, 28)],
  ],
  "cq-wpx-cw": [
    [2021, D(2021, 5, 29)], [2023, D(2023, 5, 27)],
    [2024, D(2024, 5, 25)], [2025, D(2025, 5, 24)],
    [2026, D(2026, 5, 30)],
  ],
  // 2025 is deliberately absent: CQ's own WPX_RTTY_Rules_2025_en.pdf is
  // headed "February 10-11, 2024", which were the 2024 dates. The log
  // deadline in that same PDF puts the 2025 running on February 8-9, and the
  // deadline table below is what pins it.
  "cq-wpx-rtty": [
    [2022, D(2022, 2, 12)], [2024, D(2024, 2, 10)],
    [2026, D(2026, 2, 14)],
  ],
  "cq-ww-rtty": [
    [2016, D(2016, 9, 24)], [2017, D(2017, 9, 23)],
    [2019, D(2019, 9, 28)], [2021, D(2021, 9, 25)],
    [2022, D(2022, 9, 24)], [2023, D(2023, 9, 23)],
    [2024, D(2024, 9, 28)], [2025, D(2025, 9, 27)],
    [2026, D(2026, 9, 26)],
  ],
  // CQ has not published 2026 CQ WW rules; cqww.com still serves the 2025 set.
  "cq-ww-ssb": [
    [2016, D(2016, 10, 29)], [2019, D(2019, 10, 26)],
    [2020, D(2020, 10, 24)], [2021, D(2021, 10, 30)],
    [2022, D(2022, 10, 29)], [2023, D(2023, 10, 28)],
    [2024, D(2024, 10, 26)], [2025, D(2025, 10, 25)],
  ],
  "cq-ww-cw": [
    [2016, D(2016, 11, 26)], [2019, D(2019, 11, 23)],
    [2020, D(2020, 11, 28)], [2021, D(2021, 11, 27)],
    [2022, D(2022, 11, 26)], [2023, D(2023, 11, 25)],
    [2024, D(2024, 11, 23)], [2025, D(2025, 11, 29)],
  ],
};

test.each(Object.entries(CQ_PRINTED_DATES).sort())(
  "CQ matches the dates CQ printed in its own rules: %s",
  (cid, published) => {
    const c = byId(cid);
    for (const [year, expected] of published) {
      const occ = expand(c, year);
      expect(occ.length, `${cid} produced nothing for ${year}`).toBeGreaterThan(0);
      expect(
        isoDate(occ[0].start!),
        `${cid} ${year}: engine disagrees with the date CQ printed`,
      ).toBe(expected);
    }
  },
);

// The log deadline CQ printed inside each year's rules, as [year, window days,
// deadline date]. The window is CQ's own: "All entries must be sent WITHIN FIVE
// (5) DAYS after the end of the contest" through 2025, and "WITHIN 48 HOURS"
// from 2026 for WPX, WPX RTTY and WW RTTY. Checking end + window against the
// printed deadline reaches the years whose header text would not extract, and
// is a second CQ-published field rather than a restatement of the first.
const CQ_PRINTED_DEADLINES: Record<string, [number, number, string][]> = {
  "cq-160-cw": [
    [2016, 5, D(2016, 2, 5)], [2017, 5, D(2017, 2, 3)],
    [2018, 5, D(2018, 2, 2)], [2021, 5, D(2021, 2, 5)],
    [2022, 5, D(2022, 2, 4)], [2023, 5, D(2023, 2, 3)],
    [2024, 5, D(2024, 2, 2)], [2025, 5, D(2025, 1, 31)],
    [2026, 5, D(2026, 1, 30)],
  ],
  "cq-160-ssb": [
    [2016, 5, D(2016, 3, 4)], [2017, 5, D(2017, 3, 3)],
    [2018, 5, D(2018, 3, 2)], [2020, 5, D(2020, 2, 28)],
    [2021, 5, D(2021, 3, 5)], [2022, 5, D(2022, 3, 4)],
    [2023, 5, D(2023, 3, 3)], [2024, 5, D(2024, 3, 1)],
    [2025, 5, D(2025, 2, 28)], [2026, 5, D(2026, 3, 6)],
  ],
  "cq-wpx-ssb": [
    [2016, 5, D(2016, 4, 1)], [2017, 5, D(2017, 3, 31)],
    [2018, 5, D(2018, 3, 30)], [2019, 5, D(2019, 4, 5)],
    [2020, 5, D(2020, 4, 3)], [2021, 5, D(2021, 4, 2)],
    [2022, 5, D(2022, 4, 1)], [2023, 5, D(2023, 3, 31)],
    [2024, 5, D(2024, 4, 5)], [2025, 5, D(2025, 4, 4)],
    [2026, 2, D(2026, 3, 31)],
  ],
  "cq-wpx-cw": [
    [2016, 5, D(2016, 6, 3)], [2017, 5, D(2017, 6, 2)],
    [2018, 5, D(2018, 6, 1)], [2019, 5, D(2019, 5, 31)],
    [2020, 5, D(2020, 6, 5)], [2021, 5, D(2021, 6, 4)],
    [2022, 5, D(2022, 6, 3)], [2023, 5, D(2023, 6, 2)],
    [2024, 5, D(2024, 5, 31)], [2025, 5, D(2025, 5, 30)],
    [2026, 2, D(2026, 6, 2)],
  ],
  "cq-wpx-rtty": [
    [2016, 5, D(2016, 2, 19)], [2017, 5, D(2017, 2, 17)],
    [2018, 5, D(2018, 2, 16)], [2019, 5, D(2019, 2, 15)],
    [2020, 5, D(2020, 2, 14)], [2021, 5, D(2021, 2, 19)],
    [2022, 5, D(2022, 2, 18)], [2023, 5, D(2023, 2, 17)],
    [2024, 5, D(2024, 2, 16)], [2025, 5, D(2025, 2, 14)],
    [2026, 2, D(2026, 2, 17)],
  ],
  "cq-ww-rtty": [
    [2016, 5, D(2016, 9, 30)], [2017, 5, D(2017, 9, 29)],
    [2018, 5, D(2018, 10, 5)], [2019, 5, D(2019, 10, 4)],
    [2020, 5, D(2020, 10, 2)], [2021, 5, D(2021, 10, 1)],
    [2022, 5, D(2022, 9, 30)], [2023, 5, D(2023, 9, 29)],
    [2024, 5, D(2024, 10, 4)], [2025, 5, D(2025, 10, 3)],
    [2026, 2, D(2026, 9, 29)],
  ],
  "cq-ww-ssb": [
    [2016, 5, D(2016, 11, 4)], [2017, 5, D(2017, 11, 3)],
    [2018, 5, D(2018, 11, 2)], [2019, 5, D(2019, 11, 1)],
    [2020, 5, D(2020, 10, 30)], [2021, 5, D(2021, 11, 5)],
    [2022, 5, D(2022, 11, 4)], [2023, 5, D(2023, 11, 3)],
    [2024, 5, D(2024, 11, 1)], [2025, 5, D(2025, 10, 31)],
  ],
  "cq-ww-cw": [
    [2016, 5, D(2016, 12, 2)], [2017, 5, D(2017, 12, 1)],
    [2018, 5, D(2018, 11, 30)], [2019, 5, D(2019, 11, 29)],
    [2020, 5, D(2020, 12, 4)], [2021, 5, D(2021, 12, 3)],
    [2022, 5, D(2022, 12, 2)], [2023, 5, D(2023, 12, 1)],
    [2024, 5, D(2024, 11, 29)], [2025, 5, D(2025, 12, 5)],
  ],
};

test.each(Object.entries(CQ_PRINTED_DEADLINES).sort())(
  "CQ end dates match the log deadlines CQ printed: %s",
  (cid, published) => {
    const c = byId(cid);
    for (const [year, window, deadline] of published) {
      const occ = expand(c, year);
      expect(occ.length, `${cid} produced nothing for ${year}`).toBeGreaterThan(0);
      const o = occ[0];
      expect(
        isoDate(new Date(o.end!.getTime() + window * DAY_MS)),
        `${cid} ${year}: engine ends ${isoDate(o.end!)}, +${window}d misses CQ's printed deadline`,
      ).toBe(deadline);
      // Where the year's window is the one on the record, log_due -- the
      // field the site actually shows -- must land on CQ's printed instant,
      // time included. CQ prints "2359 UTC" for the weekend contests and
      // "2200z" for CQ 160, which is exactly end + window.
      if (window === c.log_deadline_days) {
        expect(isoDate(o.log_due!)).toBe(deadline);
        expect(o.log_due!.getUTCHours()).toBe(o.end!.getUTCHours());
        expect(o.log_due!.getUTCMinutes()).toBe(o.end!.getUTCMinutes());
      }
    }
  },
);

test("CQ 160 SSB is the fourth Saturday not the last anything", () => {
  // The one CQ rule that neither "last full weekend" nor "last Saturday"
  // explains. CQ settles it in both directions with its own dates: 2020 ran
  // 2200Z Feb 21 (the last Saturday was Feb 29) and 2026 runs 2200Z Feb 27 to
  // 2200Z Mar 1 (the last full weekend was Feb 21-22). Only the fourth Saturday
  // of February fits both, and the CW running in January is a different rule
  // again -- there, the last full weekend fits all eleven years.
  const ssb = byId("cq-160-ssb");

  const twenty = expand(ssb, 2020)[0];
  expect(isoDate(twenty.start!)).toBe(D(2020, 2, 21)); // Friday before Sat Feb 22
  expect(isoDate(twenty.start!)).not.toBe(D(2020, 2, 28)); // not the Sat Feb 29 weekend

  const six = expand(ssb, 2026)[0];
  expect(isoDate(six.start!)).toBe(D(2026, 2, 27));
  expect(isoDate(six.start!)).not.toBe(D(2026, 2, 20)); // not the last full weekend
  expect(isoDate(six.end!)).toBe(D(2026, 3, 1)); // spills into March

  // January's CW running really is the last full weekend: in 2026 the last
  // Saturday is Jan 31, whose Sunday falls in February, and CQ ran Jan 24-25.
  const cw = expand(byId("cq-160-cw"), 2026)[0];
  expect(isoDate(cw.start!)).toBe(D(2026, 1, 23));
  expect(isoDate(cw.end!)).toBe(D(2026, 1, 25));
});

const CQ_WEEKEND_CONTESTS = [
  "cq-wpx-ssb", "cq-wpx-cw", "cq-wpx-rtty",
  "cq-ww-ssb", "cq-ww-cw", "cq-ww-rtty",
];

test.each(CQ_WEEKEND_CONTESTS)(
  "CQ weekend contests run 0000 Saturday to 2359 Sunday: %s",
  (cid) => {
    // CQ states the period identically on all four weekend rules pages.
    const o = expand(byId(cid), 2026)[0];
    expect(weekdayOf(o.start!)).toBe(5);
    expect([o.start!.getUTCHours(), o.start!.getUTCMinutes()]).toEqual([0, 0]);
    expect(weekdayOf(o.end!)).toBe(6);
    expect([o.end!.getUTCHours(), o.end!.getUTCMinutes()]).toEqual([23, 59]);
    expect(o.duration_hours).toBeGreaterThan(47.9);
    expect(o.duration_hours).toBeLessThan(48.1);
  },
);

test.each(["cq-160-cw", "cq-160-ssb"])(
  "CQ 160 is 48 hours from 2200Z Friday: %s",
  (cid) => {
    // cq160.com: "Each contest is 48 hours long and starts at 2200Z."
    const o = expand(byId(cid), 2026)[0];
    expect(weekdayOf(o.start!)).toBe(4); // Friday
    expect([o.start!.getUTCHours(), o.start!.getUTCMinutes()]).toEqual([22, 0]);
    expect(weekdayOf(o.end!)).toBe(6); // Sunday
    expect([o.end!.getUTCHours(), o.end!.getUTCMinutes()]).toEqual([22, 0]);
    expect(o.duration_hours).toBeGreaterThan(47.9);
    expect(o.duration_hours).toBeLessThan(48.1);
  },
);

const NCJ_SPRINT_2026: Record<string, string[]> = {
  "ncj-sprint-cw": [D(2026, 2, 8), D(2026, 9, 13)],
  "ncj-sprint-rtty": [D(2026, 3, 15), D(2026, 9, 20)],
};

test.each(Object.entries(NCJ_SPRINT_2026).sort())(
  "NCJ Sprint matches published 2026 dates: %s",
  (cid, expected) => {
    // NCJ's 2026 Sprint rules state each date twice -- once in rule 4 'Contest
    // Periods' and again in 'Table 1 - The 2026 Sprint calendar'. Both agree.
    const occ = expand(byId(cid), 2026);
    expect(occ.map((o) => isoDate(o.start!))).toEqual(expected);
    expect(
      occ.every((o) => o.start!.getUTCHours() === 0 && o.start!.getUTCMinutes() === 0),
    ).toBe(true);
    expect(
      occ.every((o) => o.end!.getUTCHours() === 3 && o.end!.getUTCMinutes() === 59),
    ).toBe(true);
  },
);

test("NCJ Sprint stays silent for years NCJ has not published", () => {
  // NCJ publishes dates, not a recurrence rule, and flagged 2026 September with
  // 'NOTE CW DATE SHIFT'. The 2026 dates happen to land on the 2nd and 3rd
  // Sundays, but inferring that as a rule would invent dates NCJ never stated.
  // A 'manual' record must generate nothing for an unpublished year.
  for (const cid of Object.keys(NCJ_SPRINT_2026)) {
    expect(expand(byId(cid), 2027)).toEqual([]);
  }
});

test("NCJ Sprint log deadline is seven days", () => {
  // NCJ rule 14: 'Entries must be received no later than 7 days after the
  // Sprint.' Table 1 gives logs due Feb 15 for the Feb 8 CW Sprint.
  const feb = expand(byId("ncj-sprint-cw"), 2026)[0];
  expect(feb.log_due).not.toBeNull();
  expect(isoDate(feb.log_due!)).toBe(D(2026, 2, 15));
});

const NCCC_SESSIONS: Record<string, [number, number]> = {
  "nccc-ns-ft4": [1, 0],
  "nccc-ns-rtty": [1, 45],
  "nccc-ns-cw": [2, 30],
};

test.each(Object.entries(NCCC_SESSIONS).sort())(
  "NCCC sprints run weekly at their published UTC slot: %s",
  (cid, hm) => {
    // ncccsprint.com: CW NS is '0230-0300 UTC Fridays (Thursday evening NA
    // time, DST ignored)'; RTTY NS 'is always 0145-0215 UTC'; FT4 NS starts
    // '0100 UTC'. Each runs 'each Thursday' -- ~52 Friday-UTC sessions a year.
    const occ = expand(byId(cid), 2026);
    expect(occ.length).toBeGreaterThanOrEqual(51);
    expect(occ.length).toBeLessThanOrEqual(53);
    expect(new Set(occ.map((o) => weekdayOf(o.start!)))).toEqual(new Set([4]));
    const slots = new Set(
      occ.map((o) => `${o.start!.getUTCHours()}:${o.start!.getUTCMinutes()}`),
    );
    expect(slots).toEqual(new Set([`${hm[0]}:${hm[1]}`]));
    expect(occ.every((o) => o.duration_hours === 0.5)).toBe(true);
  },
);

test("NCCC sessions are 45 minutes apart", () => {
  // NCCC states the gaps rather than a bare list of times: FT4 is '45 minutes
  // BEFORE the regular RTTY NS', which is in turn '45 minutes BEFORE the
  // regular CW NS'. Encoding all three lets us check that arithmetic holds.
  const pick = (cid: string) =>
    expand(byId(cid), 2026).find((o) => isoDate(o.start!) === D(2026, 3, 6))!;
  const ft4 = pick("nccc-ns-ft4");
  const rtty = pick("nccc-ns-rtty");
  const cw = pick("nccc-ns-cw");
  expect(rtty.start!.getTime() - ft4.start!.getTime()).toBe(45 * 60 * 1000);
  expect(cw.start!.getTime() - rtty.start!.getTime()).toBe(45 * 60 * 1000);
});

test("NCCC NS matches sponsor's published ladder table", () => {
  // Cross-check against a date table NCCC published independently of the rules
  // text: the 'NSL XXXV - 2023' schedule pairs US Thursday dates with Zulu
  // Friday dates at 0230-0300Z (US Feb 2 / Zulu Feb 3, and weekly thereafter).
  const occ = new Set(expand(byId("nccc-ns-cw"), 2023).map((o) => isoDate(o.start!)));
  for (const published of [
    D(2023, 2, 3),
    D(2023, 2, 10),
    D(2023, 2, 17),
    D(2023, 2, 24),
    D(2023, 3, 3),
    D(2023, 3, 10),
  ]) {
    expect(occ.has(published), `NCCC published ${published} Zulu; engine missed it`)
      .toBe(true);
  }
});

test("4SQRP SSS anchors second Sunday and runs into Monday UTC", () => {
  // 4sqrp.com: 'The SSS is held the second Sunday night of every month (local
  // time). It runs for two (2) hours from 7 PM until 9 PM central time.' 7 PM
  // CST is 0100 UTC the following day, so every session lands on a Monday UTC
  // even though the sponsor's rule names Sunday.
  const occ = expand(byId("4sqrp-sss"), 2026);
  expect(occ).toHaveLength(12);
  expect(occ.every((o) => weekdayOf(o.start!) === 0)).toBe(true); // Monday UTC
  expect(occ.every((o) => o.duration_hours === 2)).toBe(true);
  // Second Sunday of May 2026 is the 10th -> 0100 UTC Monday the 11th.
  const may = occ.find((o) => o.start!.getUTCMonth() === 4)!;
  expect(isoDate(may.start!)).toBe(D(2026, 5, 11));
});

test("Spartan Sprint anchors on first Monday not first Tuesday", () => {
  // ars-qrp.com: 'Held on the first Monday of every month', 8-10 p.m. Eastern.
  // That is NOT the same as the first Tuesday UTC: whenever the 1st falls on a
  // Tuesday the two diverge by a week. September and December 2026 are both
  // such months, and the earlier encoding got both wrong.
  const occ = expand(byId("ars-spartan-sprint"), 2026);
  expect(occ).toHaveLength(12);
  expect(occ.every((o) => weekdayOf(o.start!) === 1)).toBe(true); // Tuesday UTC
  const dates = new Map(occ.map((o) => [o.start!.getUTCMonth() + 1, isoDate(o.start!)]));
  expect(dates.get(9), "first Monday Sep 7 -> Sep 8 UTC, not Sep 1")
    .toBe(D(2026, 9, 8));
  expect(dates.get(12), "first Monday Dec 7 -> Dec 8 UTC, not Dec 1")
    .toBe(D(2026, 12, 8));
});

test("first Monday plus one never equals first Tuesday blindly", () => {
  // Guard the rule itself, not just 2026: the anchor must always be the day
  // after the first Monday, which is the first Tuesday only in months whose
  // 1st is not a Tuesday.
  const c = byId("ars-spartan-sprint");
  for (let y = 2026; y <= 2035; y++) {
    for (const anchor of resolveAnchors(c.recurrence, y)) {
      expect(weekdayOf(anchor)).toBe(0);
      expect(anchor.getUTCDate()).toBeLessThanOrEqual(7);
      expect(weekdayOf(new Date(anchor.getTime() + DAY_MS))).toBe(1);
    }
  }
});

test("sponsor-anchored contests declare a zone and explain it", () => {
  // A contest whose sponsor publishes local times only must name an IANA zone,
  // mark its time specs wall_clock, and explain the UTC consequence -- or a
  // reader will trust a UTC instant that is an hour wrong for half the year.
  for (const cid of ["4sqrp-sss", "ars-spartan-sprint", "nzart-jock-white-field-day"]) {
    const c = byId(cid);
    expect(c.timezone, `${cid} has no timezone`).toBeTruthy();
    expect(c.start.wall_clock).toBe(true);
    expect(c.end.wall_clock).toBe(true);
    expect(c.note).toContain("UTC");
    // A sessioned contest is expanded from `sessions`, not from the top-level
    // pair, so an unmarked session would silently be resolved as UTC no matter
    // what the top-level specs say.
    for (const s of c.sessions ?? []) {
      expect(s.start.wall_clock, cid).toBe(true);
      expect(s.end.wall_clock, cid).toBe(true);
    }
  }
});

// ---------------------------------------------------------------------------
// Sponsor validation -- PODXS 070 Club
//
// The 070 Club is the best-documented sponsor found so far: its contest
// calendar page states each recurrence rule in words AND publishes a projected
// date table running 2026-2035. The rules go in the catalog; the table is held
// back as the independent check.
// ---------------------------------------------------------------------------

const PODXS_PUBLISHED: Record<string, [string, string[]]> = {
  "podxs-pskfest": [
    "1st Sat after 1 Jan",
    ["3-Jan-26", "2-Jan-27", "8-Jan-28", "6-Jan-29", "5-Jan-30",
     "4-Jan-31", "3-Jan-32", "8-Jan-33", "7-Jan-34", "6-Jan-35"],
  ],
  "podxs-valentine-sprint": [
    "Valentine's Day",
    ["14-Feb-26", "14-Feb-27", "14-Feb-28", "14-Feb-29", "14-Feb-30",
     "14-Feb-31", "14-Feb-32", "14-Feb-33", "14-Feb-34", "14-Feb-35"],
  ],
  "podxs-st-patricks": [
    "3rd Sat of March",
    ["21-Mar-26", "20-Mar-27", "18-Mar-28", "17-Mar-29", "16-Mar-30",
     "15-Mar-31", "20-Mar-32", "19-Mar-33", "18-Mar-34", "17-Mar-35"],
  ],
  "podxs-new-member-jamboree": [
    "1st Sat in April",
    ["4-Apr-26", "3-Apr-27", "1-Apr-28", "7-Apr-29", "6-Apr-30",
     "5-Apr-31", "3-Apr-32", "2-Apr-33", "1-Apr-34", "7-Apr-35"],
  ],
  "podxs-tdw": [
    "1st weekend ending in June",
    ["5-Jun-26", "4-Jun-27", "2-Jun-28", "1-Jun-29", "31-May-30",
     "30-May-31", "4-Jun-32", "3-Jun-33", "2-Jun-34", "1-Jun-35"],
  ],
  "podxs-40m-firecracker": [
    "1st Sat after 1 July",
    ["4-Jul-26", "3-Jul-27", "8-Jul-28", "7-Jul-29", "6-Jul-30",
     "5-Jul-31", "3-Jul-32", "2-Jul-33", "8-Jul-34", "7-Jul-35"],
  ],
  "podxs-jay-hudak-80m": [
    "1st Sat in Sept",
    ["5-Sep-26", "4-Sep-27", "2-Sep-28", "1-Sep-29", "7-Sep-30",
     "6-Sep-31", "4-Sep-32", "3-Sep-33", "2-Sep-34", "1-Sep-35"],
  ],
  "podxs-160m-great-pumpkin": [
    "2nd Sat in Oct",
    ["10-Oct-26", "9-Oct-27", "14-Oct-28", "13-Oct-29", "12-Oct-30",
     "11-Oct-31", "9-Oct-32", "8-Oct-33", "14-Oct-34", "13-Oct-35"],
  ],
  "podxs-triple-play": [
    "2nd Sat in Nov",
    ["14-Nov-26", "13-Nov-27", "11-Nov-28", "10-Nov-29", "9-Nov-30",
     "8-Nov-31", "13-Nov-32", "12-Nov-33", "11-Nov-34", "10-Nov-35"],
  ],
  "podxs-triple-play-doubleheader": [
    "2nd Sat in Dec",
    ["12-Dec-26", "11-Dec-27", "9-Dec-28", "8-Dec-29", "14-Dec-30",
     "13-Dec-31", "11-Dec-32", "10-Dec-33", "9-Dec-34", "8-Dec-35"],
  ],
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse the club's own "5-Jun-26" notation, mirroring strptime("%d-%b-%y"). */
function parseClubDate(text: string): string {
  const [d, mon, yy] = text.split("-");
  return D(2000 + Number(yy), MONTHS.indexOf(mon) + 1, Number(d));
}

test.each(
  Object.entries(PODXS_PUBLISHED)
    .sort()
    .map(([cid, [rule, dates]]) => [cid, rule, dates] as const),
)("PODXS matches club's own ten-year table: %s", (cid, rule, published) => {
  // Ten contests x ten years = 100 dates the club published itself. Every one
  // must fall out of the recurrence rule alone.
  const c = byId(cid);
  published.forEach((text, offset) => {
    const year = 2026 + offset;
    const expected = parseClubDate(text);
    const occ = expand(c, year);
    expect(occ.length, `${cid} produced nothing for ${year} (rule: ${rule})`)
      .toBeGreaterThan(0);
    expect(
      isoDate(occ[0].start!),
      `${cid} ${year}: rule '${rule}' gave the wrong date`,
    ).toBe(expected);
  });
});

test("PODXS January and July sprints skip the first of the month", () => {
  // '1st Sat AFTER 1 Jan' and '1st Sat AFTER 1 July' exclude the 1st itself.
  // The club's table proves it: 2028 and 2033 open January 1 on a Saturday and
  // the club lists Jan 8 both times; 2028 and 2034 do the same for July.
  // A plain 'first Saturday' rule would be a week early in four of ten years.
  const cases: [string, number, number[]][] = [
    ["podxs-pskfest", 1, [2028, 2033]],
    ["podxs-40m-firecracker", 7, [2028, 2034]],
  ];
  for (const [cid, month, years] of cases) {
    const c = byId(cid);
    for (const y of years) {
      expect(weekdayOf(new Date(Date.UTC(y, month - 1, 1))), "test premise")
        .toBe(5);
      expect(expand(c, y)[0].start!.getUTCDate()).toBe(8);
    }
  }
});

test("PODXS TDW can start in May", () => {
  // 'First weekend ENDING in June' anchors on June's first Sunday and counts
  // back to Friday, so the contest itself can open in May -- the club lists
  // 31-May-30 and 30-May-31. An anchor picked from Fridays *in June* would put
  // both a week late.
  const c = byId("podxs-tdw");
  const cases: [number, string][] = [
    [2030, D(2030, 5, 31)],
    [2031, D(2031, 5, 30)],
  ];
  for (const [y, expected] of cases) {
    const occ = expand(c, y)[0];
    expect(isoDate(occ.start!)).toBe(expected);
    expect(occ.start!.getUTCMonth()).toBe(4); // May
    expect(occ.end!.getUTCMonth()).toBe(5); // June
    expect(weekdayOf(occ.start!)).toBe(4); // Friday
    expect(weekdayOf(occ.end!)).toBe(6); // Sunday
  }
});

test("PODXS sprints have the right window length", () => {
  // Three shapes: 24-hour parties, 24-hour windows opening 2000 UTC, and the
  // 72-hour three-day sprints. All are outer windows -- most carry a six-hour
  // operating limit, which is recorded in `note`, not in the timestamps.
  const hours: Record<string, number> = {
    "podxs-pskfest": 24,
    "podxs-valentine-sprint": 24,
    "podxs-st-patricks": 24,
    "podxs-new-member-jamboree": 24,
    "podxs-40m-firecracker": 24,
    "podxs-jay-hudak-80m": 24,
    "podxs-160m-great-pumpkin": 24,
    "podxs-tdw": 72,
    "podxs-triple-play": 72,
    "podxs-triple-play-doubleheader": 72,
  };
  for (const [cid, expected] of Object.entries(hours)) {
    const occ = expand(byId(cid), 2026)[0];
    expect(Math.abs(occ.duration_hours - expected), cid).toBeLessThan(0.02);
  }
});

test("PODXS logs are due seven days after", () => {
  // 070 general rules: 'All contest submissions are due 7 (seven) calendar
  // days after the end of the contest.'
  for (const cid of Object.keys(PODXS_PUBLISHED)) {
    const occ = expand(byId(cid), 2026)[0];
    expect(occ.log_due, cid).not.toBeNull();
    expect((occ.log_due!.getTime() - occ.end!.getTime()) / DAY_MS, cid).toBe(7);
  }
});

// ---------------------------------------------------------------------------
// Sponsor validation -- AGCW-DL (fourth continent-scale sponsor, German text)
// ---------------------------------------------------------------------------

const AGCW_NEXT_TERMIN: Record<string, [string, string]> = {
  "agcw-htp-80m": ["erster Samstag im Februar", D(2026, 2, 7)],
  "agcw-htp-40m": ["erster Samstag im September", D(2026, 9, 5)],
  "agcw-yl-cw-party": ["erster Dienstag im März", D(2026, 3, 3)],
};

test.each(
  Object.entries(AGCW_NEXT_TERMIN)
    .sort()
    .map(([cid, [rule, exp]]) => [cid, rule, exp] as const),
)("AGCW matches its own nächster Termin: %s", (cid, rule, expected) => {
  const occ = expand(byId(cid), 2026);
  expect(occ).toHaveLength(1);
  expect(isoDate(occ[0].start!), `${cid}: rule '${rule}'`).toBe(expected);
});

test("AGCW STA runs third Wednesday twice a year", () => {
  // agcw.de: 'Jeden dritten Mittwoch im Februar und jeden dritten Mittwoch im
  // Oktober von 1900 bis 2030 UTC. Nächster Termin: 21. Okt. 2026.'
  const occ = expand(byId("agcw-sta"), 2026);
  expect(occ.map((o) => isoDate(o.start!))).toEqual([D(2026, 2, 18), D(2026, 10, 21)]);
  expect(occ.every((o) => weekdayOf(o.start!) === 2)).toBe(true);
  expect(occ.every((o) => o.duration_hours === 1.5)).toBe(true);
});

test("AGCW VHF/UHF has four dates with two sessions each", () => {
  // agcw.de: '1. Januar, 3. Samstag im März, 2. Samstag im Juni, 4. Samstag im
  // September ... VHF von 14.00 bis 17.00 UTC auf 2m und UHF von 17.00 bis
  // 18.00 UTC auf 70cm'. Four anchors x two sessions = eight occurrences, and
  // the UHF leg must start exactly where the VHF leg ends.
  const occ = expand(byId("agcw-vhf-uhf"), 2026);
  expect(occ).toHaveLength(8);
  const anchors = [...new Set(occ.map((o) => isoDate(o.start!)))].sort();
  expect(anchors).toEqual([
    D(2026, 1, 1), D(2026, 3, 21), D(2026, 6, 13), D(2026, 9, 26),
  ]);
  for (const anchor of anchors) {
    const day = occ
      .filter((o) => isoDate(o.start!) === anchor)
      .sort((a, b) => a.start!.getTime() - b.start!.getTime());
    expect(day).toHaveLength(2);
    expect(day[0].duration_hours).toBe(3);
    expect(day[1].duration_hours).toBe(1);
    expect(day[0].end!.getTime(), "UHF leg must start as the VHF leg ends")
      .toBe(day[1].start!.getTime());
  }
});

test("AGCW fixed-date contests track the calendar not the week", () => {
  // Three AGCW contests hang off fixed dates -- New Year's Day, May 1st, and
  // German Unity Day. They must land on the same date every year and drift
  // through the week, unlike everything anchored on an nth weekday.
  const cases: [string, number, number][] = [
    ["agcw-hnyc", 1, 1],
    ["agcw-qrp-qrp-party", 5, 1],
    ["agcw-dtc", 10, 3],
  ];
  for (const [cid, month, day] of cases) {
    const weekdays = new Set<number>();
    for (let y = 2026; y <= 2035; y++) {
      const occ = expand(byId(cid), y)[0];
      expect([occ.start!.getUTCMonth() + 1, occ.start!.getUTCDate()]).toEqual([month, day]);
      weekdays.add(weekdayOf(occ.start!));
    }
    expect(weekdays.size, `${cid} should drift through the week`).toBeGreaterThan(1);
  }
});

test("AGCW DTC entry is open but every QSO needs a German station", () => {
  // AGCW: 'Teilnehmen können alle Funkamateurinnen und Funamateure' but
  // 'Mindestens eine der an einem QSO beteiligten Stationen muss sich in
  // Deutschland befinden.' Those are different claims, and collapsing them into
  // a single can_enter boolean would wrongly hide the contest from DX -- who can
  // enter it perfectly well, just working DL only.
  const e = eligibilityFor(byId("agcw-dtc"), "K");
  expect(e.can_enter).toBe(true);
  expect(e.practical.includes("Deutschland") || e.practical.includes("German")).toBe(true);
});

test("AGCW ZAP Merit is flagged unverified for its missing end time", () => {
  // AGCW publishes 'jeden Montag, Vorloggen ab 1740 UTC, Telegrammsendung 1800
  // UTC' and no closing time. The stored end is a placeholder, so the record
  // must stay verified:false and say why -- a confident wrong duration is worse
  // than an admitted gap.
  const c = byId("agcw-zap-merit");
  expect(c.verified).toBe(false);
  expect(c.note).toContain("PLACEHOLDER");
  const occ = expand(c, 2026);
  expect(occ.length).toBeGreaterThanOrEqual(51);
  expect(occ.length).toBeLessThanOrEqual(53);
  expect(new Set(occ.map((o) => weekdayOf(o.start!)))).toEqual(new Set([0]));
});

// ---------------------------------------------------------------------------
// Sponsor validation -- BARTG, SARTG, 10-10 International, FISTS
// ---------------------------------------------------------------------------

const BARTG_PUBLISHED: Record<string, [string, [number, number, number][]]> = {
  "bartg-hf-rtty": [
    "third full weekend of March",
    [[2027, 3, 20], [2028, 3, 18], [2029, 3, 17],
     [2030, 3, 16], [2031, 3, 15], [2032, 3, 20]],
  ],
  "bartg-sprint": [
    "fourth full weekend of January",
    [[2027, 1, 23], [2028, 1, 22], [2029, 1, 27],
     [2030, 1, 26], [2031, 1, 25], [2032, 1, 24]],
  ],
  "bartg-sprint75": [
    "fourth Sunday of April",
    [[2027, 4, 25], [2028, 4, 23], [2029, 4, 22],
     [2030, 4, 28], [2031, 4, 27], [2032, 4, 25]],
  ],
  "bartg-sprint-psk63": [
    "third Sunday of September",
    [[2026, 9, 20], [2027, 9, 19], [2028, 9, 17],
     [2029, 9, 16], [2030, 9, 15], [2031, 9, 21]],
  ],
};

test.each(
  Object.entries(BARTG_PUBLISHED)
    .sort()
    .map(([cid, [rule, dates]]) => [cid, rule, dates] as const),
)("BARTG matches its own published schedules: %s", (cid, rule, published) => {
  // BARTG is unusual in publishing both halves separately: the rules PDF states
  // the recurrence in words, and the contest page lists six years of dates. The
  // rule goes in the catalog; the dates are the check.
  const c = byId(cid);
  for (const [y, m, day] of published) {
    const occ = expand(c, y);
    expect(occ.length, `${cid} produced nothing for ${y}`).toBeGreaterThan(0);
    expect(isoDate(occ[0].start!), `${cid} ${y}: rule '${rule}'`).toBe(D(y, m, day));
  }
});

test("BARTG January sprint needs full weekends not Saturdays", () => {
  // January 2032 has five Saturdays but only four FULL weekends -- Jan 31 2032
  // is a Saturday whose Sunday falls in February. BARTG publishes 24 January
  // 2032, the fourth full weekend.
  expect(saturdaysInMonth(2032, 1)).toHaveLength(5);
  expect(fullWeekendsInMonth(2032, 1)).toHaveLength(4);
  const occ = expand(byId("bartg-sprint"), 2032)[0];
  expect(isoDate(occ.start!)).toBe(D(2032, 1, 24));
});

test("BARTG Sprint75 is fourth Sunday not last Sunday", () => {
  // April 2028 and April 2029 both have five Sundays, and BARTG lists the
  // fourth in each (23rd and 22nd). 'Last Sunday' would give the 30th and 29th.
  const c = byId("bartg-sprint75");
  expect(isoDate(expand(c, 2028)[0].start!)).toBe(D(2028, 4, 23));
  expect(isoDate(expand(c, 2029)[0].start!)).toBe(D(2029, 4, 22));
});

test("SARTG WW RTTY runs three separate periods", () => {
  // sartg.com: 'Third full weekend in August', '15 - 16 August 2026', and
  // 'Three (3) separate periods: 0000 - 0800 UTC Saturday / 1600 - 2400 UTC
  // Saturday / 0800 - 1600 UTC Sunday'. Three eight-hour blocks with real gaps
  // between them, not a continuous 48-hour run.
  const occ = expand(byId("sartg-ww-rtty"), 2026);
  expect(occ).toHaveLength(3);
  expect(isoDate(occ[0].start!)).toBe(D(2026, 8, 15)); // SARTG's published date
  expect(occ.every((o) => o.duration_hours === 8)).toBe(true);
  expect(occ[1].start!.getTime()).toBeGreaterThan(occ[0].end!.getTime());
  expect(occ[2].start!.getTime()).toBeGreaterThan(occ[1].end!.getTime());
});

test("SARTG WW second period 2400 normalises to midnight", () => {
  // SARTG writes the second period as '1600 - 2400 UTC Saturday'. 2400 is a
  // legitimate way to write end-of-day and must roll into the next date rather
  // than throwing or clamping to 23:00.
  const second = expand(byId("sartg-ww-rtty"), 2026)[1];
  expect(second.start!.getUTCHours()).toBe(16);
  expect(second.end!.getUTCHours()).toBe(0);
  expect(isoDate(second.end!)).toBe(D(2026, 8, 16));
});

const TENTEN_2026: Record<string, [string, string]> = {
  "tenten-winter-phone": [D(2026, 2, 7), D(2026, 2, 8)],
  "tenten-summer-phone": [D(2026, 8, 1), D(2026, 8, 2)],
  "tenten-day-sprint": [D(2026, 10, 10), D(2026, 10, 10)],
};

test.each(Object.entries(TENTEN_2026).sort())(
  "10-10 matches its published 2026 schedule: %s",
  (cid, expected) => {
    // 10-10 rule 5.2.2 states each recurrence in words ('the first full weekend
    // in February', 'the first full weekend in August', 'October 10th'); the
    // club's QSO Party Schedule page independently lists Feb 7-8, Aug 1-2 and
    // Oct 10 for 2026.
    const occ = expand(byId(cid), 2026)[0];
    expect([isoDate(occ.start!), isoDate(occ.end!)]).toEqual(expected);
  },
);

test("10-10 membership limits logs not entry", () => {
  // 10-10 rule 5.2.1: 'QSO Parties are open to all amateurs with operating
  // privileges on the 10 meter band, however, logs will be accepted only from
  // active members'. Anyone may operate; only members are scored. Filtering the
  // contest out for non-members would hide an event they can absolutely work.
  const e = eligibilityFor(byId("tenten-winter-phone"), "K");
  expect(e.can_enter).toBe(true);
  expect(e.practical.toLowerCase()).toContain("member");
});

const FISTS_SPRINT_IDS = [
  "fists-sprint-winter-sat", "fists-sprint-winter-sun",
  "fists-sprint-spring-sat", "fists-sprint-spring-sun",
  "fists-sprint-summer-sat", "fists-sprint-summer-sun",
  "fists-sprint-fall-sat", "fists-sprint-fall-sun",
];

test("FISTS sprints ran in 2025 on their stated weekends", () => {
  // fistsna.org: Saturday sprints are the second Saturday of Feb/May/Aug/Nov,
  // Sunday sprints the third Sunday of the same months, all 0000-2359 UTC.
  for (const cid of FISTS_SPRINT_IDS) {
    const occ = expand(byId(cid), 2025);
    expect(occ, cid).toHaveLength(1);
    const o = occ[0];
    expect([2, 5, 8, 11], cid).toContain(o.start!.getUTCMonth() + 1);
    if (cid.endsWith("-sat")) {
      expect(weekdayOf(o.start!), cid).toBe(5);
      expect(o.start!.getUTCDate(), cid).toBeGreaterThanOrEqual(8);
      expect(o.start!.getUTCDate(), cid).toBeLessThanOrEqual(14);
    } else {
      expect(weekdayOf(o.start!), cid).toBe(6);
      expect(o.start!.getUTCDate(), cid).toBeGreaterThanOrEqual(15);
      expect(o.start!.getUTCDate(), cid).toBeLessThanOrEqual(21);
    }
  }
});

test("FISTS sprints generate nothing from 2026", () => {
  // fistsna.org: 'Sprints will NOT continue in 2026 due to a lack of
  // sufficiant participation.' The records keep the verified rule but must not
  // put dates on a 2026 calendar that the club has said will not happen.
  for (const cid of FISTS_SPRINT_IDS) {
    const c = byId(cid);
    expect(c.active_until, cid).toBe(2025);
    expect(expand(c, 2026), cid).toEqual([]);
    expect(expand(c, 2030), cid).toEqual([]);
  }
});

test("suspended contests explain themselves", () => {
  // A record that silently generates nothing is indistinguishable from a
  // broken one. Anything with active_until must say why in its note.
  for (const c of catalog) {
    if (c.active_until) {
      expect(c.note, `${c.id} is time-limited with no note`).toBeTruthy();
    }
  }
});

// ---------------------------------------------------------------------------
// Sponsor validation -- JARL, RAC, WIA, Oceania DX, NZART, LABRE, ORARI
//
// The pass that opened Asia, Oceania and South America. Every rule below is
// encoded from the sponsor's own wording; every date below was published by the
// same sponsor separately from that wording, on the same page or in an earlier
// year's rules. The rule goes in the catalog, the dates are the check, and
// neither came from an aggregator.
// ---------------------------------------------------------------------------

const WORLD_PUBLISHED: Record<string, [string, [number, number, number][]]> = {
  "jarl-aa-dx-cw": ["third Saturday in June", [[2026, 6, 20]]],
  "jarl-aa-dx-phone": ["first Saturday in September", [[2026, 9, 5]]],
  "jarl-ww-rtty": ["third Saturday in October", [[2026, 10, 17]]],
  "rac-canada-day": ["Canada Day, July 1", [[2025, 7, 1], [2026, 7, 1]]],
  "wia-remembrance-day": [
    "weekend in August closest to the 15th",
    [[2023, 8, 12], [2026, 8, 15]],
  ],
  "wia-john-moyle-field-day": ["3rd full weekend in March", [[2026, 3, 21]]],
  "wia-vk-shires": [
    "weekend prior to the second Monday of June",
    [[2026, 6, 6], [2027, 6, 12]],
  ],
  "wia-harry-angel-sprint": ["first Saturday in May", [[2026, 5, 2]]],
  "wia-trans-tasman": [
    "Saturday night of the third full weekend of July",
    [[2026, 7, 18]],
  ],
  "ocdx-phone": [
    "first full weekend in October",
    [[2024, 10, 5], [2026, 10, 3]],
  ],
  "ocdx-cw": [
    "second full weekend in October",
    [[2024, 10, 12], [2026, 10, 10]],
  ],
  "nzart-jock-white-field-day": [
    "last full weekend in February, moved a week when February has only three",
    [[2026, 2, 28], [2027, 2, 27]],
  ],
  "nzart-sangster-shield": ["third Saturday of May", [[2026, 5, 16]]],
  "nzart-memorial-contest": ["first Saturday in July", [[2026, 7, 4]]],
  "labre-dx": ["3rd (third) weekend of July", [[2026, 7, 18]]],
  "orari-north-jakarta-dx": [
    "every June 2nd weekend",
    [[2026, 6, 13], [2027, 6, 12], [2028, 6, 10], [2029, 6, 9]],
  ],
};

test.each(
  Object.entries(WORLD_PUBLISHED)
    .sort()
    .map(([cid, [rule, dates]]) => [cid, rule, dates] as const),
)("world sponsors match their own published dates: %s", (cid, rule, published) => {
  const c = byId(cid);
  for (const [y, m, day] of published) {
    const occ = expand(c, y);
    expect(occ.length, `${cid} produced nothing for ${y}`).toBeGreaterThan(0);
    expect(isoDate(occ[0].start!), `${cid} ${y}: rule '${rule}'`).toBe(D(y, m, day));
  }
});

// WIA: "Weekend in August closest to the 15th". Seven years, seven weekdays for
// the 15th, so the whole table is covered -- 2019 is skipped only because it
// would repeat a weekday. The rule can never be ambiguous: the nearest instance
// of a weekday is at most three days away, and a tie would need a distance of
// 3.5, which does not exist because seven is odd.
const REMEMBRANCE_DAY_SHIFTS: [number, number, number][] = [
  [2018, 2, 18], // the 15th is a Wednesday -> forward 3
  [2020, 5, 15], // ...a Saturday           -> already there
  [2021, 6, 14], // ...a Sunday             -> back 1
  [2022, 0, 13], // ...a Monday             -> back 2
  [2023, 1, 12], // ...a Tuesday            -> back 3
  [2024, 3, 17], // ...a Thursday           -> forward 2
  [2025, 4, 16], // ...a Friday             -> forward 1
];

test.each(REMEMBRANCE_DAY_SHIFTS)(
  "nearest_weekday resolves every case to a Saturday: %i",
  (year, weekdayOf15th, day) => {
    expect(weekdayOf(new Date(at(year, 8, 15)))).toBe(weekdayOf15th);
    const anchors = resolveAnchors(byId("wia-remembrance-day").recurrence, year);
    expect(anchors.map(isoDate)).toEqual([D(year, 8, day)]);
    expect(weekdayOf(anchors[0])).toBe(5);
    expect(Math.abs(anchors[0].getTime() - at(year, 8, 15)) / DAY_MS).toBeLessThanOrEqual(3);
  },
);

// RAC's own rules PDFs, one per year. The December Saturday ordinal is 4th,
// 3rd, 3rd, 3rd, 5th, 4th, 3rd -- and 2026 is not a Saturday at all.
const RAC_WINTER_PUBLISHED: [number, number, number][] = [
  [2019, 12, 28], [2020, 12, 19], [2021, 12, 18], [2022, 12, 17],
  [2023, 12, 30], [2024, 12, 28], [2025, 12, 20], [2026, 12, 27],
];

test("RAC Canada Winter reproduces every date RAC published", () => {
  const c = byId("rac-canada-winter");
  for (const [y, m, day] of RAC_WINTER_PUBLISHED) {
    const occ = expand(c, y);
    expect(occ.length, `rac-canada-winter produced nothing for ${y}`).toBeGreaterThan(0);
    expect(isoDate(occ[0].start!)).toBe(D(y, m, day));
  }
});

test("RAC Canada Winter is manual because no rule fits", () => {
  // The point of `manual` is that it is used only where a rule would be a
  // guess. RAC announces this date each year: the eight dates it has published
  // are not a consistent ordinal Saturday, and 2026's is a Sunday. A record
  // that fitted an ordinal to them would print confident dates for years RAC
  // has not set.
  const ordinals = new Set<number>();
  for (const [y, m, day] of RAC_WINTER_PUBLISHED) {
    const d = new Date(at(y, m, day));
    if (weekdayOf(d) === 5) {
      ordinals.add(
        saturdaysInMonth(y, m).filter((s) => s.getTime() <= d.getTime()).length,
      );
    }
  }
  expect(ordinals.size, "an ordinal Saturday would have fitted after all").toBeGreaterThan(1);
  expect(weekdayOf(new Date(at(2026, 12, 27)))).toBe(6); // Sunday
  // ...and the years RAC has not announced are simply absent, not guessed.
  expect(expand(byId("rac-canada-winter"), 2027)).toEqual([]);
});

test("NZART field day moves when February has three full weekends", () => {
  // NZART: 'when February only has three full weekends then field day will be
  // held on Saturday 28th February and Sunday 1st March ... This will occur in
  // 2026.' The last-full-weekend Saturday is February 21 exactly when February
  // has 28 days and starts on a Sunday, which is precisely that case, so the
  // exclusion is the rule rather than a patch over one year.
  const c = byId("nzart-jock-white-field-day");
  expect(fullWeekendsInMonth(2026, 2)).toHaveLength(3);
  expect(isoDate(fullWeekendsInMonth(2026, 2).at(-1)!)).toBe(D(2026, 2, 21));
  expect(isoDate(expand(c, 2026)[0].start!)).toBe(D(2026, 2, 28));
  // A four-full-weekend February is untouched by the exclusion.
  expect(fullWeekendsInMonth(2027, 2)).toHaveLength(4);
  expect(isoDate(expand(c, 2027)[0].start!)).toBe(D(2027, 2, 27));
});

test("NZART field day runs two sessions on New Zealand time", () => {
  // 1500-2400 Saturday and 0600-1500 Sunday NZDT. New Zealand is UTC+13 in
  // February, so both sessions land on UTC dates that are not the local ones --
  // which is the whole reason the record is wall-clock rather than UTC.
  const occ = expand(byId("nzart-jock-white-field-day"), 2026);
  expect(occ).toHaveLength(2);
  expect(occ.map((o) => o.duration_hours)).toEqual([9, 9]);
  expect(occ[0].start!.getTime()).toBe(at(2026, 2, 28, 2, 0));
  expect(occ[1].end!.getTime()).toBe(at(2026, 3, 1, 2, 0));
});

const NZART_SPRINT_IDS = ["nzart-sprint-cw", "nzart-sprint-ssb", "nzart-sprint-ft4"];

test.each(NZART_SPRINT_IDS)(
  "NZART sprints run every Tuesday in April and August only: %s",
  (cid) => {
    // 'Each Tuesday in April and August' -- a weekly rule narrowed to a season.
    // Encoded as `weekly` with `months` rather than as a composite of ordinal
    // Tuesdays: neither April nor August 2026 has a fifth Tuesday, and a
    // composite would have to name one, so the whole contest would vanish that
    // year.
    const occ = expand(byId(cid), 2026);
    expect(new Set(occ.map((o) => weekdayOf(o.start!)))).toEqual(new Set([1]));
    expect(new Set(occ.map((o) => o.start!.getUTCMonth() + 1))).toEqual(new Set([4, 8]));
    expect(occ).toHaveLength(8); // four Tuesdays in each month, 2026
    expect(isoDate(occ[0].start!)).toBe(D(2026, 4, 7));
    expect(isoDate(occ.at(-1)!.start!)).toBe(D(2026, 8, 25));
  },
);

test("NZART sprints are three back-to-back windows", () => {
  // Three modes, three 29-minute windows, one evening, scored separately -- so
  // three records. Each ends one minute before the next begins.
  const firsts = NZART_SPRINT_IDS.map((cid) => expand(byId(cid), 2026)[0]);
  const hhmm = (d: Date): string =>
    `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
  expect(firsts.map((o) => hhmm(o.start!))).toEqual(["0800", "0830", "0900"]);
  expect(firsts.map((o) => hhmm(o.end!))).toEqual(["0829", "0859", "0929"]);
  expect(new Set(firsts.map((o) => isoDate(o.start!))).size).toBe(1);
});

test("JARL RTTY log deadline is the tenth day after the end", () => {
  // JARL: 'Logs must be submitted no later than 24:00 UTC on the 10th day after
  // the end of the contest.' The contest ends at 24:00 UTC on October 18 2026,
  // which this catalog stores as the instant 00:00 on the 19th, so ten days
  // later is 00:00 on the 29th -- 24:00 on the 28th, the tenth day after the
  // 18th. The two All Asian legs deliberately carry no deadline field, because
  // the same arithmetic there lands a day past the date JARL prints.
  const o = expand(byId("jarl-ww-rtty"), 2026)[0];
  expect(o.end!.getTime()).toBe(at(2026, 10, 19, 0, 0));
  expect(o.log_due!.getTime()).toBe(at(2026, 10, 29, 0, 0));
  for (const cid of ["jarl-aa-dx-cw", "jarl-aa-dx-phone"]) {
    expect(byId(cid).log_deadline_days).toBeUndefined();
  }
});

test("Oceania DX is two consecutive full weekends", () => {
  // Phone on the first full weekend of October, CW on the second. The committee
  // publishes only the year's dates; the rule in words comes from co-sponsor
  // WIA.
  for (const y of [2024, 2026]) {
    const phone = expand(byId("ocdx-phone"), y)[0];
    const cw = expand(byId("ocdx-cw"), y)[0];
    expect((cw.start!.getTime() - phone.start!.getTime()) / DAY_MS).toBe(7);
    expect(weekdayOf(phone.start!)).toBe(5);
    expect(weekdayOf(cw.start!)).toBe(5);
  }
});

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

test("no record still uses legacy local_time", () => {
  const stragglers = catalog.filter((c) => "local_time" in c).map((c) => c.id);
  expect(stragglers, `still using retired local_time: ${stragglers}`).toEqual([]);
});

test("no record has both timezone and local_rolling", () => {
  for (const c of catalog) {
    expect(Boolean(c.timezone && c.local_rolling), c.id).toBe(false);
  }
});

test("timezone records mark every spec wall_clock", () => {
  // A `timezone` with an unmarked time spec is the dangerous half-migration:
  // the zone looks handled but the spec is still read as UTC.
  for (const c of catalog) {
    if (!c.timezone) continue;
    const specs = c.sessions ?? [{ start: c.start, end: c.end }];
    for (const s of specs) {
      expect(s.start.wall_clock, c.id).toBe(true);
      expect(s.end.wall_clock, c.id).toBe(true);
    }
  }
});

test("wall_clock without a timezone is refused", () => {
  // Refusing beats defaulting. Silently treating an unzoned wall_clock spec as
  // UTC is exactly the bug this rework removes.
  const broken = {
    id: "broken",
    name: "Broken",
    recurrence: { type: "fixed_date", month: 6, day: 1 },
    start: { day_offset: 0, time: "1900", wall_clock: true },
    end: { day_offset: 0, time: "2100", wall_clock: true },
  } as unknown as Contest;
  expect(() => expand(broken, 2026)).toThrow(/wall_clock/);
});

test("sponsor-anchored shifts with DST", () => {
  // The whole point. 4SQRP says it themselves: "7 PM until 9 PM central time
  // (CST or CDT, whichever is in effect at the time). If you use UTC, that time
  // changes when we switch from CST to CDT (or vice versa)."
  //
  // Same wall clock in January and July; UTC instants exactly one hour apart.
  const occ = new Map(
    expand(byId("4sqrp-sss"), 2026).map((o) => [o.start!.getUTCMonth() + 1, o]),
  );
  const jan = occ.get(1)!;
  const jul = occ.get(7)!;

  expect(jan.start_wall!.getUTCHours()).toBe(19);
  expect(jul.start_wall!.getUTCHours()).toBe(19);
  expect(jan.start!.getUTCHours(), "19:00 CST is 0100Z").toBe(1);
  expect(jul.start!.getUTCHours(), "19:00 CDT is 0000Z").toBe(0);

  // Expressed as an offset from the same wall reading, the gap is one hour.
  const janOffset = jan.start!.getTime() - jan.start_wall!.getTime();
  const julOffset = jul.start!.getTime() - jul.start_wall!.getTime();
  expect(janOffset - julOffset).toBe(HOUR_MS);
});

test("Spartan Sprint shifts with DST too", () => {
  // ARS publishes no UTC time at all and says the event "is always at these
  // Local Times", so the UTC instant is what moves. December and July differ.
  const occ = new Map(
    expand(byId("ars-spartan-sprint"), 2026).map((o) => [o.start!.getUTCMonth() + 1, o]),
  );
  expect(occ.get(12)!.start!.getUTCHours(), "20:00 EST is 0100Z").toBe(1);
  expect(occ.get(7)!.start!.getUTCHours(), "20:00 EDT is 0000Z").toBe(0);
  expect([...occ.values()].every((o) => o.start_wall!.getUTCHours() === 20)).toBe(true);
});

test("DST spring-forward hour", () => {
  // 02:30 on 2026-03-08 in America/Chicago DOES NOT EXIST -- the clocks jump
  // from 02:00 to 03:00. The resolution uses the pre-transition offset, landing
  // at 0830Z. That is the conventional "shift forward an hour" outcome, pinned
  // here so it stays a decision rather than an accident, and matched exactly by
  // the Python engine's zoneinfo.
  const c = {
    id: "spring-forward-probe",
    name: "Spring Forward Probe",
    timezone: "America/Chicago",
    recurrence: { type: "fixed_date", month: 3, day: 8 },
    start: { day_offset: 0, time: "0230", wall_clock: true },
    end: { day_offset: 0, time: "0430", wall_clock: true },
  } as unknown as Contest;
  const occ = expand(c, 2026)[0];
  expect(occ.start_wall!.getTime()).toBe(at(2026, 3, 8, 2, 30));
  expect(occ.start!.getTime()).toBe(at(2026, 3, 8, 8, 30));
});

test("DST fall-back hour", () => {
  // 01:30 on 2026-11-01 in America/Chicago happens TWICE. The resolution picks
  // the first, still-CDT pass, which is 0630Z. The second pass would be 0730Z,
  // a full hour later, and both are "valid". Pinned so the default is a choice.
  const c = {
    id: "fall-back-probe",
    name: "Fall Back Probe",
    timezone: "America/Chicago",
    recurrence: { type: "fixed_date", month: 11, day: 1 },
    start: { day_offset: 0, time: "0130", wall_clock: true },
    end: { day_offset: 0, time: "0330", wall_clock: true },
  } as unknown as Contest;
  const occ = expand(c, 2026)[0];
  expect(occ.start!.getTime(), "first pass, still CDT").toBe(at(2026, 11, 1, 6, 30));
});

test("rolling contest exposes no UTC instant", () => {
  // An operator-anchored contest starts at a clock time wherever you are, so no
  // single UTC instant exists. The engine must hand back null rather than a
  // plausible-looking timestamp that would be wrong for everyone not on UTC --
  // a hard failure beats a wrong value that propagates into an iCal feed.
  //
  // Exercised against a synthetic definition: no contest in the catalog is
  // operator-anchored today (ARRL moved 10 GHz to fixed UTC), but the capability
  // is here so the next one found does not get a fake instant.
  const c = {
    id: "rolling-probe",
    name: "Rolling Probe",
    local_rolling: true,
    recurrence: { type: "nth_full_weekend", month: 8, n: 3 },
    start: { day_offset: 0, time: "0600" },
    end: { day_offset: 1, time: "2359" },
  } as unknown as Contest;
  const occ = expand(c, 2026)[0];

  expect(occ.start).toBeNull();
  expect(occ.end).toBeNull();
  expect(occ.local_rolling).toBe(true);
  expect(occ.start_wall!.getTime()).toBe(at(2026, 8, 15, 6, 0));
  expect(occ.start_date).toBe(D(2026, 8, 15));
  expect(occ.duration_hours).toBeCloseTo(41.98, 1);

  const payload = occ.toDict();
  expect(payload.start).toBeNull();
  expect(payload.end).toBeNull();
  expect(payload.start_wall).toBe("2026-08-15T06:00:00");
});

test("rolling contest claims no log deadline", () => {
  // A deadline counted from an end that does not exist would be fiction.
  const c = {
    id: "rolling-probe",
    name: "Rolling Probe",
    local_rolling: true,
    log_deadline_days: 30,
    recurrence: { type: "fixed_date", month: 6, day: 1 },
    start: { day_offset: 0, time: "0600" },
    end: { day_offset: 0, time: "1800" },
  } as unknown as Contest;
  expect(expand(c, 2026)[0].log_due).toBeNull();
});

test("conflicting time anchors are refused", () => {
  const c = {
    id: "conflicted",
    name: "Conflicted",
    timezone: "America/Chicago",
    local_rolling: true,
    recurrence: { type: "fixed_date", month: 6, day: 1 },
    start: { day_offset: 0, time: "1900", wall_clock: true },
    end: { day_offset: 0, time: "2100", wall_clock: true },
  } as unknown as Contest;
  expect(() => expand(c, 2026)).toThrow(/local_rolling/);
});

test("mixed schedule sorts without comparing apples to oranges", () => {
  // Sorting a year that mixes UTC, zoned and rolling contests must not blow up
  // on naive-vs-aware comparison. `sort_key` exists for exactly this.
  const occ = expandYear(catalog, 2026);
  const keys = occ.map((o) => o.sort_key);
  expect(keys).toEqual([...keys].sort((a, b) => a - b));
  expect(keys.every((k) => Number.isFinite(k))).toBe(true);
});

test("ARRL 10 GHz is UTC not local any more", () => {
  // ARRL moved this contest off local time and says so in the rules: "Each
  // weekend begins 0900 UTC Saturday and runs through 0759 UTC Monday. NOTE:
  // This is a change from the previous start and end times in local time."
  //
  // It was stored here as 0600 local Saturday to 2359 local Sunday, which is
  // now wrong twice over -- wrong hours and wrong model.
  const cases: [string, [number, number, number]][] = [
    ["arrl-10ghz-leg1", [2026, 8, 15]],
    ["arrl-10ghz-leg2", [2026, 9, 19]],
  ];
  for (const [cid, [y, m, day]] of cases) {
    const c = byId(cid);
    expect(c.timezone).toBeFalsy();
    expect(c.local_rolling).toBeFalsy();
    const occ = expand(c, 2026)[0];
    expect(occ.start!.getTime()).toBe(at(y, m, day, 9, 0));
    expect([occ.end!.getUTCHours(), occ.end!.getUTCMinutes()]).toEqual([7, 59]);
    const days = (occ.end!.getTime() - occ.start!.getTime()) / DAY_MS;
    expect(Math.floor(days), "Saturday to Monday").toBe(1);
    expect(occ.end!.getUTCDate() - occ.start!.getUTCDate()).toBe(2);
  }
});

test("composite rule handles mixed subrules", () => {
  // A composite may mix rule types -- last-weekday plus nth-full-weekend.
  const anchors = resolveAnchors(
    {
      type: "composite",
      rules: [
        { type: "nth_weekday", month: 2, n: -1, weekday: 5 },
        { type: "nth_full_weekend", month: 7, n: 3 },
      ],
    },
    2026,
  );
  expect(anchors.map(isoDate)).toEqual([D(2026, 2, 28), D(2026, 7, 18)]);
});

// ---------------------------------------------------------------------------
// Malformed rules
// ---------------------------------------------------------------------------

describe("malformed rules", () => {
  test("unknown rule type surfaces instead of yielding an empty schedule", () => {
    // A rule that produces no anchors this year is fine and returns nothing --
    // a fifth-Saturday rule in a four-Saturday month, or a `manual` record for
    // an unpublished year. A rule type that does not exist is a catalog typo,
    // and swallowing it would silently drop the contest from every calendar.
    const c = {
      id: "typo",
      name: "Typo",
      recurrence: { type: "nth_fortnight", month: 6, n: 1 },
      start: { day_offset: 0, time: "0000" },
      end: { day_offset: 0, time: "0100" },
    } as unknown as Contest;
    expect(() => expand(c, 2026)).toThrow(/unknown rule type/);
  });
});

// ---------------------------------------------------------------------------
// Catalog vocabularies
//
// `modes` and `bands` were free text until 2026-08-16: `Digital` and `DIGITAL`
// were different values, PSK31 sat alongside them as if it were a peer, and no
// band filter could be written at all. These tests are what stops that
// returning -- a controlled set that nothing enforces is a convention, and a
// convention decays one hand-edited record at a time.
//
// Mirrored one-for-one from tests/test_recurrence.py.
// ---------------------------------------------------------------------------

describe("catalog vocabularies", () => {
  test("every record draws its modes from the controlled set", () => {
    const offenders = catalog.flatMap((c) =>
      (c.modes ?? []).filter((m) => !MODES.has(m)).map((m) => [c.id, m]),
    );
    expect(offenders, `modes outside the vocabulary: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  test("every record declares at least one mode", () => {
    // A contest with no mode cannot be found by anyone filtering on mode, and
    // every sponsor states one. Absence here is an editing slip, not a fact.
    expect(catalog.filter((c) => !(c.modes ?? []).length).map((c) => c.id)).toEqual([]);
  });

  test("every record draws its bands from the ladder", () => {
    const offenders = catalog.flatMap((c) =>
      (c.bands ?? []).filter((b) => !BANDS.has(b)).map((b) => [c.id, b]),
    );
    expect(offenders, `bands outside the ladder: ${JSON.stringify(offenders)}`).toEqual([]);
  });

  test("bands are listed low to high", () => {
    // Order is displayed as-is -- "160-10m" is collapsed from the ends of the
    // list. An unsorted list renders as a wrong range rather than as a mess,
    // which is the kind of wrong that gets believed.
    for (const c of catalog) {
      const order = (c.bands ?? []).map((b) => CATALOG_BANDS.indexOf(b as never));
      expect(order, `${c.id} lists bands out of order: ${c.bands}`).toEqual(
        [...order].sort((a, b) => a - b),
      );
    }
  });

  test("no record carries a duplicate mode or band", () => {
    for (const c of catalog) {
      for (const values of [c.modes ?? [], c.bands ?? []]) {
        expect(new Set(values).size, c.id).toBe(values.length);
      }
    }
  });

  test("retired free-text tokens are gone everywhere", () => {
    // The exact values that were in the catalog before the migration. Named
    // rather than inferred, so this fails loudly if one is reintroduced by a
    // copy-paste from an old record.
    const retired = new Set([
      "DIGITAL", "PSK31", "PSK63", "RTTY75", "FT4", "VHF+", "222MHz+", "10GHz+",
    ]);
    const stragglers = catalog.flatMap((c) =>
      [...(c.modes ?? []), ...(c.bands ?? [])]
        .filter((v) => retired.has(v))
        .map((v) => [c.id, v]),
    );
    expect(stragglers, `pre-migration tokens still in the catalog: ${JSON.stringify(stragglers)}`)
      .toEqual([]);
  });

  test("submodes are specifics, not a second mode list", () => {
    // `submodes` is free text on purpose. What it must never hold is a value
    // from the controlled set -- that would be the mode recorded twice, in two
    // fields, and the two would eventually disagree.
    for (const c of catalog) {
      for (const s of c.submodes ?? []) {
        expect(MODES.has(s), `${c.id}: submode ${JSON.stringify(s)} belongs in modes`).toBe(false);
      }
    }
  });

  test("a record with submodes declares the family they belong to", () => {
    // PSK31 without Digital, or FT4 without FT8/FT4, is a record that shows up
    // in no filter at all. The submode is the detail; the mode is the handle.
    for (const c of catalog) {
      if ((c.submodes ?? []).length) {
        expect((c.modes ?? []).length, `${c.id} has submodes but no mode`).toBeGreaterThan(0);
      }
    }
  });

  test("unrecorded bands are the documented exception", () => {
    // Empty `bands` means unrecorded, and a band filter drops the record. That
    // is a real cost, so it is pinned to the records that have a documented
    // reason.
    //
    // jarl-new-year-qso-party: JARL's rule is "All bands and Modes permitted
    // for JA amateur radio stations" and points at the Japanese band plan.
    // There is no band list on the page to record, and inferring one from the
    // band plan would be this catalog writing a rule JARL did not.
    //
    // sarl-hf-phone: sarl.org.za served an expired TLS certificate on
    // 2026-08-16, so its rules could not be read. The project's rule is to
    // document a blocked source and stop, never to reach for an aggregator.
    const unrecorded = catalog
      .filter((c) => !(c.bands ?? []).length)
      .map((c) => c.id)
      .sort();
    expect(unrecorded).toEqual(["jarl-new-year-qso-party", "sarl-hf-phone"]);
  });

  test("bands_note never stands in for a band list", () => {
    // The note carries the sponsor's wording; it is not a place to record the
    // bands themselves in prose and skip the machine-readable list.
    for (const c of catalog) {
      if (c.bands_note) {
        expect((c.bands ?? []).length, `${c.id} has a bands_note but no bands`).toBeGreaterThan(0);
      }
    }
  });

  test("the two engines declare the same vocabularies", () => {
    // The Python and TypeScript vocabularies are hand-maintained in two files.
    // This asserts the TypeScript side against the literal text of the Python
    // one, so a value added to one and not the other fails here rather than in
    // a filter six months later.
    const py = readFileSync(
      join(DATA_DIR, "..", "contestcal", "recurrence.py"),
      "utf-8",
    );
    for (const [name, values] of [
      ["CATALOG_MODES", CATALOG_MODES],
      ["CATALOG_BANDS", CATALOG_BANDS],
    ] as const) {
      const block = py.split(`${name} = (`)[1].split(")")[0];
      const declared = block
        .split(",")
        .map((v) => v.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      expect(declared, `${name} differs between the engines`).toEqual([...values]);
    }
  });
});
