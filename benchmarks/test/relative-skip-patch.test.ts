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
      // The unit floors decline to run a diff whose answer they can already
      // bound, so the way they fail is by declining one they could not: a floor
      // set above the shortest that unit really is, in a zone where it is
      // shorter than the usual. The sweep is built to sit on that. Spreads are
      // placed either side of every floor and either side of each unit's true
      // minimum, so a floor off by an hour lands between two of them; zones
      // include the half-hour DST of Lord Howe and Chatham's 45-minute offset,
      // where a local day and a local month are shorter than the constants a
      // whole-hour reading would suggest; and anchors sit on both DST weekends
      // in both directions, on a leap day and across a year boundary.
      //
      // toRelativeCalendar is in for the opposite reason. Its units count
      // boundary crossings, so no spread bounds them — 23:00 and 01:00 are two
      // hours apart and one day apart — and it is only correct because the skip
      // is switched off there. It is the case that fails if that guard goes.
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

          for (const anchor of ANCHORS) {
            for (const spread of SPREADS) {
              for (const sign of [1, -1]) {
                for (const extra of OPTS) {
                  const opts = { zone, locale: "en-US" };
                  const at = (m: typeof stock) => m.DateTime.fromMillis(anchor + sign * spread, opts);
                  const from = (m: typeof stock) => m.DateTime.fromMillis(anchor, opts);
                  const where = `${zone} ${anchor} ${sign * spread} ${JSON.stringify(extra)}`;

                  assert.equal(
                    at(patched).toRelative({ base: from(patched), ...extra } as never),
                    at(stock).toRelative({ base: from(stock), ...extra } as never),
                    `toRelative ${where}`
                  );

                  // an array unit is toRelative's alone; the other throws on one
                  if (Array.isArray(extra["unit"])) continue;

                  assert.equal(
                    at(patched).toRelativeCalendar({ base: from(patched), ...extra } as never),
                    at(stock).toRelativeCalendar({ base: from(stock), ...extra } as never),
                    `toRelativeCalendar ${where}`
                  );
                }
              }
            }
          }
        });
      }

      // A unit the floors do not name has to keep reaching the diff, or an
      // invalid one stops throwing where it threw. Inherited names are the way
      // that goes wrong, and it takes polluting Object.prototype to see it: a
      // floor read off the prototype is a function or an object for every name
      // that is there by default, and a spread compares false against both, so
      // an ordinary run cannot tell a plain object from a bare one. Give the
      // prototype a numeric "floor" for a unit luxon rejects and the difference
      // appears — a table that inherits it skips the diff that would have
      // thrown and answers instead.
      test("units the floors do not name still reach the diff", async () => {
        const patched = await loadLuxon(keys);

        const opts = { zone: "America/New_York", locale: "en-US" };
        const at = (m: typeof stock) => m.DateTime.fromMillis(Date.UTC(2024, 5, 1, 12), opts);
        const from = (m: typeof stock) => m.DateTime.fromMillis(Date.UTC(2024, 0, 1, 12), opts);
        const run = (m: typeof stock, unit: string) => {
          try {
            return at(m).toRelative({ base: from(m), unit: [unit] } as never);
          } catch (e) {
            return `threw ${(e as Error).name}`;
          }
        };

        for (const unit of ["constructor", "toString", "__proto__", "hasOwnProperty", "fortnights", ""]) {
          assert.equal(run(patched, unit), run(stock, unit), `unit ${JSON.stringify(unit)}`);
        }

        const proto = Object.prototype as unknown as Record<string, unknown>;

        try {
          // large enough that any spread would sit under it, so a table reading
          // it would skip every time
          proto["fortnights"] = 1e18;

          assert.equal(run(patched, "fortnights"), run(stock, "fortnights"), "polluted prototype");
        } finally {
          delete proto["fortnights"];
        }
      });
    });
  }
});
