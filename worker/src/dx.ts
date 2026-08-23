/**
 * DXpeditions: one-shot operations, alongside the contest catalog.
 *
 * Deliberately NOT contests, and kept in their own file and their own module
 * for a reason that is about meaning rather than tidiness. A contest record is
 * built around a recurrence rule -- that is this project's whole thesis, that
 * nobody else stores rules -- plus an exchange and an eligibility question. A
 * DXpedition has none of the three. Folding one into a contest record would
 * make `recurrence`, `exchange` and `eligibility` conditional on a type flag,
 * and "230 contests" would stop being literally true on the front page.
 *
 * Three consequences worth knowing before touching this.
 *
 * **The recurrence engine is not involved.** These are plain UTC day ranges.
 * Nothing here imports `expand()`, nothing here can affect the Python/TypeScript
 * parity suite, and adding a DXpedition can never change a contest date.
 *
 * **Whole days, not instants.** Teams publish "November 16 - December 4", not
 * an hour, so no hour is recorded. That is why they suit the month grid, which
 * already buckets by UTC day, and why they carry no local-time conversion: there
 * is nothing to convert.
 *
 * **A record outlives its source.** An expedition's site usually goes dark or
 * turns into a QRT notice within months of the operation -- desecheo2026.com
 * already reads "Officially QRT" seven months on, with its own dates gone. So a
 * finished operation is marked `ended` and KEPT, and this calendar becomes the
 * surviving statement of when it ran.
 */

import raw from "../../data/dxpeditions.seed.json";

export interface DXpedition {
  id: string;
  callsign: string;
  /** The place, for a heading: "Christmas Island". */
  name: string;
  entity: string;
  iota: string | null;
  team: string;
  country: string;
  url: string;
  url_checked: string;
  /** Whole UTC days, inclusive. */
  start: string;
  end: string;
  /**
   * `exact` — the team published start and end days.
   * `month` — they have announced only a month, which is the normal state
   * until a few weeks out. A `month` record is never drawn on the calendar.
   */
  precision: "exact" | "month";
  modes: string[];
  /** EMPTY MEANS UNRECORDED, not unrestricted -- as in the contest catalog. */
  bands: string[];
  ended: boolean;
  verified: boolean;
  source_note: string;
  note: string;
  summary: string;
}

export const DXPEDITIONS: DXpedition[] = (raw as { dxpeditions: DXpedition[] })
  .dxpeditions;

export const DX_COUNT = DXPEDITIONS.length;

const DAY = 86_400_000;

/** Inclusive UTC day range as ms. `to` is the END of the last day. */
export function spanOf(d: DXpedition): { from: number; to: number } {
  return {
    from: Date.parse(`${d.start}T00:00:00Z`),
    to: Date.parse(`${d.end}T00:00:00Z`) + DAY - 1,
  };
}

export function dxById(id: string): DXpedition | undefined {
  return DXPEDITIONS.find((d) => d.id === id);
}

/**
 * The ones that can be drawn on a calendar.
 *
 * `month` precision is excluded, and that is the point rather than a
 * limitation: drawing "March 2027" across thirty-one days would claim a month
 * of operating nobody announced, and drawing it on a guessed fortnight would
 * invent the one fact a reader came for.
 */
export function datedDXpeditions(): DXpedition[] {
  return DXPEDITIONS.filter((d) => d.precision === "exact");
}

/** Announced, but only to a month. Listed, never plotted. */
export function undatedDXpeditions(): DXpedition[] {
  return DXPEDITIONS.filter((d) => d.precision !== "exact");
}

/** Every dated operation overlapping a window, soonest first. */
export function dxInRange(fromMs: number, toMs: number): DXpedition[] {
  return datedDXpeditions()
    .filter((d) => {
      const { from, to } = spanOf(d);
      return to >= fromMs && from <= toMs;
    })
    .sort((a, b) => spanOf(a).from - spanOf(b).from);
}

/** On the air right now. */
export function dxLive(nowMs: number): DXpedition[] {
  return dxInRange(nowMs, nowMs);
}

/**
 * Has this operation finished?
 *
 * Computed from the dates rather than read from `ended`, because a stored flag
 * is a fact that goes stale on its own the moment nobody updates it. `ended` in
 * the data is the team's own statement where there is one; this is the clock.
 */
export function hasEnded(d: DXpedition, nowMs: number): boolean {
  return d.ended || spanOf(d).to < nowMs;
}

/** Every UTC day an operation covers, as `YYYY-MM-DD` keys, bounded. */
export function daysCovered(d: DXpedition, fromMs: number, toMs: number): string[] {
  const { from, to } = spanOf(d);
  const out: string[] = [];
  let t = Math.max(from, fromMs);
  const last = Math.min(to, toMs);
  for (let i = 0; t <= last && i < 400; i++, t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
