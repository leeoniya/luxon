// J's name memo has to be invisible, and the way it could fail is specific: it
// answers from a slot keyed by one field of the DateTime, so it is wrong exactly
// when the rendered name depends on something else. Everything here is built to
// find that.
//
// The sweep is the main event. Every name token at every width, in a spread of
// locales, against timestamps that walk all twelve months, all seven weekdays,
// all 24 hours and both eras — compared render for render against the unpatched
// formatter. A slot keyed by the wrong field, or shared between two locales, or
// sized too small, shows up as a differing string rather than as a throw.
//
// Two boundaries get their own tests because the sweep found them and a later
// edit could quietly undo either:
//
//   * fa resolves to the persian calendar with no outputCalendar named, so a
//     month or era slot keyed by the Gregorian field is a neighbour's name. The
//     patch consults the resolved calendar and falls back for those two tokens.
//     Tested by rendering every month of a Persian year and checking they are
//     twelve distinct names in the order Intl gives.
//   * Day periods are keyed by hour across 24 slots, not by hour < 12 across
//     two. Every hour is checked in the locales most likely to have a flexible
//     day-period system — though on the ICU this was written against none of
//     them render more than AM/PM under h12, so these pass against a two-slot
//     version too. They are here to fail on an ICU or a locale where that stops
//     being true, which is the case the 24 slots exist for.
//
// Locales must not share slots, so there is an interleaved test: the same
// formatter reached alternately through two locales, which a memo keyed on the
// pattern rather than the Locale would fail.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
  loadLuxon,
  patchedEntry,
  patchKey,
  patchKeys,
  withNeeds,
  type PatchKey,
} from "../lib/patches.ts";
import type { LuxonModule } from "../lib/luxon-types.ts";

const compileFormat = patchKey("compileFormat");
const numericPath = patchKey("numericPath");
const VARIANTS: [string, PatchKey[]][] = [
  ["compileFormat", [compileFormat]],
  ["every patch", [...patchKeys]],
];

const stock = await loadLuxon([]);

test("compileFormat replaces numericPath's formatter interpreter", async () => {
  assert.deepEqual(withNeeds([compileFormat]), [numericPath, compileFormat]);

  const entry = await patchedEntry([compileFormat]);
  const formatter = await readFile(new URL("impl/formatter.js", entry), "utf8");
  assert.doesNotMatch(formatter, /\bstringifyTokens\b/);
});

// One representative per formatter-relevant locale class: English's direct
// tables, grammatical context, non-Gregorian calendars, CJK, RTL and non-Latin
// numbering. Handler dispatch does not branch on individual locale names, and
// the fixtures enumerate every memo field value.
const LOCALES = [
  "en-US", "ru", "fi", "ja", "zh-CN", "th", "ar", "hi", "bn", "fa",
];

// every token that resolves to a name, at every width, plus the macros and
// compound patterns that reach several at once
const PATTERNS = [
  "ccc", "cccc", "ccccc", "cccccc",
  "EEE", "EEEE", "EEEEE",
  "LLL", "LLLL", "LLLLL",
  "MMM", "MMMM", "MMMMM",
  "a", "G", "GG", "GGGGG",
  "cccc, LLLL d, yyyy 'at' h:mm a",
  "EEEE d MMMM yyyy HH:mm",
  "GG yyyy MMMM EEEE a",
  "DDDD", "ff", "FFF", "tt",
];

/** all twelve months, all seven weekdays, all 24 hours, and a BC year */
const STAMPS = [
  ...Array.from({ length: 24 }, (_, i) => Date.UTC(2024, i % 12, 1 + ((i * 5) % 27), i % 24, (i * 13) % 60)),
  Date.UTC(-40, 3, 2, 15),
  Date.UTC(1, 0, 1, 0),
];

