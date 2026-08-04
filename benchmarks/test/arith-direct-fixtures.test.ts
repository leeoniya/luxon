// H's sweep, reduced to the cases that actually discriminate.
//
// The sweep beside this file compares roughly a million calls against a stock
// build. That works while the fork exists and stops working the moment a patch
// merges, because upstream has one tree and nothing to compare against. So every
// mutation in benchmarks/mutations/08-arith-direct.ts was run against the sweep
// and the case that failed first was recorded; those cases are below, and nothing
// else is. `node mutate.ts --patch 08-arith-direct` is what checks that claim.
//
// Two of the fixtures were not found that way. They are the two mutations the
// sweep did NOT catch, which is the more interesting half of the result: a
// million comparisons missed `numeric: "auto"` entirely, because it is the only
// option that reaches formatRelativeTime's `lastable` branch, and missed a diff
// between endpoints at different times of day, because every pair it built shared
// a wall clock. Both are marked below.
//
// Where an answer can be derived rather than recorded, it is. The system zone
// compares against the expression it replaced, and whole time units compare
// against timestamp arithmetic — neither can rot when tzdata or ICU moves. The
// recorded values are civil results in one zone, which is what luxon's own
// test/datetime/math.test.js already asserts.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["arithDirect", [patchKey("arithDirect")]],
  ["every patch", [...patchKeys]],
];

const ZONE = "America/New_York";
// one second before spring forward, so a fast path that mishandles the offset
// lands in the hole rather than beside it
const TS = 1710053999000;

