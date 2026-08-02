// H has two shapes of risk in it, and they are not the same.
//
// Three of the constants it hoists are lookup tables moved out of the function
// that reads them. A table that lost or gained a key while being moved would not
// throw: it would resolve a unit to undefined, and the caller would either throw
// InvalidUnitError on a unit that used to work or silently accept one that never
// did. So the sweep asks for every key both tables hold, in both singular and
// plural, in mixed case, and checks that the units luxon rejects are still
// rejected.
//
// The fourth replaces the Date that SystemZone#offset allocates with one instance
// reused across calls. That instance is shared mutable state on the default zone,
// so the sweep interleaves zones rather than finishing one before the next, and
// crosses DST transitions in both directions: an offset read that left the probe
// holding a stale time would show up as one zone reading another's answer.
//
// Last, adjustTime and dayDiff compute directly what they used to route through
// objects built to be read once. Both are guarded, and the guards are the whole
// correctness argument: the fast path in adjustTime is only exact when every
// field is an integer, and only when the sum stays inside the finite range, where
// luxon's existing behaviour is to add nothing at all. So that sweep is organised
// by input rather than by method — fractions in each of the nine fields, values
// past 2^53, sums that overflow — and would fail if either guard were dropped.
// dayDiff's guard is a different kind: it reads the civil date off the DateTime
// and converts it, and the conversion has to be the one that does not read years
// under 100 as 19xx, so there is a sweep of those.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DurationUnit } from "luxon";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["arithDirect", [patchKey("arithDirect")]],
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

// What adjustTime's fast path has to get right, grouped by the guard each one
// exercises. Dropping the isInteger guard breaks the fractional block; dropping
// the finite guard breaks the last one, where luxon's existing answer is to add
// nothing rather than to go invalid.
const AMOUNTS: unknown[] = [
  // plain numbers and whole amounts, which is what takes the fast path
  0, 1, -1, 86_400_000,
  { days: 1 }, { days: -1 }, { months: 1 }, { months: -13 }, { quarters: 3 },
  { weeks: 2 }, { hours: 25 }, { minutes: 1440 }, { seconds: 90061 },
  { milliseconds: 1 }, { years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6, milliseconds: 7 },

  // a fraction in each of the nine fields, which must not take it
  { years: 1.5 }, { quarters: 1.5 }, { months: 2.5 }, { weeks: 1.5 }, { days: 1.5 },
  { days: -1.5 }, { hours: 0.25 }, { minutes: 0.5 }, { seconds: 0.001 },
  { milliseconds: 0.5 }, { months: 1.25, days: 2.75, hours: 3.5 },

  // The five calendar fields contribute only their fractional parts, so a
  // fraction there is caught by any of their five guards. The four time fields
  // are passed whole, and for most fractions shiftTo's trunc-and-remainder
  // split happens to reassemble them exactly — 0.5 and 0.25 both do — so those
  // four guards need values where it does not. About 4% of random fractions
  // qualify; one per field, found by searching for that.
  { hours: -204.63316678596144 },
  { minutes: -0.003974581243864517 },
  { seconds: -248.3538081770198 },
  { milliseconds: 334.2807337622956 },

  // integers large enough that summation order would show
  { days: Number.MAX_SAFE_INTEGER }, { milliseconds: Number.MAX_SAFE_INTEGER },
  { hours: 1e15, milliseconds: 1 },

  // and past the end of it, where the old path's remainder goes NaN and the
  // milliseconds getter's `|| 0` turns that into zero
  { hours: Infinity }, { days: -Infinity }, { seconds: 1e308 },
  { milliseconds: 1e308, seconds: 1e308 }, { hours: 1e305 },
  { hours: 1e305, milliseconds: -1e308 }, { seconds: 1e308, milliseconds: -1e308 },
  { seconds: 1e308, milliseconds: -1e308 },
];

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

const stock = await loadLuxon([]);

