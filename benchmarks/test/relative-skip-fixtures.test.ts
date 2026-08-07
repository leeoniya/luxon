// H's fixtures.
//
// The floor table is a claim about tzdata, so almost nothing here is a recorded
// string. The oracle is luxon itself: toRelative({ unit: "weeks" }) takes the
// single-unit branch above the loop, which this patch does not touch, so the
// answer the loop should have reached can be asked for directly and compared.
// That follows tzdata wherever it moves.
//
// Four of the fixtures are zones rather than cases. They are the extremes of the
// floor table, and one of them found a real bug: a week in Pacific/Apia spanning
// the deleted 2011-12-30 is six real days, under the 6.9-day floor an earlier
// draft carried, and "in 1 week" came back as "in 7 days". The floors are now
// derived from the -12:00..+14:00 offset range rather than fitted to tzdata, and
// these four are what holds that derivation in place.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["relativeSkip", [patchKey("relativeSkip")]],
  ["every patch", [...patchKeys]],
];

type DT = {
  toRelative: (o: unknown) => string | null;
  diff: (o: unknown, u: string) => { get: (u: string) => number };
};

const D = 86400000;

/**
 * What the loop would have answered with nothing skipped: the first unit whose
 * own diff reaches one, asked for by name so the single-unit branch answers it.
 */
const unskipped = (base: DT, at: DT, units: string[]): string | null => {
  for (const unit of units) {
    if (Math.abs(at.diff(base, unit).get(unit)) >= 1) {
      return at.toRelative({ base, unit });
    }
  }

  return at.toRelative({ base, unit: units[units.length - 1] });
};

