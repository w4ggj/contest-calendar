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
  NoAnchorsThisYear,
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
  // qrpcontest.com is the one that would actually get taken. It publishes
  // recurrences in exactly this catalog's shape, for the one sponsor whose
  // rules are nowhere on the public web -- and it links WA7BNM from its own
  // front page, so it is downstream too.
  expect(derived.some((n: string) => n.toLowerCase().includes("qrpcontest"))).toBe(true);
  expect(derived.some((n) => n.includes("Corral"))).toBe(true);
  expect(derived.some((n) => n.includes("SM3CER"))).toBe(true);
});

const REGISTRY_TIERS = [
  "tier_1_major_international",
  "tier_2_european_societies",
  "tier_3_other_regions",
  "tier_4_specialty_clubs",
  "tier_5_qso_parties",
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

// ---------------------------------------------------------------------------
// SARL -- and the reason Africa was stuck at one record.
//
// sarl.org.za served an expired certificate, then became a parked cPanel page.
// The league had moved to mysarl.org.za, which publishes a per-contest rules
// PDF for each event AND its own SARL-Contests-2026-Calendar.ics. That .ics is
// the independent second source every record here is tested against: its times
// carry TZID="South Africa Standard Time", a fixed +0200 with no DST, and
// SARL's own X-CALSTART confirms the offset by writing 09:00 local as 07:00Z.
// ---------------------------------------------------------------------------

const SARL_PUBLISHED: Record<string, [string, [number, number, number][]]> = {
  "sarl-hf-phone": [
    "HF Phone Contest on (1st Sunday) 2 August 2026 14:00 to 17:00 UTC",
    [[2026, 8, 2]],
  ],
  "sarl-hf-digital": [
    "HF Digital Contest on (2nd Sunday) 9 August 2026 13:00 UTC to 16:00 UTC",
    [[2026, 8, 9]],
  ],
  "sarl-hf-cw": [
    "HF CW Contest on (4th Sunday) 23 August 2026 14:00 to 17:00 UTC",
    [[2026, 8, 23]],
  ],
  "sarl-africa-all-mode-dx": [
    "12:00 UTC on Saturday 28 March to 12:00 UTC on Sunday 29 March 2026 (The 4th full weekend of March)",
    [[2026, 3, 28]],
  ],
  "sarl-equinox-6m-march": [
    "From 00:01UTC on the 16th March to 23:59 UTC on 15th April",
    [[2026, 3, 16]],
  ],
  "sarl-equinox-6m-september": [
    "From 00:01UTC on the 16th September to 23:59 UTC on 15th October",
    [[2026, 9, 16]],
  ],
  "sarl-qrp-summer": [
    "Summer Leg: 3rd Saturday of January - 17 January 2026 - from 07:00 to 09:00 UTC",
    [[2026, 1, 17]],
  ],
  "sarl-qrp-autumn": [
    "Autumn Leg: 1st Saturday of April - 4 April 2026 - from 13:30 to 15:30 UTC",
    [[2026, 4, 4]],
  ],
  "sarl-qrp-winter": [
    "Winter Leg: 3rd Saturday of July - 18 July 2026 - from 07:00 to 09:00 UTC",
    [[2026, 7, 18]],
  ],
  "sarl-qrp-spring": [
    "Spring Leg: 1st Saturday of November - 7 November 2026 - from 13:30 to 15:30 UTC",
    [[2026, 11, 7]],
  ],
  "sarl-hamnet-40m-sec": [
    "12:00 to 14:00 UTC on (the 1st Sunday) 1 March 2026",
    [[2026, 3, 1]],
  ],
  "sarl-top-band-qso": [
    "Wednesday 2026/06/03 22:01 UTC, per SARL's own Date Ordered List",
    [[2026, 6, 3]],
  ],
};

test.each(
  Object.entries(SARL_PUBLISHED)
    .sort()
    .map(([cid, [rule, dates]]) => [cid, rule, dates] as const),
)("SARL contests match the dates SARL publishes: %s", (cid, rule, published) => {
  const c = byId(cid);
  for (const [y, m, day] of published) {
    const occ = expand(c, y);
    expect(occ.length, `${cid} produced nothing for ${y}`).toBeGreaterThan(0);
    expect(isoDate(occ[0].start!), `${cid} ${y}: rule '${rule}'`).toBe(D(y, m, day));
  }
});

test("SARL two-leg contests produce both legs", () => {
  // Field Day and the Africa FT4 contest each run twice a year off ONE record,
  // because both legs share a start and end offset and differ only in the
  // weekend they anchor to. A record that produced one leg would silently drop
  // half the contest, which no date-level test on the first occurrence catches.
  expect(expand(byId("sarl-national-field-day"), 2026).map((o) => isoDate(o.start!)))
    .toEqual([D(2026, 3, 14), D(2026, 9, 5)]);
  expect(expand(byId("sarl-africa-ft4"), 2026).map((o) => isoDate(o.start!)))
    .toEqual([D(2026, 4, 11), D(2026, 9, 12)]);
});

test("the SARL HF series runs the hours SARL states", () => {
  // The digital leg starts an hour earlier than the other two. That is SARL's
  // own wording -- "13:00 UTC to 16:00 UTC" against "14:00 to 17:00" -- and it
  // is the kind of detail a copied schedule regularises away.
  const hours: Record<string, number[]> = {};
  for (const cid of ["sarl-hf-phone", "sarl-hf-digital", "sarl-hf-cw"]) {
    const [o] = expand(byId(cid), 2026);
    hours[cid] = [o.start!.getUTCHours(), o.end!.getUTCHours()];
  }
  expect(hours).toEqual({
    "sarl-hf-phone": [14, 17],
    "sarl-hf-digital": [13, 16],
    "sarl-hf-cw": [14, 17],
  });
});

test("the SARL equinox legs run a month and end where SARL says", () => {
  // Two records rather than one, because the end offsets differ: 16 March to
  // 15 April is 30 days and 16 September to 15 October is 29. One record
  // carries one start/end pair, so a single record would be wrong by a day in
  // one leg or the other.
  const [mar] = expand(byId("sarl-equinox-6m-march"), 2026);
  expect([isoDate(mar.start!), isoDate(mar.end!)]).toEqual([D(2026, 3, 16), D(2026, 4, 15)]);

  const [sep] = expand(byId("sarl-equinox-6m-september"), 2026);
  expect([isoDate(sep.start!), isoDate(sep.end!)]).toEqual([D(2026, 9, 16), D(2026, 10, 15)]);

  for (const o of [mar, sep]) {
    expect([o.start!.getUTCHours(), o.start!.getUTCMinutes()]).toEqual([0, 1]);
    expect([o.end!.getUTCHours(), o.end!.getUTCMinutes()]).toEqual([23, 59]);
  }
});

test("the Africa All Mode deadline matches the date SARL prints", () => {
  // SARL states this deadline BOTH ways -- "15 days after the contest" and
  // "Monday 13 April 2026" -- so the span can be encoded against the sponsor's
  // own arithmetic rather than inferred from one year's date.
  const c = byId("sarl-africa-all-mode-dx");
  expect(c.log_deadline_days).toBe(15);
  const [o] = expand(c, 2026);
  expect(isoDate(o.log_due!)).toBe(D(2026, 4, 13));
});

// The legs, which the first-occurrence table above cannot see. SARL runs most
// of its programme two or four times a year off one rule, and a record that
// produced only the first would look right in every date test and be missing
// half the contest.
const SARL_LEGS: Record<string, [number, number, number][]> = {
  "sarl-club-40m": [[2026, 1, 24], [2026, 4, 25], [2026, 7, 25], [2026, 11, 28]],
  "sarl-club-20m": [[2026, 3, 21], [2026, 6, 20]],
  "sarl-club-80m": [[2026, 2, 18], [2026, 5, 20], [2026, 8, 19], [2026, 10, 21]],
  "sarl-80m-qso-party": [[2026, 4, 2], [2026, 10, 1]],
  "sarl-yl-qso-party": [[2026, 3, 7], [2026, 8, 9]],
  "sarl-youth-qso-party": [[2026, 6, 16], [2026, 8, 15]],
  "sarl-newbie-qso-party": [[2026, 7, 4], [2026, 11, 21]],
};

test.each(Object.entries(SARL_LEGS).sort())(
  "SARL multi-leg records produce every leg: %s",
  (cid, published) => {
    const got = expand(byId(cid), 2026).map((o) => isoDate(o.start!));
    expect(got).toEqual((published as [number, number, number][]).map(([y, m, d]) => D(y, m, d)));
  },
);

test("SARL club contests run in the months SARL names", () => {
  // The club contests are "the 4th Saturday of a month" and "the third
  // Wednesday of a month" -- but only in four months of the year, and only two
  // for the 20 m one. Dropping the month list would put eight extra contests a
  // year on the calendar that SARL does not run, which is the same class of
  // error as NZART's April-and-August sprints reading as weekly.
  const months: Record<string, number[]> = {
    "sarl-club-40m": [1, 4, 7, 11],
    "sarl-club-20m": [3, 6],
    "sarl-club-80m": [2, 5, 8, 10],
  };
  for (const [cid, expected] of Object.entries(months)) {
    expect(byId(cid).recurrence.months, cid).toEqual(expected);
    expect(expand(byId(cid), 2026).length, cid).toBe(expected.length);
  }
});

test("SARL parties mix a fixed date with an ordinal", () => {
  // Two of these hang one leg on a national holiday and the other on an
  // ordinal weekday: the YL party runs on the first Saturday of March and then
  // on National Women's Day, 9 August, which is a fixed date; the Youth party
  // runs on National Youth Day, 16 June, and then the third Saturday of August.
  //
  // One record each, because both legs share their hour -- and `composite` can
  // hold rules of different types, which is what makes that possible.
  expect(expand(byId("sarl-yl-qso-party"), 2027).map((o) => isoDate(o.start!)))
    .toEqual([D(2027, 3, 6), D(2027, 8, 9)]);
  expect(expand(byId("sarl-youth-qso-party"), 2027).map((o) => isoDate(o.start!)))
    .toEqual([D(2027, 6, 16), D(2027, 8, 21)]);
});

test("SARL Top Band is flagged rather than guessed", () => {
  // Two problems, either of which alone would justify the flag.
  //
  // SARL's rules prose says the contest starts "22:01 UTC 4 June (00:01 CAT)
  // Thursday 4 June", but 22:01 UTC on Thursday the 4th is 00:01 CAT on FRIDAY
  // the 5th. SARL's own Date Ordered List says Wednesday 3 June 22:01 UTC,
  // which is 00:01 CAT Thursday -- self-consistent, so that is what is encoded.
  //
  // And "the first full week of June" has two readings that agree in 2026 and
  // diverge in 2027: a Monday-to-Sunday week wholly inside June puts the
  // Thursday on the 10th, while the first week containing the whole
  // Thursday-to-Sunday block puts it on the 3rd. So no ordinal rule is encoded
  // at all -- only the date SARL published.
  const c = byId("sarl-top-band-qso");
  expect(c.recurrence.type).toBe("manual");
  expect(c.verified).toBe(false);
  expect(c.note).toContain("first full week");

  const [o] = expand(c, 2026);
  expect(isoDate(o.start!)).toBe(D(2026, 6, 3));
  expect([o.start!.getUTCHours(), o.start!.getUTCMinutes()]).toEqual([22, 1]);
  expect(isoDate(o.end!)).toBe(D(2026, 6, 7));
  expect([o.end!.getUTCHours(), o.end!.getUTCMinutes()]).toEqual([21, 59]);

  // No year SARL has not published. Absent beats guessed.
  expect(expand(c, 2027)).toEqual([]);
});

test("SARL club eligibility is marked as our inference", () => {
  // The club contests require an "Abbreviated Club Callsign" derived from an
  // ICASA-issued callsign, and ICASA is the South African regulator -- so a
  // station elsewhere has no valid exchange to send. That is a reading, not
  // SARL's wording, so the eligibility carries verified: false and says so.
  // Every other SARL record's eligibility quotes a sentence and is verified.
  for (const cid of ["sarl-club-40m", "sarl-club-20m", "sarl-club-80m"]) {
    const e = byId(cid).eligibility!;
    expect(e.scope, cid).toBe("entity_list");
    expect(e.entities, cid).toEqual(["ZS"]);
    expect(e.verified, cid).toBe(false);
    expect(e.note, cid).toContain("READING");
  }
  for (const cid of ["sarl-hamnet-40m-sec", "sarl-top-band-qso"]) {
    const e = byId(cid).eligibility!;
    expect(e.scope, cid).toBe("entity_list");
    expect(e.verified, cid).toBe(true);
  }
});

test("SARL entry is worldwide, which corrects an earlier guess", () => {
  // This catalog previously carried SARL HF Phone as ZS-only, flagged
  // verified: false with the note "SARL contests are generally South African
  // entrants only. Confirm." Reading the rules confirmed the opposite: the
  // scoring table's Area 9 is "Stations in the rest of the world", and the two
  // Africa DX contests say worldwide entry in as many words.
  //
  // The flag did its job, so this test pins the correction rather than the
  // guess -- an unverified record that was WRONG is the case the flag exists
  // for, and it should not be able to come back quietly.
  for (const cid of [
    "sarl-hf-phone", "sarl-hf-digital", "sarl-hf-cw", "sarl-africa-all-mode-dx",
    "sarl-africa-ft4", "sarl-equinox-6m-march", "sarl-national-field-day",
  ]) {
    const c = byId(cid);
    expect(c.eligibility?.scope, cid).toBe("worldwide");
    expect(eligibilityFor(c, "K").can_enter, cid).toBe(true);
    expect(c.verified, cid).toBeTruthy();
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
// Sponsor validation -- REF, UBA, VERON, PZK/SP DX Club, PK RVG, CRK/SARA,
// ARI, URE
//
// The Tier 2 European pass. Most of these societies publish only in their own
// language, so each record carries the rule in the sponsor's own words; the
// dates below were published by the same sponsor separately from that wording,
// in another year's rules or on the sponsor's own calendar page. Where a
// sponsor's calendar is an aggregator of other people's contests -- REF's and
// ARI's are, and UBA's is except for the rows it marks as its own -- it was not
// used at all.
// ---------------------------------------------------------------------------

const EUROPE_TIER2_PUBLISHED: Record<string, [string, [number, number, number][]]> = {
  "ref-coupe-du-ref-cw": [
    "dernier week-end entier du mois de janvier",
    [[2025, 1, 25], [2026, 1, 24]],
  ],
  "ref-coupe-du-ref-ssb": [
    "dernier week-end entier du mois de fevrier",
    [[2025, 2, 22], [2026, 2, 21]],
  ],
  "ref-160m": [
    "troisieme week-end de novembre",
    [[2025, 11, 15], [2026, 11, 21]],
  ],
  "ref-ddfm-50mhz": [
    "le deuxieme samedi de juin",
    [[2025, 6, 14], [2026, 6, 13]],
  ],
  "uba-dx-ssb": [
    "starts every year on the last Saturday of January",
    [[2026, 1, 31]],
  ],
  "uba-dx-cw": [
    "starts every year on the last Saturday of February",
    [[2026, 2, 28]],
  ],
  "uba-psk63-prefix": [
    "every year the 2nd weekend of january",
    [[2026, 1, 10], [2027, 1, 9]],
  ],
  "pacc": [
    "het tweede volle weekend van februari",
    [[2026, 2, 14], [2027, 2, 13], [2028, 2, 12], [2029, 2, 10]],
  ],
  "sp-dx-contest": [
    "pierwszy pelny weekend kwietnia",
    [[2025, 4, 5], [2026, 4, 4]],
  ],
  "sp-dx-rtty": ["the 4th full weekend of April", [[2026, 4, 25]]],
  "ok-om-dx-ssb": ["second weekend in April", [[2026, 4, 11]]],
  "ok-om-dx-cw": ["second (full) weekend in November", [[2026, 11, 14]]],
  "ok-dx-rtty": ["3rd full weekend in December", [[2026, 12, 19]]],
  "ari-international-dx": ["il primo weekend completo di Maggio", [[2026, 5, 2]]],
  "ari-contest-sezioni-hf": [
    "ogni secondo week-end completo di Giugno",
    [[2026, 6, 13]],
  ],
  "ari-40-80": [
    "il secondo weekend completo di Dicembre",
    [[2025, 12, 13], [2026, 12, 12]],
  ],
  "ure-rey-de-espana-cw": ["3rd full weekend of May", [[2026, 5, 16]]],
  // URE's typo, quoted as written.
  "ure-rey-de-espana-ssb": ["4rd full weekend of June", [[2026, 6, 27]]],
  "ure-eapsk63": ["segundo fin de semana del mes de marzo", [[2026, 3, 14]]],
  "ure-cncw": ["3rd full weekend of July", [[2026, 7, 18]]],
  "ure-cme": ["2nd full weekend of August", [[2026, 8, 8]]],
};

test.each(
  Object.entries(EUROPE_TIER2_PUBLISHED)
    .sort()
    .map(([cid, [rule, dates]]) => [cid, rule, dates] as const),
)(
  "tier 2 European societies match their own published dates: %s",
  (cid, rule, published) => {
    const c = byId(cid);
    for (const [y, m, day] of published) {
      const occ = expand(c, y);
      expect(occ.length, `${cid} produced nothing for ${y}`).toBeGreaterThan(0);
      expect(isoDate(occ[0].start!), `${cid} ${y}: rule '${rule}'`).toBe(D(y, m, day));
    }
  },
);

test("UBA DX is the last Saturday, not the last full weekend", () => {
  // UBA: 'starts every year on the last Saturday of January'. The two readings
  // diverge in 2026 and UBA's own dates settle it -- January 31 is a Saturday
  // and February 1 a Sunday, so the last FULL weekend of January 2026 is the
  // 24th, but UBA published January 31 - February 1.
  expect(isoDate(fullWeekendsInMonth(2026, 1).at(-1)!)).toBe(D(2026, 1, 24));
  expect(isoDate(expand(byId("uba-dx-ssb"), 2026)[0].start!)).toBe(D(2026, 1, 31));
  // 2026 separates the two readings on both legs: February 28 is a Saturday
  // whose Sunday falls in March, so the last full weekend of February is the
  // 21st -- and UBA published February 28 - March 1.
  expect(isoDate(fullWeekendsInMonth(2026, 2).at(-1)!)).toBe(D(2026, 2, 21));
  expect(isoDate(expand(byId("uba-dx-cw"), 2026)[0].start!)).toBe(D(2026, 2, 28));
});

// UBA prints a log deadline beside each ON Contest leg. All four are the leg's
// own date plus five days, which is what makes 'no later than 5 days after the
// contest' encodable rather than a fixed date to be quoted.
const UBA_ON_LEGS: [string, [number, number, number], [number, number, number]][] = [
  ["uba-on-6m", [2026, 9, 27], [2026, 10, 2]],
  ["uba-on-80-40-ssb", [2026, 10, 4], [2026, 10, 9]],
  ["uba-on-80-40-cw", [2026, 10, 11], [2026, 10, 16]],
  ["uba-on-2m", [2026, 10, 18], [2026, 10, 23]],
];

test.each(UBA_ON_LEGS)(
  "UBA ON Contest deadlines are the dates UBA printed: %s",
  (cid, day, deadline) => {
    const o = expand(byId(cid), 2026)[0];
    expect(isoDate(o.start!)).toBe(D(...day));
    expect(isoDate(o.log_due!)).toBe(D(...deadline));
  },
);

test("REF 160m deadline is the second Monday after the contest", () => {
  // REF states no interval for this one -- 'A plus tard le deuxieme lundi apres
  // le concours' -- so the 8 in the record is derived, and only correct because
  // the contest always ends at 0000 UTC on a Sunday. Checked across a decade
  // rather than asserted once.
  const c = byId("ref-160m");
  for (let y = 2025; y < 2035; y += 1) {
    const o = expand(c, y)[0];
    expect(weekdayOf(o.start!)).toBe(5);
    expect(weekdayOf(o.end!)).toBe(6);
    const mondays: Date[] = [];
    for (let n = 1; n <= 14; n += 1) {
      const d = new Date(o.start!.getTime() + n * DAY_MS);
      if (weekdayOf(d) === 0) mondays.push(d);
    }
    expect(isoDate(o.log_due!), String(y)).toBe(isoDate(mondays[1]));
  }
});

test("URE night-break contests run two sessions", () => {
  // URE's CNCW and CME both stop overnight: '1200 UTC Saturday till 2259 UTC
  // Saturday and from 0500UTC till 1159UTC Sunday'. Two sessions, not one long
  // window -- a single span would claim eighteen hours of operating time that
  // the rules do not permit.
  const hhmm = (d: Date): string =>
    `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
  for (const [cid, first] of [
    ["ure-cncw", D(2026, 7, 18)],
    ["ure-cme", D(2026, 8, 8)],
  ] as const) {
    const occ = expand(byId(cid), 2026);
    expect(occ, cid).toHaveLength(2);
    expect(isoDate(occ[0].start!)).toBe(first);
    expect(occ.map((o) => hhmm(o.start!))).toEqual(["1200", "0500"]);
    expect(occ.map((o) => hhmm(o.end!))).toEqual(["2259", "1159"]);
    // Six hours off air between them, which is the point of the split.
    expect(occ[1].start!.getTime() - occ[0].end!.getTime()).toBe(
      6 * HOUR_MS + 60_000,
    );
  }
});

test("URE deadline is fifteen days from the end of the second session", () => {
  // Every URE record states '(15 days)' and prints a date. For the two-session
  // contests the printed date is fifteen days after the SECOND session ends;
  // the engine applies the interval per session, so the first session's
  // computed deadline is a day early. Recorded in the records' notes rather
  // than papered over.
  for (const [cid, printed] of [
    ["ure-cncw", [2026, 8, 3]],
    ["ure-cme", [2026, 8, 24]],
  ] as const) {
    const occ = expand(byId(cid), 2026);
    const [py, pm, pd] = printed;
    expect(isoDate(occ[1].log_due!), cid).toBe(D(py, pm, pd));
    expect(
      isoDate(new Date(occ[0].log_due!.getTime() + DAY_MS)),
      cid,
    ).toBe(D(py, pm, pd));
  }
});

test("OK DX RTTY carries no deadline because the sponsor contradicts itself", () => {
  // The rules say 'not later than 7th day after the contest'; the announcement
  // of the same edition prints 26 December -- with the wrong year, 2025, for a
  // 2026 contest. The stored end is 00:00 on the Sunday, so seven days from
  // there is the 27th. No number is invented: the field is absent and both
  // statements are quoted in the record. The two OK/OM legs, whose parenthetical
  // dates DO match their stated interval, encode it.
  expect(byId("ok-dx-rtty").log_deadline_days).toBeUndefined();
  const o = expand(byId("ok-dx-rtty"), 2026)[0];
  expect(o.end!.getTime()).toBe(at(2026, 12, 20, 0, 0));
  expect(o.log_due ?? null).toBeNull();
  for (const [cid, due] of [
    ["ok-om-dx-ssb", D(2026, 4, 19)],
    ["ok-om-dx-cw", D(2026, 11, 22)],
  ] as const) {
    expect(isoDate(expand(byId(cid), 2026)[0].log_due!)).toBe(due);
  }
});

// Records where the sponsor publishes dates and never states a rule. Each is
// manual on purpose: an ordinal fitted to the dates would print confident
// schedules for years the sponsor has not announced.
const TIER2_MANUAL: Record<string, [number, number]> = {
  "uba-spring-2m": [2026, 2027],
  "uba-spring-80m-cw": [2026, 2027],
  "uba-spring-6m": [2026, 2027],
  "uba-spring-80m-ssb": [2026, 2027],
  "uba-on-6m": [2026, 2027],
  "uba-on-80-40-ssb": [2026, 2027],
  "uba-on-80-40-cw": [2026, 2027],
  "uba-on-2m": [2026, 2027],
  "uba-bma": [2026, 2027],
  "paccdigi": [2027, 2028],
  "ure-eartty": [2026, 2027],
};

test.each(
  Object.entries(TIER2_MANUAL)
    .sort()
    .map(([cid, [last, after]]) => [cid, last, after] as const),
)(
  "tier 2 manual records stop where the sponsor stopped publishing: %s",
  (cid, last, after) => {
    const c = byId(cid);
    expect(c.recurrence.type).toBe("manual");
    expect(
      expand(c, last).length,
      `${cid} produced nothing for its last published year`,
    ).toBeGreaterThan(0);
    expect(expand(c, after), `${cid} guessed ${after}, a year nobody published`)
      .toHaveLength(0);
  },
);

test("PACCdigi is manual even though both dates look like a rule", () => {
  // VERON's two published PACCdigi editions are both the third Saturday of
  // April, and the temptation is to encode that. VERON does not say it -- the
  // PACC page says 'het tweede volle weekend van februari' in so many words and
  // the PACCdigi page says nothing of the kind, so the difference is the
  // sponsor's, not ours.
  const c = byId("paccdigi");
  const published = [2026, 2027].map((y) => expand(c, y)[0].start!);
  expect(published.map(isoDate)).toEqual([D(2026, 4, 18), D(2027, 4, 17)]);
  for (const d of published) {
    expect(weekdayOf(d)).toBe(5);
    expect(d.getUTCDate()).toBeGreaterThanOrEqual(15); // third Saturday,
    expect(d.getUTCDate()).toBeLessThanOrEqual(21); // ...both years
  }
  expect(c.recurrence.type).toBe("manual");
});

test("URE RTTY is manual while URE states a rule for its other five", () => {
  // Five of URE's six HF contests name an ordinal weekend in both language
  // versions of their page. EA RTTY names a date and nothing else, in both, so
  // it alone is manual -- the contrast is what makes that a reading of URE
  // rather than an inconsistency of ours.
  expect(byId("ure-eartty").recurrence.type).toBe("manual");
  for (const cid of [
    "ure-rey-de-espana-cw",
    "ure-rey-de-espana-ssb",
    "ure-eapsk63",
    "ure-cncw",
    "ure-cme",
  ]) {
    expect(byId(cid).recurrence.type, cid).toBe("nth_full_weekend");
  }
});

test("Czech contest hosts are http because their TLS is broken", () => {
  // okomdx.crk.cz and okrtty.crk.cz serve a certificate issued for
  // default.web4u.cz, so HTTPS fails validation. The http:// URLs are a
  // recorded blocker, not an oversight, and each record says so -- the same
  // treatment given to SARL's dead host.
  for (const cid of ["ok-om-dx-ssb", "ok-om-dx-cw", "ok-dx-rtty"]) {
    const c = byId(cid);
    expect((c.rules_url ?? "").startsWith("http://"), cid).toBe(true);
    expect(c.rules_url ?? "", cid).toContain("crk.cz");
    expect(c.note ?? "", cid).toContain("TLS");
  }
});

// ---------------------------------------------------------------------------
// Sponsor validation -- DARC
//
// The rules are German and each record quotes them in German. The dates and
// deadlines below are DARC's, published separately from that wording in its own
// "Termine DARC KW Conteste 2026" table at /darc-kw-conteste/kw-conteste/. That
// table lists only DARC's own contests, so it is a sponsor source and not an
// aggregator -- the one IARU event on it is not encoded, for that reason.
// ---------------------------------------------------------------------------

const DARC_PUBLISHED: Record<string, [string, [number, number, number][]]> = {
  "wae-dx-cw": ["CW: August, zweites Wochenende", [[2026, 8, 8]]],
  "wae-dx-ssb": ["SSB: September, zweites Wochenende", [[2026, 9, 12]]],
  "wae-dx-rtty": ["RTTY: November, zweites Wochenende", [[2026, 11, 14]]],
  "darc-wag": [
    "Oktober, drittes volles Wochenende, 1500 UTC Samstag bis 1459 UTC Sonntag",
    [[2026, 10, 17]],
  ],
  "darc-10m": ["Zweiter Sonntag im Januar, 0900-1059 UTC", [[2026, 1, 11]]],
  "darc-xmas": ["26. Dezember, 08.30-10.59 UTC", [[2026, 12, 26]]],
  "darc-ft4": [
    "Jeweils 2. Monat im Quartal, Am 2. Dienstag im Monat",
    [[2026, 2, 10], [2026, 5, 12], [2026, 8, 11], [2026, 11, 10]],
  ],
  "darc-rtty-kurzcontest": [
    "jeweils im 1. Monat eines jeden Quartals am 2. Dienstag",
    [[2026, 1, 13], [2026, 4, 14], [2026, 7, 14], [2026, 10, 13]],
  ],
};

test.each(
  Object.entries(DARC_PUBLISHED)
    .sort()
    .map(([cid, [rule, dates]]) => [cid, rule, dates] as const),
)("DARC contests match DARC's own published dates: %s", (cid, rule, published) => {
  const got = expand(byId(cid), 2026).map((o) => isoDate(o.start!));
  expect(got, `${cid}: rule '${rule}'`).toEqual(
    published.map(([y, m, d]) => D(y, m, d)),
  );
});

// The deadline column of the same table. DARC states the interval once in the
// general contest rules and again in most of the individual Ausschreibungen, so
// these are a second statement of it rather than a restatement of ours.
const DARC_PUBLISHED_DEADLINES: Record<string, [number, number, number][]> = {
  "wae-dx-cw": [[2026, 8, 16]],
  "wae-dx-ssb": [[2026, 9, 20]],
  "wae-dx-rtty": [[2026, 11, 22]],
  "darc-wag": [[2026, 10, 25]],
  "darc-10m": [[2026, 1, 18]],
  "darc-xmas": [[2027, 1, 2]],
  "darc-ft4": [[2026, 2, 17], [2026, 5, 19], [2026, 8, 18], [2026, 11, 17]],
  "darc-rtty-kurzcontest": [
    [2026, 1, 20], [2026, 4, 21], [2026, 7, 21], [2026, 10, 20],
  ],
};

test.each(
  Object.entries(DARC_PUBLISHED_DEADLINES)
    .sort()
    .map(([cid, dates]) => [cid, dates] as const),
)("DARC log deadlines match DARC's own published dates: %s", (cid, published) => {
  const c = byId(cid);
  expect(c.log_deadline_days, cid).toBe(7);
  const got = expand(c, 2026).map((o) => isoDate(o.log_due!));
  expect(got, cid).toEqual(published.map(([y, m, d]) => D(y, m, d)));
});

test("DARC WAE RTTY is the second full weekend, not the second weekend", () => {
  // DARC writes 'zweites Wochenende', without 'volles'. November 2026 is the
  // year that separates the readings: 1 November is a Sunday whose Saturday
  // belongs to October, so counting weekends from it gives 7-8 November. DARC
  // publishes 14-15, which is the second FULL weekend.
  expect(weekdayOf(new Date(at(2026, 11, 1)))).toBe(6); // an orphan Sunday
  expect(isoDate(fullWeekendsInMonth(2026, 11)[1])).toBe(D(2026, 11, 14));
  expect(isoDate(expand(byId("wae-dx-rtty"), 2026)[0].start!)).toBe(D(2026, 11, 14));
});

test("WAE CW deadline follows the interval DARC states twice", () => {
  // DARC contradicts itself on this one leg. Rule 13 of the WAE rules and the
  // general contest rules both say seven days; seven days is 16 August 2026,
  // which is what DARC's own contest calendar prints. The per-leg line on the
  // rules page says 17.08.2026. The interval wins because it is stated twice
  // and because it reproduces the SSB and RTTY legs' printed instants exactly.
  const c = byId("wae-dx-cw");
  expect(isoDate(expand(c, 2026)[0].log_due!)).toBe(D(2026, 8, 16));
  expect(c.note ?? "").toContain("17.08.2026"); // the losing statement stays recorded
});

test("DARC quarterly series interleave on the same weekday", () => {
  // RTTY takes the first month of each quarter and FT4 the second, both on the
  // second Tuesday. Encoded as one record each, so the two months lists must
  // stay disjoint or a leg would be claimed twice.
  const rtty = byId("darc-rtty-kurzcontest").recurrence;
  const ft4 = byId("darc-ft4").recurrence;
  expect(rtty.months).toEqual([1, 4, 7, 10]);
  expect(ft4.months).toEqual([2, 5, 8, 11]);
  expect(rtty.months!.filter((m) => ft4.months!.includes(m))).toEqual([]);
  expect(rtty.weekday).toBe(1); // Tuesday
  expect(ft4.weekday).toBe(1);
  expect(rtty.n).toBe(2);
  expect(ft4.n).toBe(2);
  for (const cid of ["darc-rtty-kurzcontest", "darc-ft4"]) {
    for (const o of expand(byId(cid), 2026)) {
      expect(weekdayOf(o.start!), cid).toBe(1);
      expect(o.start!.getUTCDate(), cid).toBeGreaterThanOrEqual(8); // the second
      expect(o.start!.getUTCDate(), cid).toBeLessThanOrEqual(14); // ...Tuesday
    }
  }
});

test("DARC Xmas is a calendar date and ignores the weekday", () => {
  // 26 December whatever day it falls on -- 2026 is a Saturday, 2027 a Sunday,
  // 2028 a Tuesday. A weekday rule fitted to any one of them would be wrong the
  // next year.
  const c = byId("darc-xmas");
  expect(c.recurrence).toEqual({ type: "fixed_date", month: 12, day: 26 });
  for (const [y, weekday] of [[2026, 5], [2027, 6], [2028, 1]] as const) {
    const o = expand(c, y)[0];
    expect(isoDate(o.start!)).toBe(D(y, 12, 26));
    expect(weekdayOf(o.start!)).toBe(weekday);
  }
});

test("DARC 10m rule comes from DARC's superseded Ausschreibung", () => {
  // The current Ausschreibung prints '11.01.26' and no rule; the pre-2023 one
  // DARC keeps below it on the same page says 'Zweiter Sonntag im Januar'. That
  // is where the recurrence comes from, and the record says so rather than
  // letting a rule appear to have been fitted to a single date.
  const c = byId("darc-10m");
  expect(c.recurrence).toEqual({
    type: "nth_weekday",
    month: 1,
    n: 2,
    weekday: 6,
  });
  expect(String(c.source_note)).toContain("bis 2023");
  expect(isoDate(expand(c, 2026)[0].start!)).toBe(D(2026, 1, 11));
});

test("DARC records all carry the sponsor string the registry joins on", () => {
  // DARC runs these under one contest department; the registry's DARC entry
  // lists exactly one catalog_sponsors string, and an unregistered sponsor is
  // only detectable through that join.
  const darc = catalog.filter((c) => c.id in DARC_PUBLISHED);
  expect(darc).toHaveLength(8);
  expect(new Set(darc.map((c) => c.sponsor))).toEqual(new Set(["DARC"]));
  expect(new Set(darc.map((c) => c.country))).toEqual(new Set(["DE"]));
});

// ---------------------------------------------------------------------------
// Counting backwards past "last"
//
// `n` used to mean "the nth from the front", with -1 special-cased to mean the
// last. BFRA's LZ DX Contest is the rule that needed more: "the weekend before
// the last full weekend of November", which BFRA states as a rule and not as an
// annual announcement, because the weekend it names is defined by CQ WW CW
// sitting on the last one. So n <= -1 now counts back from the end.
//
// The risk that comes with it is n=0, which is a position in neither direction.
// Read as "the first" it silently shifts a contest; read as "no anchors this
// year" it silently empties one. It raises instead, and because
// NoAnchorsThisYear is an Error, `monthly_nth_weekday`'s skip-a-short-month
// catch had to be narrowed so it does not swallow that.
// ---------------------------------------------------------------------------

/** A minimal record for exercising a rule with no catalog entry behind it. */
const synthetic = (rule: Record<string, unknown>): Contest =>
  ({
    id: "synthetic",
    name: "Synthetic",
    recurrence: rule,
    start: { day_offset: 0, time: "0000" },
    end: { day_offset: 0, time: "0100" },
  }) as unknown as Contest;

test("nth counts backwards past last", () => {
  // November 2025 has five full weekends: 1, 8, 15, 22 and 29 November. -1 is
  // the last, -2 the one before it, -3 the one before that.
  expect(fullWeekendsInMonth(2025, 11).map(isoDate)).toEqual([
    D(2025, 11, 1),
    D(2025, 11, 8),
    D(2025, 11, 15),
    D(2025, 11, 22),
    D(2025, 11, 29),
  ]);
  for (const [n, expected] of [[-1, 29], [-2, 22], [-3, 15]] as const) {
    const got = expand(synthetic({ type: "nth_full_weekend", month: 11, n }), 2025);
    expect(isoDate(got[0].start!), String(n)).toBe(D(2025, 11, expected));
  }
});

test("nth counting back past the start is an empty year not an error", () => {
  // Asking for the sixth-from-last of five is the same kind of nothing as a
  // fifth Monday in a four-Monday month: the year has no such date, and expand
  // returns nothing rather than throwing.
  const rule = { type: "nth_full_weekend", month: 11, n: -6 };
  expect(expand(synthetic(rule), 2025)).toEqual([]);
});

test("nth rejects zero as a malformed rule", () => {
  // n=0 is a catalog typo, not a date that does not exist. Read as "the first"
  // it moves a contest a week; read as NoAnchorsThisYear it drops the contest
  // from the calendar without a word. Neither is acceptable, so it throws --
  // and the error must not be NoAnchorsThisYear, or callers that legitimately
  // swallow that would swallow this too.
  const rule = { type: "nth_weekday", month: 11, n: 0, weekday: 5 };
  let caught: unknown;
  try {
    expand(synthetic(rule), 2025);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(NoAnchorsThisYear);
  expect(String((caught as Error).message)).toContain("n=0");
});

test("monthly_nth_weekday skips short months but not malformed rules", () => {
  // A "fifth Monday" rule simply has no date in a month with four, and skipping
  // those is the whole point of the catch inside monthly_nth_weekday. It is
  // narrowed to NoAnchorsThisYear so a n=0 rule inside the same loop still
  // throws instead of quietly producing an empty year.
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const fifths = expand(
    synthetic({ type: "monthly_nth_weekday", n: 5, weekday: 0, months }),
    2026,
  );
  expect(fifths.length).toBeGreaterThan(0);
  expect(fifths.length).toBeLessThan(12);
  for (const o of fifths) {
    expect(o.start!.getUTCDate()).toBeGreaterThan(28);
    expect(weekdayOf(o.start!)).toBe(0);
  }

  let caught: unknown;
  try {
    expand(
      synthetic({ type: "monthly_nth_weekday", n: 0, weekday: 0, months }),
      2026,
    );
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(NoAnchorsThisYear);
});

// ---------------------------------------------------------------------------
// Sponsor validation -- the remaining Tier 2 European societies
//
// USKA, OeVSV, MRASZ, BFRA, FRR, SRS, HRS, LRAL, ERAU, LRMD, SRR and UARL. Each
// rule is quoted in the sponsor's own language on the record; the dates below
// are the sponsor's too, published separately from that wording -- a KW-Contest
// date page, a year printed inside the rules themselves, an archive of past
// editions, a society calendar. NRAU is absent on purpose: it is blocked at
// source and encodes nothing. See data/sources.md.
//
// Session records emit one occurrence per session, so start dates are deduped.
// ---------------------------------------------------------------------------

const TIER2B_PUBLISHED: Record<
  string,
  [string, Record<number, [number, number, number][]>]
> = {
  "uska-helvetia": [
    "Letztes volles Wochenende im April, Samstag 13:00 UTC bis Sonntag 12:59 UTC",
    { 2026: [[2026, 4, 25]], 2027: [[2027, 4, 24]] },
  ],
  "uska-field-day-cw": [
    "CW: Erstes volles Wochenende im Juni",
    { 2026: [[2026, 6, 6]], 2027: [[2027, 6, 5]] },
  ],
  "uska-field-day-ssb": [
    "SSB: Erstes volles Wochenende im September",
    { 2026: [[2026, 9, 5]] },
  ],
  "uska-nmd": [
    "Dritter Sonntag im Juli, 06:00 UTC bis 09:59 UTC",
    { 2026: [[2026, 7, 19]] },
  ],
  "uska-weihnachtswettbewerb-ssb": [
    "SSB: Erster Samstag im Dezember, 07:00 bis 09:59 UTC",
    { 2026: [[2026, 12, 5]] },
  ],
  "uska-weihnachtswettbewerb-cw": [
    "CW: Zweiter Samstag im Dezember, 07:00 bis 09:59 UTC",
    { 2026: [[2026, 12, 12]] },
  ],
  "oevsv-aoee-80-40": ["2. TERMIN: 1. Mai 2026", { 2026: [[2026, 5, 1]] }],
  "oevsv-aoec-160m": [
    "Jeweils am dritten vollen Wochenende im NOVEMBER",
    { 2025: [[2025, 11, 15]], 2026: [[2026, 11, 21]] },
  ],
  "mrasz-ha-dx": ["every year 3rd full weekend of January", { 2026: [[2026, 1, 17]] }],
  "mrasz-yl-om": [
    "minden evben marcius 8-hoz legkozelebb eso hetvegen",
    { 2026: [[2026, 3, 8]] },
  ],
  "mrasz-rfwd-hf": [
    "evente aprilis 18.-an 16.00 UT-tol 16.59 UT-ig",
    { 2026: [[2026, 4, 18]] },
  ],
  "bfra-lz-dx": [
    "The weekend before the last full weekend of November",
    { 2025: [[2025, 11, 22]], 2026: [[2026, 11, 21]] },
  ],
  "frr-yo-dx-hf": [
    "Al patrulea weekend intreg al lunii August",
    { 2026: [[2026, 8, 22]] },
  ],
  "hrs-9a-dx": [
    "3rd full weekend in December",
    { 2025: [[2025, 12, 20]], 2026: [[2026, 12, 19]] },
  ],
  "srs-tesla-memorial-hf-cw": [
    "odrzavace se svake godine drugog vikenda u martu",
    {
      2019: [[2019, 3, 9]],
      2020: [[2020, 3, 14]],
      2021: [[2021, 3, 13]],
      2022: [[2022, 3, 12]],
      2023: [[2023, 3, 11]],
      2024: [[2024, 3, 9]],
      2025: [[2025, 3, 8]],
      2026: [[2026, 3, 14]],
    },
  ],
  "lral-18-november-80m": [
    "18. novembri no 08.00-11.14 pec vieteja laika",
    { 2026: [[2026, 11, 18]] },
  ],
  "lral-4-may-80m": [
    "4. maija no 07.00-10.14 pec vieteja laika",
    { 2026: [[2026, 5, 4]] },
  ],
  "erau-es-open": [
    "3rd SATURDAY in APRIL: 18. APRIL 2026 05.00 - 08.59 UTC",
    { 2026: [[2026, 4, 18]] },
  ],
  "erau-es-ll-kv": [
    "9-s etapis laupaeva hommikuti vastavalt ERAU kalenderplaanile",
    {
      2026: [
        [2026, 1, 3],
        [2026, 2, 14],
        [2026, 3, 7],
        [2026, 4, 4],
        [2026, 5, 2],
        [2026, 9, 5],
        [2026, 10, 3],
        [2026, 11, 7],
        [2026, 12, 5],
      ],
    },
  ],
  "lrmd-vytautas-magnus": [
    "kiekvienais metais pirma sekmadieni po Nauju metu, 0700-0759 UTC",
    { 2026: [[2026, 1, 4]] },
  ],
  "lrmd-wal": [
    "2026 m. birzelio 06 d. (sestadieni), 06:00-08:59 UTC",
    { 2026: [[2026, 6, 6]] },
  ],
  "srr-russian-dx": [
    "s 12:00 UTC 20 marta po 11:59 UTC 21 marta 2027 goda",
    { 2027: [[2027, 3, 20]] },
  ],
  "uarl-champ-rtty": [
    "Teletaypnyy Chempionat Ukrayiny na KKH - 7 bereznya 2026 r.",
    { 2026: [[2026, 3, 7]] },
  ],
  "uarl-champ-cw": [
    "Telehrafnyy Chempionat Ukrayiny na KKH - 15 bereznya 2026 r.",
    { 2026: [[2026, 3, 15]] },
  ],
  "uarl-champ-ssb": [
    "Telefonnyy Chempionat Ukrayiny na KKH - 22 bereznya 2026 r.",
    { 2026: [[2026, 3, 22]] },
  ],
  "uarl-lp-cup-cw": [
    "bude provedeno 10 travnya 2026r. z 16:00 do 17:59 UT",
    { 2026: [[2026, 5, 10]] },
  ],
  // REP prints six years of dates beside the rule -- the longest independent
  // table any sponsor in this catalog publishes -- so all six are checked.
  "rep-portugal-day-hf": [
    "each year on the second weekend of June",
    {
      2025: [[2025, 6, 14]],
      2026: [[2026, 6, 13]],
      2027: [[2027, 6, 12]],
      2028: [[2028, 6, 10]],
      2029: [[2029, 6, 9]],
      2030: [[2030, 6, 8]],
    },
  ],
  "rep-portugal-day-vhf-uhf": [
    "organiza no 10 de junho (feriado) de cada ano",
    { 2025: [[2025, 6, 10]], 2026: [[2026, 6, 10]] },
  ],
  "rep-50mhz": [
    "Primeiro fim de semana completo de agosto",
    { 2025: [[2025, 8, 2]] },
  ],
};

/** Unique start dates, in order. A sessions record yields one per session. */
const startDates = (cid: string, year: number): string[] => {
  const seen: string[] = [];
  for (const o of expand(byId(cid), year)) {
    const d = isoDate(o.start!);
    if (!seen.includes(d)) seen.push(d);
  }
  return seen;
};

test.each(
  Object.entries(TIER2B_PUBLISHED)
    .sort()
    .flatMap(([cid, [rule, years]]) =>
      Object.entries(years)
        .sort()
        .map(([year, dates]) => [cid, rule, Number(year), dates] as const),
    ),
)(
  "Tier 2 contests match their sponsors' published dates: %s %s %d",
  (cid, rule, year, published) => {
    expect(startDates(cid, year), `${cid} ${year}: rule '${rule}'`).toEqual(
      published.map(([y, m, d]) => D(y, m, d)),
    );
  },
);

test("Tesla Memorial second weekend means second full weekend", () => {
  // SRS says "odrzavace se svake godine drugog vikenda u martu" -- every year,
  // the second weekend in March -- and publishes eight editions. 2020 is the
  // year that separates the readings: 1 March 2020 was a Sunday whose Saturday
  // belonged to February, so counting weekends by their Sunday gives 7-8 March.
  // SRS published 14-15, which is the second FULL weekend.
  expect(weekdayOf(new Date(at(2020, 3, 1)))).toBe(6); // an orphan Sunday
  expect(isoDate(fullWeekendsInMonth(2020, 3)[1])).toBe(D(2020, 3, 14));
  expect(startDates("srs-tesla-memorial-hf-cw", 2020)).toEqual([D(2020, 3, 14)]);
  // ...and the eight published editions all reproduce, which is what makes it
  // a rule rather than eight coincidences.
  expect(Object.keys(TIER2B_PUBLISHED["srs-tesla-memorial-hf-cw"][1])).toHaveLength(8);
});

test("LZ DX counts back two weekends because CQ WW CW takes the last", () => {
  // BFRA anchors its date to another sponsor's contest: "The weekend before the
  // last full weekend of November (the weekend before CQWW CW contest weekend)".
  // That is n=-2, and it is the record that made the engine count backwards past
  // "last". November 2025 has five full weekends and BFRA published 22-23.
  expect(fullWeekendsInMonth(2025, 11)).toHaveLength(5);
  expect(byId("bfra-lz-dx").recurrence).toEqual({
    type: "nth_full_weekend",
    month: 11,
    n: -2,
  });
  expect(startDates("bfra-lz-dx", 2025)).toEqual([D(2025, 11, 22)]);
  expect(isoDate(fullWeekendsInMonth(2025, 11).at(-1)!)).toBe(D(2025, 11, 29)); // CQ WW CW
});

test("YO DX is the fourth full weekend not the last", () => {
  // August 2026 separates the readings: 1 August is a Saturday, so the month has
  // five full weekends and the fourth (22-23) is not the last (29-30). The
  // current yodx.ro rules and FRR's own 2026 announcement both say the fourth.
  // An older hamradio.ro PDF says "Ultimul weekend intreg" -- the last -- and
  // that statement stays on the record rather than being reconciled away.
  const weekends = fullWeekendsInMonth(2026, 8);
  expect(weekends).toHaveLength(5);
  expect(isoDate(weekends[3])).toBe(D(2026, 8, 22));
  expect(isoDate(weekends.at(-1)!)).toBe(D(2026, 8, 29));
  expect(startDates("frr-yo-dx-hf", 2026)).toEqual([D(2026, 8, 22)]);
  expect(byId("frr-yo-dx-hf").note ?? "").toContain("Ultimul weekend intreg");
});

test("AOEC third full weekend survives an orphan Sunday", () => {
  // OeVSV states the rule twice, in German and in English, and prints 15
  // November 2025 for itself. 2026 is the harder year: 1 November is a Sunday
  // whose Saturday belongs to October, so the full weekends start on the 7th and
  // the third is the 21st.
  expect(weekdayOf(new Date(at(2026, 11, 1)))).toBe(6); // an orphan Sunday
  expect(isoDate(fullWeekendsInMonth(2026, 11)[0])).toBe(D(2026, 11, 7));
  expect(startDates("oevsv-aoec-160m", 2025)).toEqual([D(2025, 11, 15)]);
  expect(startDates("oevsv-aoec-160m", 2026)).toEqual([D(2026, 11, 21)]);
});

test("USKA forward dates come from USKA's own KW-Contest page", () => {
  // USKA's KW-Contest page prints the year's dates separately from the
  // Reglemente, and states two 2027 dates in prose: "Der Helvetia Contest findet
  // am 24. - 25. April 2027 ... statt" and "Der Field Day in CW findet am 5. -
  // 6. Juni 2027 ... statt". Those are forward statements rather than calendar
  // rows, so they test the rule a year past every other date USKA publishes.
  expect(startDates("uska-helvetia", 2027)).toEqual([D(2027, 4, 24)]);
  expect(startDates("uska-field-day-cw", 2027)).toEqual([D(2027, 6, 5)]);
});

test("Weihnachtswettbewerb sessions leave the gap hour out", () => {
  // Each Saturday is a phone-or-CW morning and then a separate digital hour, and
  // the hour between them is not part of the contest. Two sessions rather than
  // one 07:00-10:59 span, or the calendar would claim an hour USKA does not run.
  for (const cid of [
    "uska-weihnachtswettbewerb-ssb",
    "uska-weihnachtswettbewerb-cw",
  ]) {
    const occs = expand(byId(cid), 2026);
    expect(occs, cid).toHaveLength(2);
    expect(
      occs.map((o) => [o.start!.getUTCHours(), o.start!.getUTCMinutes()]),
      cid,
    ).toEqual([[7, 0], [10, 0]]);
    expect(
      occs.map((o) => [o.end!.getUTCHours(), o.end!.getUTCMinutes()]),
      cid,
    ).toEqual([[9, 59], [10, 59]]);
  }
});

test("Weihnachtswettbewerb carries no deadline because USKA states none", () => {
  // Three of USKA's four KW Reglemente say "Die Logs sind innert 8 Tagen ...
  // einzureichen". The Weihnachtswettbewerb's says nothing at all. Borrowing the
  // interval from its siblings would be this catalog inventing a deadline, so
  // none is encoded and the silence is recorded on the record.
  for (const cid of [
    "uska-weihnachtswettbewerb-ssb",
    "uska-weihnachtswettbewerb-cw",
  ]) {
    const c = byId(cid);
    expect("log_deadline_days" in c, cid).toBe(false);
    expect(c.note ?? "", cid).toContain("no log deadline");
  }
  for (const cid of [
    "uska-helvetia",
    "uska-field-day-cw",
    "uska-field-day-ssb",
    "uska-nmd",
  ]) {
    expect(byId(cid).log_deadline_days, cid).toBe(8);
  }
});

test("YL-OM falls on the Sunday nearest 8 March", () => {
  // MRASZ ties the date to International Women's Day: "minden evben marcius
  // 8-hoz legkozelebb eso hetvegen", run on the Sunday. 2026 is the only year
  // MRASZ confirms independently, and in it 8 March is itself a Sunday, so the
  // rule and the date agree trivially. The caveat is on the record; what is
  // asserted here is that the rule is nearest-Sunday and not a hard 8 March.
  const c = byId("mrasz-yl-om");
  expect(c.recurrence).toEqual({
    type: "nearest_weekday",
    month: 3,
    day: 8,
    weekday: 6,
  });
  expect(weekdayOf(new Date(at(2026, 3, 8)))).toBe(6);
  expect(startDates("mrasz-yl-om", 2026)).toEqual([D(2026, 3, 8)]);
  // 8 March 2027 is a Monday, so the nearest Sunday is behind it, not ahead.
  expect(weekdayOf(new Date(at(2027, 3, 8)))).toBe(0);
  expect(startDates("mrasz-yl-om", 2027)).toEqual([D(2027, 3, 7)]);
  expect(c.note ?? "").toContain("Only that one year is independently confirmed");
});

test("VMC first Sunday reading is recorded as a caveat", () => {
  // LRMD writes it both ways on the same page: "pirma sekmadieni po Nauju metu"
  // and "the first Sunday after New Year's Day". The readings diverge only when
  // 1 January is itself a Sunday, and LRMD has published no such year, so the
  // first-Sunday-in-January reading is encoded and the divergence is recorded
  // rather than resolved by picking a winner nobody has confirmed.
  const c = byId("lrmd-vytautas-magnus");
  expect(c.recurrence).toEqual({ type: "nth_weekday", month: 1, n: 1, weekday: 6 });
  expect(startDates("lrmd-vytautas-magnus", 2026)).toEqual([D(2026, 1, 4)]);
  expect(c.note ?? "").toContain("CAVEAT");
  expect(c.note ?? "").toContain("1 January is itself a Sunday");
  // 2034 is such a year: the two readings give 1 January and 8 January.
  expect(weekdayOf(new Date(at(2034, 1, 1)))).toBe(6);
  expect(startDates("lrmd-vytautas-magnus", 2034)).toEqual([D(2034, 1, 1)]);
});

test("ES LL KV Tallinn wall clock reproduces ERAU's own UTC calendar", () => {
  // ERAU's rules give the hour in Estonian time -- "Etappide algus on 10:00 Eesti
  // aja (EA) jargi" -- and its 2026 calendar prints the same nine stages in UTC:
  // 08:00-08:59 for stages 1, 2, 3, 8 and 9, and 07:00-07:59 for 4, 5, 6 and 7.
  // That split IS the DST boundary, and it is the second source: get the zone
  // handling wrong in either direction and four rows stop matching.
  const c = byId("erau-es-ll-kv");
  expect(c.timezone).toBe("Europe/Tallinn");
  const occs = expand(c, 2026);
  expect(occs).toHaveLength(9);
  expect(occs.map((o) => o.start!.getUTCHours())).toEqual([8, 8, 8, 7, 7, 7, 7, 8, 8]);
  expect(
    new Set(occs.map((o) => `${o.end!.getUTCHours()}:${o.end!.getUTCMinutes()}`)),
  ).toEqual(new Set(["8:59", "7:59"]));
});

test("LRAL rounds are Riga wall clock", () => {
  // LRAL states the rounds "pec vieteja laika" -- in local time -- and never in
  // UTC, so the same 08.00 start is a different instant in November than the
  // 07.00 start is in May. 18 November 2026 is EET (UTC+2) and 4 May 2026 is
  // EEST (UTC+3).
  expect(byId("lral-18-november-80m").timezone).toBe("Europe/Riga");
  const nov = expand(byId("lral-18-november-80m"), 2026);
  expect(nov.map((o) => o.start!.getUTCHours())).toEqual([6, 8]); // 08.00 and 10.15 local
  expect(nov[1].start!.getUTCMinutes()).toBe(15);

  const may = expand(byId("lral-4-may-80m"), 2026);
  expect(may.map((o) => o.start!.getUTCHours())).toEqual([4, 6]); // 07.00 and 09.15 local
  expect(may[1].start!.getUTCMinutes()).toBe(15);
});

test("UARL championships are Kyiv wall clock and the LP Cup is not", () => {
  // UARL writes its championships in Kyiv time ("z 19:00 do 19:29 kyyivskoho
  // chasu") and its Low Power Cup in UT with Kyiv time in brackets ("z 16:00 do
  // 17:59 UT (z 19:00 kyyivskoho chasu do 20:59)"). Same local hour, two
  // different UTC instants, because March is EET and May is EEST -- and only one
  // of the two records is wall-clocked. Encoding both the same way would move
  // one of them by an hour.
  for (const cid of ["uarl-champ-rtty", "uarl-champ-cw", "uarl-champ-ssb"]) {
    const c = byId(cid);
    expect(c.timezone, cid).toBe("Europe/Kyiv");
    const o = expand(c, 2026)[0];
    expect([o.start!.getUTCHours(), o.end!.getUTCHours()], cid).toEqual([17, 18]);
    expect(o.end!.getUTCMinutes(), cid).toBe(59);
  }

  const cup = byId("uarl-lp-cup-cw");
  expect("timezone" in cup).toBe(false);
  const o = expand(cup, 2026)[0];
  expect([
    o.start!.getUTCHours(),
    o.end!.getUTCHours(),
    o.end!.getUTCMinutes(),
  ]).toEqual([16, 17, 59]);
});

test("RDXC deadline lands on the date SRR prints", () => {
  // SRR states the interval and the instant in one sentence: reports are taken
  // "v techenii 14 dney posle okonchaniya sorevnovaniy (po 04.04.2027 goda
  // vklyuchitelno)". The contest ends 11:59 UTC on 21 March 2027, and fourteen
  // days is 4 April -- so the sponsor's own arithmetic is what checks ours.
  const c = byId("srr-russian-dx");
  expect(c.log_deadline_days).toBe(14);
  const o = expand(c, 2027)[0];
  expect(isoDate(o.end!)).toBe(D(2027, 3, 21));
  expect(isoDate(o.log_due!)).toBe(D(2027, 4, 4));
});

test("LP Cup deadline lands on the date UARL prints", () => {
  // Same shape, from UARL: "7 dib pislya zakinchennya zmahan. Tobto, 17 travnya
  // 2026 roku ostanniy den." Seven days from 10 May is 17 May.
  const c = byId("uarl-lp-cup-cw");
  expect(c.log_deadline_days).toBe(7);
  expect(isoDate(expand(c, 2026)[0].log_due!)).toBe(D(2026, 5, 17));
});

test("ES Open is worldwide with a note not two_sided", () => {
  // ERAU's rule is asymmetric -- "ESTONIAN STATIONS CAN WORK ALL THE STATIONS WHO
  // PARTICIPATE ... NON-ES STATIONS CAN WORK ONLY ES STATIONS" -- but that is
  // about who counts, not about who may enter. two_sided needs both sides
  // enumerated and tells a station in neither that it cannot enter, which is
  // false here. Same call as DARC's WAE and WAG and JARL's All Asian.
  const elig = byId("erau-es-open").eligibility!;
  expect(elig.scope).toBe("worldwide");
  expect(String(elig.note)).toContain("NON-ES STATIONS CAN WORK ONLY ES STATIONS");
  for (const entity of ["ES", "K", "JA", "VK"]) {
    expect(eligibilityFor(byId("erau-es-open"), entity).can_enter, entity).toBe(true);
  }
});

test("Tier 2 records carry the sponsor strings the registry joins on", () => {
  // Three Baltic societies share one registry entry but are three separate
  // sponsors in the catalog, because an LV record is not an EE one. The join is
  // the only thing that makes an unregistered sponsor detectable, so it is
  // asserted here rather than left to the coverage test to discover.
  const records = catalog.filter((c) => c.id in TIER2B_PUBLISHED);
  expect(records).toHaveLength(29);
  expect(new Set(records.map((c) => c.sponsor))).toEqual(
    new Set([
      "USKA",
      "ÖVSV",
      "MRASZ",
      "BFRA",
      "FRR",
      "SRS",
      "HRS",
      "LRAL",
      "ERAU",
      "LRMD",
      "SRR",
      "UARL",
      "REP",
    ]),
  );
  expect(new Set(records.map((c) => c.country))).toEqual(
    new Set([
      "CH", "AT", "HU", "BG", "RO", "RS", "HR", "LV", "EE", "LT", "RU", "UA", "PT",
    ]),
  );
  const owner = registryOwner(loadRegistry() as Record<string, any>);
  for (const c of records) {
    expect(owner.get(c.sponsor ?? "")?.split("|")[0], c.id).toBe(
      "tier_2_european_societies",
    );
  }
});

test("Portugal Day HF runs noon to noon", () => {
  // The date table above checks six years of REP's own published dates. This
  // checks the clock, which a table of dates cannot: "Time: 12:00 UTC to 11:59
  // UTC", a minute short of 24 hours.
  const [o] = expand(byId("rep-portugal-day-hf"), 2026);
  expect([o.start!.getUTCHours(), o.start!.getUTCMinutes()]).toEqual([12, 0]);
  expect([o.end!.getUTCHours(), o.end!.getUTCMinutes()]).toEqual([11, 59]);
  expect(isoDate(o.start!)).toBe(D(2026, 6, 13));
  expect(isoDate(o.end!)).toBe(D(2026, 6, 14));
});

test("REP VHF/UHF follows the holiday and not the second Saturday", () => {
  // REP publishes two live and contradictory rules for this one contest.
  // concursos.rep.pt -- the portal rep.pt's own front page links to -- says
  // "no 10 de junho (feriado) de cada ano". portugaldaycontest.rep.pt still
  // says "no 2 Sabado do mes de junho de cada ano, (8 de Junho de 2024)". They
  // give different days in every year where 10 June is not the second Saturday.
  //
  // The fixed date is encoded because it is the one REP ran: its own "Logs
  // recebidos - VHF-UHF 2025" post is dated 10 June 2025, a TUESDAY, while the
  // second Saturday of June 2025 was the 14th. This test is the decision, so
  // that reverting it means arguing with the evidence rather than editing JSON.
  const [o] = expand(byId("rep-portugal-day-vhf-uhf"), 2025);
  expect(isoDate(o.start!)).toBe(D(2025, 6, 10));
  expect(o.start!.getUTCDay()).toBe(2); // Tuesday
  expect(isoDate(o.start!)).not.toBe(D(2025, 6, 14)); // the superseded page

  for (const year of [2026, 2027, 2028]) {
    const [p] = expand(byId("rep-portugal-day-vhf-uhf"), year);
    expect(isoDate(p.start!)).toBe(D(year, 6, 10));
    expect([p.start!.getUTCHours(), p.end!.getUTCHours()]).toEqual([12, 18]);
  }
});

test("REP 50 MHz takes the first complete weekend of August", () => {
  // "Primeiro fim de semana completo de agosto, desde as 14:00 UTC de sabado
  // as 14:00 UTC de domingo. 2025: o concurso ocorre nos dias 2 e 3 de agosto."
  //
  // Note what this does NOT prove. For the FIRST weekend of a 31-day month the
  // full-weekend reading and "first Saturday" agree in every year, because the
  // only Saturday that cannot open a full weekend is one falling on the last
  // day of the month. The type is REP's own wording, not a date-changing
  // choice, and the note on the record says so.
  const [o] = expand(byId("rep-50mhz"), 2025);
  expect(isoDate(o.start!)).toBe(D(2025, 8, 2));
  expect(isoDate(o.end!)).toBe(D(2025, 8, 3));
  expect([o.start!.getUTCHours(), o.end!.getUTCHours()]).toEqual([14, 14]);
  expect(o.duration_hours).toBe(24);
});

test("REP deadlines are encoded only where the sponsor states a span", () => {
  // All three REP contests state a log deadline and only one of them is a span.
  //
  // The VHF/UHF contest runs on a fixed date (10 June) and its logs are due on
  // a fixed date (20 June), so ten days is exact in every year. The other two
  // state a calendar deadline against a moving contest -- "no later than June
  // 30th of the same year", "ate as 23:59 (UTC) do dia 8 de Agosto de 2025" --
  // which is a different number of days every year, so they carry none rather
  // than a number REP never wrote. Same rule as JARL All Asian.
  expect(byId("rep-portugal-day-vhf-uhf").log_deadline_days).toBe(10);
  for (const cid of ["rep-portugal-day-hf", "rep-50mhz"]) {
    expect("log_deadline_days" in byId(cid), cid).toBe(false);
  }
});

test("RCA holds only the editions Argentina published", () => {
  // Radio Club Argentino states one dated running per contest and no
  // recurrence, so both records are `manual` and both currently sit in the
  // past: 18 October 2025 for the 40 m contest and 13 June 2026 for the 80 m
  // one. Neither puts anything on a forward calendar, and that is correct --
  // fitting an ordinal to a single date would be a rule RCA has not written.
  //
  // South America is the catalog's thinnest region, which makes this exactly
  // the place where inventing a rule would be most tempting and least
  // defensible.
  for (const [cid, year, day] of [
    ["rca-nacional-40m", 2025, D(2025, 10, 18)],
    ["rca-nacional-80m", 2026, D(2026, 6, 13)],
  ] as const) {
    const c = byId(cid);
    expect(c.recurrence.type, cid).toBe("manual");
    const [o] = expand(c, year);
    expect(isoDate(o.start!), cid).toBe(day);
    expect(expand(c, year + 1), cid).toEqual([]);
  }

  // RCA restricts entry to Argentina and its neighbours, which is a real
  // entity list rather than a formality, so a K station cannot enter.
  expect(eligibilityFor(byId("rca-nacional-80m"), "K").can_enter).toBe(false);
  expect(eligibilityFor(byId("rca-nacional-80m"), "LU").can_enter).toBe(true);
});

// ---------------------------------------------------------------------------
// JARL's Japanese-language contests.
//
// These four were deferred on 2026-08-17 with the note "they are real contests
// and a future pass should read the Japanese pages rather than guess". Read
// 2026-08-19. JARL states each recurrence in its 規約 and then prints the
// year's dates separately at the head of the same page, which is the check.
// ---------------------------------------------------------------------------

const JARL_JP_PUBLISHED: Record<string, [string, [number, number, number]]> = {
  "jarl-all-ja": [
    "毎年4月の最終日曜日の前日の21時00分から最終日曜日の21時00分（JST）まで",
    [2026, 4, 25],
  ],
  "jarl-6m-and-down": [
    "毎年7月の第1土曜日21時00分～翌日の15時00分（JST）",
    [2026, 7, 4],
  ],
  "jarl-field-day": [
    "毎年8月の第1土曜日の21時00分から翌日の15時00分（JST）まで",
    [2026, 8, 1],
  ],
  "jarl-acag": [
    "毎年10月第2月曜日の前々日の21時00分から前日の21時00分（JST）まで",
    [2026, 10, 10],
  ],
};

test.each(
  Object.entries(JARL_JP_PUBLISHED)
    .sort()
    .map(([cid, [rule, d]]) => [cid, rule, d] as const),
)("JARL Japanese contests match JARL's published dates: %s", (cid, rule, published) => {
  const [o] = expand(byId(cid), 2026);
  expect(isoDate(o.start!), `${cid}: rule '${rule}'`).toBe(
    D(published[0], published[1], published[2]),
  );
});

test("JARL states its times in Tokyo and they never shift", () => {
  // JARL writes 21時00分（JST）, so the records carry Asia/Tokyo wall clock
  // rather than a UTC time converted by hand. Japan has not observed daylight
  // saving since 1952, so the resolved instant is 1200Z every year -- worth
  // pinning precisely BECAUSE it never moves: if it ever does, something has
  // gone wrong in the zone layer rather than at JARL.
  for (const year of [2026, 2027, 2030]) {
    for (const cid of Object.keys(JARL_JP_PUBLISHED)) {
      const [o] = expand(byId(cid), year);
      expect(o.start_wall!.getUTCHours(), cid).toBe(21);
      expect(o.start!.getUTCHours(), `${cid} ${year}: 2100 JST is 1200Z`).toBe(12);
    }
  }
});

test("ACAG hangs off Japan's Sports Day and counts backwards", () => {
  // 全市全郡 is the only rule in the catalog anchored on a public holiday and
  // counted backwards: from 21:00 two days before the second Monday of October
  // until 21:00 the day before it. The second Monday is Japan's Sports Day.
  //
  // It is NOT "the second full weekend of October", and the difference is not
  // academic: the two readings agree in 2026 and 2027 and then diverge by a
  // whole week in 2028 and 2029. A calendar that guessed the weekend reading
  // would send someone to the radio seven days late, twice.
  const expected: [number, string][] = [
    [2026, D(2026, 10, 10)],
    [2027, D(2027, 10, 9)],
    [2028, D(2028, 10, 7)],   // a full-weekend reading says the 14th
    [2029, D(2029, 10, 6)],   // ...and the 13th
    [2030, D(2030, 10, 12)],
  ];
  for (const [year, day] of expected) {
    const [o] = expand(byId("jarl-acag"), year);
    expect(isoDate(o.start!), String(year)).toBe(day);
    expect(o.start!.getUTCDay(), String(year)).toBe(6); // Saturday
    expect(o.end!.getUTCDay(), String(year)).toBe(0);   // Sunday
  }

  for (const year of [2028, 2029]) {
    const weekend = resolveAnchors({ type: "nth_full_weekend", month: 10, n: 2 }, year)[0];
    expect(isoDate(expand(byId("jarl-acag"), year)[0].start!), String(year))
      .not.toBe(isoDate(weekend));
  }
});

test("ALL JA follows JARL's wording though nothing turns on it", () => {
  // The opposite case, recorded so the distinction above is not overclaimed.
  // ALL JA is "the day before the last Sunday of April", which is the same date
  // as "the last full weekend of April" in every year and always will be:
  // April's last Sunday falls on the 24th at the earliest, so the Saturday
  // before it is never outside the month. JARL's wording is encoded because it
  // is JARL's, not because it changes an answer.
  for (let year = 2026; year < 2036; year++) {
    const [o] = expand(byId("jarl-all-ja"), year);
    const weekend = resolveAnchors({ type: "nth_full_weekend", month: 4, n: -1 }, year)[0];
    expect(isoDate(o.start!), String(year)).toBe(isoDate(weekend));
  }
});

test("JARL domestic contests are Japan-only and carry no deadline", () => {
  // "日本国内のアマチュア局およびSWL" -- amateur stations within Japan, and SWLs.
  // A JA station can be WORKED from anywhere, which is why these records exist
  // at all; entry is the restricted part, and that is a display-time filter.
  //
  // And no log deadline: JARL prints a dated one per edition above the rules
  // rather than a span inside them. All four 2026 deadlines happen to fall ten
  // days after their contest, which is suggestive and is not a rule JARL wrote.
  for (const cid of Object.keys(JARL_JP_PUBLISHED)) {
    const c = byId(cid);
    expect(c.eligibility?.scope, cid).toBe("entity_list");
    expect(c.eligibility?.entities, cid).toEqual(["JA"]);
    expect(eligibilityFor(c, "K").can_enter, cid).toBe(false);
    expect(eligibilityFor(c, "JA").can_enter, cid).toBe(true);
    expect("log_deadline_days" in c, cid).toBe(false);
  }
});

const ARSI_PUBLISHED: Record<string, [string, [number, number, number], number]> = {
  "arsi-vu-dx": ["22 - 23 August 2026, 12:00 UTC to 11:59:59 UTC", [2026, 8, 22], 12],
  "arsi-qrp-day": ["27th - 28th June 2026, 5:30 UTC to 11:59:59 UTC", [2026, 6, 27], 5],
  "arsi-vu-rookie": ["25 - 26 April 2026, 12:00 UTC to 11:59:59 UTC", [2026, 4, 25], 12],
  "arsi-40m-cq-vu-ssb": ["21 - 22 March 2026, 7:30 PM IST", [2026, 3, 21], 14],
  "arsi-40m-cq-vu-cw": ["5 - 6 Dec 2026, 7:30 PM IST", [2026, 12, 5], 14],
};

test.each(
  Object.entries(ARSI_PUBLISHED)
    .sort()
    .map(([cid, [rule, day, hour]]) => [cid, rule, day, hour] as const),
)("ARSI holds the editions India published: %s", (cid, rule, day, hour) => {
  // ARSI publishes dates and no recurrence -- every page opens with the year's
  // dates and states no rule anywhere. So all five are manual, hold exactly the
  // 2026 edition, and produce nothing for a year ARSI has not announced.
  const c = byId(cid);
  expect(c.recurrence.type, cid).toBe("manual");
  const [o] = expand(c, 2026);
  expect(isoDate(o.start!), `${cid}: ${rule}`).toBe(D(day[0], day[1], day[2]));
  expect(o.start!.getUTCHours(), `${cid}: ${rule}`).toBe(hour);
  expect(expand(c, 2027), cid).toEqual([]);
});

test("ARSI 40M contests are stated in Indian time only", () => {
  // Three of ARSI's five pages give UTC. The two 40M ones give ONLY Indian
  // Standard Time -- "7:30 PM IST to 7:29:59 PM IST" -- so those records carry
  // Asia/Kolkata wall clock rather than a UTC time converted by hand. India is
  // a fixed +05:30 with no daylight saving, so 1930 IST is 1400 UTC and always
  // will be; the record still says what the page said.
  for (const cid of ["arsi-40m-cq-vu-ssb", "arsi-40m-cq-vu-cw"]) {
    const c = byId(cid);
    expect(c.timezone, cid).toBe("Asia/Kolkata");
    const [o] = expand(c, 2026);
    expect([o.start_wall!.getUTCHours(), o.start_wall!.getUTCMinutes()], cid).toEqual([19, 30]);
    expect([o.start!.getUTCHours(), o.start!.getUTCMinutes()], cid).toEqual([14, 0]);
  }
  for (const cid of ["arsi-vu-dx", "arsi-qrp-day", "arsi-vu-rookie"]) {
    expect("timezone" in byId(cid), cid).toBe(false);
  }
});

test("ARSI 40M eligibility records a contradiction rather than resolving it", () => {
  // Both 40M pages say "Any licensed ham can participate in the contest" and
  // then, four lines later, "Though this contest is only for VU, any DX
  // contacts in the log will get 2 QSO multiplier points". The two cannot both
  // be taken at face value. The likely reading -- entry is VU, DX may be worked
  // -- is what is encoded, with eligibility.verified false saying so.
  for (const cid of ["arsi-40m-cq-vu-ssb", "arsi-40m-cq-vu-cw"]) {
    const e = byId(cid).eligibility!;
    expect(e.scope, cid).toBe("entity_list");
    expect(e.entities, cid).toEqual(["VU"]);
    expect(e.verified, cid).toBe(false);
    expect(e.note, cid).toContain("CONTRADICTS");
  }
  const dx = byId("arsi-vu-dx").eligibility!;
  expect(dx.scope).toBe("worldwide");
  expect(dx.verified).toBe(true);
  expect(eligibilityFor(byId("arsi-vu-dx"), "K").can_enter).toBe(true);
});

// TRAC publishes a page per year, so its own dates check its own rule -- and
// in one year out of four they disagree. See data/sources.md.
const TRAC_PUBLISHED: [number, number, number][] = [
  [2023, 7, 8], [2024, 7, 6], [2025, 7, 5], [2026, 7, 4],
];

test.each(TRAC_PUBLISHED)(
  "TRAC reproduces every date Turkey published: %i",
  (year, month, day) => {
    const [o] = expand(byId("trac-ta-vhf-uhf"), year);
    expect(isoDate(o.start!)).toBe(D(year, month, day));
    expect([o.start!.getUTCHours(), o.end!.getUTCHours()]).toEqual([12, 12]);
  },
);

test("the TRAC exception is flagged as an inference", () => {
  // TRAC states "Temmuz ayının ilk hafta sonu" -- the first weekend of July --
  // and that reproduces its 2024, 2025 and 2026 dates. It does NOT reproduce
  // 2023: 1 July 2023 was itself a Saturday, the rule gives 1-2 July, and TRAC
  // ran the contest on 8-9 July.
  //
  // exclude_dates [[7, 1]] is what makes all four come out right. It is the
  // same shape as ARRL RTTY Roundup's "never 1 January" -- except ARRL STATES
  // its exception and TRAC does not, so this is one year's evidence fitted
  // into a rule. Hence verified: false, and hence this test, which exists to
  // keep the inference visible rather than to bless it.
  const c = byId("trac-ta-vhf-uhf");
  expect(c.verified).toBe(false);
  expect(c.recurrence.exclude_dates).toEqual([[7, 1]]);
  expect(c.note).toContain("INFERENCE");

  for (const year of [2028, 2034, 2045]) {
    const [o] = expand(c, year);
    expect(isoDate(o.start!), String(year)).toBe(D(year, 7, 8));
  }

  // Without the exception the 2023 running would be wrong by a week.
  const naive = resolveAnchors({ type: "nth_full_weekend", month: 7, n: 1 }, 2023)[0];
  expect(isoDate(naive)).toBe(D(2023, 7, 1));
  expect(isoDate(expand(c, 2023)[0].start!)).toBe(D(2023, 7, 8));
});

// Nine contests run by eight South African clubs, all from the SARL Contest
// Manual -- which carries their full rules and names each organiser, so it is
// where these rules are published rather than a listing of them.
const ZA_CLUB_PUBLISHED: Record<string, [string, [number, number, number][], number]> = {
  "zs1-qso-party": ["last Sunday of July", [[2026, 7, 26]], 16],
  "zs2-qso-party": ["3rd Sunday of July", [[2026, 7, 19]], 14],
  "zs3-qso-party": ["3rd Sunday of May", [[2026, 5, 17]], 14],
  "zs4-qso-party": ["2nd Sunday of April", [[2026, 4, 12]], 14],
  "zs5-qso-party": ["1st Sunday of July", [[2026, 7, 5]], 14],
  "hammies-qso-party": ["2nd Sunday of June", [[2026, 6, 14]], 14],
  "early-morning-coffee-qso-party": [
    "2nd Wednesday of May and October", [[2026, 5, 13], [2026, 10, 14]], 4],
  "awasa-cw-activity-day": ["1st Sunday of February", [[2026, 2, 1]], 13],
  "hamsat-sa-qo100-qso-party": ["2nd Sunday February", [[2026, 2, 8]], 13],
};

test.each(
  Object.entries(ZA_CLUB_PUBLISHED)
    .sort()
    .map(([cid, [rule, days, hour]]) => [cid, rule, days, hour] as const),
)("South African club contests match the manual's own dates: %s", (cid, rule, days, hour) => {
  const occ = expand(byId(cid), 2026);
  expect(occ.map((o) => isoDate(o.start!)), `${cid}: ${rule}`)
    .toEqual(days.map(([y, m, d]) => D(y, m, d)));
  expect(occ[0].start!.getUTCHours(), `${cid}: ${rule}`).toBe(hour);
});

test("South African club contests are credited to their clubs, not to SARL", () => {
  // The SARL Contest Manual publishes these, but SARL does not run them -- it
  // names a Sponsor Club for each. Crediting them to SARL would misattribute
  // the contest AND hide nine clubs behind one sponsor filter -- nine
  // contests, nine clubs, one each.
  const sponsors = new Set(Object.keys(ZA_CLUB_PUBLISHED).map((cid) => byId(cid).sponsor));
  expect(sponsors.has("SARL")).toBe(false);
  expect(sponsors.size).toBe(9);
  expect(sponsors.has("Cape Town Amateur Radio Club")).toBe(true);
});

test("ZS1 runs an hour later than the other provincial parties", () => {
  // Five provincial parties with near-identical rules, and one starts at 16:00
  // rather than 14:00 -- the detail a regularised copy would smooth away.
  expect(expand(byId("zs1-qso-party"), 2026)[0].start!.getUTCHours()).toBe(16);
  for (const cid of ["zs2-qso-party", "zs3-qso-party", "zs4-qso-party", "zs5-qso-party"]) {
    expect(expand(byId(cid), 2026)[0].start!.getUTCHours(), cid).toBe(14);
  }
});

test("South African club eligibility is unverified where the manual is silent", () => {
  // The manual names entity lists for SARL's own HAMNET and Top Band contests
  // and says nothing about who may enter the club parties. Silence is not a
  // statement, so those records are worldwide with verified false.
  for (const cid of ["zs1-qso-party", "zs2-qso-party", "zs3-qso-party", "zs4-qso-party",
                     "zs5-qso-party", "hammies-qso-party",
                     "early-morning-coffee-qso-party", "awasa-cw-activity-day"]) {
    const e = byId(cid).eligibility!;
    expect(e.scope, cid).toBe("worldwide");
    expect(e.verified, cid).toBe(false);
  }
  const hs = byId("hamsat-sa-qo100-qso-party").eligibility!;
  expect(hs.scope).toBe("worldwide");
  expect(hs.verified).toBe(true);
});

test("PEARS runs two scored sessions back to back", () => {
  // PEARS calls it "a 44-hour dual contest ... divided into 2 sessions" and
  // scores them separately. They are contiguous -- the second "commences
  // immediately after" the first ends at 14:00 UTC Saturday -- so a single
  // 44-hour occurrence would draw the same bar while losing the fact that
  // there are two scored periods. The anchor is the 2nd FRIDAY of January.
  const occ = expand(byId("pears-national-vhf-uhf"), 2026);
  expect(occ).toHaveLength(2);
  expect(isoDate(occ[0].start!)).toBe(D(2026, 1, 9));
  expect(occ[0].start!.getUTCDay()).toBe(5); // Friday
  expect(occ[0].duration_hours).toBe(22);
  expect(occ[1].duration_hours).toBe(22);
  expect(occ[0].end!.getTime()).toBe(occ[1].start!.getTime());
});

test("SOTA says all bands, so none are recorded", () => {
  // "Frequencies and modes: All amateur bands and modes". Mixed is exactly
  // what that sentence means for modes; for bands there is no list to record,
  // and writing one would invent a restriction SARL did not state.
  const c = byId("zs-sota-activity-weekend");
  expect(c.bands).toEqual([]);
  expect(c.modes).toEqual(["Mixed"]);
  expect(expand(c, 2026).map((o) => isoDate(o.start!)))
    .toEqual([D(2026, 5, 16), D(2026, 9, 19)]);
});

test("Australia Day opens the day before the holiday", () => {
  // Australia Day is 26 January and the contest opens at 2200 UTC on the 25th,
  // which is 0900 on the 26th in eastern Australia. The anchor is therefore
  // the 26th with a negative offset on the start, exactly as WIA states it --
  // not a rule about the 25th, which would drift if WIA moved the hours.
  for (const year of [2026, 2027, 2028]) {
    const [o] = expand(byId("wia-australia-day"), year);
    expect(isoDate(o.start!), String(year)).toBe(D(year, 1, 25));
    expect([o.start!.getUTCHours(), o.end!.getUTCHours()]).toEqual([22, 10]);
    expect(isoDate(o.end!), String(year)).toBe(D(year, 1, 26));
    expect(o.duration_hours).toBe(12);
  }
  // WIA's "Phone" covers AM, FM and SSB; FM has a token and AM does not.
  const c = byId("wia-australia-day");
  expect(c.modes).toContain("FM");
  expect(c.modes).toContain("SSB");
  expect(c.submodes).toEqual(["AM"]);
});

// WWROF publishes future dates on its front page and keeps a rules PDF per
// year, so five of the sponsor's own dates check one rule.
const WW_DIGI_PUBLISHED: [number, number][] = [
  [2024, 24], [2026, 29], [2027, 28], [2028, 26], [2029, 25],
];

test.each(WW_DIGI_PUBLISHED)(
  "WW Digi reproduces every date WWROF published: %i",
  (year, day) => {
    expect(isoDate(expand(byId("ww-digi"), year)[0].start!)).toBe(D(year, 8, day));
  },
);

test("WW Digi is a full-weekend rule and 2024 is why", () => {
  // "Last full weekend of August" and "last Saturday of August" are different
  // rules. They agree every year EXCEPT when 31 August is a Saturday, because
  // the Sunday then falls in September and that weekend is not full.
  //
  // 2024 was such a year, and WWROF's own 2024 rules PDF says the contest ran
  // Saturday 24 August -- not the 31st. This test exists because the two
  // encodings agree in 2026, 2027, 2028 and 2029, so every year a casual check
  // is likely to try would pass with the wrong rule stored.
  const c = byId("ww-digi");
  expect(c.recurrence).toEqual({ type: "nth_full_weekend", month: 8, n: -1 });
  expect(isoDate(expand(c, 2024)[0].start!)).toBe(D(2024, 8, 24));
});

test("WW Digi records the 2026 rule changes", () => {
  // Both changed for 2026 and both matter to an operator: the log deadline went
  // from five days to 48 hours, and autonomous operation is now prohibited --
  // which is a rule about unattended FT8.
  const c = byId("ww-digi");
  expect(c.log_deadline_days).toBe(2);
  expect(c.source_note).toContain("Autonomous systems or robots");
  expect(c.modes).toEqual(["FT8/FT4"]);
  const occ = expand(c, 2026)[0];
  expect([occ.start!.getUTCHours(), occ.start!.getUTCMinutes()]).toEqual([12, 0]);
  expect([occ.end!.getUTCHours(), occ.end!.getUTCMinutes()]).toEqual([11, 59]);
});

// RSGB keeps a rules page per year, so five years of its own dates check one
// rule -- fifteen date-points across three contests, all from one anchor.
const AFS_PUBLISHED: [number, number, number, number][] = [
  [2022, 8, 16, 22], [2023, 7, 15, 21], [2024, 6, 14, 20],
  [2025, 4, 12, 18], [2026, 3, 11, 17],
];

test.each(AFS_PUBLISHED)(
  "RSGB AFS reproduces every date RSGB published: %i",
  (year, cw, data, ssb) => {
    const got = ["rsgb-afs-cw", "rsgb-afs-data", "rsgb-afs-ssb"]
      .map((cid) => expand(byId(cid), year)[0].start!.getUTCDate());
    expect(got).toEqual([cw, data, ssb]);
  },
);

test("RSGB AFS hangs three contests off one anchor", () => {
  // The AFS CW Saturday is the anchor; Datamodes is the Sunday eight days
  // later and SSB the Saturday fourteen days later. Datamodes has no
  // consistent ordinal of its own -- third Sunday in 2022 and 2023, second in
  // 2024, 2025 and 2026 -- so an ordinal would have been wrong in two of the
  // five years RSGB published.
  const offsets: Record<string, number> = {
    "rsgb-afs-cw": 0, "rsgb-afs-data": 8, "rsgb-afs-ssb": 14,
  };
  for (const [cid, off] of Object.entries(offsets)) {
    const c = byId(cid);
    expect(c.start.day_offset, cid).toBe(off);
    expect(c.recurrence.exclude_dates, cid).toEqual([[1, 1]]);
    expect(c.verified, cid).toBeTruthy();
  }
  expect(expand(byId("rsgb-afs-data"), 2023)[0].start!.getUTCDate()).toBe(15);
  expect(expand(byId("rsgb-afs-data"), 2026)[0].start!.getUTCDate()).toBe(11);
});

test("the RSGB AFS New Year exception is evidenced", () => {
  // 1 January 2022 was itself a Saturday and RSGB ran AFS CW on the 8th. The
  // exclusion is not a guess fitted to one year: it is the only reading that
  // fits all five years across all three contests.
  expect(isoDate(expand(byId("rsgb-afs-cw"), 2022)[0].start!)).toBe(D(2022, 1, 8));
  expect(isoDate(expand(byId("rsgb-afs-cw"), 2028)[0].start!)).toBe(D(2028, 1, 8));
});

// Four years of RSGB's own rules pages, per contest. RSGB keeps a page per
// year, so the sponsor checks the sponsor's rule -- 28 date-points here.
const RSGB_PUBLISHED: [string, number, number, number][] = [
  ["rsgb-1_8mhz-first", 2023, 2, 11], ["rsgb-1_8mhz-first", 2024, 2, 10],
  ["rsgb-1_8mhz-first", 2025, 2, 8], ["rsgb-1_8mhz-first", 2026, 2, 14],
  ["rsgb-1_8mhz-second", 2023, 11, 18], ["rsgb-1_8mhz-second", 2024, 11, 16],
  ["rsgb-1_8mhz-second", 2025, 11, 15], ["rsgb-1_8mhz-second", 2026, 11, 21],
  ["rsgb-club-calls", 2023, 11, 11], ["rsgb-club-calls", 2024, 11, 9],
  ["rsgb-club-calls", 2025, 11, 8], ["rsgb-club-calls", 2026, 11, 14],
  ["rsgb-nfd-cw", 2023, 6, 3], ["rsgb-nfd-cw", 2024, 6, 1],
  ["rsgb-nfd-cw", 2025, 6, 7], ["rsgb-nfd-cw", 2026, 6, 6],
  ["rsgb-ssb-field-day", 2023, 9, 2], ["rsgb-ssb-field-day", 2024, 9, 7],
  ["rsgb-ssb-field-day", 2025, 9, 6], ["rsgb-ssb-field-day", 2026, 9, 5],
  ["rsgb-low-power", 2023, 7, 16], ["rsgb-low-power", 2024, 7, 21],
  ["rsgb-low-power", 2025, 7, 20], ["rsgb-low-power", 2026, 7, 19],
];

test.each(RSGB_PUBLISHED)(
  "RSGB reproduces four years of its own dates: %s %i",
  (cid, year, month, day) => {
    expect(isoDate(expand(byId(cid), year)[0].start!)).toBe(D(year, month, day));
  },
);

test("RSGB National Field Day has no New Year-style exception", () => {
  // The same committee, two different answers, and only published dates
  // separate them. AFS skips 1 January when it falls on a Saturday --
  // evidenced by 2022. NFD does not skip 1 June: 1 June 2024 was itself a
  // Saturday and RSGB ran the contest on it. So the AFS exclusion must not be
  // copied across to NFD out of symmetry, and this test fails if it is.
  expect(isoDate(expand(byId("rsgb-nfd-cw"), 2024)[0].start!)).toBe(D(2024, 6, 1));
  expect(byId("rsgb-nfd-cw").recurrence.exclude_dates).toBeUndefined();
  expect(byId("rsgb-afs-cw").recurrence.exclude_dates).toEqual([[1, 1]]);
});

test("the RSGB FT4 Activity Day is manual because the ordinal breaks", () => {
  // First Saturday of April in 2023, 2024 and 2025 -- and the second in 2026.
  // Three years out of four is not a rule, so the record holds only the date
  // RSGB published. Easter Sunday fell on 5 April 2026, which is a plausible
  // reason and not a source.
  const c = byId("rsgb-ft4-activity-day");
  expect(c.recurrence.type).toBe("manual");
  expect(c.verified).toBeFalsy();
  const occ = expand(c, 2026);
  expect(occ).toHaveLength(1);
  expect(isoDate(occ[0].start!)).toBe(D(2026, 4, 11));
  // ...and it produces nothing at all for a year RSGB has not published.
  expect(expand(c, 2027)).toEqual([]);
});

test("the RSGB Low Power Contest leaves the lunch hour empty", () => {
  // 0900-1200 and 1300-1600, which is why this record uses sessions. A single
  // seven-hour block would put a contest on the calendar during an hour RSGB
  // does not run one.
  const occ = expand(byId("rsgb-low-power"), 2026);
  expect(occ.map((o) => [o.start!.getUTCHours(), o.end!.getUTCHours()]))
    .toEqual([[9, 12], [13, 16]]);
  expect(occ.every((o) => o.duration_hours === 3.0)).toBe(true);
});

test("the RSGB top band records differ in the ways RSGB states", () => {
  // Three top-band contests, three sets of rules, and the differences are the
  // sponsor's own -- which is why they are three records and not one.
  const feb = byId("rsgb-1_8mhz-first");
  const nov = byId("rsgb-1_8mhz-second");
  const club = byId("rsgb-club-calls");

  expect(feb.modes).toEqual(["CW", "SSB"]);
  expect(nov.modes).toEqual(["CW"]);          // the November leg is CW only
  expect([feb, nov, club].map((c) => c.bands))
    .toEqual([["160m"], ["160m"], ["160m"]]);

  // Club Calls caps the whole contest at 32 W, which is the point of it rather
  // than a footnote. Every other single-ceiling record in the catalog sits at
  // 5 W (a QRP class) or 100 W (the usual low-power class); 32 is exactly the
  // sort of odd number that gets "tidied" by someone who has not read the rules.
  // power_categories is not on the Contest interface -- it reaches the render
  // layer through the index signature -- so it is cast here exactly as
  // worker/src/render/detail.ts casts it.
  const cats = (c: Contest) =>
    (c.power_categories ?? []) as { name: string; max_watts?: number | null }[];
  expect(cats(club)[0].max_watts).toBe(32);
  const wholeContestCeilings = new Set(
    catalog
      .filter((c) => cats(c).length === 1 && cats(c)[0].max_watts)
      .map((c) => cats(c)[0].max_watts!),
  );
  expect([...wholeContestCeilings].sort((a, b) => a - b)).toEqual([5, 32, 100]);

  // Club Calls and the November leg are a week apart and are not the same
  // contest -- the second and third Saturdays of November.
  expect(isoDate(expand(club, 2026)[0].start!)).toBe(D(2026, 11, 14));
  expect(isoDate(expand(nov, 2026)[0].start!)).toBe(D(2026, 11, 21));
});

test("NRAU is blocked for the right contests and not for SAC", () => {
  // This used to assert NRAU encoded NOTHING, and it was half right. nrau.net
  // does say its contest information is under revision and does publish nothing
  // usable for NRAU-Baltic or the Nordic Activity Contests. What it got wrong is
  // the leap from "this organisation's site is blocked" to "this organisation
  // runs nothing we can read": NRAU also organises the Scandinavian Activity
  // Contest, which publishes complete rules at a domain of its own, and SAC
  // appeared nowhere in the registry until the 2026-08-21 gap audit.
  const reg = loadRegistry() as Record<string, any>;
  const nrau = reg.tier_2_european_societies.find(
    (o: { org: string }) => o.org === "NRAU",
  );

  const sac = catalog.filter((c) => c.sponsor === "NRAU").map((c) => c.id).sort();
  expect(sac).toEqual(["sac-cw", "sac-ssb"]);
  for (const id of sac) {
    expect(byId(id).rules_url, id).toContain("sactest.net");
    expect(byId(id).verified, id).toBeTruthy();
  }

  // ...and the part that really is blocked is still empty.
  const names = catalog.map((c) => c.name.toLowerCase()).join(" ");
  expect(names).not.toContain("nordic activity");
  expect(names).not.toContain("nrau-baltic");

  expect(nrau.status).toBe("partial");
  expect(nrau.catalog_sponsors).toEqual(["NRAU"]);
  expect(nrau.notes).toContain("under revision");
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
    // zs-sota-activity-weekend: SARL states "Frequencies and modes: All
    // amateur bands and modes". Same shape -- no list on the page, and writing
    // one out would be inventing a restriction the sponsor did not state.
    //
    // Note what BOTH have in common: the sponsor said "all bands", and that
    // was recorded as an absence rather than guessed at. sarl-hf-phone used to
    // be here for the OTHER reason -- its source was unreachable -- and left
    // this list on 2026-08-19 when the league turned out to have moved rather
    // than died.
    const unrecorded = catalog
      .filter((c) => !(c.bands ?? []).length)
      .map((c) => c.id)
      .sort();
    expect(unrecorded).toEqual(["jarl-new-year-qso-party", "zs-sota-activity-weekend"]);
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

// -------------------------------------------------------------------------
// The expiry cliff
// -------------------------------------------------------------------------
//
// A `manual` record produces NOTHING for a year absent from its `dates` map.
// That is correct behaviour and this project's discipline working as designed:
// a sponsor who publishes one year at a time gets a record holding exactly what
// was published, and no ordinal is invented to fill the gap.
//
// The failure mode is that correctness has an expiry date and nothing on the
// record's face says when. A wrong rule shows a contest on the wrong day, which
// somebody notices. An expired one shows nothing at all, on a calendar that
// still looks complete -- so nobody notices, which is worse.
//
// Measured 2026-08-21: 220 of 230 records produce occurrences in 2026 and only
// 194 do in 2027. These tests exist so that number cannot move in silence.
// Mirrored one-for-one with tests/test_recurrence.py.

const CATALOG_YEAR = 2026;

// Re-read the sponsors and move this forward when you do. Past it, the suite
// fails on purpose -- see "manual records get reviewed before the year turns".
const MANUAL_REVIEW_DEADLINE = Date.UTC(2026, 11, 1); // 1 December 2026

// Every `manual` record whose latest published year is CATALOG_YEAR, so it goes
// dark on 1 January. Pinned by id rather than by count: a count tells you the
// cliff moved, ids tell you which contest fell off it.
const EXPIRE_AFTER_CATALOG_YEAR = [
  "arsi-40m-cq-vu-cw", "arsi-40m-cq-vu-ssb", "arsi-qrp-day", "arsi-vu-dx",
  "arsi-vu-rookie", "cwops-cw-open", "erau-es-ll-kv", "lrmd-wal",
  "ncj-sprint-cw", "ncj-sprint-rtty", "rac-canada-winter", "rca-nacional-80m",
  "rsgb-80mcc-cw", "rsgb-80mcc-data", "rsgb-80mcc-ssb", "rsgb-autumn-cw",
  "rsgb-autumn-data", "rsgb-autumn-ssb", "rsgb-ft4-activity-day",
  "rsgb-ft4-series", "sarl-top-band-qso", "stew-perry", "uarl-champ-cw",
  "uarl-champ-rtty", "uarl-champ-ssb", "uarl-lp-cup-cw", "uba-bma",
  "uba-on-2m", "uba-on-6m", "uba-on-80-40-cw", "uba-on-80-40-ssb",
  "uba-spring-2m", "uba-spring-6m", "uba-spring-80m-cw", "uba-spring-80m-ssb",
  "ure-eartty",
].sort();

// Records that already produce nothing this year WITHOUT active_until to say
// why. `active_until` means "the sponsor stopped running it"; neither of these
// has that evidence, so setting it would be a claim we cannot support.
const DARK_WITHOUT_EXPLANATION = [
  "rca-nacional-40m",   // holds 2025 only -- invisible in 2026 AND 2027
  "srr-russian-dx",     // holds 2027 only -- invisible for all of 2026
].sort();

function latestManualYear(c: Contest): number | null {
  const dates = (c.recurrence as { dates?: Record<string, unknown> }).dates ?? {};
  const years = Object.keys(dates).map(Number);
  return years.length ? Math.max(...years) : null;
}

test("the expiry cliff is exactly where we think it is", () => {
  // Fails in both directions on purpose. A record ADDED to the cliff -- a new
  // sponsor who publishes one year at a time -- must be written down here so the
  // liability is visible rather than discovered next January. One REMOVED
  // because next year's dates arrived is good news that still has to be
  // recorded, because an unexplained shrink means somebody edited the data
  // without understanding this.
  const got = catalog
    .filter((c) => c.recurrence.type === "manual"
      && !c.active_until
      && latestManualYear(c) === CATALOG_YEAR)
    .map((c) => c.id)
    .sort();
  expect(got).toEqual(EXPIRE_AFTER_CATALOG_YEAR);
});

test("a record showing nothing this year says why", () => {
  // Either explained by active_until -- the sponsor stopped running it, which
  // the eight FISTS sprints record correctly -- or pinned above. A record that
  // silently shows nothing is the exact failure these tests exist to prevent.
  const dark = catalog.filter((c) => expand(c, CATALOG_YEAR).length === 0);
  const unexplained = dark.filter((c) => !c.active_until).map((c) => c.id).sort();
  expect(unexplained).toEqual(DARK_WITHOUT_EXPLANATION);

  // ...and the explained ones really are explained, not merely absent.
  for (const c of dark.filter((x) => x.active_until)) {
    expect(c.active_until!, c.id).toBeLessThan(CATALOG_YEAR);
  }
});

test("manual records get reviewed before the year turns", () => {
  // A dated tripwire, and it is meant to go off. Past MANUAL_REVIEW_DEADLINE
  // this fails until somebody re-reads the sponsors on the cliff, adds whatever
  // they have published for next year, and moves the deadline forward. Bumping
  // the date is not a loophole -- it is the point. It turns "nobody looked" into
  // a commit that says who looked and when.
  expect(
    Date.now(),
    `${EXPIRE_AFTER_CATALOG_YEAR.length} manual records hold ${CATALOG_YEAR} dates only `
    + `and will produce nothing from ${CATALOG_YEAR + 1}-01-01. `
    + `THE CHECKLIST IS IN HANDOVER.md, "The December re-check". It is THIRTEEN sponsors, `
    + `not ${EXPIRE_AFTER_CATALOG_YEAR.length} contests -- UBA alone is nine of them and `
    + `three pages cover all nine. RSGB's next URL is derivable: change the year in `
    + `rules/{year}/. SARL publishes its manual in December, so it is timed right. `
    + `When done: add whatever each sponsor has published, then move `
    + `MANUAL_REVIEW_DEADLINE and CATALOG_YEAR forward and update the two pinned sets. `
    + `Bumping the date without looking is the one way to make this test useless.`,
  ).toBeLessThan(MANUAL_REVIEW_DEADLINE);
});


  test("a manual date may carry its own times", () => {
    // The schema question NEEDS_A_HUMAN carried since the REP FT4 series,
    // settled by RSGB's 3.5 MHz Autumn Series hitting the same wall: it runs
    // 1900-2030 UTC in September and October and 2000-2130 in November, and
    // every leg sits on one side or the other. One stored time would put two of
    // three runnings on the calendar an hour wrong; a record per clock time
    // means six records for a nine-leg series the sponsor treats as one.
    const hhmm = (d: Date) =>
      `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const legs = (id: string) =>
      expand(byId(id), 2026).map((o) => [isoDate(o.start!), hhmm(o.start!), hhmm(o.end!)]);

    expect(legs("rsgb-autumn-cw")).toEqual([
      [D(2026, 9, 16), "1900", "2030"],
      [D(2026, 10, 5), "1900", "2030"],
      [D(2026, 11, 26), "2000", "2130"],   // <- November moves the clock
    ]);
    expect(legs("rsgb-autumn-ssb").at(-1)).toEqual([D(2026, 11, 11), "2000", "2130"]);
    expect(legs("rsgb-autumn-data").at(-1)).toEqual([D(2026, 11, 2), "2000", "2130"]);

    // Non-vacuous: the earlier legs really do fall back to the record's own
    // default, so this is not asserting every leg got the override.
    for (const id of ["rsgb-autumn-cw", "rsgb-autumn-ssb", "rsgb-autumn-data"]) {
      expect(legs(id)[0][1], id).toBe("1900");
      expect(byId(id).start.time, id).toBe("1900");
    }
  });

  test("a plain manual date still uses the record's own times", () => {
    // The override is opt-in per entry. Every other manual record lists bare
    // strings and must be untouched by the feature existing, which is the
    // failure a new branch in expand() would most easily cause.
    const plain = catalog.filter(
      (c) =>
        c.recurrence.type === "manual" &&
        !c.timezone &&
        !c.local_rolling &&
        Object.values(c.recurrence.dates ?? {}).every((lst) =>
          (lst as unknown[]).every((e) => typeof e === "string"),
        ),
    );
    expect(plain.length).toBeGreaterThan(20);

    for (const c of plain) {
      const want = new Set(
        (c.sessions ?? [{ start: c.start, end: c.end }]).map((s) => s.start.time),
      );
      for (const year of Object.keys(c.recurrence.dates ?? {})) {
        for (const o of expand(c, Number(year))) {
          const t = `${String(o.start!.getUTCHours()).padStart(2, "0")}`
            + `${String(o.start!.getUTCMinutes()).padStart(2, "0")}`;
          expect(want.has(t), `${c.id} at ${t}`).toBe(true);
        }
      }
    }
  });

  test("verified means the evidence is in the record", () => {
    // HANDOVER.md defines verification as recording the rule IN THE SPONSOR'S
    // OWN WORDING in source_note. Three SARL club records carried
    // verified: true with an empty string there -- a stricter defect than the
    // thin notes found beside them, because an empty source_note is not weak
    // evidence, it is none.
    //
    // The bar is length, not content, on purpose: judging whether a note really
    // quotes its sponsor is a job for a person, and refusing to call a record
    // verified with nothing behind it is a job a test can do.
    const thin = catalog
      .filter((c) => c.verified && ((c.source_note as string) ?? "").length < 40)
      .map((c) => c.id);
    expect(thin, "verified with no evidence").toEqual([]);

    const undated = catalog
      .filter((c) => c.verified && !c.rules_url_checked)
      .map((c) => c.id);
    expect(undated).toEqual([]);
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
