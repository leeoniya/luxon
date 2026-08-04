// A is still load-bearing underneath D and E when D declines a formatter
// layout. This forces that full-stack fallback and proves it reaches A's shared
// DTF cache rather than constructing the stock formatter on every read.
//
// Run: node --test benchmarks/test/zone-info-fallback-fixtures.test.ts
//      bun test benchmarks/test/zone-info-fallback-fixtures.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, type PatchKey } from "../lib/patches.ts";
import { stockName } from "../lib/stock-zone.ts";

const TS = Date.UTC(2024, 6, 15, 23);
const ZONE = "America/New_York";
const LOCALE = "en-US";

const VARIANTS: [string, PatchKey[]][] = [
  ["A alone", [patchKey("zoneInfoCache")]],
  [
    "A under D/E",
    ["zoneInfoCache", "offsetScan", "zoneNameScan", "transitionInterval"].map(patchKey),
  ],
];

for (const [label, keys] of VARIANTS) {
  describe(`zoneInfoCache fallback > ${label}`, () => {
    test("reuses and resets the fallback formatter", async () => {
      const lux = await loadLuxon(keys);
      const Real = Intl.DateTimeFormat;
      const want = stockName(TS, "short", LOCALE, ZONE);
      let fallbackConstructions = 0;

      lux.Settings.resetCaches();

      try {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
          const opts = args[1] as Intl.DateTimeFormatOptions | undefined;
          const dtf = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);

          // D's narrow scanner asks only for hour + timeZoneName. Make format()
          // disagree with its parts so D must reject it. A's fallback asks for
          // the full date/time shape; count those constructions without bending
          // their answer.
          if (opts?.timeZoneName !== undefined && opts.year === undefined) {
            const format = dtf.format.bind(dtf);
            Object.defineProperty(dtf, "format", {
              configurable: true,
              value: (ts: number) => `~${format(ts)}`,
            });
          } else if (opts?.timeZoneName !== undefined) {
            fallbackConstructions++;
          }

          return dtf;
        };

        const zone = lux.IANAZone.create(ZONE);
        const read = () => zone.offsetName(TS, { format: "short", locale: LOCALE } as never);

        assert.equal(read(), want);
        assert.equal(fallbackConstructions, 1, "first fallback did not construct exactly one formatter");

        assert.equal(read(), want);
        assert.equal(fallbackConstructions, 1, "fallback formatter was not reused");

        lux.Settings.resetCaches();

        assert.equal(read(), want);
        assert.equal(fallbackConstructions, 2, "resetCaches did not clear the fallback formatter");
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
        lux.Settings.resetCaches();
      }
    });
  });
}
