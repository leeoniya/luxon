// B decodes six numbers out of dtf.format() and converts them with integer
// arithmetic. The oracle is the expression it replaced, kept in lib/stock-zone.ts,
// so nothing below is a recorded value and no tzdata update can turn it red on
// its own.
//
// The cases are the ones that failed first when each mutation in
// benchmarks/mutations/02-offset-scan.ts was run against the sweep beside this
// file. That is why the timestamps look arbitrary: -62587360024261 is where a
// truncated era stops matching a floored one, -94069002240 is where the century
// leap rule starts to matter, and the sub-second ones are where flooring towards
// zero and flooring down disagree.
//
// One mutation the sweep did not catch is here too: dropping the check that the
// zone came back with the field order B expects. No zone on any ICU tested
// produces a different one, so it is reached by handing the scanner a formatter
// that does.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";
import { stockOffset } from "../lib/stock-zone.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["offsetScan", [patchKey("offsetScan")]],
  ["transitionInterval", [patchKey("transitionInterval")]],
  ["every patch", [...patchKeys]],
];

const ZONES = [
  "America/New_York",
  "Europe/Dublin", // negative DST
  "Australia/Lord_Howe", // 30-minute step
  "Pacific/Chatham", // 45-minute offset
  "Asia/Kolkata", // no DST
  "Pacific/Kiritimati", // +14
  "UTC",
];

// Each of these is where some mutation first disagreed with stock.
const INSTANTS = [
  0,
  1767225600000, // the epoch shift
  1769922000000, // the era boundary month
  -94069002240, // the century leap rule, and a negative sub-second remainder
  -149990079995,
  -1538845061110,
  -62587360024261, // BC, where a truncated era and a floored one part company
  8.64e15, // the last instant Date accepts
  -8.64e15,
  8.64e15 + 1, // and the first it does not
  -8640000000000000 - 1,
  1710053999999,
  -1,
  -999,
  -1000,
  -1001,
  1.5, // a fractional timestamp
  -1.5,
];