describe("arithDirect is invisible", () => {
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

      test("plus and minus agree on whole, fractional and out-of-range amounts", async () => {
        const patched = await loadLuxon(keys);

        for (const zone of ZONES) {
          for (const ts of INSTANTS) {
            const w = stock.DateTime.fromMillis(ts, { zone });
            const g = patched.DateTime.fromMillis(ts, { zone });

            for (const amount of AMOUNTS) {
              assert.equal(
                outcome(() => g.plus(amount as any).toISO()),
                outcome(() => w.plus(amount as any).toISO()),
                `plus(${JSON.stringify(amount)}) ${zone} ${ts}`
              );

              assert.equal(
                outcome(() => g.minus(amount as any).toISO()),
                outcome(() => w.minus(amount as any).toISO()),
                `minus(${JSON.stringify(amount)}) ${zone} ${ts}`
              );

              // toISO truncates, so a sub-millisecond disagreement would not
              // show in the strings above. The timestamp is stored unrounded.
              assert.equal(
                outcome(() => g.plus(amount as any).valueOf()),
                outcome(() => w.plus(amount as any).valueOf()),
                `plus(${JSON.stringify(amount)}).valueOf() ${zone} ${ts}`
              );

              assert.equal(
                outcome(() => g.minus(amount as any).valueOf()),
                outcome(() => w.minus(amount as any).valueOf()),
                `minus(${JSON.stringify(amount)}).valueOf() ${zone} ${ts}`
              );
            }

            // a Duration instance rather than an object: fromDurationLike hands
            // it through without re-normalizing, so its getters are what
            // adjustTime reads
            assert.equal(
              g.plus(patched.Duration.fromObject({ months: 1, days: 2.5, hours: 6 })).toISO(),
              w.plus(stock.Duration.fromObject({ months: 1, days: 2.5, hours: 6 })).toISO(),
              `plus(Duration) ${zone} ${ts}`
            );
          }
        }
      });

      test("dayDiff-backed units agree, including across transitions", async () => {
        const patched = await loadLuxon(keys);

        // days and weeks are the two units that route through dayDiff; the
        // fractional remainder it feeds is what a wrong division would move
        for (const zone of ZONES) {
          for (const ts of INSTANTS) {
            for (const span of [0, 1, 7, 45, 400, -1, -180]) {
              const at = ts + span * 86_400_000 + 5_400_000;
              const w = stock.DateTime.fromMillis(ts, { zone });
              const g = patched.DateTime.fromMillis(ts, { zone });
              const w2 = stock.DateTime.fromMillis(at, { zone });
              const g2 = patched.DateTime.fromMillis(at, { zone });

              for (const units of [["days"], ["weeks"], ["days", "hours"], ["weeks", "days"]]) {
                assert.equal(
                  g.diff(g2, units as DurationUnit[]).toISO(),
                  w.diff(w2, units as DurationUnit[]).toISO(),
                  `diff ${units.join(",")} ${zone} ${ts} +${span}d`
                );
              }

              assert.equal(
                patched.Interval.fromDateTimes(g, g2).isValid
                  ? patched.Interval.fromDateTimes(g, g2).count("days")
                  : null,
                stock.Interval.fromDateTimes(w, w2).isValid
                  ? stock.Interval.fromDateTimes(w, w2).count("days")
                  : null,
                `Interval#count ${zone} ${ts} +${span}d`
              );
            }
          }
        }
      });

      test("dayDiff over years the two-digit rule would rewrite", async () => {
        const patched = await loadLuxon(keys);

        // utcDayStart now reads dt.c and converts it itself, and the obvious way
        // to write that conversion — Date.UTC(year, month - 1, day) — reads any
        // year under 100 as 19xx. objToLocalTS undoes that; nothing else here
        // would notice if this stopped calling it. Year 100 and the leap day at
        // 99/100 are in because Date.UTC's 1999 is a leap year and 99 is not.
        const YEARS = [1, 49, 50, 70, 99, 100, 101, 1899, 1900, 2024];

        for (const zone of ["America/New_York", "UTC"]) {
          for (const year of YEARS) {
            for (const [month, day] of [
              [1, 1],
              [2, 28],
              [3, 1],
              [12, 31],
            ] as const) {
              const of = (m: typeof stock) =>
                m.DateTime.fromObject({ year, month, day, hour: 13, minute: 30 }, { zone });
              const to = (m: typeof stock) => m.DateTime.fromObject({ year: 2024, month: 6, day: 15 }, { zone });

              for (const units of [["days"], ["weeks"], ["weeks", "days"], ["years", "days"]]) {
                assert.equal(
                  of(patched).diff(to(patched), units as DurationUnit[]).toISO(),
                  of(stock).diff(to(stock), units as DurationUnit[]).toISO(),
                  `diff ${units.join(",")} ${zone} ${year}-${month}-${day}`
                );
              }
            }
          }
        }
      });

      // A duration with no calendar field leaves the civil object identical to
      // the receiver's, so adjustTime returns before building it and before the
      // offset round trip that would re-derive what the instance already has.
      // What that skips is fixOffset, which is also where wasHole comes from —
      // so wasHole is part of the comparison here and not only the instant.
      test("durations with no calendar field, including wasHole", async (t) => {
        const patched = await loadLuxon(keys);

        // amounts either side of the guard: whole and fractional, zero and not,
        // inside the finite range and past it
        const AMTS: unknown[] = [
          0, 1, -1, 1000, 86_400_000, -86_400_000, 0.5, -0.5,
          { milliseconds: 1 }, { seconds: 90 }, { minutes: -30 }, { hours: 5 }, { hours: -5 },
          { hours: 1, minutes: 30 }, { seconds: 0.5 }, { milliseconds: 0.25 }, { hours: 0.25 },
          // zeroed calendar fields still count as calendar-free
          { days: 0 }, { months: 0 }, { weeks: 0 }, { quarters: 0, hours: 1 }, { years: 0, minutes: 5 },
          // and these must not take it
          { days: 1 }, { months: 1 }, { weeks: -2 }, { years: 1, hours: 2 },
          { hours: Number.MAX_SAFE_INTEGER }, { hours: 1e305 }, { seconds: 1e308 },
          { hours: 1e305, milliseconds: -1e308 },
        ];

        let checked = 0;

        for (const zone of ZONES) {
          for (const instant of INSTANTS) {
            for (let min = -60; min <= 60; min += 15) {
              const ts = instant + min * 60_000;

              for (const amt of AMTS) {
                for (const op of ["plus", "minus"] as const) {
                  const read = (mod: typeof stock) =>
                    outcome(() => {
                      const dt = mod.DateTime.fromMillis(ts, { zone });
                      const d = op === "plus" ? dt.plus(amt as never) : dt.minus(amt as never);
                      return d.isValid ? `${d.valueOf()}/${d.offset}/${d.wasHole}` : `invalid:${d.invalidReason}`;
                    });

                  checked++;

                  assert.equal(
                    read(patched),
                    read(stock),
                    `${zone} ${new Date(ts).toISOString()} ${op} ${JSON.stringify(amt)}`
                  );
                }
              }
            }
          }
        }

        t.diagnostic(`${checked} compared`);
        assert.ok(checked > 10_000, `only ${checked} compared`);
      });

      // fromMillis cannot land in a DST hole, so the receivers above are all
      // outside one. These are built into holes on purpose: reading the civil
      // time back out of a hole resolution lands outside it, which is why the
      // skipped round trip could not have reported wasHole either way.
      test("receivers constructed into a DST hole", async () => {
        const patched = await loadLuxon(keys);

        for (const zone of ["America/New_York", "Australia/Lord_Howe", "Pacific/Chatham", "Europe/Dublin"]) {
          for (const [year, month, day] of [
            [2017, 3, 12], [2024, 3, 10], [2024, 10, 6], [2024, 4, 7],
          ] as [number, number, number][]) {
            for (const hour of [1, 2, 3]) {
              for (const minute of [0, 30]) {
                const obj = { year, month, day, hour, minute };

                for (const amt of [0, 1, { hours: 1 }, { minutes: 30 }, { milliseconds: -1 }, { days: 1 }]) {
                  const read = (mod: typeof stock) => {
                    const d = mod.DateTime.fromObject(obj, { zone }).plus(amt as never);
                    return d.isValid ? `${d.valueOf()}/${d.offset}/${d.wasHole}` : `invalid:${d.invalidReason}`;
                  };

                  assert.equal(
                    read(patched),
                    read(stock),
                    `${zone} ${JSON.stringify(obj)} + ${JSON.stringify(amt)}`
                  );
                }
              }
            }
          }
        }
      });
    });
  }
});
