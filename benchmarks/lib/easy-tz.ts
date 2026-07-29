// Access to easy-tz, for the benches that compare luxon's Intl-based zone
// lookups against baked rules (benchmarks/format.ts, and the easy-tz rows in
// benchmarks/upstream.ts).
//
// Vendored into benchmarks/vendor/easy-tz rather than installed or symlinked —
// see that directory's README.md for what is there and why. The upshot for this
// file is that easy-tz is always present, so there is no missing-checkout case
// to degrade for, and the bytes being measured are pinned in-tree instead of
// being whatever a sibling checkout was last built at.

import { fileURLToPath } from "node:url";
import meta from "../vendor/easy-tz/meta.json" with { type: "json" };
import { getTimeZoneAt, getTimeZones } from "../vendor/easy-tz/index.mjs";

export type { TimeZoneInfo } from "./easy-zone.ts";

/** The vendored bundle's own path, for the entries benchmarks/upstream.ts sizes. */
export const bakedRules = fileURLToPath(new URL("../vendor/easy-tz/index.mjs", import.meta.url));

/** A single zone's DST-correct abbreviation and UTC offset at an instant. */
export { getTimeZoneAt };

/** Which host's ICU the tables were baked from, for the report headers. */
export const tablesHost = meta.tables.host;

/** First instant the baked schedule covers; earlier values use baked history. */
export const yearStart = meta.yearStart;

/**
 * The zones easy-tz answers only approximately: the irregular, Ramadan-driven
 * ones, whose transition dates its baked step table can put up to an hour off.
 * They have to keep using luxon's exact Intl lookup, and the reports name them.
 */
export const irregularZones: ReadonlySet<string> = new Set(meta.irregularZones);

/**
 * Every IANA zone the tables were baked against.
 *
 * Read out of the bundle rather than vendored alongside it, so it cannot drift
 * from the bundle actually being measured. Lazy because benchmarks/lib/intl-probe.ts
 * imports this module purely for getTimeZoneAt and counts every Intl.DateTimeFormat
 * built after that point — work done here at import time would be work charged to
 * nobody.
 */
let zoneList: readonly string[] | undefined;

export function zones(): readonly string[] {
  return (zoneList ??= getTimeZones(true).map((z) => z.name));
}

let known: Set<string> | undefined;

/**
 * Whether easy-tz resolves this zone exactly, i.e. it is one of the baked zones
 * and not one of the irregular ones above.
 */
export function canResolve(name: string): boolean {
  return (known ??= new Set(zones())).has(name) && !irregularZones.has(name);
}