for (const [label, keys] of VARIANTS) {
  describe(`relativeSkip fixtures > ${label}`, () => {
    // The extremes of tzdata, one per floored unit. Each is a span of exactly one
    // unit that takes much less real time than a naive floor would allow, because
    // the zone jumped forward inside it.
    // JEST-MIRROR (sync until relativeSkip merges, then remove): test/datetime/relative.test.js — "DateTime#toRelative reports units shortened by historical zone jumps"
    test("a unit whose span was shortened by a large jump is still reported as that unit", async () => {
      const m = await loadLuxon(keys);

      // each of these is the shortest that unit gets anywhere in tzdata, found by
      // walking every hour around every jump over an hour and taking the minimum
      // of plus({unit: 1}) minus the anchor
      const cases: [string, string, string, string[], string][] = [
        // 2011-12-30 was deleted outright: a seven-day week took six real days
        ["Pacific/Apia", "2011-12-24T00:00", "2011-12-31T00:00", ["weeks", "days", "hours"], "week"],
        // the zone was abolished and jumped seven hours, off a January 31st that
        // clamps to the 28th: 88d17h
        ["Antarctica/Davis", "1969-01-31T00:00", "1969-04-30T00:00", ["quarters", "months", "days"], "quarter"],
        // the same jump and the same clamp, one month wide: 27d17h
        ["Antarctica/Davis", "1969-01-31T00:00", "1969-02-28T00:00", ["months", "weeks", "days"], "month"],
        // ten hours in 1948, which makes this local day fourteen hours long
        ["Antarctica/Macquarie", "1948-03-24T10:00", "1948-03-25T10:00", ["days", "hours"], "day"],
        // another deleted day, inside a year that is therefore 364 days
        ["Pacific/Enderbury", "1994-11-21T00:00", "1995-11-21T00:00", ["years", "months", "days"], "year"],
      ];

      for (const [zone, from, to, units, expected] of cases) {
        const base = m.DateTime.fromISO(from, { zone }) as unknown as DT;
        const at = m.DateTime.fromISO(to, { zone }) as unknown as DT;
        const got = at.toRelative({ base, unit: units });

        assert.equal(got, unskipped(base, at, units), `${zone} ${from} -> ${to}`);
        assert.match(
          got ?? "",
          new RegExp(expected),
          `${zone}: a ${expected}-long span that took ${((+(at as never) - +(base as never)) / D).toFixed(2)} real days`
        );
      }
    });

    // A floor is a lower bound, so the interesting spans are the ones just above
    // it, where skipping would be wrong for the first time.
    // JEST-MIRROR (sync until relativeSkip merges, then remove): test/datetime/relative.test.js — "DateTime#toRelative does not skip spans that only just reach a unit"
    test("a span that only just reaches a unit is not skipped", async () => {
      const m = await loadLuxon(keys);
      const zone = "UTC";

      // the last three are the shortest that unit can be on the calendar alone,
      // with no zone involved: a quarter off January 31st clamps to April 30th
      // and is 89 days, and a year off February 29th is 365
      const cases: [string, string, string, string[]][] = [
        ["seconds", "2023-01-01T00:00:00", "2023-01-01T00:00:01", ["seconds"]],
        ["minutes", "2023-01-01T00:00:00", "2023-01-01T00:01:00", ["minutes", "seconds"]],
        ["hours", "2023-01-01T00:00:00", "2023-01-01T01:00:00", ["hours", "minutes"]],
        ["days", "2023-01-01T00:00:00", "2023-01-02T00:00:00", ["days", "hours"]],
        ["weeks", "2023-01-01T00:00:00", "2023-01-08T00:00:00", ["weeks", "days"]],
        ["months", "2023-01-31T00:00:00", "2023-02-28T00:00:00", ["months", "weeks"]],
        ["quarters", "2023-01-31T00:00:00", "2023-04-30T00:00:00", ["quarters", "months"]],
        ["years", "2024-02-29T00:00:00", "2025-02-28T00:00:00", ["years", "months"]],
      ];

      for (const [unit, from, to, units] of cases) {
        const base = m.DateTime.fromISO(from, { zone }) as unknown as DT;
        const at = m.DateTime.fromISO(to, { zone }) as unknown as DT;
        const got = at.toRelative({ base, unit: units });

        assert.equal(got, unskipped(base, at, units), `exactly one ${unit}`);
        assert.match(got ?? "", new RegExp(unit.slice(0, -1)), `exactly one ${unit} reported as ${got}`);
      }
    });

    // JEST-MIRROR (sync until relativeSkip merges, then remove): test/datetime/relative.test.js — "DateTime#toRelative falls through for spans just under a unit in both directions"
    test("a span a hair under a unit falls through to the next one down", async () => {
      const m = await loadLuxon(keys);
      const zone = "UTC";
      const base = m.DateTime.fromISO("2023-06-01T00:00", { zone }) as unknown as DT;
      const units = ["years", "quarters", "months", "weeks", "days", "hours", "minutes", "seconds"];

      for (const under of [1, 999, 59999, 3599999, D - 1, 7 * D - 1, 30 * D - 1, 364 * D]) {
        const at = m.DateTime.fromMillis(+(base as never) + under, { zone }) as unknown as DT;

        assert.equal(got(at, base, units), unskipped(base, at, units), `${under}ms after`);
      }

      function got(a: DT, b: DT, u: string[]) {
        return a.toRelative({ base: b, unit: u });
      }
    });

    // JEST-PARTIAL (sync shared cases; not removable): test/datetime/relative.test.js — "DateTime#toRelative falls through for spans just under a unit in both directions"
    // JEST-PARTIAL (sync shared cases; not removable): test/datetime/relative.test.js — "DateTime#toRelative finds a backward six-day week across the Pacific/Apia jump"
    // JEST-PARTIAL (sync shared cases; not removable): test/datetime/relative.test.js — "DateTime#toRelative finds a backward shortened quarter in Antarctica/Davis"
    test("a span reaching backwards is measured the same way", async () => {
      const m = await loadLuxon(keys);
      const zone = "America/New_York";
      const base = m.DateTime.fromISO("2024-03-15T12:00", { zone }) as unknown as DT;
      const units = ["years", "months", "days", "hours", "minutes", "seconds"];

      for (const back of [1000, 90 * 60000, 5 * 3600000, 3 * D, 45 * D, 400 * D]) {
        const at = m.DateTime.fromMillis(+(base as never) - back, { zone }) as unknown as DT;

        assert.equal(at.toRelative({ base, unit: units }), unskipped(base, at, units), `${back}ms before`);
      }
    });

    // Measuring the span with a sign rather than a magnitude leaves every answer
    // right and skips nothing at all for a past instant, which no assertion about
    // the answer can see. Count the diffs instead.
    test("a span reaching backwards skips as much as one reaching forwards", async () => {
      const m = await loadLuxon(keys);
      const zone = "America/New_York";
      const proto = (m.DateTime as unknown as { prototype: Record<string, unknown> }).prototype;
      const real = proto["diff"] as (...a: unknown[]) => unknown;
      let asked = 0;

      Object.defineProperty(proto, "diff", {
        configurable: true,
        value: function (this: unknown, ...a: unknown[]) {
          asked++;
          return real.apply(this, a);
        },
      });

      try {
        const base = m.DateTime.fromISO("2024-06-15T12:00", { zone });
        const counts: Record<string, number> = {};

        for (const [label, delta] of [
          ["ahead", 180000],
          ["behind", -180000],
        ] as const) {
          const at = m.DateTime.fromMillis(+base + delta, { zone });
          asked = 0;
          at.toRelative({ base });
          counts[label] = asked;
        }

        assert.equal(
          counts["behind"],
          counts["ahead"],
          `three minutes ago took ${counts["behind"]} diffs where three minutes from now took ${counts["ahead"]}`
        );
        assert.ok(counts["ahead"]! <= 3, `three minutes took ${counts["ahead"]} diffs of the six units`);
      } finally {
        Object.defineProperty(proto, "diff", { configurable: true, writable: true, value: real });
      }
    });

    // The calendary path counts boundary crossings, not elapsed time, so no
    // amount of closeness implies anything and the skip has to stay out of it.
    // JEST-MIRROR (sync until relativeSkip merges, then remove): test/datetime/relative.test.js — "DateTime#toRelativeCalendar keeps calendary boundary semantics"
    test("two hours either side of local midnight is still yesterday and tomorrow", async () => {
      const m = await loadLuxon(keys);
      const zone = "America/New_York";
      const late = m.DateTime.fromISO("2024-03-14T23:00", { zone });
      const early = m.DateTime.fromISO("2024-03-15T01:00", { zone });

      assert.equal(early.toRelativeCalendar({ base: late }), "tomorrow");
      assert.equal(late.toRelativeCalendar({ base: early }), "yesterday");

      // and a year boundary crossed by one minute
      const eve = m.DateTime.fromISO("2023-12-31T23:59", { zone });
      const ny = m.DateTime.fromISO("2024-01-01T00:00", { zone });

      assert.equal(ny.toRelativeCalendar({ base: eve }), "next year");
      assert.equal(eve.toRelativeCalendar({ base: ny }), "last year");
    });

    // JEST-MIRROR (sync until relativeSkip merges, then remove): test/datetime/relative.test.js — "DateTime#toRelative padding crosses a day boundary in either direction"
    test("padding still moves the answer", async () => {
      const m = await loadLuxon(keys);
      const zone = "UTC";
      const base = m.DateTime.fromISO("2024-01-10T00:00", { zone });
      const at = m.DateTime.fromISO("2024-01-10T23:00", { zone });

      assert.equal(at.toRelative({ base }), "in 23 hours");
      // padding pushes it over the day boundary
      assert.equal(at.toRelative({ base, padding: 2 * 3600000 }), "in 1 day");
      // and in the other direction it is subtracted, not added
      const ago = m.DateTime.fromISO("2024-01-09T01:00", { zone });
      assert.equal(ago.toRelative({ base }), "23 hours ago");
      assert.equal(ago.toRelative({ base, padding: 2 * 3600000 }), "1 day ago");
    });

    // JEST-MIRROR (sync until relativeSkip merges, then remove): test/datetime/relative.test.js — "DateTime#toRelative handles unknown and zero-valued unit lists"
    test("a unit with no floor is still asked, and still throws if it is not a unit", async () => {
      const m = await loadLuxon(keys);
      const zone = "UTC";
      const base = m.DateTime.fromISO("2024-01-10T00:00", { zone });
      const at = m.DateTime.fromISO("2024-01-10T00:00:00.500", { zone });

      assert.throws(() => at.toRelative({ base, unit: ["fortnights"] } as never), /Invalid unit/);
    });

    // JEST-MIRROR (sync until relativeSkip merges, then remove): test/datetime/relative.test.js — "DateTime#toRelative handles unknown and zero-valued unit lists"
    test("identical instants report zero of the last unit asked for", async () => {
      const m = await loadLuxon(keys);
      const zone = "Europe/Berlin";
      const base = m.DateTime.fromISO("2024-05-05T05:05", { zone });
      const at = m.DateTime.fromISO("2024-05-05T05:05", { zone });

      assert.equal(at.toRelative({ base }), "in 0 seconds");
      assert.equal(at.toRelative({ base, unit: ["years", "months"] } as never), "in 0 months");
    });
  });
}
