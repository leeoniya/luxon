// I removes short-lived objects. Each removal is invisible for a different
// reason, so each gets its own sweep or fixture.
//
// clone stopped merging its config and now names the seven fields. The risk is a
// field that reads differently when it is named than when it was spread: a
// missing one silently falls back to the current value, which for `ts` or `zone`
// is a different DateTime and not an error. So the sweep drives every one of
// clone's six call sites — setZone with and without keepLocalTime, toUTC,
// reconfigure, set, plus, minus — across zones and DST edges, and compares the
// instant, the zone, the locale and the invalid reason, since a wrong `invalid`
// or `loc` would not move the timestamp at all.
//
// as() computes the sum shiftTo would have walked to. The risk is floating point:
// shiftTo splits its running total into an integer and a remainder and adds them
// back together, which is not the identity, and its getter ends in `|| 0`, which
// is not the identity either. So that sweep is organised by input — fractions
// chosen so the split does not reassemble, values past 2^53, non-finite sums,
// both conversion accuracies — and compares with Object.is so that NaN and -0
// have to agree and not merely compare equal.
//
// endOf memoizes `{ [unit]: 1 }` on the string it was handed and combines the
// fixed calendar boundaries' plus().startOf() pair. The sweep asks for every
// real unit, aliases, offset edges and object-prototype names, and compares with stock.
// diff's single-lower-unit merge is covered by the focused cross-zone fixtures.
//
// Run: node --test 'benchmarks/test/*.test.ts'
//      bun test benchmarks/test/          (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DurationUnit } from "luxon";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["trimAllocs", [patchKey("trimAllocs")]],
  ["every patch", [...patchKeys]],
];

const ZONES = ["America/New_York", "Australia/Lord_Howe", "Asia/Kolkata", "Europe/Dublin", "UTC"];

// both US transitions, Lord Howe's half hour, and the ends of the range
const INSTANTS = [
  Date.UTC(2024, 2, 10, 6, 59, 59),
  Date.UTC(2024, 2, 10, 7, 0, 0),
  Date.UTC(2024, 10, 3, 5, 59, 59),
  Date.UTC(2024, 10, 3, 6, 0, 0),
  Date.UTC(2024, 3, 6, 16, 0, 0),
  Date.UTC(1970, 0, 1, 0, 0, 0),
  Date.UTC(2038, 0, 19, 3, 14, 8),
];

// as normalizeUnit spells them, as callers do, and in the case it does not care about
const DUR_UNITS = [
  "year", "years", "quarter", "quarters", "month", "months", "week", "weeks",
  "day", "days", "hour", "hours", "minute", "minutes", "second", "seconds",
  "millisecond", "milliseconds", "Days", "MINUTES",
];

const DT_UNITS = [
  "year", "years", "quarter", "quarters", "month", "months", "week", "weeks",
  "day", "days", "hour", "hours", "minute", "minutes", "second", "seconds",
  "millisecond", "milliseconds", "Month", "DAY",
];

const NOT_UNITS = ["", "fortnight", "dayz", "week "];

// What as() has to get right, grouped by what each one exercises.
const DURATIONS: Record<string, number>[] = [
  // ordinary, and the empty case
  {}, { minutes: 100 }, { hours: 1, minutes: 30, seconds: 15 },
  { years: 1, months: 2, days: 3 }, { weeks: 3, days: -20 }, { quarters: 2, months: -1 },

  // mixed signs and zeroes, where the `|| 0` and the sign of the remainder show
  { minutes: 0 }, { minutes: -100 }, { days: -1, hours: 25 }, { hours: -1, minutes: 30 },
  { seconds: -0 }, { days: 0, hours: -0 },

  // fractions, including four where shiftTo's trunc-and-remainder split does not
  // reassemble the total exactly — most fractions do, so these were searched for
  { minutes: 1.5 }, { hours: 1 / 3 }, { milliseconds: 0.5 },
  { hours: -204.63316678596144 }, { minutes: -0.003974581243864517 },
  { seconds: -248.3538081770198 }, { milliseconds: 334.2807337622956 },

  // large enough that summation order would show, then past the end of the range
  { seconds: Number.MAX_SAFE_INTEGER }, { years: 1e6 }, { hours: 1e15, milliseconds: 1 },
  { hours: Infinity }, { days: -Infinity }, { seconds: 1e308 },
  { seconds: 1e308, milliseconds: -1e308 },
];

const stock = await loadLuxon([]);

