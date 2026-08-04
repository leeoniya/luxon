// I declines to run diffs whose answers it can already bound, so the way it
// fails is by declining one it could not: a floor set above the shortest that
// unit really is, in a zone where it is shorter than usual. Everything here is
// built to sit on that.
//
// Spreads are placed either side of every floor and either side of each unit's
// true minimum, so a floor off by an hour lands between two of them. Zones
// include Lord Howe's half-hour DST and Chatham's 45-minute offset, where a
// local day and a local month are shorter than a whole-hour reading of the
// constants would suggest. Anchors sit on both DST weekends in both directions,
// on a leap day, across a year boundary, and on the first of February in a
// non-leap year, which is the only start in the calendar from which 28 days is
// exactly one month.
//
// toRelativeCalendar is here for the opposite reason. Its units count boundary
// crossings rather than elapsed time, so no spread bounds them — 23:00 and 01:00
// are two hours apart and one day apart — and it is correct only because the
// skip is switched off there. It is the case that fails if that guard goes.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["relativeSkip", [patchKey("relativeSkip")]],
  ["every patch", [...patchKeys]],
];

const stock = await loadLuxon([]);

describe("relativeSkip is invisible", () => {
  for (const [name, keys] of VARIANTS) {
    describe(name, () => {
      // The temporal sweep keeps every zone, anchor, spread and direction, using
      // the default unit chain. Options are orthogonal to that geometry, so each
      // is paired with a different point instead of multiplying the full matrix.
      // The mutation-backed fixtures independently pin every floor, padding and
      // the calendary guard to their discriminating boundary cases.
      //
      // A test per zone rather than one sweep, so that no single one runs past
      // bun's default per-test timeout.
      for (const zone of ["America/New_York", "UTC", "Australia/Lord_Howe", "Pacific/Chatham"]) {
        test(`toRelative skips only the diffs it can already answer > ${zone}`, async () => {
          const patched = await loadLuxon(keys);

          const MIN = 60_000;
          const HOUR = 3_600_000;
          const DAY = 86_400_000;
          const SPREADS = [
            0, 1, 999, 1000, 1001, MIN - 1, MIN, MIN + 1, HOUR - 1, HOUR, HOUR + 1,
            22 * HOUR, 23 * HOUR, 23 * HOUR + 1, DAY - 1, DAY, DAY + 1, 2 * DAY,
            6 * DAY, 6.9 * DAY, 7 * DAY, 7 * DAY + 1, 13 * DAY,
            27 * DAY, 28 * DAY - 1, 28 * DAY, 28 * DAY + 1, 29 * DAY, 30 * DAY, 31 * DAY,
            59 * DAY, 89 * DAY, 90 * DAY, 91 * DAY, 92 * DAY,
            364 * DAY, 365 * DAY - 1, 365 * DAY, 365 * DAY + 1, 366 * DAY, 367 * DAY,
            400 * DAY, 730 * DAY, 4000 * DAY,
          ];
          // Feb 1 of a non-leap year is the anchor the months floor turns on: 28
          // days from there is exactly one month, and it is the only start in the
          // calendar for which that is true. Without it a floor set at 29 days
          // never rejects a real month and the sweep passes on a broken table.
          const ANCHORS = [
            Date.UTC(2024, 0, 1, 12), Date.UTC(2024, 2, 10, 5), Date.UTC(2024, 2, 10, 7),
            Date.UTC(2024, 10, 3, 5), Date.UTC(2024, 10, 3, 7), Date.UTC(2024, 1, 29, 12),
            Date.UTC(2023, 11, 31, 23), Date.UTC(2023, 1, 1, 12),
          ];
          // Every option that reaches the loop or the padding branch, plus the
          // rounding modes, which decide whether a fractional count reads as 1.
          // weeks and quarters get named explicitly because the default unit list
          // holds neither, so nothing else in this file would touch their floors.
          const OPTS: Record<string, unknown>[] = [
            {},
            { round: false },
            { rounding: "round" },
            { rounding: "expand" },
            { unit: "days" },
            { unit: ["days", "hours"] },
            { unit: ["weeks", "days"] },
            { unit: ["quarters", "months"] },
            { padding: 3 * HOUR },
            { style: "short" },
          ];

          const compare = (anchor: number, spread: number, sign: number, extra: Record<string, unknown>) => {
            const opts = { zone, locale: "en-US" };
            const patchedBase = patched.DateTime.fromMillis(anchor, opts);
            const stockBase = stock.DateTime.fromMillis(anchor, opts);
            const patchedAt = patched.DateTime.fromMillis(anchor + sign * spread, opts);
            const stockAt = stock.DateTime.fromMillis(anchor + sign * spread, opts);
            const where = `${zone} ${anchor} ${sign * spread} ${JSON.stringify(extra)}`;

            assert.equal(
              patchedAt.toRelative({ base: patchedBase, ...extra } as never),
              stockAt.toRelative({ base: stockBase, ...extra } as never),
              `toRelative ${where}`
            );
          };

          for (const anchor of ANCHORS) {
            for (const spread of SPREADS) {
              for (const sign of [1, -1]) {
                compare(anchor, spread, sign, OPTS[0]!);
              }
            }
          }

          for (let i = 0; i < OPTS.length; i++) {
            const anchor = ANCHORS[i % ANCHORS.length]!;
            const spread = SPREADS[(i * 5 + 3) % SPREADS.length]!;
            const sign = i % 2 === 0 ? 1 : -1;
            const extra = OPTS[i]!;

            compare(anchor, spread, sign, extra);

            // Array units are accepted only by toRelative.
            if (Array.isArray(extra["unit"])) continue;

            const opts = { zone, locale: "en-US" };
            const patchedBase = patched.DateTime.fromMillis(anchor, opts);
            const stockBase = stock.DateTime.fromMillis(anchor, opts);
            const patchedAt = patched.DateTime.fromMillis(anchor + sign * spread, opts);
            const stockAt = stock.DateTime.fromMillis(anchor + sign * spread, opts);
            const where = `${zone} ${anchor} ${sign * spread} ${JSON.stringify(extra)}`;

            assert.equal(
              patchedAt.toRelativeCalendar({ base: patchedBase, ...extra } as never),
              stockAt.toRelativeCalendar({ base: stockBase, ...extra } as never),
              `toRelativeCalendar ${where}`
            );
          }
        });
      }

    });
  }
});
