// H's four hoisted constants have to be invisible, and the risk in them is not
// the same as the risk in a cache.
//
// Three are lookup tables moved out of the function that reads them. A table that
// lost or gained a key while being moved would not throw: it would resolve a unit
// to undefined, and the caller would either throw InvalidUnitError on a unit that
// used to work or silently accept one that never did. So the sweep asks for every
// key both tables hold, in both singular and plural, in mixed case, and checks
// that the units luxon rejects are still rejected.
//
// The fourth replaces the Date that SystemZone#offset allocates with one instance
// reused across calls. That instance is shared mutable state on the default zone,
// so the sweep interleaves zones rather than finishing one before the next, and
// crosses DST transitions in both directions: an offset read that left the probe
// holding a stale time would show up as one zone reading another's answer.
//
// The formatter half of H is covered by the --verify pass in benchmarks/format.ts
// and benchmarks/upstream.ts, which compares every rendered string against stock.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DurationUnit } from "luxon";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["hotPath", [patchKey("hotPath")]],
  ["every patch", [...patchKeys]],
];

// DateTime units, as normalizeUnit spells them and as callers do
const DT_UNITS = [
  "year", "years", "quarter", "quarters", "month", "months", "day", "days",
  "hour", "hours", "minute", "minutes", "second", "seconds",
  "millisecond", "milliseconds", "weekday", "weekdays",
  "weekNumber", "weeknumbers", "weekYear", "weekyears", "ordinal",
];

// Duration units, which are a different set: no weekday/ordinal, but weeks
const DUR_UNITS = [
  "year", "years", "quarter", "quarters", "month", "months", "week", "weeks",
  "day", "days", "hour", "hours", "minute", "minutes", "second", "seconds",
  "millisecond", "milliseconds",
];

const NOT_UNITS = ["", "fortnight", "dayz", "week ", "yearss", "Weekly"];

/** the sweep passes unit names luxon rejects on purpose, which the union excludes */
const asUnit = (u: string) => u as DurationUnit;

// zones that disagree with each other and with the host, including a half-hour
// offset, a 30-minute DST shift and one that never shifts
const ZONES = ["America/New_York", "Australia/Lord_Howe", "Asia/Kolkata", "Europe/Dublin", "UTC"];

// straddling both US and southern-hemisphere transitions
const INSTANTS = [
  Date.UTC(2024, 2, 10, 6, 59, 59), // one second before US spring forward
  Date.UTC(2024, 2, 10, 7, 0, 0),
  Date.UTC(2024, 10, 3, 5, 59, 59), // and before fall back
  Date.UTC(2024, 10, 3, 6, 0, 0),
  Date.UTC(2024, 3, 6, 16, 0, 0), // Lord Howe's 30-minute shift
  Date.UTC(2024, 6, 4, 12, 0, 0),
  Date.UTC(1970, 0, 1, 0, 0, 0),
  Date.UTC(2038, 0, 19, 3, 14, 8),
];

const stock = await loadLuxon([]);

/** an invalid DateTime values as NaN, so validity has to agree before the instant can */
function same(a: any, b: any): boolean {
  return a.isValid ? b.isValid && a.valueOf() === b.valueOf() : !b.isValid && a.invalidReason === b.invalidReason;
}

