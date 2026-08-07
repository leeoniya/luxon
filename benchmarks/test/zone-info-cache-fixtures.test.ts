// A swaps a per-call Intl.DateTimeFormat construction for the lookup luxon
// already had, then scans format() for the name. Two things have to hold: the
// formatter it gets back is the one it asked for, and both caches are still
// emptied when a caller asks for that.
//
// The reset test makes the scanner reject its mocked formatter after the reset,
// which drives the cached formatToParts fallback as well as the scanner path.
//
// The expected name is recomputed here with the expression A replaced, rather
// than recorded, so no CLDR update can turn this red on its own.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey } from "../lib/patches.ts";
import { stockName, type NameStyle } from "../lib/stock-zone.ts";

const STYLES: NameStyle[] = ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"];
const LOCALES = ["en-US", "de-DE", "ja-JP", "zh-CN", "fa-IR", "th-TH-u-ca-buddhist-nu-thai"];
const ZONES = ["America/New_York", "Asia/Kathmandu", "Australia/Lord_Howe", "UTC"];
const TS = Date.UTC(2024, 6, 15, 23);

describe("zoneInfoCache", () => {
  // JEST-PARTIAL (sync shared cases; not removable): test/zones/IANA.test.js — "matches Intl for every supported style and varied locale layout"
  test("the cached formatter is the one parseZoneInfo asked for", async () => {
    const m = await loadLuxon([patchKey("zoneInfoCache")]);

    for (const zone of ZONES) {
      const z = m.IANAZone.create(zone);

      for (const locale of LOCALES) {
        for (const format of STYLES) {
          assert.equal(
            z.offsetName(TS, { format, locale } as never),
            stockName(TS, format, locale, zone),
            `${zone} / ${locale} / ${format}`
          );
        }
      }
    }
  });

  // Both caches A starts reading are cleared by Locale.resetCache(), which
  // Settings.resetCaches() calls.
  test("Settings.resetCaches() reaches the shared formatter cache", async () => {
    const m = await loadLuxon([patchKey("zoneInfoCache")]);
    const z = m.IANAZone.create("America/New_York");
    const Real = Intl.DateTimeFormat;

    const before = z.offsetName(TS, { format: "short", locale: "en-US" } as never);
    assert.equal(before, stockName(TS, "short", "en-US", "America/New_York"));

    try {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
        const f = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
        const real = f.formatToParts.bind(f);
        Object.defineProperty(f, "formatToParts", {
          configurable: true,
          value: (...a: unknown[]) =>
            (real(...(a as [])) as Intl.DateTimeFormatPart[]).map((p) =>
              p.type.toLowerCase() === "timezonename" ? { ...p, value: "SWAPPED" } : p
            ),
        });
        return f;
      };

      // still the old answer: the formatter is cached and nothing has reset it
      assert.equal(z.offsetName(TS, { format: "short", locale: "en-US" } as never), before);

      m.Settings.resetCaches();

      assert.equal(
        z.offsetName(TS, { format: "short", locale: "en-US" } as never),
        "SWAPPED",
        "resetCaches did not reach the formatter cache parseZoneInfo now shares"
      );
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
      m.Settings.resetCaches();
    }
  });
});