for (const [label, keys] of VARIANTS) {
  describe(`arithDirect fixtures > ${label}`, () => {
    const load = async () => {
      const m = await loadLuxon(keys);
      return { m, dt: m.DateTime.fromMillis(TS, { zone: ZONE, locale: "en-US" }) };
    };

    // durationValues replaced fromDurationLike, so every input the old path
    // rejected has to be rejected the same way, and every input it accepted has
    // to survive the trip through a fixed-shape record.
    test("the arguments plus and minus accept and reject", async () => {
      const { m, dt } = await load();
      const iso = (d: unknown) => (d as { toISO(): string | null }).toISO();
      const threw = (f: () => unknown) => {
        try {
          return `${f()}`;
        } catch (e) {
          return `${(e as Error).message}`;
        }
      };

      // a bare number goes through asNumber, which is the whole of what
      // fromMillis validated
      assert.equal(threw(() => dt.minus(Infinity as never)), "Invalid unit value Infinity");
      // the unit name is normalized before the value is, and { bogus: "nope" }
      // is the input that can tell: it is invalid twice over
      assert.equal(threw(() => dt.plus({ bogus: "nope" } as never)), "Invalid unit bogus");
      // an invalid Duration reads NaN out of every getter, as it did before
      assert.equal(threw(() => dt.plus(m.Duration.invalid("because"))), "Invalid unit value NaN");

      // for-in walks the prototype chain and the old path did not
      assert.equal(iso(dt.plus(Object.create({ days: 9 }) as never)), "2024-03-10T01:59:59.000-05:00");
      assert.equal(iso(dt.plus({ days: undefined } as never)), "2024-03-10T01:59:59.000-05:00");
      assert.equal(iso(dt.plus({ days: null } as never)), "2024-03-10T01:59:59.000-05:00");

      // a real Duration takes the getter branch, so a field dropped there shows
      // up nowhere else
      assert.equal(iso(dt.plus(m.Duration.fromObject({ years: 1 }))), "2025-03-10T01:59:59.000-04:00");
      assert.equal(iso(dt.plus(m.Duration.fromObject({ quarters: 1 }))), "2024-06-10T01:59:59.000-04:00");
    });

    // minus negates all nine fields by hand now, so each one needs to be seen
    // moving in the right direction at least once
    test("every unit negates", async () => {
      const { dt } = await load();
      const want: [string, string][] = [
        ["years", "2023-03-10T01:59:59.000-05:00"],
        ["quarters", "2023-12-10T01:59:59.000-05:00"],
        ["months", "2024-02-10T01:59:59.000-05:00"],
        ["weeks", "2024-03-03T01:59:59.000-05:00"],
        ["days", "2024-03-09T01:59:59.000-05:00"],
        ["hours", "2024-03-10T00:59:59.000-05:00"],
        ["minutes", "2024-03-10T01:58:59.000-05:00"],
        ["seconds", "2024-03-10T01:59:58.000-05:00"],
        ["milliseconds", "2024-03-10T01:59:58.999-05:00"],
      ];

      for (const [unit, iso] of want) {
        assert.equal(dt.minus({ [unit]: 1 } as never).toISO(), iso, `minus({${unit}: 1})`);
      }
    });

    test("Duration arithmetic reads unit values directly", async () => {
      const { m } = await load();
      const a = m.Duration.fromObject({
        years: 2,
        quarters: 3,
        months: 4,
        weeks: 5,
        days: 6,
        hours: 7,
        minutes: 8,
        seconds: 9,
        milliseconds: 10,
      });
      const b = m.Duration.fromObject({
        years: 1,
        quarters: 1,
        months: 1,
        weeks: 1,
        days: 1,
        hours: 1,
        minutes: 1,
        seconds: 1,
        milliseconds: 1,
      });

      assert.deepEqual(a.plus(b).toObject(), {
        years: 3,
        quarters: 4,
        months: 5,
        weeks: 6,
        days: 7,
        hours: 8,
        minutes: 9,
        seconds: 10,
        milliseconds: 11,
      });
      assert.deepEqual(a.minus(b).toObject(), {
        years: 1,
        quarters: 2,
        months: 3,
        weeks: 4,
        days: 5,
        hours: 6,
        minutes: 7,
        seconds: 8,
        milliseconds: 9,
      });
      assert.deepEqual(a.minus({ years: 1, milliseconds: 10 }).toObject(), {
        years: 1,
        quarters: 3,
        months: 4,
        weeks: 5,
        days: 6,
        hours: 7,
        minutes: 8,
        seconds: 9,
        milliseconds: 0,
      });
    });

    // the sum replaces a Duration round trip only when all nine values are whole
    // and the result stays finite, and both halves of that are load-bearing
    test("the whole-value guard", async () => {
      const { m, dt } = await load();

      assert.equal(dt.plus({ days: 1.5 }).toISO(), "2024-03-11T13:59:59.000-04:00");
      assert.equal(dt.plus({ hours: 1.5 }).toISO(), "2024-03-10T04:29:59.000-04:00");
      // luxon answers this by adding nothing, which the patch preserves rather
      // than corrects — the sum overflows, so the old path has to keep running
      assert.equal(dt.plus({ seconds: 1e308 }).toISO(), "2024-03-10T01:59:59.000-05:00");
      assert.equal(m.DateTime.fromMillis(0).plus({ milliseconds: 9e15 }).toISO(), null);

      // whole time units move the timestamp by exactly their own size, which is
      // derived rather than recorded
      assert.equal(dt.plus({ minutes: 1 }).valueOf() - TS, 60_000);
      assert.equal(dt.plus({ hours: 2 }).valueOf() - TS, 7_200_000);
      assert.equal(dt.minus({ seconds: 90 }).valueOf() - TS, -90_000);
    });

    // the calendar-free early return skips fixOffset entirely, so anything that
    // sets a calendar field has to keep reaching it
    test("the calendar-free fast path", async () => {
      const { dt } = await load();

      // each of these crosses spring forward, where a day is 23 hours and the
      // fast path's flat sum would be an hour out
      assert.equal(dt.plus({ days: 1 }).toISO(), "2024-03-11T01:59:59.000-04:00");
      assert.equal(dt.plus({ weeks: 1 }).toISO(), "2024-03-17T01:59:59.000-04:00");
      assert.equal(dt.plus({ years: 1 }).toISO(), "2025-03-10T01:59:59.000-04:00");
      assert.equal(dt.plus({ quarters: 1 }).toISO(), "2024-06-10T01:59:59.000-04:00");
      // endOf goes through both, and is off by a millisecond if the sum is
      assert.equal(dt.endOf("year").toISO(), "2024-12-31T23:59:59.999-05:00");
      // weekyears is the alias furthest down the hoisted table
      assert.equal(dt.set({ weekyears: 2 } as never).toISO(), "0002-03-10T01:59:59.000-04:56");
    });

    // the early return reports wasHole false without consulting fixOffset. That
    // is right because reading a hole resolution's civil time back out lands
    // outside the hole — but only the receiver can still be in one.
    test("a receiver constructed into a DST hole", async () => {
      const { m } = await load();
      const hole = m.DateTime.fromObject(
        { year: 2017, month: 3, day: 12, hour: 2, minute: 0 },
        { zone: ZONE }
      );
      const holeOf = (d: unknown) => (d as { wasHole: boolean }).wasHole;

      assert.equal(holeOf(hole), true, "the receiver is in a hole");
      assert.equal(hole.plus(0).toISO(), "2017-03-12T03:00:00.000-04:00");
      assert.equal(holeOf(hole.plus(0)), false, "adding nothing leaves the hole behind");
      assert.equal(holeOf(hole.plus({ hours: 1 })), false);
    });

    test("the hoisted relative-time tables", async () => {
      const { dt } = await load();
      const rel = (d: unknown, opts: Record<string, unknown>) =>
        (d as { toRelative(o: unknown): string | null }).toRelative({ base: dt, ...opts });

      // the abbreviation table, which only the short style reads
      assert.equal(rel(dt.plus({ years: 1 }), { style: "short" }), "in 1 yr.");

      // NOT from the sweep, and awkward to reach on purpose. The lastable list
      // exists to keep "next second" from displacing "in 1 second", so seeing it
      // work needs numeric "auto" paired with a sub-day unit — and toRelative
      // pins numeric to "always", while toRelativeCalendar pins it to "auto" but
      // only ever picks years, months or days for itself. The one door left is
      // toRelativeCalendar's `unit` option, which survives the spread that sets
      // the rest. Nothing in a million comparisons went through it.
      const cal = (d: unknown, unit: string) =>
        (d as { toRelativeCalendar(o: unknown): string | null }).toRelativeCalendar({ base: dt, unit });

      assert.equal(cal(dt.plus({ seconds: 1 }), "seconds"), "in 1 second");
      assert.equal(cal(dt.minus({ seconds: 1 }), "seconds"), "1 second ago");
      assert.equal(cal(dt, "seconds"), "in 0 seconds");
      // and the units that ARE lastable still are, so the fixture above is
      // pinning the list's contents rather than deleting the branch
      assert.equal(cal(dt.plus({ days: 1 }), "days"), "tomorrow");
    });

    test("dayDiff", async () => {
      const { m, dt } = await load();

      // the mixed-unit walk, across a transition
      const earlier = dt.minus({ years: 1, months: 1, days: 4, hours: 1 });
      assert.equal(dt.diff(earlier, ["years", "months", "days", "hours"]).toISO(), "P1Y1M4DT1H");

      // years 0-99 are the reason this goes through objToLocalTS rather than
      // Date.UTC, which would map year 1 into the 1900s
      const y1 = m.DateTime.fromObject({ year: 1, month: 1, day: 1 }, { zone: ZONE });
      assert.equal(dt.diff(y1, "days").toISO(), "P738954.0869444445D");
    });

    test("exact millisecond diff", async () => {
      const { m, dt } = await load();
      const other = m.DateTime.fromMillis(TS + 123_456_789, { zone: "Europe/Paris" });

      assert.deepEqual(other.diff(dt, "milliseconds").toObject(), { milliseconds: 123_456_789 });
      assert.deepEqual(dt.diff(other, "milliseconds").toObject(), { milliseconds: -123_456_789 });
      assert.deepEqual(dt.diff(dt, "milliseconds").toObject(), { milliseconds: 0 });
      assert.deepEqual(other.diff(dt, ["seconds", "milliseconds"]).toObject(), {
        seconds: 123_456,
        milliseconds: 789,
      });
      assert.deepEqual(
        m.Interval.fromDateTimes(dt, other).toDuration("milliseconds").toObject(),
        { milliseconds: 123_456_789 }
      );
    });

    // SystemZone#offset reuses one Date across calls, so the oracle is the
    // expression it replaced. Interleaved, because a probe that is never reset
    // answers the first timestamp correctly forever.
    test("the shared system-zone probe", async () => {
      const { m } = await load();
      const sys = m.DateTime.fromMillis(TS).zone;
      const other = m.IANAZone.create("Asia/Kolkata");

      for (const ts of [TS, TS + 86_400_000, 0, -86_400_000 * 400, TS]) {
        assert.equal(sys.offset(ts), -new Date(ts).getTimezoneOffset(), `system offset at ${ts}`);
        // another zone between the reads, so a probe shared across zones rather
        // than across calls would show up here
        other.offset(ts);
        assert.equal(sys.offset(ts), -new Date(ts).getTimezoneOffset(), `system offset at ${ts}, again`);
      }
    });
  });
}