/** whatever the call produces, including the way it fails */
function outcome(fn: () => unknown): string {
  try {
    const v = fn();
    return v === undefined || v === null ? String(v) : String(v);
  } catch (e) {
    return `throws ${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
}

describe("hotPath is invisible", () => {
  for (const [name, keys] of VARIANTS) {
    describe(name, () => {
      test("every unit name, in both tables, mixed case included", async (t) => {
        const patched = await loadLuxon(keys);

        // fromObject fills whatever the object leaves out from the current
        // instant, and the two builds keep their own clocks, so without this the
        // pair is read a millisecond apart and the comparison is a coin toss
        const FIXED = Date.UTC(2024, 6, 4, 12, 34, 56, 789);
        const clocks = [stock, patched].map((m) => {
          const was = m.Settings.now;
          m.Settings.now = () => FIXED;
          return () => (m.Settings.now = was);
        });
        t.after(() => clocks.forEach((restore) => restore()));

        for (const unit of [...DT_UNITS, ...NOT_UNITS]) {
          for (const spelling of [unit, unit.toUpperCase(), unit.toLowerCase()]) {
            const dt = (m: any) => m.DateTime.fromMillis(INSTANTS[0]!, { zone: "America/New_York" });

            assert.equal(
              outcome(() => dt(patched).plus({ [spelling]: 2 }).toISO()),
              outcome(() => dt(stock).plus({ [spelling]: 2 }).toISO()),
              `plus({ ${spelling} })`
            );

            // set() and fromObject() are the calls that reach the DateTime
            // table's week and ordinal entries; get() is a plain property read
            // and would not notice a table missing a key at all
            assert.equal(
              outcome(() => dt(patched).set({ [spelling]: 2 }).toISO()),
              outcome(() => dt(stock).set({ [spelling]: 2 }).toISO()),
              `set({ ${spelling} })`
            );

            assert.equal(
              outcome(() => patched.DateTime.fromObject({ [spelling]: 2 }, { zone: "UTC" }).toISO()),
              outcome(() => stock.DateTime.fromObject({ [spelling]: 2 }, { zone: "UTC" }).toISO()),
              `fromObject({ ${spelling} })`
            );

            // every unit, not just the spans: the ones startOf rejects have to
            // be rejected the same way, which is the half a dropped key breaks
            assert.equal(
              outcome(() => dt(patched).startOf(spelling).toISO()),
              outcome(() => dt(stock).startOf(spelling).toISO()),
              `startOf(${spelling})`
            );

            assert.equal(
              outcome(() => dt(patched).endOf(spelling).toISO()),
              outcome(() => dt(stock).endOf(spelling).toISO()),
              `endOf(${spelling})`
            );

            assert.equal(
              outcome(() => dt(patched).toISODate({ precision: spelling })),
              outcome(() => dt(stock).toISODate({ precision: spelling })),
              `toISODate(precision: ${spelling})`
            );
          }
        }

        for (const unit of [...DUR_UNITS, ...NOT_UNITS]) {
          for (const spelling of [unit, unit.toUpperCase(), unit.toLowerCase()]) {
            assert.equal(
              outcome(() => patched.Duration.fromObject({ [spelling]: 90 }).toISO()),
              outcome(() => stock.Duration.fromObject({ [spelling]: 90 }).toISO()),
              `Duration.fromObject({ ${spelling} })`
            );

            assert.equal(
              outcome(() => stock.Duration.fromObject({ minutes: 5000 }).as(asUnit(spelling))),
              outcome(() => patched.Duration.fromObject({ minutes: 5000 }).as(asUnit(spelling))),
              `Duration#as(${spelling})`
            );

            assert.equal(
              outcome(() => patched.Duration.fromObject({ minutes: 5000 }).shiftTo(asUnit(spelling)).toISO()),
              outcome(() => stock.Duration.fromObject({ minutes: 5000 }).shiftTo(asUnit(spelling)).toISO()),
              `Duration#shiftTo(${spelling})`
            );
          }
        }
      });

      test("the system zone reads the same offset with its probe shared across zones", async () => {
        const patched = await loadLuxon(keys);

        // one instant at a time across every zone, so each offset read meets a
        // probe the previous zone just set to a different time
        for (const ts of INSTANTS) {
          for (const offset of [0, -1, 1, -86_400_000, 86_400_000, -1_800_000]) {
            const at = ts + offset;

            // no zone option at all: this is SystemZone, the default
            const want = stock.DateTime.fromMillis(at);
            const got = patched.DateTime.fromMillis(at);

            assert.equal(got.offset, want.offset, `system offset at ${at}`);
            assert.ok(same(want, got), `system instant at ${at}`);
            assert.equal(got.toISO(), want.toISO(), `system toISO at ${at}`);
            assert.equal(
              got.toFormat("yyyy-MM-dd HH:mm:ss ZZ"),
              want.toFormat("yyyy-MM-dd HH:mm:ss ZZ"),
              `system toFormat at ${at}`
            );

            // interleaved with named zones, which read offsets through a
            // different path and must not be perturbed by the shared probe
            for (const zone of ZONES) {
              assert.equal(
                patched.DateTime.fromMillis(at, { zone }).offset,
                stock.DateTime.fromMillis(at, { zone }).offset,
                `${zone} offset at ${at}`
              );
            }

            // and back to the system zone, which must still read its own answer
            assert.equal(patched.DateTime.fromMillis(at).offset, want.offset, `system offset again at ${at}`);
          }
        }
      });

      test("out-of-range and NaN instants degrade the same way", async () => {
        const patched = await loadLuxon(keys);

        for (const ts of [NaN, Infinity, -Infinity, 8.64e15, 8.64e15 + 1, -8.64e15 - 1, 1e300]) {
          const want = stock.DateTime.fromMillis(ts);
          const got = patched.DateTime.fromMillis(ts);

          assert.equal(got.isValid, want.isValid, `isValid at ${ts}`);
          assert.equal(got.invalidReason, want.invalidReason, `invalidReason at ${ts}`);
          assert.ok(same(want, got), `instant at ${ts}`);
        }
      });

      test("relative time reads the same in both directions and every unit", async () => {
        const patched = await loadLuxon(keys);

        const base = stock.DateTime.fromMillis(Date.UTC(2024, 6, 4, 12), { zone: "UTC" });
        const baseP = patched.DateTime.fromMillis(Date.UTC(2024, 6, 4, 12), { zone: "UTC" });

        const shifts = [
          { seconds: 1 }, { seconds: -1 }, { minutes: 1 }, { minutes: -45 },
          { hours: 1 }, { hours: -23 }, { days: 1 }, { days: -1 }, { days: 6 },
          { weeks: 1 }, { weeks: -3 }, { months: 1 }, { months: -11 },
          { quarters: 1 }, { years: 1 }, { years: -2 }, { milliseconds: 0 },
        ];

        // toRelative pins numeric to "always" over whatever it is passed, so the
        // "auto" wording in the table — "tomorrow", "last week" — is only
        // reachable through toRelativeCalendar. Both are here for that reason.
        for (const shift of shifts) {
          for (const style of ["long", "short", "narrow"] as const) {
            const w = base.plus(shift);
            const g = baseP.plus(shift);

            assert.equal(
              g.toRelative({ base: baseP, style }),
              w.toRelative({ base, style }),
              `toRelative ${JSON.stringify(shift)} ${style}`
            );
          }

          assert.equal(
            baseP.plus(shift).toRelativeCalendar({ base: baseP }),
            base.plus(shift).toRelativeCalendar({ base }),
            `toRelativeCalendar ${JSON.stringify(shift)}`
          );
        }
      });

      test("arithmetic and diffs across transitions match stock", async () => {
        const patched = await loadLuxon(keys);

        for (const zone of ZONES) {
          for (const ts of INSTANTS) {
            const w = stock.DateTime.fromMillis(ts, { zone });
            const g = patched.DateTime.fromMillis(ts, { zone });
            const w2 = stock.DateTime.fromMillis(ts + 86_400_000 * 400, { zone });
            const g2 = patched.DateTime.fromMillis(ts + 86_400_000 * 400, { zone });

            assert.equal(
              g.diff(g2, ["years", "months", "days", "hours"]).toISO(),
              w.diff(w2, ["years", "months", "days", "hours"]).toISO(),
              `diff ${zone} ${ts}`
            );

            assert.equal(g.hasSame(g2, "day"), w.hasSame(w2, "day"), `hasSame ${zone} ${ts}`);

            assert.equal(
              patched.Interval.fromDateTimes(g, g2).length("days"),
              stock.Interval.fromDateTimes(w, w2).length("days"),
              `Interval#length ${zone} ${ts}`
            );

            assert.equal(
              patched.Interval.fromDateTimes(g, g.plus({ days: 8 })).splitBy({ days: 1 }).length,
              stock.Interval.fromDateTimes(w, w.plus({ days: 8 })).splitBy({ days: 1 }).length,
              `Interval#splitBy ${zone} ${ts}`
            );
          }
        }
      });
    });
  }
});
