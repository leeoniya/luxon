// K's fixtures.
//
// Everything K replaces still has an expression in the tree, so most of what is
// here is differential rather than recorded. The weekday math is checked against
// the Date read it replaced, written out in the test; startOf("week") against
// the set({ weekday: 1 }) route, which set() still owns; and the fused endOf
// against the plus().startOf().minus(1) chain, which is still endOf's own route
// whenever an options object is passed.
//
// The recorded cases are the midnight folds, where the chain and the fused
// route legitimately part ways: a zone that falls back across local midnight
// gave the chain an endOf("day") an hour inside the next day, and the fused
// route ends the day on the receiver's side of the fold instead. Those pins are
// absolute because there is nothing left in the tree that answers the old way —
// see the "at a midnight fold" section of benchmarks/docs/pr/11-boundary-math.md.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["boundaryMath", [patchKey("boundaryMath")]],
  ["every patch", [...patchKeys]],
];

const ZONE = "America/New_York";

// the units the fused route now serves, and the spellings
const FUSED_UNITS = [
  "year",
  "years",
  "quarter",
  "quarters",
  "month",
  "months",
  "week",
  "weeks",
  "day",
  "days",
];

// the units that must stay on the chain: their boundary is a time of day, and
// civil midnight math would answer the wrong side of a fold for them
const CHAIN_UNITS = [
  "hour",
  "hours",
  "minute",
  "minutes",
  "second",
  "seconds",
  "millisecond",
  "milliseconds",
];

// what dayOfWeek used to compute, written out -- with one repair. The replaced
// code fixed Date.UTC's two-digit-year reading by re-setting the year alone,
// which kept the day Date.UTC had already rolled: a leap day in a leap year
// below 100 (year 0 is one; 1900 is not) had become March 1 first, so those
// dates answered March 1's weekday. This reference re-sets the full date, the
// way objToLocalTS's own repair does, and the recorded test below pins the two
// dates where the old read and the true weekday disagree.
function dateWeekday(year: number, month: number, day: number): number {
  let d = new Date(Date.UTC(year, month - 1, day));

  if (year < 100 && year >= 0) {
    d = new Date(d);
    d.setUTCFullYear(year, month - 1, day);
  }

  const js = d.getUTCDay();

  return js === 0 ? 7 : js;
}

