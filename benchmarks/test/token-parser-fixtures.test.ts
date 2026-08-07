// C keeps a TokenParser instead of building one per call. Reuse itself is not
// the question — DateTime.buildFormatParser exists so that callers can do this
// by hand — so the oracle here is that public pair: whatever fromFormat returns
// through the cache has to be what fromFormatParser returns through a parser
// built for the occasion. Nothing below is a recorded value.
//
// What is left is the key. Four fields are named and the rest of a Locale is
// not, which is a claim about what a parser reads, so each named field gets a
// pair that differs only in it, and weekSettings — the field a Locale carries
// that the key leaves out — gets one too.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["tokenParserCache", [patchKey("tokenParserCache")]],
  ["every patch", [...patchKeys]],
];

// numeric, text, era, meridiem, offset and zone tokens, plus a localized format
const FORMATS = [
  "yyyy-MM-dd HH:mm:ss",
  "MMMM d, yyyy",
  "MMM d yy h:mm a",
  "d MMMM yyyy G",
  "yyyy-MM-dd'T'HH:mm:ssZZ",
  "yyyy LLLL cccc",
  "kkkk-'W'WW-c",
  "y o",
];

const INPUTS: Record<string, string[]> = {
  "yyyy-MM-dd HH:mm:ss": ["2024-03-10 02:30:00", "1999-12-31 23:59:59", "nope"],
  "MMMM d, yyyy": ["March 10, 2024", "December 31, 1999", "Nonesuch 1, 2024"],
  "MMM d yy h:mm a": ["Mar 10 24 2:30 PM", "Dec 31 99 11:59 AM"],
  "d MMMM yyyy G": ["10 March 2024 AD", "1 January 1 BC"],
  "yyyy-MM-dd'T'HH:mm:ssZZ": ["2024-03-10T02:30:00+05:30", "2024-03-10T02:30:00-08:00"],
  "yyyy LLLL cccc": ["2024 March Sunday", "1999 December Friday"],
  "kkkk-'W'WW-c": ["2024-W11-7", "2020-W01-1"],
  "y o": ["2024 070", "1999 365"],
};

/** the four fields the key names, each pair differing in exactly one */
const LOCALES = [
  {},
  { locale: "de-DE" },
  { locale: "fr-FR" },
  { locale: "ar-EG" },
  { locale: "ar-EG", numberingSystem: "arab" },
  { locale: "ar-EG", numberingSystem: "latn" },
  { locale: "en-US", outputCalendar: "islamic" },
  { locale: "en-US", outputCalendar: "gregory" },
];

for (const [label, keys] of VARIANTS) {
  describe(`tokenParserCache fixtures > ${label}`, () => {
    // JEST-PARTIAL (sync shared cases; not removable): test/datetime/tokenParse.test.js — "DateTime.fromFormatParser behaves equivalently to DateTime.fromFormat"
    // JEST-PARTIAL (sync shared cases; not removable): test/datetime/tokenParse.test.js — "DateTime.fromFormat round-trips numeric, name, era, meridiem, offset, and macro tokens"
    // JEST-PARTIAL (sync shared cases; not removable): test/datetime/tokenParse.test.js — "DateTime.fromFormat distinguishes numbering systems and output calendars"
    // JEST-PARTIAL (sync shared cases; not removable): test/datetime/tokenParse.test.js — "DateTime.fromFormat preserves failed and invalid parsing semantics across repeated calls"
    test("a cached parser answers what a fresh one does", async () => {
      const m = await loadLuxon(keys);

      // interleaved on purpose: every format is asked for after every other one
      // has been, so a key that collides has had the chance to
      for (let pass = 0; pass < 2; pass++) {
        for (const opts of LOCALES) {
          for (const fmt of FORMATS) {
            const parser = m.DateTime.buildFormatParser(fmt, opts as never);

            for (const input of INPUTS[fmt]!) {
              const cached = m.DateTime.fromFormat(input, fmt, opts as never);
              const fresh = m.DateTime.fromFormatParser(input, parser, opts as never);
              const where = `${JSON.stringify(opts)} / ${fmt} / ${input}`;

              assert.equal(cached.isValid, fresh.isValid, `${where}: validity`);

              if (cached.isValid) {
                assert.equal(+cached, +fresh, `${where}: instant`);
                assert.equal(cached.zone.name, fresh.zone.name, `${where}: zone`);
              } else {
                assert.equal(cached.invalidReason, fresh.invalidReason, `${where}: reason`);
              }
            }
          }
        }
      }
    });

    // The key names four fields of a Locale and leaves weekSettings out, which
    // is only safe if no parser reads them. Same locale, same format, different
    // week rules, and a format made of nothing but week tokens.
    // JEST-MIRROR (sync until tokenParserCache merges, then remove): test/datetime/tokenParse.test.js — "DateTime format parsers remain correct across different week settings"
    test("week settings do not change what a parser reads", async () => {
      const m = await loadLuxon(keys);
      const fmt = "kkkk-'W'WW-c";
      const input = "2024-W11-7";

      const a = { locale: "en-US", weekSettings: { firstDay: 1, minimalDays: 4, weekend: [6, 7] } };
      const b = { locale: "en-US", weekSettings: { firstDay: 7, minimalDays: 1, weekend: [6, 7] } };

      const read = (opts: unknown) => ({
        cached: +m.DateTime.fromFormat(input, fmt, opts as never),
        fresh: +m.DateTime.fromFormatParser(input, m.DateTime.buildFormatParser(fmt, opts as never), opts as never),
      });

      // a is asked first, so if its parser were reused for b the answer below
      // would be a's
      const first = read(a);
      const second = read(b);

      assert.equal(first.cached, first.fresh, "week settings A");
      assert.equal(second.cached, second.fresh, "week settings B");
    });

    // A parser is built out of the locale's month, weekday, era and meridiem
    // names, all of which come from caches Settings.resetCaches() empties. If it
    // outlived that reset it would keep matching names the locale no longer has.
    // JEST-MIRROR (sync until tokenParserCache merges, then remove): test/datetime/tokenParse.test.js — "Settings.resetCaches rebuilds cached token parsers from current Intl month names"
    test("Settings.resetCaches() drops the parsers with the names they were built from", async () => {
      const m = await loadLuxon(keys);
      const Real = Intl.DateTimeFormat;
      const fmt = "MMMM d, yyyy";
      // de-DE rather than en-US: luxon answers English month names from a table
      // and never asks Intl for them, so an English locale cannot see this
      const opts = { locale: "de-DE" } as never;

      assert.ok(m.DateTime.fromFormat("März 10, 2024", fmt, opts).isValid);

      try {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
          const dtf = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
          const parts = dtf.formatToParts.bind(dtf);
          Object.defineProperty(dtf, "formatToParts", {
            configurable: true,
            value: (ts: number) =>
              (parts(ts) as Intl.DateTimeFormatPart[]).map((p) =>
                p.type === "month" && /[A-Za-z]/.test(p.value) ? { ...p, value: p.value + "x" } : p
              ),
          });
          return dtf;
        };

        m.Settings.resetCaches();

        assert.ok(
          m.DateTime.fromFormat("Märzx 10, 2024", fmt, opts).isValid,
          "a parser outlived the name caches it was built from"
        );
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
        m.Settings.resetCaches();
      }
    });
  });
}
