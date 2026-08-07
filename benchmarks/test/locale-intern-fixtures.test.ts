// E hands one Locale to every caller who asked for the same thing. Two ways that
// goes wrong: a caller who asked for something else gets it anyway, and the
// settings that decided what it is move while it does not.
//
// Running benchmarks/mutations/05-locale-intern.ts against the sweep beside this
// file caught six of twenty. The fourteen it missed were the whole of the
// interning — every field the key discriminates on and every setting the
// generation counter watches — because that sweep exercises Duration#toHuman,
// which is the memo hung off the Locale rather than the Locale itself.
//
// So the cases here are mostly pairs: something asked for twice, differing in
// one field, in both orders, since a cache is only caught aliasing if the wrong
// entry got there first.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

const VARIANTS: [string, PatchKey[]][] = [
  ["localeIntern", [patchKey("localeIntern")]],
  ["every patch", [...patchKeys]],
];

const TS = Date.UTC(2024, 2, 10, 18, 30);

/** the Locale a DateTime is carrying, which is how identity gets asserted */
const locOf = (dt: unknown) => (dt as { loc: object }).loc;

for (const [label, keys] of VARIANTS) {
  describe(`localeIntern fixtures > ${label}`, () => {
    test("two callers asking for the same thing get the same Locale", async () => {
      const m = await loadLuxon(keys);
      const at = () => m.DateTime.fromMillis(TS);

      assert.equal(locOf(at().setLocale("de-DE")), locOf(at().setLocale("de-DE")));
      assert.equal(locOf(at().setLocale("en-US")), locOf(at().setLocale("en-US")));
      assert.notEqual(locOf(at().setLocale("de-DE")), locOf(at().setLocale("en-US")));
    });

    // Each of these is a field the key either names or refuses to intern on. The
    // pair is run both ways round because whichever is asked for first is the
    // one that would be handed to the other.
    test("a locale carrying extra configuration is not served to one that is not", async () => {
      const m = await loadLuxon(keys);
      const at = (opts: object) => m.DateTime.fromMillis(TS).reconfigure(opts as never);

      const cases: [string, object, (dt: ReturnType<typeof at>) => unknown][] = [
        // Arabic-Indic digits against Latin ones
        ["numberingSystem", { locale: "en-US", numberingSystem: "arab" }, (dt) => dt.toFormat("yyyy")],
        // ISO weeks against the Sunday-start week en-US carries
        [
          "weekSettings",
          { locale: "en-US", weekSettings: { firstDay: 1, minimalDays: 4, weekend: [6, 7] } },
          (dt) => `${dt.localWeekday} ${dt.localWeekNumber}`,
        ],
        // Rajab rather than March
        ["outputCalendar", { locale: "en-US", outputCalendar: "islamic" }, (dt) => dt.toLocaleString({ month: "long" })],
      ];

      for (const [field, extra, read] of cases) {
        const plain = { locale: (extra as { locale: string }).locale };

        for (const order of [
          [extra, plain],
          [plain, extra],
        ]) {
          m.Settings.resetCaches();

          const first = read(at(order[0]!));
          const second = read(at(order[1]!));

          assert.notEqual(
            first,
            second,
            `${field}: asking for ${JSON.stringify(order[0])} then ${JSON.stringify(order[1])} ` +
              `gave the same answer, ${first}`
          );

          // and the plain one is still the plain one, whichever order it came in
          assert.equal(read(at(plain)), read(at(plain)));
        }
      }
    });

    // "gregory" and no calendar at all are the two shapes E does intern, and it
    // keeps them apart with two maps rather than a wider key. They format the
    // same, so identity is the only thing that shows one being served for the
    // other.
    test("an explicit gregory calendar is not the same Locale as none", async () => {
      const m = await loadLuxon(keys);
      const at = (opts: object) => m.DateTime.fromMillis(TS).reconfigure(opts as never);

      const gregory = locOf(at({ locale: "en-US", outputCalendar: "gregory" }));
      const none = locOf(at({ locale: "en-US" }));

      assert.notEqual(gregory, none);
      assert.equal((gregory as { outputCalendar: unknown }).outputCalendar, "gregory");
      assert.equal(locOf(at({ locale: "en-US", outputCalendar: "gregory" })), gregory);
      assert.equal(locOf(at({ locale: "en-US" })), none);
    });

    // toFormat asks for the locale redefaulted to English, everything else asks
    // for it as it is, and on a machine whose locale is English those are the
    // same object by coincidence rather than by the key. So the system locale is
    // moved out of the way first.
    test("the English-redefaulted locale is not served to a caller that wanted the system one", async () => {
      const m = await loadLuxon(keys);
      const Real = Intl.DateTimeFormat;

      try {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
          const f = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);

          if (args.length === 0) {
            const real = f.resolvedOptions.bind(f);
            Object.defineProperty(f, "resolvedOptions", {
              configurable: true,
              value: () => ({ ...real(), locale: "de-DE" }),
            });
          }

          return f;
        };

        for (const order of ["format first", "locale first"]) {
          m.Settings.resetCaches();

          const dt = m.DateTime.fromMillis(TS);

          if (order === "format first") {
            assert.equal(dt.toFormat("MMMM"), "March", order);
            assert.equal(dt.toLocaleString({ month: "long" }), "März", order);
          } else {
            assert.equal(dt.toLocaleString({ month: "long" }), "März", order);
            assert.equal(dt.toFormat("MMMM"), "March", order);
          }
        }
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
        m.Settings.resetCaches();
      }
    });

    // toFormat with options is the one caller that passes alts, and the memo is
    // only good for the call that passed none.
    test("the no-alts memo is not served to toFormat with options", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromMillis(TS);

      for (const order of [
        ["", "de-DE"],
        ["de-DE", ""],
      ]) {
        m.Settings.resetCaches();

        for (const locale of order) {
          const got = locale === "" ? dt.toFormat("MMMM") : dt.toFormat("MMMM", { locale });
          assert.equal(got, locale === "de-DE" ? "März" : "March", `order ${order.join(",")}, locale "${locale}"`);
        }
      }
    });

    // Every field Locale.create() falls back to Settings for. Each is read once
    // to get an interned Locale on the books, then moved, then read again.
    test("a Settings change is seen by locales interned before it", async () => {
      const m = await loadLuxon(keys);
      const S = m.Settings as unknown as Record<string, unknown>;
      const at = () => m.DateTime.fromMillis(TS);

      const cases: [string, unknown, () => unknown][] = [
        ["defaultLocale", "de-DE", () => at().toLocaleString({ month: "long" })],
        ["defaultNumberingSystem", "arab", () => at().toLocaleString({ year: "numeric" })],
        ["defaultOutputCalendar", "islamic", () => at().toLocaleString({ month: "long" })],
        [
          "defaultWeekSettings",
          { firstDay: 1, minimalDays: 4, weekend: [6, 7] },
          () => `${at().localWeekday} ${at().localWeekNumber}`,
        ],
      ];

      for (const [field, value, read] of cases) {
        m.Settings.resetCaches();
        S["defaultLocale"] = "en-US";

        try {
          const before = read();
          S[field] = value;
          const after = read();

          assert.notEqual(after, before, `${field}: still ${before} after it was set to ${JSON.stringify(value)}`);

          S[field] = field === "defaultLocale" ? "en-US" : null;
          assert.equal(read(), before, `${field}: did not come back after it was put back`);
        } finally {
          S[field] = null;
          S["defaultLocale"] = null;
          m.Settings.resetCaches();
        }
      }
    });

    // The intern is bounded, which means it stops interning rather than starts
    // being wrong — so what the bound does is only visible as identity.
    test("the intern stops taking entries once it is full", async () => {
      const m = await loadLuxon(keys);
      const at = (locale: string) => m.DateTime.fromMillis(TS).setLocale(locale);

      m.Settings.resetCaches();

      // well past the 1000 the patch allows
      for (let i = 0; i < 1200; i++) at(`en-US-u-nu-latn-x-p${i}`);

      const a = locOf(at("en-GB-x-past-the-end"));
      const b = locOf(at("en-GB-x-past-the-end"));

      assert.notEqual(a, b, "a full intern is still taking entries");

      // and it is still correct, which is the part that matters
      assert.equal((a as { locale: string }).locale, (b as { locale: string }).locale);

      m.Settings.resetCaches();
      assert.equal(locOf(at("en-GB-x-past-the-end")), locOf(at("en-GB-x-past-the-end")));
    });

    // Duration#toHuman hangs two formatters off the Locale. They are only good
    // for the call that passed no options, and they have to go when the caches
    // they were built from do.
    test("toHuman's memoized formatters answer for the call that passed nothing", async () => {
      const m = await loadLuxon(keys);
      const d = m.Duration.fromObject({ hours: 2, minutes: 30 });

      assert.equal(d.toHuman(), "2 hours, 30 minutes");
      assert.equal(d.toHuman({ listStyle: "long" }), "2 hours and 30 minutes");
      assert.equal(d.toHuman(), "2 hours, 30 minutes");
      assert.equal(d.toHuman({ unitDisplay: "narrow" }), "2h, 30m");
      assert.equal(d.toHuman(), "2 hours, 30 minutes");

      // one formatter per unit, so a memo keyed on anything less prints one
      // unit's name for another
      assert.equal(
        m.Duration.fromObject({ years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 }).toHuman(),
        "1 year, 2 months, 3 days, 4 hours, 5 minutes, 6 seconds"
      );
      assert.equal(m.Duration.fromObject({ minutes: 1 }, { locale: "de-DE" }).toHuman(), "1 Minute");
    });

    // The memo is per unit, and a memo keyed on less than that is not wrong —
    // it just misses every time and rebuilds. What it saves is the call below,
    // not an Intl object, since luxon already caches those behind it. So the
    // instrument is the call.
    test("a repeated toHuman does not keep asking for its formatters", async () => {
      const m = await loadLuxon(keys);
      const d = m.Duration.fromObject({ hours: 2, minutes: 30, seconds: 15 });
      const loc = locOf(d) as Record<string, unknown>;
      let asked = 0;

      const wrap = (name: string) => {
        const real = (loc[name] as (...a: unknown[]) => unknown).bind(loc);
        Object.defineProperty(loc, name, {
          configurable: true,
          value: (...a: unknown[]) => (asked++, real(...a)),
        });
      };

      wrap("numberFormatter");
      wrap("listFormatter");

      try {
        // one per unit plus the list, and that is the last of them
        d.toHuman();
        asked = 0;

        for (let i = 0; i < 50; i++) d.toHuman();

        assert.equal(asked, 0, `50 repeats of the same toHuman asked for ${asked} formatters`);

        // a unit it has not printed before is still built, so this is a memo
        // rather than a lock
        m.Duration.fromObject({ days: 1 }, { locale: (loc as { locale: string }).locale }).toHuman();
      } finally {
        delete loc["numberFormatter"];
        delete loc["listFormatter"];
      }
    });

    // The memos hang off a Locale, and a DateTime built earlier is still
    // holding the one it had. A settings change empties the intern, which is
    // what a later caller sees, but this one has to notice on its own.
    test("a DateTime built before a Settings change still follows it", async () => {
      const m = await loadLuxon(keys);
      const S = m.Settings as unknown as Record<string, unknown>;

      m.Settings.resetCaches();

      const dt = m.DateTime.fromMillis(TS);

      try {
        assert.equal(dt.toFormat("MMMM"), "March");

        S["defaultLocale"] = "de-DE";
        assert.equal(dt.toFormat("MMMM"), "März", "the redefaulted locale outlived the setting it was built under");

        S["defaultLocale"] = null;
        assert.equal(dt.toFormat("MMMM"), "March", "and did not come back");
      } finally {
        S["defaultLocale"] = null;
        m.Settings.resetCaches();
      }
    });

    test("Settings.resetCaches() reaches the memos on a Duration already built", async () => {
      const m = await loadLuxon(keys);
      const d = m.Duration.fromObject({ hours: 2, minutes: 30 });
      const Real = Intl.NumberFormat;

      assert.equal(d.toHuman(), "2 hours, 30 minutes");

      try {
        (Intl as { NumberFormat: unknown }).NumberFormat = function (...args: unknown[]) {
          const f = new (Real as unknown as new (...a: unknown[]) => Intl.NumberFormat)(...args);
          const real = f.format.bind(f);
          Object.defineProperty(f, "format", {
            configurable: true,
            value: (n: number) => `<${real(n)}>`,
          });
          return f;
        };

        m.Settings.resetCaches();

        assert.equal(
          d.toHuman(),
          "<2 hours>, <30 minutes>",
          "the memo outlived the reset it was supposed to notice"
        );
      } finally {
        (Intl as { NumberFormat: unknown }).NumberFormat = Real;
        m.Settings.resetCaches();
      }
    });
  });
}