for (const [label, keys] of VARIANTS) {
  describe(`boundaryMath fixtures > ${label}`, () => {
    // ---- dayOfWeek ----

    test("the weekday math agrees with the Date read it replaced", async () => {
      const m = await loadLuxon(keys);

      const years: number[] = [];

      // every year of a whole 400-year gregorian cycle, sampled coarsely, plus
      // dense coverage where the replaced code had seams: the epoch, the
      // century years whose leap rule the era math carries, the two-digit
      // years Date.UTC misreads, and dates before year zero
      for (let y = -400; y <= 2400; y += 13) years.push(y);
      for (let y = 1895; y <= 1905; y++) years.push(y);
      for (let y = 2095; y <= 2105; y++) years.push(y);
      for (let y = 1968; y <= 1972; y++) years.push(y);
      for (let y = -2; y <= 102; y++) years.push(y);

      for (const year of years) {
        for (const [month, day] of [
          [1, 1],
          [2, 28],
          [2, 29],
          [3, 1],
          [6, 15],
          [12, 31],
        ] as const) {
          const dt = m.DateTime.utc(year, month, day);

          // skip the invalid Feb 29s the sweep produces in non-leap years
          if (!dt.isValid) continue;

          assert.equal(
            dt.weekday,
            dateWeekday(year, month, day),
            `weekday of ${year}-${month}-${day}`
          );
        }
      }
    });

    // The dates the replaced read got wrong: Feb 29 exists in leap years below
    // 100 (0, 4, ... 96), and the old code answered March 1's weekday for
    // them. The 400-year cycle is exactly 20871 weeks, so year 0's calendar is
    // year 2000's, and 2000-02-29 was a Tuesday. Recorded rather than
    // differential because nothing in the tree answers the old way anymore --
    // this is the one deliberate divergence, and the PR document carries it.
    test("leap days before year 100 answer their own weekday", async () => {
      const m = await loadLuxon(keys);

      assert.equal(m.DateTime.utc(0, 2, 29).weekday, 2);
      assert.equal(m.DateTime.utc(96, 2, 29).weekday, m.DateTime.utc(2096, 2, 29).weekday);
      // and the day around them never moved
      assert.equal(m.DateTime.utc(0, 2, 28).weekday, 1);
      assert.equal(m.DateTime.utc(0, 3, 1).weekday, 3);
    });

    // ---- startOf("week") ----

    test("startOf week answers what the set({ weekday: 1 }) route answers", async () => {
      const m = await loadLuxon(keys);

      const anchors = [
        // one of each weekday, so the day count runs 0 through 6
        "2024-06-10T12:00:00.000", // Monday
        "2024-06-11T12:00:00.000",
        "2024-06-12T12:00:00.000",
        "2024-06-13T12:00:00.000",
        "2024-06-14T12:00:00.000",
        "2024-06-15T12:00:00.000",
        "2024-06-16T12:00:00.000", // Sunday
        // the borrow: Monday is in the previous month, or the previous year
        "2024-03-02T08:30:00.000",
        "2021-01-01T00:00:00.000",
        "2020-02-29T23:59:59.999",
        // the week of each 2024 DST transition, entered from the far side
        "2024-03-10T15:00:00.000",
        "2024-11-03T15:00:00.000",
        // before the epoch, where the weekday math's day count is negative
        "1969-12-31T12:00:00.000",
        "1961-04-12T09:07:00.000",
        // deep past, including the two-digit years Date.UTC misreads
        "0099-01-05T12:00:00.000",
        "0001-01-01T00:00:00.000",
        "-000005-03-01T12:00:00.000",
      ];

      for (const iso of anchors) {
        const dt = m.DateTime.fromISO(iso, { zone: ZONE });
        const got = dt.startOf("week");
        const want = dt.set({ weekday: 1, hour: 0, minute: 0, second: 0, millisecond: 0 });

        assert.equal(got.toISO(), want.toISO(), `startOf week of ${iso}`);
        assert.equal(got.weekday, 1, `weekday after startOf week of ${iso}`);
      }
    });

    // ---- endOf, against the chain it fused ----

    test("endOf answers what plus().startOf().minus() answers", async () => {
      const m = await loadLuxon(keys);

      const anchors = [
        "2024-06-15T12:00:00.000",
        // receivers on each side of a week, so day + (8 - weekday) runs 1..7
        "2024-06-10T00:00:00.000", // Monday
        "2024-06-16T23:59:59.999", // Sunday
        // month ends, where day + 1 overflows into Date.UTC's carry
        "2024-01-31T12:00:00.000",
        "2024-02-29T12:00:00.000",
        "2024-12-31T23:59:59.999",
        // the DST Saturdays and Sundays, where the boundary sits across a
        // transition and the folded minus(1) must re-read the offset
        "2024-03-09T13:00:00.000",
        "2024-03-10T01:30:00.000",
        "2024-11-02T13:00:00.000",
        "2024-11-03T01:30:00.000",
        // before the epoch and before year 100
        "1969-06-15T12:00:00.000",
        "0099-12-31T12:00:00.000",
        "1600-02-29T12:00:00.000",
      ];

      for (const iso of anchors) {
        // widened the way trim-allocs' own fixture widens: the spellings are
        // the point, and the DateTimeUnit type does not carry them
        const dt = m.DateTime.fromISO(iso, { zone: ZONE }) as unknown as {
          endOf: (u: string) => { toISO: () => string | null; offset: number };
          plus: (o: unknown) => {
            startOf: (u: string) => {
              minus: (n: number) => { toISO: () => string | null; offset: number };
            };
          };
        };

        for (const unit of [...FUSED_UNITS, ...CHAIN_UNITS]) {
          const got = dt.endOf(unit);
          const want = dt
            .plus({ [unit]: 1 })
            .startOf(unit)
            .minus(1);

          assert.equal(got.toISO(), want.toISO(), `endOf ${unit} of ${iso}`);
          assert.equal(got.offset, want.offset, `offset after endOf ${unit} of ${iso}`);
        }
      }
    });

    test("endOf reads unit spellings the way it always has", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromISO("2024-06-15T12:00:00.000", { zone: ZONE }) as unknown as {
        endOf: (u: string) => { toISO: () => string | null };
      };

      assert.equal(dt.endOf("WEEK").toISO(), dt.endOf("week").toISO());
      assert.equal(dt.endOf("Day").toISO(), dt.endOf("day").toISO());
      assert.throws(() => dt.endOf("fortnight"));
    });

    // ---- the routes around the fused one ----

    test("an options object still routes endOf through startOf", async () => {
      const m = await loadLuxon(keys);

      // Saturday, in a locale whose weeks start on Sunday
      const dt = m.DateTime.fromISO("2024-06-15T12:00:00.000", { zone: ZONE }).setLocale("en-US");

      // a locale week ends on Saturday night, where the ISO week runs to Sunday
      assert.equal(
        dt.endOf("week", { useLocaleWeeks: true }).toISO(),
        "2024-06-15T23:59:59.999-04:00"
      );
      assert.equal(dt.endOf("week").toISO(), "2024-06-16T23:59:59.999-04:00");

      // an empty options object is still an options object, and takes the
      // startOf route -- its destructuring is observable
      assert.equal(dt.endOf("week", {}).toISO(), dt.endOf("week").toISO());
      assert.equal(dt.endOf("day", {}).toISO(), dt.endOf("day").toISO());
    });

    test("a result of the fused route never claims to be a hole resolution", async () => {
      const m = await loadLuxon(keys);

      // a receiver created in the spring-forward hole carries wasHole; the end
      // of its day is a plain instant and must not
      const dt = m.DateTime.fromObject(
        { year: 2017, month: 3, day: 12, hour: 2, minute: 30 },
        { zone: ZONE }
      );

      assert.equal(dt.wasHole, true);
      assert.equal(dt.endOf("day").wasHole, false);
      assert.equal(dt.endOf("day").toISO(), "2017-03-12T23:59:59.999-04:00");
    });

    // ---- the boundaries no benchmark zone has: midnight transitions ----

    // Chile springs forward at local midnight, so the fused route's boundary
    // is sometimes a time that does not exist and fixOffset's hole branch has
    // to place it. The chain agrees here -- hole resolutions do not depend on
    // the offset guess -- so this stays differential, plus one recorded pin.
    test("a boundary in a spring-forward hole lands past the gap", async () => {
      const m = await loadLuxon(keys);

      const dt = m.DateTime.fromISO("2019-09-07T12:00:00.000", { zone: "America/Santiago" });

      assert.equal(dt.endOf("day").toISO(), "2019-09-07T23:59:59.999-04:00");
      assert.equal(dt.endOf("day").toISO(), dt.plus({ days: 1 }).startOf("day").minus(1).toISO());
    });

    // Havana falls back across local midnight, and here the fused route
    // legitimately parts ways with the chain: the chain's endOf("day") landed
    // an hour inside the next day (00:59:59.999 on the first pass through the
    // fold), where the boundary placed with the receiver's own offset ends the
    // day on the receiver's side. These are recorded, not differential, and
    // they are what the PR document's behavior note points at. Amman mirrors
    // the same fold from east of UTC, where a wrong offset guess converges to
    // the wrong side of it.
    test("a midnight fold ends the day on the receiver's side", async () => {
      const m = await loadLuxon(keys);

      const havana = m.DateTime.fromISO("2020-10-31T12:00:00.000", { zone: "America/Havana" });

      assert.equal(havana.endOf("day").toISO(), "2020-10-31T23:59:59.999-04:00");
      // the month boundary is the same midnight, and answers the same way --
      // this half is I's behavior, kept by K's rewrite of the same route
      assert.equal(
        m.DateTime.fromISO("2020-10-15T12:00:00.000", { zone: "America/Havana" })
          .endOf("month")
          .toISO(),
        "2020-10-31T23:59:59.999-04:00"
      );
      // a week ending after the fold is not itself ambiguous, and stays put
      assert.equal(havana.endOf("week").toISO(), "2020-11-01T23:59:59.999-05:00");

      const amman = m.DateTime.fromISO("2021-10-28T12:00:00.000", { zone: "Asia/Amman" });

      assert.equal(amman.endOf("day").toISO(), "2021-10-28T23:59:59.999+03:00");
    });
  });
}
