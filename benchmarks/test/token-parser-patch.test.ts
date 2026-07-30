// The parse-side cache (D in benchmarks/patches) must be invisible: fromFormat
// has to return what stock luxon returns, and fromFormatExplain has to explain it
// the same way.
//
// D is stateful, and the one way it can go wrong is the cache key. A parser holds
// the locale's month, weekday, era and meridiem names baked into a compiled
// RegExp, so two locales that the key fails to separate would share one, and the
// second would be read in the first's language. That failure is silent for a
// numeric format and only shows on text tokens, so the sweep leans on those and
// interleaves the locales rather than finishing one before starting the next: a
// key that separates them only by luck passes a per-locale loop.
//
// The locales are picked to disagree in each field the key carries — a
// non-gregory calendar, a non-latn numbering system, and both at once — since a
// key that dropped one of the three would still separate plain "de-DE" from
// "ja-JP".
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const LOCALES = [
  "en-US",
  "de-DE",
  "fr-FR",
  "ja-JP",
  "ar-EG", // arab digits by default
  "ru-RU", // month names inflect between standalone and format
  "th-TH-u-ca-buddhist-nu-thai", // different calendar AND different digits
  "hi-IN-u-nu-deva",
  "fa-IR-u-ca-persian",
];

// text tokens first: those are the ones that carry locale data into the parser
const FORMATS = [
  "MMMM d, yyyy",
  "MMM d yy",
  "cccc, MMMM d yyyy",
  "ccc d MMM yyyy",
  "yyyy MMMM d hh:mm a",
  "G yyyy MMMM d",
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm:ss.SSSZZ",
  "DDDD", // a macro token, so the parser is built from Intl parts rather than the string
  "ff",
];

const ZONES = ["America/New_York", "Europe/Berlin", "Asia/Tokyo", "UTC"];

const INSTANTS = [
  Date.UTC(2024, 0, 15, 8, 30, 15, 123),
  Date.UTC(2024, 6, 4, 23, 59, 59, 999),
  Date.UTC(1999, 11, 31, 0, 0, 0, 0),
  Date.UTC(2033, 2, 13, 12, 0, 0, 500),
];

const VARIANTS: [string, PatchKey[]][] = [
  ["tokenParserCache", [patchKey("tokenParserCache")]],
  ["every patch", [...patchKeys]],
];

/**
 * An invalid DateTime values as NaN, which is never equal to itself, so the two
 * have to agree on validity before they can be compared on the instant.
 */
function same(a: any, b: any): boolean {
  return a.isValid
    ? b.isValid && a.valueOf() === b.valueOf()
    : !b.isValid && a.invalidReason === b.invalidReason;
}

const stock = await loadLuxon([]);

describe("tokenParserCache is invisible", () => {
  for (const [name, keys] of VARIANTS) {
    describe(name, () => {
      for (const fmt of FORMATS) {
        test(`"${fmt}" across ${LOCALES.length} locales, interleaved`, async () => {
          const patched = await loadLuxon(keys);

          for (const zone of ZONES) {
            // one instant at a time across every locale, so each parse meets a
            // cache the other locales just wrote to
            for (const ts of INSTANTS) {
              for (const locale of LOCALES) {
                const opts = { zone, locale };
                // rendered by stock, so both builds read an identical string
                const text = stock.DateTime.fromMillis(ts, opts).toFormat(fmt);
                const want = stock.DateTime.fromFormat(text, fmt, opts);
                const got = patched.DateTime.fromFormat(text, fmt, opts);

                assert.ok(
                  same(want, got),
                  `${locale} ${zone} "${fmt}" <- "${text}": ` +
                    `${want.isValid ? want.toISO() : want.invalidReason} vs ` +
                    `${got.isValid ? got.toISO() : got.invalidReason}`
                );
              }
            }
          }
        });
      }
    });
  }
});

