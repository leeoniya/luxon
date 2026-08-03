// D reads the zone name out of a fixed slice of a formatted string, so it is
// wrong if the slice is measured badly, reused where it does not apply, or kept
// when the layout it was measured against no longer holds.
//
// Running the mutations in benchmarks/mutations/04-zone-name-scan.ts against the
// sweep beside this file caught six of twelve. Every survivor was in the
// validation, and for two different reasons.
//
// The suffix machinery was untested because all five locales the sweep uses put
// the name last, so `suf` is 0 in every row and slicing to the end of the string
// is indistinguishable from slicing to the name. It is not defensive code: zh-CN
// renders the name FIRST and fa-IR wraps it in parentheses. Both are below.
//
// The three rejection paths are defensive. Asking ICU for every locale it has,
// across six styles and nine zones, produced no layout where format() differs
// from its parts joined and none that moves between D's probes. So those are
// reached here by handing the scanner a formatter that does, which also pins
// down something no sweep can: that each of the three probes is load-bearing.
//
// Expected names are recomputed with the expression D replaced, never recorded.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";
import { stockName, type NameStyle } from "../lib/stock-zone.ts";

const STYLES: NameStyle[] = ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"];

// en-US and de-DE put the name last; th-TH changes the width of everything
// before it; zh-CN puts it first and fa-IR puts it in brackets, so those two are
// the only rows where the suffix is not zero.
const LOCALES = ["en-US", "de-DE", "th-TH-u-ca-buddhist-nu-thai", "zh-CN", "fa-IR"];

const ZONES = [
  "America/New_York",
  "America/Cambridge_Bay", // renamed itself without moving
  "Asia/Kathmandu", // +05:45, no name but its offset
  "Australia/Lord_Howe", // 30-minute DST, so the name changes width
  "UTC",
];

// D's own probes: either side of a northern DST boundary, and one that renders
// 01 rather than 1
const INSTANTS = [Date.UTC(2024, 0, 15, 3), Date.UTC(2024, 6, 15, 23), Date.UTC(2024, 10, 3, 5)];

// What gets read back. The last two land on a single-digit local hour, which is
// the width the probes never see — a formatter that lets the hour size itself
// measures a prefix at these that is a character short of the one it stored.
const READS = [...INSTANTS, Date.UTC(2024, 0, 15, 14), Date.UTC(2024, 6, 15, 13)];

const VARIANTS: [string, PatchKey[]][] = [
  ["zoneNameScan", ["zoneInfoCache", "zoneNameScan"].map(patchKey)],
  ["every patch", [...patchKeys]],
];

/**
 * Runs `f` with Intl.DateTimeFormat wrapped so that formatters built for
 * `locale` come back mangled by `bend`. Installed before anything is built and
 * torn down after, with the caches cleared on both sides so the scanner under
 * test is the one this made.
 */
async function withBentIntl(
  m: Awaited<ReturnType<typeof loadLuxon>>,
  locale: string,
  bend: (parts: Intl.DateTimeFormatPart[], ts: number, f: Intl.DateTimeFormat) => Intl.DateTimeFormatPart[],
  f: () => void
) {
  const Real = Intl.DateTimeFormat;
  m.Settings.resetCaches();

  try {
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
      const dtf = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);

      if (args[0] !== locale) return dtf;

      const parts = dtf.formatToParts.bind(dtf);

      // format() stays the joined parts unless `bend` breaks that itself, so a
      // test can choose which of the two checks it is aiming at
      Object.defineProperty(dtf, "formatToParts", {
        configurable: true,
        value: (ts: number) => bend(parts(ts), ts, dtf),
      });
      Object.defineProperty(dtf, "format", {
        configurable: true,
        value: (ts: number) => bend(parts(ts), ts, dtf).map((p) => p.value).join(""),
      });

      return dtf;
    };

    f();
  } finally {
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
    m.Settings.resetCaches();
  }
}

