// F replaces two library calls with arithmetic and adds four guards. The
// arithmetic has an exact oracle — the Date calls it replaced, which are still
// in the platform — so tsToObj is checked against new Date().getUTC*() rather
// than against recorded values, and padStart against String#padStart.
//
// The instants are chosen for where integer arithmetic and Date part company:
// before 1970, where flooring and truncating differ; before 1600 and before year
// 0, where the era does; the ends of the representable range; and fractions,
// which Date silently truncates and arithmetic does not.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["numericPath", [patchKey("numericPath")]],
  ["every patch", [...patchKeys]],
];

const MAX_DATE = 8.64e15;

/** where the two ways of turning a timestamp into fields disagree if they do */
const INSTANTS = [
  0,
  -1,
  1,
  -86400000,
  -86399999, // the last millisecond before the epoch day
  86400000,
  1710053999000,
  -2208988800000, // 1900, before the century rule bites
  -12212553600000, // 1583, the first full Gregorian year
  -62135596800000, // 0001-01-01
  -62167219200000, // 0000-01-01, where the era changes
  -62198755200000, // 0001 BC
  -MAX_DATE,
  MAX_DATE,
  -MAX_DATE + 1,
  MAX_DATE - 1,
  1e15,
  -1e15,
  951782400000, // 2000-02-29, the leap day the century rule would take away
  4107542400000, // 2100-03-01, the leap day the century rule does take away
];

/** tsToObj as it stood before F */
function stockFields(ts: number) {
  const d = new Date(ts);

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}

// Date.UTC rewrites years 0..99 as 1900..1999. setUTCFullYear is the platform
// route that preserves the proleptic year the test actually asks for.
function startOfUTCYear(year: number): number {
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(year, 0, 1);
  return d.valueOf();
}