for (const [name, patches] of VARIANTS) {
  const luxon = await loadLuxon(patches);

  describe(`compileFormat renders what the interpreter rendered > ${name}`, () => {
    for (const locale of LOCALES) {
      test(locale, () => {
        for (const pattern of PATTERNS) {
          for (const ts of STAMPS) {
            const opts = { zone: "UTC", locale };
            const want = stock.DateTime.fromMillis(ts, opts).toFormat(pattern);
            const got = luxon.DateTime.fromMillis(ts, opts).toFormat(pattern);

            assert.equal(got, want, `${locale} "${pattern}" @${ts}`);
          }
        }
      });
    }
  });

  describe(`the name memo keys on the field the name depends on > ${name}`, () => {
    // A month slot keyed by dt.month is only right when the calendar the name
    // comes out of is the one dt.month counts in. fa's is not.
    test("fa months are twelve distinct names, not a Gregorian slot's", () => {
      // A Persian year starts in late March, so stepping a month at a time from
      // one lands on twelve consecutive Persian months.
      const start = luxon.DateTime.fromISO("2024-04-10T12:00:00Z", { zone: "UTC", locale: "fa" });
      const got = Array.from({ length: 12 }, (_, i) => start.plus({ months: i }).toFormat("LLLL"));
      const want = Array.from({ length: 12 }, (_, i) =>
        stock.DateTime.fromISO("2024-04-10T12:00:00Z", { zone: "UTC", locale: "fa" }).plus({ months: i }).toFormat("LLLL")
      );

      assert.deepEqual(got, want);
      assert.equal(new Set(got).size, 12, `expected twelve distinct month names, got ${JSON.stringify(got)}`);
    });

    test("fa eras match stock across the BC boundary", () => {
      for (const iso of ["-000040-04-02T12:00:00Z", "0001-01-01T12:00:00Z", "2024-06-01T12:00:00Z"]) {
        const opts = { zone: "UTC", locale: "fa" } as const;

        assert.equal(
          luxon.DateTime.fromISO(iso, opts).toFormat("GG"),
          stock.DateTime.fromISO(iso, opts).toFormat("GG"),
          iso
        );
      }
    });

    // Locale#meridiems assumes two day periods; the memo does not, and keys by
    // hour. See the note at the top on what these do and do not currently catch.
    for (const locale of ["zh-CN", "ja", "ko", "hi", "ta", "th", "vi"]) {
      test(`every hour's day period matches stock in ${locale}`, () => {
        for (let hour = 0; hour < 24; hour++) {
          const ts = Date.UTC(2024, 5, 1, hour, 30);
          const opts = { zone: "UTC", locale };

          assert.equal(
            luxon.DateTime.fromMillis(ts, opts).toFormat("a"),
            stock.DateTime.fromMillis(ts, opts).toFormat("a"),
            `${locale} hour ${hour}`
          );
        }
      });
    }

    // The memo is per Locale. One keyed on the pattern, or on nothing, would
    // hand the second locale the first's names — and only after the first had
    // run, which is why these interleave rather than run in blocks.
    test("two locales interleaved do not share slots", () => {
      const pairs: [string, string][] = [
        ["fr", "de"],
        ["ja", "zh-CN"],
        ["fi", "sv"],
        ["fa", "ar"],
      ];

      for (const [a, b] of pairs) {
        for (const pattern of ["cccc", "LLLL", "a", "GG", "cccc, LLLL d, yyyy 'at' h:mm a"]) {
          for (let i = 0; i < 24; i++) {
            const ts = Date.UTC(2024, i % 12, 1 + (i % 27), i, 0);

            for (const locale of [a, b, a, b]) {
              const opts = { zone: "UTC", locale };

              assert.equal(
                luxon.DateTime.fromMillis(ts, opts).toFormat(pattern),
                stock.DateTime.fromMillis(ts, opts).toFormat(pattern),
                `${locale} "${pattern}" @${ts} (interleaved with ${locale === a ? b : a})`
              );
            }
          }
        }
      }
    });

    // The same Locale reached through a DateTime that was built once and
    // formatted many times, which is the shape the benchmark measures and the
    // one where a slot is most likely to be stale rather than absent.
    test("a held DateTime formats the same as a fresh one", () => {
      for (const locale of ["fr", "ja", "fa", "fi"]) {
        const held = luxon.DateTime.fromMillis(Date.UTC(2024, 0, 1), { zone: "UTC", locale });

        for (let i = 0; i < 40; i++) {
          const at = held.plus({ months: i, days: i, hours: i });
          const fresh = luxon.DateTime.fromMillis(at.toMillis(), { zone: "UTC", locale });
          const pattern = "GG yyyy MMMM EEEE a";

          assert.equal(at.toFormat(pattern), fresh.toFormat(pattern), `${locale} step ${i}`);
          assert.equal(at.toFormat(pattern), stock.DateTime.fromMillis(at.toMillis(), { zone: "UTC", locale }).toFormat(pattern));
        }
      }
    });
  });

  describe(`compileFormat keeps the rest of the formatter's contract > ${name}`, () => {
    test("Settings.resetCaches() drops nothing a caller can see", () => {
      const opts = { zone: "UTC", locale: "fr" } as const;
      const pattern = "cccc, LLLL d, yyyy 'at' h:mm a";
      const ts = Date.UTC(2024, 6, 4, 15, 30);
      const before = luxon.DateTime.fromMillis(ts, opts).toFormat(pattern);

      luxon.Settings.resetCaches();

      assert.equal(luxon.DateTime.fromMillis(ts, opts).toFormat(pattern), before);
    });

    test("an explicit outputCalendar still renders that calendar", () => {
      for (const outputCalendar of ["gregory", "islamic", "hebrew", "buddhist"]) {
        const opts = { zone: "UTC", locale: "en-US", outputCalendar } as const;
        const ts = Date.UTC(2024, 6, 4);

        assert.equal(
          luxon.DateTime.fromMillis(ts, opts).toFormat("MMMM yyyy GG"),
          stock.DateTime.fromMillis(ts, opts).toFormat("MMMM yyyy GG"),
          outputCalendar
        );
      }
    });

    test("an invalid DateTime formats as invalid rather than reading a slot", () => {
      const bad = (m: LuxonModule) => m.DateTime.invalid("testing");

      for (const pattern of ["cccc", "LLLL", "a", "GG"]) {
        assert.equal(bad(luxon).toFormat(pattern), bad(stock).toFormat(pattern), pattern);
      }
    });

    test("unknown tokens and quoted literals survive compilation", () => {
      const opts = { zone: "UTC", locale: "fr" } as const;
      const ts = Date.UTC(2024, 2, 9, 8, 5);

      for (const pattern of ["'literal'", "[]{}!?", "yyyy 'at' LLLL", "''", "L'L'L", "\u00e9\u00e9 cccc"]) {
        assert.equal(
          luxon.DateTime.fromMillis(ts, opts).toFormat(pattern),
          stock.DateTime.fromMillis(ts, opts).toFormat(pattern),
          pattern
        );
      }
    });
  });
}