// The sweep above varies the locale string, so it would still pass on a key that
// carried only that. numberingSystem and outputCalendar can also be passed on
// their own, against an unchanged locale string, and the key has to separate
// those too — this is the case that catches a key missing either one.
describe("tokenParserCache separates locales that differ only outside the locale string", () => {
  const SHAPES = [
    { locale: "en-US" },
    { locale: "en-US", numberingSystem: "arab" },
    { locale: "en-US", numberingSystem: "deva" },
    { locale: "en-US", outputCalendar: "buddhist" },
    { locale: "en-US", outputCalendar: "islamic" },
    { locale: "en-US", numberingSystem: "arab", outputCalendar: "buddhist" },
  ];

  for (const fmt of ["yyyy MMMM d", "yyyy-MM-dd HH:mm:ss", "G yyyy MMM d"]) {
    test(`"${fmt}"`, async () => {
      const patched = await loadLuxon([patchKey("tokenParserCache")]);

      // interleaved, so each parse meets whatever the previous shape cached
      for (const ts of INSTANTS) {
        for (const shape of SHAPES) {
          const text = stock.DateTime.fromMillis(ts, shape).toFormat(fmt);
          const want = stock.DateTime.fromFormat(text, fmt, shape);
          const got = patched.DateTime.fromFormat(text, fmt, shape);

          assert.ok(
            same(want, got),
            `${JSON.stringify(shape)} "${fmt}" <- "${text}": ` +
              `${want.isValid ? want.toISO() : want.invalidReason} vs ` +
              `${got.isValid ? got.toISO() : got.invalidReason}`
          );
        }
      }
    });
  }
});

describe("tokenParserCache keeps the rest of fromFormat's contract", () => {
  test("fromFormatExplain returns the same regex and matches", async () => {
    const patched = await loadLuxon([patchKey("tokenParserCache")]);

    for (const locale of LOCALES) {
      const want = stock.DateTime.fromFormatExplain("2024-01-15 08:30:00", "yyyy-MM-dd HH:mm:ss", { locale });
      const got = patched.DateTime.fromFormatExplain("2024-01-15 08:30:00", "yyyy-MM-dd HH:mm:ss", { locale });

      assert.equal(String(got.regex), String(want.regex), locale);
      assert.deepEqual(got.matches, want.matches, locale);
    }
  });

  test("an unparsable input does not poison the entry it missed on", async () => {
    const patched = await loadLuxon([patchKey("tokenParserCache")]);

    assert.equal(patched.DateTime.fromFormat("nope", "yyyy-MM-dd", {}).isValid, false);
    assert.equal(patched.DateTime.fromFormat("2024-01-15", "yyyy-MM-dd", {}).isValid, true);
  });

  test("an invalid format stays invalid, and is not cached as a valid one", async () => {
    const patched = await loadLuxon([patchKey("tokenParserCache")]);

    for (let i = 0; i < 2; i++) {
      const got = patched.DateTime.fromFormat("2024", "qqqq", {});
      const want = stock.DateTime.fromFormat("2024", "qqqq", {});

      assert.equal(got.isValid, false);
      assert.equal(got.invalidReason, want.invalidReason);
    }
  });

  test("Settings.resetCaches() drops it and parsing still works", async () => {
    const patched = await loadLuxon([patchKey("tokenParserCache")]);

    const before = patched.DateTime.fromFormat("2024-01-15", "yyyy-MM-dd", {});
    patched.Settings.resetCaches();
    const after = patched.DateTime.fromFormat("2024-01-15", "yyyy-MM-dd", {});

    assert.equal(before.valueOf(), after.valueOf());
  });

  test("buildFormatParser still bypasses the cache and agrees with it", async () => {
    const patched = await loadLuxon([patchKey("tokenParserCache")]);
    const opts = { zone: "America/New_York", locale: "en-US" };
    const fmt = "yyyy-MM-dd HH:mm:ss";
    const parser = patched.DateTime.buildFormatParser(fmt, opts);

    for (const ts of INSTANTS) {
      const text = stock.DateTime.fromMillis(ts, opts).toFormat(fmt);

      assert.equal(
        patched.DateTime.fromFormatParser(text, parser, opts).valueOf(),
        patched.DateTime.fromFormat(text, fmt, opts).valueOf(),
        text
      );
    }
  });
});