for (const [label, keys] of VARIANTS) {
  describe(`offsetScan fixtures > ${label}`, () => {
    test("the decoded offset matches the expression it replaced", async () => {
      const m = await loadLuxon(keys);

      for (const name of ZONES) {
        const zone = m.IANAZone.create(name);

        for (const ts of INSTANTS) {
          const got = zone.offset(ts);
          const want = stockOffset(name, ts);

          assert.ok(
            Object.is(got, want) || got === want,
            `${name} @${ts}: got ${got}, expected ${want}`
          );
        }
      }
    });

    // These are the transitions most likely to expose an offset decoder that
    // accidentally assumes whole minutes, one-hour DST, or a date that advances
    // by at most one day. They are stable historical rule changes rather than
    // projections, and the expected offsets are stated independently of the
    // stock implementation used by the broad sweep above.
    test("historical second, quarter-hour and skipped-day transitions", async () => {
      const m = await loadLuxon(keys);
      const cases: [string, number, number, number][] = [
        // Local mean time included seconds before standardized offsets.
        ["America/New_York", Date.UTC(1883, 10, 18, 17), -(4 * 60 + 56 + 2 / 60), -5 * 60],
        ["Africa/Monrovia", Date.UTC(1919, 2, 1, 0, 43, 8), -(43 + 8 / 60), -44.5],
        ["Africa/Monrovia", Date.UTC(1972, 0, 7, 0, 44, 30), -44.5, 0],
        // Nepal moved by fifteen minutes, not a DST-sized hour.
        ["Asia/Kathmandu", Date.UTC(1985, 11, 31, 18, 30), 5.5 * 60, 5.75 * 60],
        // Samoa moved across the date line and skipped an entire civil day.
        ["Pacific/Apia", Date.UTC(2011, 11, 30, 10), -10 * 60, 14 * 60],
      ];

      for (const [name, transition, before, after] of cases) {
        const zone = m.IANAZone.create(name);

        // Interleave both sides as well as reading them once. The all-patches
        // variant carries D's interval cache, so a stale span would surface.
        for (const [ts, want] of [
          [transition - 1, before],
          [transition, after],
          [transition - 1, before],
          [transition, after],
        ] as [number, number][]) {
          assert.equal(zone.offset(ts), want, `${name} @${new Date(ts).toISOString()}`);
        }
      }
    });

    // Every real transition of one dense zone, either side to the millisecond.
    // A decoder that is right at an arbitrary instant and wrong at a boundary is
    // the failure this is for, and boundaries are cheap to enumerate.
    test("either side of every transition of a dense zone", async () => {
      const m = await loadLuxon(keys);
      const name = "America/New_York";
      const zone = m.IANAZone.create(name);

      // walk a decade of local noons and take the instants where the offset moves
      let prev = zone.offset(Date.UTC(2015, 0, 1));

      for (let ts = Date.UTC(2015, 0, 1); ts < Date.UTC(2025, 0, 1); ts += 3_600_000) {
        const now = zone.offset(ts);

        if (now !== prev) {
          for (const at of [ts - 1, ts, ts + 1, ts - 3_600_000, ts + 3_600_000]) {
            assert.equal(zone.offset(at), stockOffset(name, at), `${name} @${at}`);
          }
          prev = now;
        }
      }
    });

    // NOT from the sweep. B measures the field order once per zone and refuses
    // anything it does not recognise, and no ICU produces one it does not — so
    // the refusal is reached by making one.
    test("an unfamiliar field order is refused rather than decoded", async () => {
      const m = await loadLuxon(keys);
      const Real = Intl.DateTimeFormat;
      const name = "America/New_York";

      m.IANAZone.resetCache();

      try {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
          const dtf = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
          const parts = dtf.formatToParts.bind(dtf);

          // day before month, which is most of the world and none of en-US
          const bend = (ps: Intl.DateTimeFormatPart[]) => {
            const out = [...ps];
            const m0 = out.findIndex((p) => p.type === "month");
            const d0 = out.findIndex((p) => p.type === "day");
            if (m0 >= 0 && d0 >= 0) [out[m0], out[d0]] = [out[d0]!, out[m0]!];
            return out;
          };

          Object.defineProperty(dtf, "formatToParts", {
            configurable: true,
            value: (ts: number) => bend(parts(ts)),
          });
          Object.defineProperty(dtf, "format", {
            configurable: true,
            value: (ts: number) => bend(parts(ts)).map((p) => p.value).join(""),
          });

          return dtf;
        };

        const zone = m.IANAZone.create(name);

        // The stock path this has to fall back to fills its fields by name, so
        // reordering the parts does not disturb it and the right answer is still
        // the right answer. B reads by position, so a scanner that accepts this
        // layout reads the day as the month — hence dates where the two differ.
        for (const ts of [Date.UTC(2024, 0, 15, 3), Date.UTC(2024, 6, 15, 23)]) {
          assert.equal(zone.offset(ts), stockOffset(name, ts), `bent layout @${ts}`);
        }
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
        m.IANAZone.resetCache();
      }
    });

    test("IANAZone.resetCache() drops the scanners", async () => {
      const m = await loadLuxon(keys);
      const name = "America/New_York";
      const ts = Date.UTC(2024, 6, 15, 23);
      const Real = Intl.DateTimeFormat;

      assert.equal(m.IANAZone.create(name).offset(ts), stockOffset(name, ts));

      try {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
          const dtf = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
          const realFormat = dtf.format.bind(dtf);
          // an hour later than the truth, which no zone reports and every
          // decoder would notice
          Object.defineProperty(dtf, "format", {
            configurable: true,
            value: (t: number) => realFormat(t + 3_600_000),
          });
          return dtf;
        };

        m.IANAZone.resetCache();

        assert.equal(
          m.IANAZone.create(name).offset(ts),
          stockOffset(name, ts) + 60,
          "a scanner outlived IANAZone.resetCache()"
        );
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
        m.IANAZone.resetCache();
      }
    });
  });
}