for (const [label, keys] of VARIANTS) {
  describe(`zoneNameScan fixtures > ${label}`, () => {
    test("the name comes out whole, wherever the locale puts it", async () => {
      const m = await loadLuxon(keys);

      for (const zone of ZONES) {
        const z = m.IANAZone.create(zone);

        for (const locale of LOCALES) {
          for (const format of STYLES) {
            for (const ts of READS) {
              assert.equal(
                z.offsetName(ts, { format, locale } as never),
                stockName(ts, format, locale, zone),
                `${zone} / ${locale} / ${format} @${ts}`
              );
            }
          }
        }
      }
    });

    // The scanner is memoized, and its key has to be as wide as what it measured
    // against. Same locale, same instant, everything else moving.
    test("one scanner is not reused for another zone, style or locale", async () => {
      const m = await loadLuxon(keys);
      const ts = INSTANTS[0]!;
      const name = (zone: string, locale: string, format: NameStyle) =>
        m.IANAZone.create(zone).offsetName(ts, { format, locale } as never);

      // walked in an order that reuses each axis after the others have moved
      for (const zone of ZONES) {
        for (const locale of LOCALES) {
          for (const format of STYLES) {
            assert.equal(name(zone, locale, format), stockName(ts, format, locale, zone), `${zone}/${locale}/${format}`);
          }
        }
      }
    });

    // NOT from the sweep. No real locale disagrees with itself between D's
    // probes, so each probe is checked by making one — and only one — of them
    // come back with an extra character in front of the name. A scanner that no
    // longer looks at that instant measures a prefix that is wrong for the other
    // two and hands back a shifted slice.
    for (const [i, probe] of INSTANTS.entries()) {
      test(`a layout that moves at probe ${i} is refused`, async () => {
        const m = await loadLuxon(keys);
        const zone = "America/New_York";
        const locale = "en-US";

        await withBentIntl(
          m,
          locale,
          (parts, ts) =>
            ts === probe
              ? parts.flatMap((p) =>
                  p.type.toLowerCase() === "timezonename"
                    ? [{ type: "literal", value: "~" } as Intl.DateTimeFormatPart, p]
                    : [p]
                )
              : parts,
          () => {
            for (const at of INSTANTS) {
              // whatever it decides about the layout, the name it returns has to
              // be the name — falling back is allowed, guessing is not
              assert.equal(
                m.IANAZone.create(zone).offsetName(at, { format: "short", locale } as never),
                stockName(at, "short", locale, zone),
                `probe ${i} bent, read at ${at}`
              );
            }
          }
        );
      });
    }

    // NOT from the sweep either, and unreachable through ICU: the scanner takes
    // the position from formatToParts and then reads from format(), so it has to
    // check that the two agree before trusting the first.
    test("a format() that is not its parts joined is refused", async () => {
      const m = await loadLuxon(keys);
      const zone = "America/New_York";
      const locale = "en-US";
      const Real = Intl.DateTimeFormat;

      m.Settings.resetCaches();

      try {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
          const dtf = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);

          if (args[0] !== locale) return dtf;

          const realFormat = dtf.format.bind(dtf);
          Object.defineProperty(dtf, "format", {
            configurable: true,
            value: (ts: number) => `[${realFormat(ts)}`,
          });

          return dtf;
        };

        for (const at of INSTANTS) {
          assert.equal(
            m.IANAZone.create(zone).offsetName(at, { format: "short", locale } as never),
            stockName(at, "short", locale, zone),
            `format() disagrees with its parts, read at ${at}`
          );
        }
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
        m.Settings.resetCaches();
      }
    });

    // The disagreement check makes a badly measured suffix safe: a scanner that
    // stored the wrong one refuses the next probe and the name comes back off
    // the stock path, correct. So the locales where the name is not last cannot
    // be defended by comparing output — the question is whether they are being
    // served at all, and the answer is a count.
    test("the locales whose name is not last are served by the scanner", async () => {
      const m = await loadLuxon(keys);
      const Real = Intl.DateTimeFormat;
      let parts = 0;

      m.Settings.resetCaches();

      try {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
          const dtf = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
          const real = dtf.formatToParts.bind(dtf);
          Object.defineProperty(dtf, "formatToParts", {
            configurable: true,
            value: (...a: unknown[]) => (parts++, real(...(a as []))),
          });
          return dtf;
        };

        for (const locale of ["zh-CN", "fa-IR"]) {
          const z = m.IANAZone.create("America/New_York");

          // building the scanner is three formatToParts calls and is not what
          // this counts
          z.offsetName(READS[0]!, { format: "short", locale } as never);
          parts = 0;

          for (const ts of READS) z.offsetName(ts, { format: "short", locale } as never);

          assert.equal(parts, 0, `${locale} fell back to formatToParts ${parts} times`);
        }
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
        m.Settings.resetCaches();
      }
    });

    test("Settings.resetCaches() drops the scanners too", async () => {
      const m = await loadLuxon(keys);
      const zone = "America/New_York";
      const locale = "en-US";
      const ts = INSTANTS[0]!;
      const read = () => m.IANAZone.create(zone).offsetName(ts, { format: "short", locale } as never);

      const before = read();
      assert.equal(before, stockName(ts, "short", locale, zone));

      await withBentIntl(
        m,
        locale,
        (parts) =>
          parts.map((p) => (p.type.toLowerCase() === "timezonename" ? { ...p, value: "SWAPPED" } : p)),
        () => {
          // withBentIntl resets the caches on the way in, so a scanner that
          // survived the reset is the failure this is looking for
          assert.equal(read(), "SWAPPED", "a scanner outlived Settings.resetCaches()");
        }
      );
    });
  });
}