for (const [label, keys] of VARIANTS) {
  describe(`numericPath fixtures > ${label}`, () => {
    test("the civil fields are the ones Date reads", async () => {
      const m = await loadLuxon(keys);

      for (const ts of INSTANTS) {
        const dt = m.DateTime.fromMillis(ts, { zone: "utc" });
        const want = stockFields(ts);

        assert.equal(dt.isValid, true, `@${ts} is not valid`);
        assert.deepEqual(
          {
            year: dt.year,
            month: dt.month,
            day: dt.day,
            hour: dt.hour,
            minute: dt.minute,
            second: dt.second,
            millisecond: dt.millisecond,
          },
          want,
          `@${ts}`
        );
      }
    });

    // Every day of a few chosen years, because the month arithmetic is a series
    // that can be right for most of a month and wrong on one day of it — the
    // constant in mp only moves the answer on the last day of February's
    // March-based year, which no scattered set of instants is likely to land on.
    test("every day across Gregorian 4, 100 and 400-year boundaries", async () => {
      const m = await loadLuxon(keys);

      // Includes BCE, year zero, Date.UTC's 0..99 trap, negative century
      // boundaries, and both sides of the modern Gregorian exceptions.
      for (const year of [-400, -100, -4, -1, 0, 1, 4, 99, 100, 400, 1583, 1900, 1969, 1972, 2000, 2024, 2100, 2400]) {
        const start = startOfUTCYear(year);
        const end = startOfUTCYear(year + 1);

        for (let ts = start; ts < end; ts += 86400000) {
          const dt = m.DateTime.fromMillis(ts, { zone: "utc" });
          const want = stockFields(ts);

          assert.deepEqual(
            { year: dt.year, month: dt.month, day: dt.day },
            { year: want.year, month: want.month, day: want.day },
            `@${ts}`
          );
        }
      }
    });

    // The same, through a zone with an offset, since the offset is added before
    // the arithmetic and moves every one of the boundaries above.
    test("the civil fields are the ones Date reads, offset too", async () => {
      const m = await loadLuxon(keys);

      for (const zone of ["America/New_York", "Asia/Kathmandu", "Pacific/Kiritimati"]) {
        for (const ts of INSTANTS) {
          const dt = m.DateTime.fromMillis(ts, { zone });

          if (!dt.isValid) continue; // the offset pushed it out of range

          const want = stockFields(ts + dt.offset * 60000);

          assert.deepEqual(
            { year: dt.year, month: dt.month, day: dt.day, hour: dt.hour, minute: dt.minute, second: dt.second },
            { year: want.year, month: want.month, day: want.day, hour: want.hour, minute: want.minute, second: want.second },
            `${zone} @${ts}`
          );
        }
      }
    });

    // new Date() ran TimeClip before any field was read, so both of these used
    // to be handled by the constructor and now have to be done by hand.
    test("a fractional timestamp is truncated and an out-of-range one is invalid", async () => {
      const m = await loadLuxon(keys);

      // fromSeconds multiplies by 1000, so a fraction of a millisecond reaches
      // tsToObj — and Date truncated towards zero rather than rounding, which
      // these tell apart in both directions
      for (const seconds of [1.0006, -1.0006, 0.9994, -0.9994, 1.5, -1.5]) {
        const dt = m.DateTime.fromSeconds(seconds, { zone: "utc" });

        assert.equal(+dt, seconds * 1000, `fromSeconds(${seconds}) keeps the instant it was given`);
        assert.deepEqual(
          {
            year: dt.year,
            month: dt.month,
            day: dt.day,
            hour: dt.hour,
            minute: dt.minute,
            second: dt.second,
            millisecond: dt.millisecond,
          },
          stockFields(Math.trunc(seconds * 1000)),
          `fromSeconds(${seconds}) fields`
        );
      }

      // past the calendar-overflow check, so this reaches tsToObj rather than
      // being turned away earlier
      const far = m.DateTime.fromMillis(MAX_DATE, { zone: "utc" }).plus({ milliseconds: 1 });
      assert.equal(far.isValid, false, "a millisecond past the end of time is still valid");

      assert.equal(m.DateTime.fromMillis(-MAX_DATE, { zone: "utc" }).minus({ milliseconds: 1 }).isValid, false);
      assert.equal(m.DateTime.fromMillis(MAX_DATE, { zone: "utc" }).isValid, true);
    });

    // padStart's table is only good for two-digit non-negative integers, and
    // luxon's ISO writer asks it for four- and six-wide years, three-wide
    // milliseconds, and offsets that go negative.
    test("padding matches String#padStart wherever the table does not apply", async () => {
      const m = await loadLuxon(keys);

      const pad = (n: number, w: number) =>
        (n < 0 ? "-" : "") + String(Math.abs(n)).padStart(w, "0");

      for (const year of [1, 9, 99, 100, 999, 1000, 2024, 9999]) {
        const dt = m.DateTime.fromObject(
          { year, month: 2, day: 3, hour: 4, minute: 5, second: 6, millisecond: 7 },
          { zone: "utc" }
        );

        assert.equal(
          dt.toISO({ suppressMilliseconds: false }),
          `${pad(year, 4)}-02-03T04:05:06.007Z`,
          `year ${year}`
        );
      }

      // beyond four digits, and negative, which is the expanded ISO form
      for (const year of [-1, -44, -2024, 10000, 275760]) {
        const dt = m.DateTime.fromObject({ year, month: 1, day: 1 }, { zone: "utc" });

        if (!dt.isValid) continue;

        assert.equal(dt.toISO()?.slice(0, 7), (year < 0 ? "-" : "+") + pad(Math.abs(year), 6), `year ${year}`);
      }

      // the offset, which is written with padStart and is negative for
      // everything east of Greenwich
      for (const [zone, want] of [
        ["UTC+5:45", "+05:45"],
        ["UTC-8", "-08:00"],
        ["UTC+14", "+14:00"],
        ["UTC-9:30", "-09:30"],
      ] as [string, string][]) {
        const dt = m.DateTime.fromMillis(1710053999000, { zone });
        assert.equal(dt.toISO()?.slice(-6), want, zone);
      }
    });

    // Two of the guards are about who is allowed onto the direct numeric path:
    // a locale that does not render latn digits, and a formatter carrying
    // options that change what a number looks like.
    test("a locale with its own digits does not take the direct path", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromMillis(1710053999000, { zone: "utc" });

      assert.equal(dt.reconfigure({ locale: "en-US" }).toFormat("yyyy-MM-dd"), "2024-03-10");
      assert.equal(dt.reconfigure({ locale: "ar-EG", numberingSystem: "arab" }).toFormat("yyyy"), "٢٠٢٤");
      assert.equal(dt.reconfigure({ locale: "en-US", numberingSystem: "beng" }).toFormat("dd"), "১০");
      assert.equal(dt.reconfigure({ locale: "th-TH", numberingSystem: "thai" }).toFormat("MM"), "๐๓");
    });

    test("Duration#toFormat keeps its own padding, flooring and rounding", async () => {
      const m = await loadLuxon(keys);

      // the formatter's padTo, which the token did not ask for
      assert.equal(m.Duration.fromObject({ hours: 5 }).toFormat("h"), "5");
      assert.equal(m.Duration.fromObject({ hours: 5 }).toFormat("hh"), "05");

      // flooring is the default, and the rounding to three places that stands in
      // for it when it is turned off
      const frac = m.Duration.fromObject({ seconds: 1.6667 });
      assert.equal(frac.toFormat("s"), "1");
      assert.equal(frac.toFormat("s", { floor: false }), "1.667");
      assert.equal(frac.toFormat("ss", { floor: false }), "01.667");
      assert.equal(m.Duration.fromObject({ seconds: 1.2345 }).toFormat("s", { floor: false }), "1.235");
      assert.equal(m.Duration.fromObject({ seconds: 90 }).shiftTo("minutes").toFormat("m", { floor: false }), "1.5");

      // roundTo again, on the ISO writer's seconds
      assert.equal(m.Duration.fromObject({ seconds: 1, milliseconds: 500 }).toISO(), "PT1.5S");
      assert.equal(m.Duration.fromObject({ seconds: 1, milliseconds: 5 }).toISO(), "PT1.005S");
      assert.equal(m.Duration.fromObject({ seconds: 0.0004 }).toISO(), "PT0S");
    });

    // A token with no letters in it cannot match any case in the formatter, so
    // it is passed through — but only if it really has no letters.
    test("punctuation passes through and anything with a letter does not", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromMillis(1710053999000, { zone: "utc" });

      assert.equal(dt.toFormat("yyyy-MM-dd'T'HH:mm:ss"), "2024-03-10T06:59:59");
      assert.equal(dt.toFormat("//--..::"), "//--..::");
      assert.equal(dt.toFormat("(yyyy) [MM] {dd}"), "(2024) [03] {10}");
      assert.equal(dt.toFormat("y!!!"), "2024!!!");

      // a letter that is not a token comes back unchanged as well, but through
      // the switch rather than around it — same answer, different route, and the
      // route is what the flag decides
      assert.equal(dt.toFormat("Q"), "Q");
      assert.equal(dt.toFormat("t"), "6:59 AM");
    });

    // parseFormat is memoized, so the same string has to keep meaning the same
    // thing and different strings have to keep meaning different things.
    test("a memoized format keeps its meaning", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromMillis(1710053999000, { zone: "utc" });

      const cases: [string, string][] = [
        ["yyyy", "2024"],
        ["yy", "24"],
        ["MM", "03"],
        ["M", "3"],
        ["MMM", "Mar"],
        ["MMMM", "March"],
        ["dd/MM/yyyy", "10/03/2024"],
        ["yyyy/MM/dd", "2024/03/10"],
        ["HH:mm:ss.SSS", "06:59:59.000"],
        ["'yyyy'", "yyyy"],
      ];

      // twice through, so every one of them is answered from the memo the
      // second time, and interleaved so a shared entry would show
      for (let pass = 0; pass < 2; pass++) {
        for (const [fmt, want] of cases) {
          assert.equal(dt.toFormat(fmt), want, `pass ${pass}: ${fmt}`);
        }
      }
    });
  });
}
