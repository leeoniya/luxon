// F interns Locales and memoizes three things off them, and all three have the
// same failure mode: a memo that outlives what it was derived from. The intern
// and the redefaultToEN memo are keyed on a generation counter that moves when
// any Settings field Locale.create() falls back to changes; the two formatters
// Duration#toHuman asks for hang off the same counter.
//
// The formatters are the ones worth a file, for a reason the other two do not
// have. A Duration built before Settings.resetCaches() still holds the Locale
// instance it was built with, so the memo on that instance has to notice the
// reset even though nothing looked the Locale up again. Swapping Intl out from
// under a Duration is how that is checked here, since it is the reason
// resetCaches() exists.
//
// The memo is only taken when the caller passed no options at all, because
// every option toHuman receives is spread into both formatters' options — so
// the sweep walks the options that change the answer as well as the ones Intl
// ignores.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["localeIntern", [patchKey("localeIntern")]],
  ["every patch", [...patchKeys]],
];

// locales whose plural rules, list joiners and digits differ from each other
const LOCALES = ["en-US", "en-GB", "fr", "de", "ja", "ar-EG", "ru", "th-TH-u-nu-thai", "cs"];

// shapes that reach one unit, several, a zero, a negative and a fraction
const SHAPES: Record<string, number>[] = [
  { hours: 2, minutes: 30 },
  { hours: 1 },
  { minutes: 1 },
  { years: 1, months: 2, days: 3 },
  { minutes: 0, seconds: 5 },
  { weeks: 3, days: 0 },
  { milliseconds: 250 },
  { years: 0, months: 0, days: 0 },
  { hours: -4, minutes: -15 },
  { days: 1.5 },
  { quarters: 2, months: 1 },
  { years: 1, quarters: 1, months: 1, weeks: 1, days: 1, hours: 1, minutes: 1, seconds: 1, milliseconds: 1 },
];

// undefined is the memoized call; every other entry must not take the memo
const OPTS: (Record<string, unknown> | undefined)[] = [
  undefined,
  {},
  { showZeros: false },
  { showZeros: true },
  { listStyle: "long" },
  { listStyle: "narrow" },
  { unitDisplay: "short" },
  { unitDisplay: "narrow" },
  { unitDisplay: "narrow", listStyle: "long" },
  { showZeros: false, unitDisplay: "short" },
  { maximumFractionDigits: 1 },
  { type: "disjunction" },
];

const stock = await loadLuxon([]);

describe("localeIntern is invisible", () => {
  for (const [name, keys] of VARIANTS) {
    describe(name, () => {
      test("toHuman over every locale, shape and option combination", async () => {
        const patched = await loadLuxon(keys);
        let checked = 0;

        for (const locale of LOCALES) {
          for (const shape of SHAPES) {
            for (const opts of OPTS) {
              const a = stock.Duration.fromObject(shape, { locale });
              const b = patched.Duration.fromObject(shape, { locale });

              const x = opts === undefined ? a.toHuman() : a.toHuman(opts as never);
              const y = opts === undefined ? b.toHuman() : b.toHuman(opts as never);

              checked++;

              assert.equal(y, x, `${locale} ${JSON.stringify(shape)} ${JSON.stringify(opts)}`);
            }
          }
        }

        assert.ok(checked > 1_000, `only ${checked} rendered`);
      });

      test("an invalid Duration still renders the invalid string", async () => {
        const patched = await loadLuxon(keys);

        assert.equal(patched.Duration.invalid("because").toHuman(), stock.Duration.invalid("because").toHuman());
      });

      // the memo is per unit, so a Duration that prints a unit a previous one
      // did not must not be handed the previous one's formatter
      test("units interleaved across Durations sharing a locale", async () => {
        const patched = await loadLuxon(keys);
        const order = [
          { hours: 1 }, { minutes: 1 }, { hours: 1, minutes: 1 }, { days: 1 },
          { minutes: 1 }, { seconds: 1, milliseconds: 1 }, { hours: 1 }, { years: 1, seconds: 1 },
        ];

        for (const shape of order) {
          assert.equal(
            patched.Duration.fromObject(shape, { locale: "fr" }).toHuman(),
            stock.Duration.fromObject(shape, { locale: "fr" }).toHuman(),
            JSON.stringify(shape)
          );
        }
      });

      // the options object belongs to the caller, who may reuse and mutate it
      test("a caller who mutates the options object it passed", async () => {
        const patched = await loadLuxon(keys);
        const opts: Record<string, unknown> = { unitDisplay: "short" };
        const d = patched.Duration.fromObject({ hours: 2, minutes: 30 });

        const short = d.toHuman(opts as never);
        opts["unitDisplay"] = "long";
        const long = d.toHuman(opts as never);

        assert.notEqual(short, long, "a mutated options object was answered from a stale formatter");
        assert.equal(long, d.toHuman({ unitDisplay: "long" } as never));
      });

      // Settings.resetCaches() exists so a caller can swap Intl. A Duration
      // built before the reset holds the Locale the memo lives on, so the reset
      // has to reach it — this is the case the generation counter is for.
      test("Intl swapped, then resetCaches, then a Duration that already rendered", async () => {
        const patched = await loadLuxon(keys);

        const wrap = (mod: typeof stock) => {
          const d = mod.Duration.fromObject({ hours: 2, minutes: 30 }, { locale: "en-US" });
          const before = d.toHuman();

          const RealNF = Intl.NumberFormat;

          (Intl as { NumberFormat: unknown }).NumberFormat = function (...a: unknown[]) {
            const real = new RealNF(...(a as [string]));
            return { format: (n: number) => `<${real.format(n)}>` };
          } as unknown as typeof Intl.NumberFormat;

          try {
            mod.Settings.resetCaches();
            return { before, after: d.toHuman() };
          } finally {
            Intl.NumberFormat = RealNF;
            mod.Settings.resetCaches();
          }
        };

        const expected = wrap(stock);
        const actual = wrap(patched);

        assert.equal(actual.before, expected.before);
        assert.equal(actual.after, expected.after, "the memo outlived the reset it was supposed to notice");
        assert.ok(expected.after.includes("<"), "the swap did not take, so this proves nothing");
      });

      // the same, through the other half of the counter: a Settings field the
      // interned Locale falls back to
      test("defaultLocale changed under a Duration built with no locale", async () => {
        const patched = await loadLuxon(keys);

        const wrap = (mod: typeof stock) => {
          const prev = mod.Settings.defaultLocale;

          try {
            mod.Settings.defaultLocale = "en-US";
            const d = mod.Duration.fromObject({ hours: 2, minutes: 30 });
            const before = d.toHuman();
            mod.Settings.defaultLocale = "fr";
            return { before, after: d.toHuman() };
          } finally {
            mod.Settings.defaultLocale = prev;
            mod.Settings.resetCaches();
          }
        };

        const expected = wrap(stock);
        const actual = wrap(patched);

        assert.equal(actual.before, expected.before);
        assert.equal(actual.after, expected.after);
      });
    });
  }
});