/** whatever the call produces, including the way it fails */
function outcome(fn: () => unknown): string {
  try {
    return String(fn());
  } catch (e) {
    return `throws ${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
}

/**
 * Everything clone carries, so a wrong field shows up even when the instant does
 * not move. wasHole is in here because it is the one field of the seven whose
 * only effect is a getter of its own — drop it and every timestamp still agrees.
 */
function describeDT(dt: any): string {
  return dt.isValid
    ? [dt.valueOf(), dt.zone.name, dt.offset, dt.locale, dt.numberingSystem, dt.outputCalendar, dt.wasHole].join("|")
    : `invalid: ${dt.invalidReason} / ${dt.invalidExplanation}`;
}

describe("trimAllocs is invisible", () => {
  for (const [name, keys] of VARIANTS) {
    describe(name, () => {
      test("every clone call site, across zones and transitions", async () => {
        const patched = await loadLuxon(keys);

        // named separately from the loop so a failure says which setter moved
        const SETTERS: [string, (m: any, dt: any) => any][] = [
          ["setZone", (m, dt) => dt.setZone("Asia/Tokyo")],
          ["setZone keepLocalTime", (m, dt) => dt.setZone("Asia/Tokyo", { keepLocalTime: true })],
          ["setZone keepCalendarTime", (m, dt) => dt.setZone("Pacific/Chatham", { keepCalendarTime: true })],
          ["setZone same", (m, dt) => dt.setZone(dt.zone)],
          ["setZone invalid", (m, dt) => dt.setZone("Not/AZone")],
          ["toUTC", (m, dt) => dt.toUTC()],
          ["toUTC keepLocalTime", (m, dt) => dt.toUTC(0, { keepLocalTime: true })],
          ["toLocal", (m, dt) => dt.toLocal()],
          ["setLocale", (m, dt) => dt.setLocale("fr-CA")],
          ["reconfigure", (m, dt) => dt.reconfigure({ numberingSystem: "beng", outputCalendar: "islamic" })],
          ["set", (m, dt) => dt.set({ hour: 3, minute: 7 })],
          ["set rollover", (m, dt) => dt.set({ month: 2, day: 31 })],
          ["plus", (m, dt) => dt.plus({ months: 1, hours: 5 })],
          ["plus fractional", (m, dt) => dt.plus({ days: 1.5 })],
          ["minus", (m, dt) => dt.minus({ days: 400 })],
          ["plus out of range", (m, dt) => dt.plus({ years: 1e9 })],
          ["startOf", (m, dt) => dt.startOf("month")],
          ["endOf", (m, dt) => dt.endOf("month")],
          // 2:30 on 2024-03-10 does not exist in New York, so these two set
          // wasHole, which nothing else about the result reflects
          ["set into a hole", (m, dt) => dt.set({ year: 2024, month: 3, day: 10, hour: 2, minute: 30 })],
          [
            "setZone into a hole",
            (m, dt) =>
              dt
                .set({ year: 2024, month: 3, day: 10, hour: 2, minute: 30 })
                .setZone("America/New_York", { keepLocalTime: true }),
          ],
          ["out of a hole", (m, dt) => dt.set({ year: 2024, month: 3, day: 10, hour: 2 }).plus({ days: 1 })],
          // the setters chained, since each one's output is the next one's input
          ["chained", (m, dt) => dt.setZone("Europe/Berlin").plus({ days: 3 }).setLocale("de").startOf("week")],
        ];

        for (const zone of ZONES) {
          for (const ts of INSTANTS) {
            const w = stock.DateTime.fromMillis(ts, { zone, locale: "en-GB" });
            const g = patched.DateTime.fromMillis(ts, { zone, locale: "en-GB" });

            for (const [what, apply] of SETTERS) {
              assert.equal(
                describeDT(apply(patched, g)),
                describeDT(apply(stock, w)),
                `${what} ${zone} ${ts}`
              );
            }

            // and off an invalid DateTime, which takes the other branch of every setter
            const bad = (m: any) => m.DateTime.invalid("because");

            for (const [what, apply] of SETTERS) {
              assert.equal(
                outcome(() => describeDT(apply(patched, bad(patched)))),
                outcome(() => describeDT(apply(stock, bad(stock)))),
                `${what} on invalid`
              );
            }
          }
        }
      });

      test("endOf and startOf over every unit, its aliases, and the strings that are not units", async () => {
        const patched = await loadLuxon(keys);

        for (const zone of ["America/New_York", "UTC"]) {
          for (const ts of INSTANTS) {
            const w = stock.DateTime.fromMillis(ts, { zone });
            const g = patched.DateTime.fromMillis(ts, { zone });

            for (const unit of [...DT_UNITS, ...NOT_UNITS]) {
              assert.equal(
                outcome(() => g.endOf(unit as any)?.toISO()),
                outcome(() => w.endOf(unit as any)?.toISO()),
                `endOf(${JSON.stringify(unit)}) ${zone} ${ts}`
              );

              assert.equal(
                outcome(() => g.endOf(unit as any, { useLocaleWeeks: true })?.toISO()),
                outcome(() => w.endOf(unit as any, { useLocaleWeeks: true })?.toISO()),
                `endOf(${JSON.stringify(unit)}, useLocaleWeeks) ${zone} ${ts}`
              );

              assert.equal(
                outcome(() => g.startOf(unit as any)?.toISO()),
                outcome(() => w.startOf(unit as any)?.toISO()),
                `startOf(${JSON.stringify(unit)}) ${zone} ${ts}`
              );
            }
          }
        }

        // the memo is keyed on the string it was handed, so asking twice has to
        // answer the same thing — and asking for a rejected unit twice has to
        // reject twice, rather than the first call leaving something behind
        const g = patched.DateTime.fromMillis(INSTANTS[0]!, { zone: "UTC" });

        for (const unit of [...DT_UNITS, ...NOT_UNITS]) {
          assert.equal(
            outcome(() => g.endOf(unit as any)?.toISO()),
            outcome(() => g.endOf(unit as any)?.toISO()),
            `endOf(${JSON.stringify(unit)}) twice`
          );
        }
      });

      test("Duration#as over every unit and every shape, both accuracies", async () => {
        const patched = await loadLuxon(keys);

        // fromObject rejects a non-finite field, so the shapes that hold one are
        // built the way a caller reaches them: by adding two Durations, which
        // writes the sum straight into the values without going back through
        // normalizeObject
        const build = (m: any, shape: Record<string, number>, opts: object) => {
          const half: Record<string, number> = {};
          let doubled = false;

          for (const [k, v] of Object.entries(shape)) {
            if (Number.isFinite(v)) half[k] = v;
            else {
              half[k] = v === Infinity ? 1e308 : -1e308;
              doubled = true;
            }
          }

          const d = m.Duration.fromObject(half, opts);

          return doubled ? d.plus(d).plus(d) : d;
        };

        for (const shape of DURATIONS) {
          for (const accuracy of ["casual", "longterm"] as const) {
            const opts = { conversionAccuracy: accuracy };
            const w = build(stock, shape, opts);
            const g = build(patched, shape, opts);

            for (const unit of [...DUR_UNITS, ...NOT_UNITS]) {
              const a = outcome(() => g.as(unit as DurationUnit));
              const b = outcome(() => w.as(unit as DurationUnit));

              assert.equal(a, b, `as(${JSON.stringify(unit)}) ${JSON.stringify(shape)} ${accuracy}`);

              // String() maps -0 to "0" and would let a sign flip through
              if (!a.startsWith("throws")) {
                assert.ok(
                  Object.is(g.as(unit as DurationUnit), w.as(unit as DurationUnit)),
                  `as(${unit}) ${JSON.stringify(shape)} ${accuracy}: ` +
                    `${g.as(unit as DurationUnit)} vs ${w.as(unit as DurationUnit)}`
                );
              }
            }
          }
        }
      });

      test("Duration#as off the other ways a Duration is built", async () => {
        const patched = await loadLuxon(keys);

        for (const unit of DUR_UNITS) {
          const u = unit as DurationUnit;

          for (const ms of [0, 1, -1, 0.5, -0.5, 86_400_000, 1e300, Number.MAX_SAFE_INTEGER]) {
            assert.equal(
              outcome(() => patched.Duration.fromMillis(ms).as(u)),
              outcome(() => stock.Duration.fromMillis(ms).as(u)),
              `fromMillis(${ms}).as(${unit})`
            );
          }

          for (const iso of ["P1Y2M3DT4H5M6S", "PT0S", "-P1D", "P0.5Y", "PT1.5H", "P10000Y"]) {
            assert.equal(
              outcome(() => patched.Duration.fromISO(iso).as(u)),
              outcome(() => stock.Duration.fromISO(iso).as(u)),
              `fromISO(${iso}).as(${unit})`
            );
          }

          assert.equal(
            outcome(() => patched.Duration.invalid("nope").as(u)),
            outcome(() => stock.Duration.invalid("nope").as(u)),
            `invalid.as(${unit})`
          );
        }
      });

      test("the callers that read Duration#as for their own answer", async () => {
        const patched = await loadLuxon(keys);

        // Interval#length and #count go through as(), and diff's remainder does too
        for (const zone of ZONES) {
          for (const ts of INSTANTS) {
            for (const span of [1, 45, 400, -180]) {
              const at = ts + span * 86_400_000 + 5_400_000;
              const iv = (m: any) =>
                m.Interval.fromDateTimes(m.DateTime.fromMillis(ts, { zone }), m.DateTime.fromMillis(at, { zone }));

              for (const unit of ["days", "hours", "months", "years", "milliseconds"]) {
                assert.equal(
                  outcome(() => iv(patched).length(unit)),
                  outcome(() => iv(stock).length(unit)),
                  `Interval#length(${unit}) ${zone} ${ts} +${span}d`
                );

                assert.equal(
                  outcome(() => iv(patched).count(unit)),
                  outcome(() => iv(stock).count(unit)),
                  `Interval#count(${unit}) ${zone} ${ts} +${span}d`
                );
              }

              assert.equal(
                outcome(() => iv(patched).toDuration(["months", "days", "hours"]).toISO()),
                outcome(() => iv(stock).toDuration(["months", "days", "hours"]).toISO()),
                `Interval#toDuration ${zone} ${ts} +${span}d`
              );
            }
          }
        }
      });
    });
  }
});
