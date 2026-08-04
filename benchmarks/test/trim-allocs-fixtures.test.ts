// J's fixtures.
//
// All three changes replace an expression that is still in the tree, so nothing
// here is a recorded number. `as()` keeps `shiftTo(unit).get(unit)` as its
// fallback for units it cannot place, and that expression is the whole of what
// it replaced, so every case below is checked against it. `endOf` is checked
// against the `plus({ [unit]: 1 }).startOf(unit).minus(1)` it used to be. Only
// `clone` has no expression left to compare with, and it is checked through the
// methods that call it.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["trimAllocs", [patchKey("trimAllocs")]],
  ["every patch", [...patchKeys]],
];

const ZONE = "America/New_York";

// the ordered units, plus the spellings and the two that only endOf takes
const ENDOF_UNITS = [
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
  "hour",
  "hours",
  "minute",
  "minutes",
  "second",
  "seconds",
  "millisecond",
  "milliseconds",
] as const;

const AS_UNITS = [
  "years",
  "quarters",
  "months",
  "weeks",
  "days",
  "hours",
  "minutes",
  "seconds",
  "milliseconds",
] as const;

for (const [label, keys] of VARIANTS) {
  describe(`trimAllocs fixtures > ${label}`, () => {
    // ---- as() ----

    test("as() answers what shiftTo().get() answers", async () => {
      const m = await loadLuxon(keys);

      const shapes: Record<string, number>[] = [
        { hours: 60 },
        { hours: 1, minutes: 30 },
        { minutes: 90 },
        { days: 1, hours: 12, minutes: 30, seconds: 15, milliseconds: 500 },
        // a value below the target unit, which is the divide-down half of the sum
        { milliseconds: 1 },
        { seconds: 1, milliseconds: 500 },
        // and above it, which is the multiply-up half
        { years: 2, months: 6 },
        { quarters: 3 },
        { weeks: 2, days: 3 },
        // negatives, and mixed signs, where trunc and floor part ways
        { hours: -60 },
        { hours: -1, minutes: -30 },
        { hours: 1, minutes: -30 },
        { hours: -1, minutes: 30 },
        { days: -1, milliseconds: 1 },
        // fractions, where the trunc-and-remainder split is not the identity
        { hours: 1.5 },
        { seconds: 0.1 },
        { seconds: 0.2 },
        { minutes: 1.0000001 },
        { days: 0.3333333333 },
        // negative fractions, where truncating and flooring choose different
        // wholes and only the remainder puts them back together
        { hours: -1.5 },
        { hours: -0.1 },
        { seconds: -0.3333333333 },
        { minutes: -1e-7 },
        // and values where shiftTo's detour through thousandths is the whole of
        // the difference, in the last bit
        { hours: 40.599848099943756 },
        { hours: -271.0026115978799 },
        { minutes: 96.67190976656002 },
        // zero and empty, where `|| 0` decides the answer -- including a negative
        // one, which is falsy and so becomes positive
        {},
        { hours: 0 },
        { hours: -0 },
        { hours: -0, minutes: -0 },
        { hours: 0, minutes: 0 },
        // large, where the multiply-up can lose precision if ordered badly
        { years: 10000 },
        { milliseconds: 8.64e15 },
      ];

      for (const accuracy of ["casual", "longterm"] as const) {
        for (const shape of shapes) {
          const d = m.Duration.fromObject(shape, { conversionAccuracy: accuracy });

          for (const unit of AS_UNITS) {
            const want = (d.shiftTo(unit) as unknown as { get: (u: string) => number }).get(unit);
            const got = d.as(unit);

            // Object.is rather than equal, so that a negative zero surviving
            // where shiftTo produced a positive one is a failure
            assert.ok(
              Object.is(got, want),
              `${accuracy} ${JSON.stringify(shape)}.as(${unit}) = ${got}, shiftTo says ${want}`
            );
          }
        }
      }
    });

    test("as() of an invalid duration is NaN, and of a unit it cannot place is what it always was", async () => {
      const m = await loadLuxon(keys);
      const bad = m.Duration.invalid("because");

      assert.ok(Number.isNaN(bad.as("hours")));

      // normalizeUnit's table is an object literal, so these get past its check
      // and shiftTo indexes the matrix with them; the fallback has to reproduce
      // that, TypeError and all, rather than answer a number
      const d = m.Duration.fromObject({ hours: 3 });
      const outcome = (fn: () => unknown) => {
        try {
          return `= ${fn()}`;
        } catch (e) {
          return `threw ${(e as Error).constructor.name}`;
        }
      };

      for (const unit of ["__proto__", "constructor"]) {
        assert.equal(
          outcome(() => d.as(unit as never)),
          outcome(() => (d.shiftTo(unit as never) as unknown as { get: (u: string) => number }).get(unit)),
          `as(${unit})`
        );
      }

      assert.throws(() => d.as("fortnights" as never), /Invalid unit/);
    });

    // A spelling that normalizes to a unit has to be placed by its normalized
    // name; failing to normalize it leaves the answer right and reaches it
    // through the shiftTo this replaced, which only a count can see.
    test("a singular unit name takes the same route as a plural one", async () => {
      const m = await loadLuxon(keys);
      const proto = (m.Duration as unknown as { prototype: Record<string, unknown> }).prototype;
      const real = proto["shiftTo"] as (...a: unknown[]) => unknown;
      let fellBack = 0;

      Object.defineProperty(proto, "shiftTo", {
        configurable: true,
        value: function (this: unknown, ...a: unknown[]) {
          fellBack++;
          return real.apply(this, a);
        },
      });

      try {
        const d = m.Duration.fromObject({ hours: 3, minutes: 30 });

        for (const unit of ["hour", "hours", "minute", "minutes", "day", "days"]) {
          fellBack = 0;
          d.as(unit as never);

          assert.equal(fellBack, 0, `as(${unit}) fell back to shiftTo`);
        }
      } finally {
        Object.defineProperty(proto, "shiftTo", { configurable: true, writable: true, value: real });
      }
    });

    test("as() reads the accuracy the duration carries, not a default", async () => {
      const m = await loadLuxon(keys);
      const shape = { days: 365 };
      const casual = m.Duration.fromObject(shape, { conversionAccuracy: "casual" }).as("years");
      const longterm = m.Duration.fromObject(shape, { conversionAccuracy: "longterm" }).as("years");

      assert.notEqual(casual, longterm, "both matrices gave the same answer, so neither was consulted");
    });

    test("as() follows every conversion direction in a custom matrix", async () => {
      const m = await loadLuxon(keys);
      const seed = m.Duration.fromObject({});
      const matrix = structuredClone((seed as unknown as { matrix: object }).matrix) as Record<
        string,
        Record<string, number>
      >;

      matrix["years"]!["months"] = 17;
      matrix["months"]!["days"] = 41;
      matrix["days"]!["hours"] = 31;
      matrix["hours"]!["minutes"] = 47;
      matrix["minutes"]!["seconds"] = 53;
      matrix["seconds"]!["milliseconds"] = 997;

      const shapes = [
        { years: 1.25, months: -2, days: 3, hours: 4, minutes: 5, seconds: 6, milliseconds: 7 },
        { years: -0.5, days: -2.75, seconds: 1.125 },
        { months: 2, milliseconds: -1 },
      ];

      for (const shape of shapes) {
        const d = m.Duration.fromObject(shape, { matrix } as never);

        for (const unit of AS_UNITS) {
          const want = d.shiftTo(unit).get(unit);
          const got = d.as(unit);

          assert.ok(Object.is(got, want), `${JSON.stringify(shape)}.as(${unit}) = ${got}, shiftTo says ${want}`);
        }
      }
    });

    // ---- endOf ----

    test("endOf answers what plus().startOf().minus() answers", async () => {
      const m = await loadLuxon(keys);

      const anchors = [
        "2024-01-01T00:00:00.000",
        "2024-02-29T13:45:12.345",
        "2024-03-10T01:30:00.000", // the hour before spring forward
        "2024-11-03T01:30:00.000", // the repeated hour
        "2024-12-31T23:59:59.999",
        "2023-06-15T12:00:00.000",
      ];

      for (const iso of anchors) {
        const dt = m.DateTime.fromISO(iso, { zone: ZONE }) as unknown as {
          endOf: (u: string) => { toISO: () => string };
          plus: (o: unknown) => { startOf: (u: string) => { minus: (n: number) => { toISO: () => string } } };
        };

        for (const unit of ENDOF_UNITS) {
          const want = dt.plus({ [unit]: 1 }).startOf(unit).minus(1).toISO();

          assert.equal(dt.endOf(unit).toISO(), want, `${iso} endOf(${unit})`);
        }
      }
    });

    test("the cached unit object is not consumed by the call that used it", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromISO("2024-03-10T01:30:00.000", { zone: ZONE });

      // if plus() kept or mutated what it was handed, the second and third would
      // differ from the first
      for (const unit of ["day", "month", "hour"] as const) {
        const first = dt.endOf(unit).toISO();

        assert.equal(dt.endOf(unit).toISO(), first, `second endOf(${unit})`);
        assert.equal(dt.endOf(unit).toISO(), first, `third endOf(${unit})`);
      }

      // and two receivers must not share an answer
      const other = m.DateTime.fromISO("2020-07-04T09:00:00.000", { zone: ZONE });

      assert.notEqual(other.endOf("day").toISO(), dt.endOf("day").toISO());
    });

    test("calendar-unit endOf preserves startOf's options handling", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromISO("2024-01-15T12:00", { zone: ZONE });
      let reads = 0;
      const opts = {
        get useLocaleWeeks() {
          reads++;
          return false;
        },
      };

      const expected = [
        ["year", "2024-12-31T23:59:59.999-05:00"],
        ["quarter", "2024-03-31T23:59:59.999-04:00"],
        ["month", "2024-01-31T23:59:59.999-05:00"],
      ] as const;

      for (const [unit, iso] of expected) {
        assert.equal(dt.endOf(unit, opts).toISO(), iso);
      }

      assert.equal(reads, expected.length, "startOf's option getter was skipped");
      assert.throws(() => dt.endOf("year", null as never), TypeError);
    });

    test("endOf preserves DST and locale-week calendar boundaries", async () => {
      const m = await loadLuxon(keys);
      const cases = [
        m.DateTime.fromISO("2024-03-10T01:30", { zone: ZONE, locale: "en-US" }),
        m.DateTime.fromISO("2024-11-03T01:30", { zone: ZONE, locale: "en-US" }),
        m.DateTime.fromISO("2020-12-31T23:30", { zone: "Europe/Paris", locale: "de-DE" }),
        m.DateTime.fromISO("2021-01-01T00:30", { zone: "Pacific/Apia", locale: "ar-SA" }),
      ];

      for (const dt of cases) {
        for (const useLocaleWeeks of [false, true]) {
          const opts = { useLocaleWeeks };
          const want = dt.plus({ week: 1 }).startOf("week", opts).minus(1);

          assert.equal(
            dt.endOf("week", opts).toISO(),
            want.toISO(),
            `${dt.toISO()} locale=${dt.locale} useLocaleWeeks=${useLocaleWeeks}`
          );
        }

        for (const unit of ["year", "quarter", "month"] as const) {
          const want = dt.plus({ [unit]: 1 }).startOf(unit).minus(1);
          assert.equal(dt.endOf(unit).toISO(), want.toISO(), `${dt.toISO()} endOf(${unit})`);
        }
      }
    });

    test("a unit named after something on Object.prototype is answered the way it always was", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromISO("2024-01-01T12:00", { zone: "UTC" }) as unknown as {
        endOf: (u: string) => { toISO: () => string };
        plus: (o: unknown) => { startOf: (u: string) => { minus: (n: number) => { toISO: () => string } } };
      };

      // luxon's own normalizeUnit lets these through, so endOf does not throw for
      // them; a cache that answered from its own prototype would hand plus()
      // something else entirely
      for (const unit of ["__proto__", "constructor"]) {
        const want = dt.plus({ [unit]: 1 }).startOf(unit).minus(1).toISO();

        assert.equal(dt.endOf(unit).toISO(), want, `endOf(${unit})`);
      }

      for (const unit of ["toString", "valueOf", "hasOwnProperty"]) {
        assert.throws(() => dt.endOf(unit), /Invalid unit/, `endOf(${unit})`);
      }

      assert.equal(dt.endOf("day").toISO(), "2024-01-01T23:59:59.999Z", "a real unit after all that");
    });

    // ---- diff ----

    test("diff with one lower-order unit matches stock", async () => {
      const [m, stock] = await Promise.all([loadLuxon(keys), loadLuxon([])]);
      const pairs = [
        ["2024-01-01T00:00:00.000", ZONE, "2024-01-01T02:17:00.000", ZONE],
        ["2024-03-09T23:30:00.000", ZONE, "2024-03-11T01:45:12.345", ZONE],
        ["2024-11-02T23:30:00.000", ZONE, "2024-11-04T01:45:12.345", ZONE],
        ["2020-02-29T12:00:00.000", "UTC", "2024-03-31T13:14:15.016", "Europe/Paris"],
        ["2011-12-29T12:00:00.000", "Pacific/Apia", "2012-01-02T08:00:00.000", "Pacific/Apia"],
      ] as const;
      const unitSets = [
        ["days", "hours"],
        ["months", "minutes"],
        ["years", "seconds"],
        ["weeks", "milliseconds"],
        ["hours"],
        // The fallback alongside the new branch.
        ["days", "hours", "minutes"],
      ] as const;

      for (const accuracy of ["casual", "longterm"] as const) {
        for (const [leftISO, leftZone, rightISO, rightZone] of pairs) {
          for (const reverse of [false, true]) {
            const build = (luxon: typeof m) => {
              const left = luxon.DateTime.fromISO(leftISO, { zone: leftZone });
              const right = luxon.DateTime.fromISO(rightISO, { zone: rightZone });
              return reverse ? ([right, left] as const) : ([left, right] as const);
            };
            const [left, right] = build(m);
            const [stockLeft, stockRight] = build(stock);

            for (const units of unitSets) {
              const got = left.diff(right, [...units], { conversionAccuracy: accuracy });
              const want = stockLeft.diff(stockRight, [...units], { conversionAccuracy: accuracy });
              const label = `${accuracy} ${leftISO}/${leftZone} ${reverse ? "<-" : "->"} ${rightISO}/${rightZone} ${units}`;

              assert.deepEqual(got.toObject(), want.toObject(), label);
              assert.equal(got.toISO(), want.toISO(), label);
            }
          }
        }
      }
    });

    // ---- clone ----

    test("every field clone forwards survives the methods that change one", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromISO("2024-03-10T01:30:00.000", { zone: ZONE, locale: "en-US" });

      // ts alone
      const later = dt.plus({ hours: 5 });
      assert.equal(+later, +dt + 5 * 3600000);
      assert.equal(later.zoneName, dt.zoneName, "plus kept the zone");
      assert.equal(later.locale, dt.locale, "plus kept the locale");

      // zone alone
      const moved = dt.setZone("Europe/Berlin");
      assert.equal(+moved, +dt, "setZone kept the instant");
      assert.equal(moved.zoneName, "Europe/Berlin");
      assert.equal(moved.locale, dt.locale, "setZone kept the locale");

      // locale alone
      const french = dt.setLocale("fr");
      assert.equal(+french, +dt, "setLocale kept the instant");
      assert.equal(french.zoneName, dt.zoneName, "setLocale kept the zone");
      assert.equal(french.locale, "fr");
      assert.notEqual(french.toFormat("MMMM"), dt.toFormat("MMMM"), "the locale reached the formatter");

      // numberingSystem and outputCalendar ride on loc as well
      const arab = dt.reconfigure({ numberingSystem: "arab" });
      assert.equal(arab.numberingSystem, "arab");
      assert.notEqual(arab.toFormat("yyyy"), dt.toFormat("yyyy"));

      // and set(), which goes through the o/wasHole path
      const set = dt.set({ hour: 4 });
      assert.equal(set.hour, 4);
      assert.equal(set.zoneName, dt.zoneName);
      assert.equal(set.locale, dt.locale);
    });

    // `old` is what lets the constructor reuse the calendar and offset it was
    // handed instead of deriving them again. Dropping it changes no answer, so
    // the only way to see it is to count what the zone is asked.
    test("a clone that moves neither the instant nor the zone asks the zone nothing", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromISO("2024-03-10T01:30:00.000", { zone: ZONE });
      const zone = (dt as unknown as { zone: Record<string, unknown> }).zone;
      const real = zone["offset"] as (...a: unknown[]) => unknown;
      let asked = 0;

      Object.defineProperty(zone, "offset", {
        configurable: true,
        value: function (this: unknown, ...a: unknown[]) {
          asked++;
          return real.apply(this, a);
        },
      });

      try {
        dt.year; // make sure nothing is left to compute lazily
        asked = 0;

        dt.setLocale("fr");
        dt.reconfigure({ numberingSystem: "arab" });

        assert.equal(asked, 0, `two clones that changed only the locale asked the zone ${asked} times`);
      } finally {
        Object.defineProperty(zone, "offset", { configurable: true, writable: true, value: real });
      }
    });

    test("wasHole survives a clone that was not asked to change it", async () => {
      const m = await loadLuxon(keys);
      // 2:30 does not exist on this date in this zone
      const hole = m.DateTime.fromObject({ year: 2024, month: 3, day: 10, hour: 2, minute: 30 }, { zone: ZONE });

      assert.equal((hole as unknown as { wasHole: boolean }).wasHole, true, "the fixture is not in a hole");

      // a clone that changes only the locale must not lose it
      assert.equal((hole.setLocale("fr") as unknown as { wasHole: boolean }).wasHole, true);

      // and one that lands outside a hole must not keep it
      const solid = m.DateTime.fromObject({ year: 2024, month: 3, day: 10, hour: 4 }, { zone: ZONE });
      assert.equal((solid as unknown as { wasHole: boolean }).wasHole, false);
      assert.equal((solid.setLocale("fr") as unknown as { wasHole: boolean }).wasHole, false);

      // set() is the case where the clone is told a different answer from the one
      // its receiver carried, in both directions
      const into = solid.set({ hour: 2, minute: 30 });
      assert.equal((into as unknown as { wasHole: boolean }).wasHole, true, "set() into the hole");

      const outOf = hole.set({ hour: 4 });
      assert.equal((outOf as unknown as { wasHole: boolean }).wasHole, false, "set() out of the hole");
    });

    test("an invalid DateTime stays invalid through the methods that clone it", async () => {
      const m = await loadLuxon(keys);
      const bad = m.DateTime.invalid("because");

      assert.equal(bad.isValid, false);
      assert.equal(bad.setLocale("fr").isValid, false);
      assert.equal(bad.setZone("Europe/Berlin").isValid, false);
      assert.equal(bad.plus({ days: 1 }).isValid, false);
      assert.equal(bad.endOf("day").isValid, false);
      assert.equal(bad.invalidReason, "because");
      assert.equal(bad.setLocale("fr").invalidReason, "because");
    });
  });
}
