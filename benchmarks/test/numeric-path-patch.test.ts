// F's one change off the formatter is tsToObj, and it is the one with a risk
// worth a file. Replacing new Date(ts) with civil math also dropped the TimeClip
// the Date constructor was running on the way in — truncate toward zero, NaN
// outside +/-MAX_DATE — and neither is something a benchmark reaches, because
// every timestamp a benchmark builds is a whole number well inside the range.
// Both are reachable from ordinary calls, and both were bugs here until this
// sweep found them. So the sweep is organised by the shape of the timestamp
// rather than by the method: fractional, negative-fractional, exactly on the
// range boundary, past it, and NaN.
//
// The other five changes are on the formatter, where the check that matters is
// that every rendered string still matches stock. That is the --verify pass in
// benchmarks/format.ts and benchmarks/upstream.ts, which compares 20,000 values
// per format per path, and it covers far more patterns than a file here could.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["compileFormat", [patchKey("compileFormat")]],
  ["every patch", [...patchKeys]],
];

/** an invalid DateTime values as NaN, so validity has to agree before the instant can */
function same(a: any, b: any): boolean {
  return a.isValid ? b.isValid && a.valueOf() === b.valueOf() : !b.isValid && a.invalidReason === b.invalidReason;
}

const stock = await loadLuxon([]);

describe("compileFormat's numeric fast paths are invisible", () => {
  for (const [name, keys] of VARIANTS) {
    describe(name, () => {
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

      // The civil math replacing new Date(ts) also replaced the TimeClip the
      // constructor was running on the way in. Both halves of it are checked
      // here rather than only through plus, because fromMillis and fromSeconds
      // reach tsToObj without doing any arithmetic at all: a regression in
      // either half should not depend on which caller found it.
      test("tsToObj clips its timestamp the way new Date did", async () => {
        const patched = await loadLuxon(keys);

        // truncation toward zero, which is not Math.floor for negatives
        for (const ts of [0.5, -0.5, 1.25, -1.25, 1710053999000.5, -1710053999000.5, 999.999]) {
          assert.equal(
            patched.DateTime.fromMillis(ts, { zone: "UTC" }).toISO(),
            stock.DateTime.fromMillis(ts, { zone: "UTC" }).toISO(),
            `fromMillis(${ts})`
          );

          assert.equal(
            patched.DateTime.fromMillis(ts, { zone: "UTC" }).millisecond,
            stock.DateTime.fromMillis(ts, { zone: "UTC" }).millisecond,
            `fromMillis(${ts}).millisecond`
          );
        }

        // and the same fraction arriving from the two callers that make one
        for (const seconds of [1.0005, -1.0005, 0.9999]) {
          assert.equal(
            patched.DateTime.fromSeconds(seconds, { zone: "UTC" }).toISO(),
            stock.DateTime.fromSeconds(seconds, { zone: "UTC" }).toISO(),
            `fromSeconds(${seconds})`
          );
        }

        // NaN outside the range. Calendar units overflow through objToLocalTS,
        // whose Date.UTC already returns NaN; milliseconds are added to the
        // timestamp after that step, so only they reach tsToObj out of range.
        const epoch = (m: any) => m.DateTime.fromMillis(0, { zone: "UTC" });
        const edge = (m: any) => m.DateTime.fromMillis(8.64e15, { zone: "UTC" });

        for (const amount of [
          { milliseconds: 9e15 }, { milliseconds: -9e15 }, { hours: 2.5e12 },
          { seconds: 8.64e12 }, { milliseconds: 8.64e15 }, { milliseconds: 8.64e15 + 1 },
        ]) {
          const what = JSON.stringify(amount);

          assert.equal(epoch(patched).plus(amount).isValid, epoch(stock).plus(amount).isValid, `plus(${what})`);
          assert.equal(epoch(patched).plus(amount).toISO(), epoch(stock).plus(amount).toISO(), `plus(${what}) ISO`);
          assert.equal(epoch(patched).minus(amount).toISO(), epoch(stock).minus(amount).toISO(), `minus(${what}) ISO`);
        }

        // and one step either side of the boundary itself
        for (const amount of [{ milliseconds: 0 }, { milliseconds: 1 }, { milliseconds: -1 }, { days: 1 }]) {
          assert.equal(
            edge(patched).plus(amount).toISO(),
            edge(stock).plus(amount).toISO(),
            `MAX_DATE plus(${JSON.stringify(amount)})`
          );
        }
      });
    });
  }
});
