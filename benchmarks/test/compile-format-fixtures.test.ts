// K's fixtures.
//
// K deletes an interpreter and replaces it with a table, so the bulk of what
// could go wrong -- a token wired to the wrong field or the wrong width -- is
// what luxon's own format tests already assert, and those are run against the
// patched tree rather than restated here. What is left is everything the
// interpreter never did: a memo per locale, a guard on the calendar those names
// come out of, a compiled program cached by pattern, and the seam between the
// literal runs and the handler runs.
//
// The name tokens are checked against toLocaleParts, which reaches Intl through
// the same options loc.extract passes, so it is the unmemoized answer to the
// same question rather than a recorded string.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadLuxon, patchedEntry, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";

/**
 * Formatter is not on the public module, and the program cache is only visible
 * as a count of compiles. Same URL as the one luxon.js imports, so this is the
 * module it is using and not a second copy of it.
 */
const formatterModule = async (keys: PatchKey[]) => {
  const entry = await patchedEntry(keys);
  const mod = (await import(new URL("./impl/formatter.js", entry).href)) as {
    default: { parseFormat: (f: string) => unknown };
  };

  return mod.default;
};

const VARIANTS: [string, PatchKey[]][] = [
  ["compileFormat", [patchKey("compileFormat")]],
  ["every patch", [...patchKeys]],
];

const ZONE = "America/New_York";

type Part = { type: string; value: string };
type DT = {
  toFormat: (f: string, o?: unknown) => string;
  toLocaleParts: (o: unknown) => Part[];
  month: number;
  weekday: number;
  hour: number;
  year: number;
};

const partOf = (dt: DT, opts: object, type: string) =>
  (dt.toLocaleParts(opts).find((p) => p.type === type) as Part | undefined)?.value;

for (const [label, keys] of VARIANTS) {
  describe(`compileFormat fixtures > ${label}`, () => {
    // ---- the memo, one entry per distinct field value ----

    test("every month, weekday, era and hour of a non-English locale renders unmemoized", async () => {
      const m = await loadLuxon(keys);

      for (const locale of ["fr", "de", "ru", "ja"]) {
        // months: twelve slots, and a wrong index hands back a neighbour
        for (let month = 1; month <= 12; month++) {
          const dt = m.DateTime.fromObject({ year: 2024, month, day: 15 }, { zone: ZONE, locale }) as unknown as DT;

          for (const [token, length, standalone] of [
            ["MMM", "short", false],
            ["MMMM", "long", false],
            ["MMMMM", "narrow", false],
            ["LLL", "short", true],
            ["LLLL", "long", true],
            ["LLLLL", "narrow", true],
          ] as const) {
            const opts = standalone ? { month: length } : { month: length, day: "numeric" };

            assert.equal(dt.toFormat(token), partOf(dt, opts, "month"), `${locale} ${token} month ${month}`);
          }
        }

        // weekdays: seven slots
        for (let day = 1; day <= 7; day++) {
          const dt = m.DateTime.fromObject({ year: 2024, month: 4, day }, { zone: ZONE, locale }) as unknown as DT;

          for (const [token, length, standalone] of [
            ["EEE", "short", false],
            ["EEEE", "long", false],
            ["EEEEE", "narrow", false],
            ["ccc", "short", true],
            ["cccc", "long", true],
            ["ccccc", "narrow", true],
          ] as const) {
            const opts = standalone
              ? { weekday: length }
              : { weekday: length, month: "long", day: "numeric" };

            assert.equal(dt.toFormat(token), partOf(dt, opts, "weekday"), `${locale} ${token} weekday ${day}`);
          }
        }

        // day periods: keyed by the hour, so all twenty-four
        for (let hour = 0; hour < 24; hour++) {
          const dt = m.DateTime.fromObject(
            { year: 2024, month: 6, day: 12, hour },
            { zone: ZONE, locale }
          ) as unknown as DT;

          assert.equal(
            dt.toFormat("a"),
            partOf(dt, { hour: "numeric", hourCycle: "h12" }, "dayPeriod"),
            `${locale} a at ${hour}`
          );
        }

        // eras: two slots, and the index is a sign test rather than a lookup.
        // Year 0 is the proleptic one and renders as 1 BC, so it belongs on the
        // negative side of that test -- and an AD year comes first here, so a
        // slot it shared with one would already be full.
        for (const year of [2024, 0, 1, -1, -44, -3000]) {
          const dt = m.DateTime.fromObject({ year, month: 6, day: 12 }, { zone: ZONE, locale }) as unknown as DT;

          for (const [token, length] of [
            ["G", "short"],
            ["GG", "long"],
            ["GGGGG", "narrow"],
          ] as const) {
            assert.equal(dt.toFormat(token), partOf(dt, { era: length }, "era"), `${locale} ${token} year ${year}`);
          }
        }
      }
    });

    test("two locales asking for the same token do not share an answer", async () => {
      const m = await loadLuxon(keys);
      const at = (locale: string) =>
        m.DateTime.fromObject({ year: 2024, month: 3, day: 5 }, { zone: ZONE, locale }) as unknown as DT;

      const fr = at("fr");
      const de = at("de");
      const ru = at("ru");

      // interleaved, so a memo keyed on the token alone would answer for whoever
      // asked first
      for (let i = 0; i < 3; i++) {
        assert.equal(fr.toFormat("MMMM"), partOf(fr, { month: "long", day: "numeric" }, "month"), "fr");
        assert.equal(de.toFormat("MMMM"), partOf(de, { month: "long", day: "numeric" }, "month"), "de");
        assert.equal(ru.toFormat("MMMM"), partOf(ru, { month: "long", day: "numeric" }, "month"), "ru");
      }

      assert.notEqual(fr.toFormat("MMMM"), de.toFormat("MMMM"), "fr and de agreed, so nothing was distinguished");
    });

    test("the widths and the two contexts keep separate answers", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromObject(
        { year: 2024, month: 9, day: 3 },
        { zone: ZONE, locale: "ru" }
      ) as unknown as DT;

      // Russian declines the month, so standalone and format differ, and a memo
      // keyed without the context would answer with whichever was asked first
      const long = dt.toFormat("MMMM");
      const standalone = dt.toFormat("LLLL");

      assert.equal(long, partOf(dt, { month: "long", day: "numeric" }, "month"));
      assert.equal(standalone, partOf(dt, { month: "long" }, "month"));
      assert.notEqual(long, standalone, "ru gave the same month name in both contexts");

      // and the three widths must not collapse into each other
      const widths = ["MMM", "MMMM", "MMMMM"].map((t) => dt.toFormat(t));
      assert.equal(new Set(widths).size, 3, `three widths gave ${JSON.stringify(widths)}`);
    });

    // ---- the calendar the names come out of ----

    test("a locale whose resolved calendar is not gregorian is not memoized by gregorian month", async () => {
      const m = await loadLuxon(keys);

      // fa resolves to the persian calendar with no outputCalendar named, so the
      // rendered month tracks the Persian one and does not step with dt.month
      for (const locale of ["fa", "fa-IR"]) {
        const seen = new Map<string, string>();

        for (let month = 1; month <= 12; month++) {
          for (const day of [1, 10, 20, 28]) {
            const dt = m.DateTime.fromObject(
              { year: 2024, month, day },
              { zone: "UTC", locale }
            ) as unknown as DT;

            const want = partOf(dt, { month: "long", day: "numeric" }, "month");

            assert.equal(dt.toFormat("MMMM"), want, `${locale} ${month}-${day}`);
            seen.set(`${month}-${day}`, want!);
          }
        }

        // and the point of the guard: the persian month turns over around the
        // 21st, so two days of one gregorian month carry different names and a
        // slot keyed by dt.month would have to be wrong for one of them
        assert.notEqual(
          seen.get("3-10"),
          seen.get("3-28"),
          `${locale} gave March 10 and March 28 the same month name`
        );

        const turnovers = [...Array(12).keys()].filter(
          (i) => seen.get(`${i + 1}-10`) !== seen.get(`${i + 1}-28`)
        ).length;

        assert.equal(turnovers, 12, `${locale} turned its month over in only ${turnovers} of 12 gregorian months`);
      }
    });

    test("an explicit non-gregorian outputCalendar still goes through extract", async () => {
      const m = await loadLuxon(keys);

      for (const outputCalendar of ["islamic", "hebrew", "buddhist"]) {
        for (let month = 1; month <= 12; month++) {
          const dt = m.DateTime.fromObject(
            { year: 2024, month, day: 14 },
            { zone: "UTC", locale: "en-US", outputCalendar }
          ) as unknown as DT;

          assert.equal(
            dt.toFormat("MMMM"),
            partOf(dt, { month: "long", day: "numeric" }, "month"),
            `${outputCalendar} month ${month}`
          );
          // the numeric tokens take the extract branch under this flag too
          assert.equal(dt.toFormat("d"), partOf(dt, { day: "numeric" }, "day"), `${outputCalendar} d`);
          assert.equal(dt.toFormat("y"), partOf(dt, { year: "numeric" }, "year"), `${outputCalendar} y`);
        }
      }
    });

    // The Japanese calendar changes era within living memory, so an era memo
    // keyed by the sign of the year would answer Heisei for a Reiwa date.
    test("a calendar whose era changes inside one sign of the year is not memoized by that sign", async () => {
      const m = await loadLuxon(keys);
      // the calendar rides on the locale string rather than on outputCalendar,
      // which is what lets two of these share a Locale once locales are interned
      // -- and so share the memo that would confuse them
      const at = (year: number) =>
        m.DateTime.fromObject(
          { year, month: 6, day: 1 },
          { zone: "UTC", locale: "ja-JP-u-ca-japanese" }
        ) as unknown as DT;

      const eras = [1985, 2000, 2018, 2020].map((y) => at(y).toFormat("GG"));

      for (const [i, year] of [1985, 2000, 2018, 2020].entries()) {
        assert.equal(eras[i], partOf(at(year), { era: "long" }, "era"), `japanese era ${year}`);
      }

      assert.equal(new Set(eras).size, 3, `four Japanese years gave the eras ${JSON.stringify(eras)}`);
    });

    // ---- the seam between literals and handlers ----

    test("literals, quoted text and unrecognized tokens land where they were", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromObject(
        { year: 2024, month: 3, day: 5, hour: 14, minute: 7, second: 9 },
        { zone: "UTC", locale: "en-US" }
      ) as unknown as DT;

      assert.equal(dt.toFormat("yyyy-MM-dd'T'HH:mm:ss"), "2024-03-05T14:07:09");
      assert.equal(dt.toFormat("HH:mm"), "14:07");
      // leading and trailing literal runs, which are the first and last slots
      assert.equal(dt.toFormat("[HH]"), "[14]");
      assert.equal(dt.toFormat("'at' HH"), "at 14");
      assert.equal(dt.toFormat("HH 'sharp'"), "14 sharp");
      // adjacent handlers with nothing between them
      assert.equal(dt.toFormat("HHmmss"), "140709");
      // a format that is only literal, with no handler run at all
      assert.equal(dt.toFormat("'hello'"), "hello");
      assert.equal(dt.toFormat("-- --"), "-- --");
      assert.equal(dt.toFormat(""), "");
      // an unrecognized token comes back verbatim, and does not shift what
      // follows it
      assert.equal(dt.toFormat("Q HH"), "Q 14");
      assert.equal(dt.toFormat("HH Q HH"), "14 Q 14");
      // escaped quotes
      assert.equal(dt.toFormat("''"), "'");
      assert.equal(dt.toFormat("'''HH'''"), "'HH'");
    });

    test("macro tokens are still macros, and still keep their place", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromObject(
        { year: 2024, month: 3, day: 5, hour: 14, minute: 7 },
        { zone: "UTC", locale: "en-US" }
      );

      const formats: Record<string, unknown> = {
        D: m.DateTime.DATE_SHORT,
        DD: m.DateTime.DATE_MED,
        DDD: m.DateTime.DATE_FULL,
        DDDD: m.DateTime.DATE_HUGE,
        t: m.DateTime.TIME_SIMPLE,
        tt: m.DateTime.TIME_WITH_SECONDS,
        T: m.DateTime.TIME_24_SIMPLE,
        TT: m.DateTime.TIME_24_WITH_SECONDS,
        ttt: m.DateTime.TIME_WITH_SHORT_OFFSET,
        tttt: m.DateTime.TIME_WITH_LONG_OFFSET,
        TTT: m.DateTime.TIME_24_WITH_SHORT_OFFSET,
        TTTT: m.DateTime.TIME_24_WITH_LONG_OFFSET,
        f: m.DateTime.DATETIME_SHORT,
        ff: m.DateTime.DATETIME_MED,
        fff: m.DateTime.DATETIME_FULL,
        ffff: m.DateTime.DATETIME_HUGE,
        F: m.DateTime.DATETIME_SHORT_WITH_SECONDS,
        FF: m.DateTime.DATETIME_MED_WITH_SECONDS,
        FFF: m.DateTime.DATETIME_FULL_WITH_SECONDS,
        FFFF: m.DateTime.DATETIME_HUGE_WITH_SECONDS,
      };

      for (const [macro, preset] of Object.entries(formats)) {
        const alone = dt.toFormat(macro);

        // the macro has to render as the preset it names, not as anything else
        // that is merely non-empty and stable
        assert.equal(alone, dt.toLocaleString(preset as never), `${macro} is not its preset`);
        assert.equal(dt.toFormat(`<${macro}>`), `<${alone}>`, `${macro} between literals`);
        assert.equal(dt.toFormat(`${macro} ${macro}`), `${alone} ${alone}`, `${macro} twice`);
      }
    });

    test("the offset tokens read the formatter's own allowZ", async () => {
      const m = await loadLuxon(keys);
      const utc = m.DateTime.fromObject({ year: 2024, month: 3, day: 5 }, { zone: "utc" });
      const est = m.DateTime.fromObject({ year: 2024, month: 1, day: 5 }, { zone: ZONE });

      // toFormat's formatter carries no allowZ, so a zero fixed offset is not Z
      assert.equal(utc.toFormat("Z"), "+0");
      assert.equal(utc.toFormat("ZZ"), "+00:00");
      assert.equal(utc.toFormat("ZZZ"), "+0000");
      assert.equal(est.toFormat("Z"), "-5");
      assert.equal(est.toFormat("ZZ"), "-05:00");
      assert.equal(est.toFormat("ZZZ"), "-0500");
      assert.equal(est.toFormat("ZZZZ"), "EST");
      assert.equal(est.toFormat("ZZZZZ"), "Eastern Standard Time");
      assert.equal(est.toFormat("z"), ZONE);

      // toISO's formatter does carry it, which is the only caller that does
      assert.equal(utc.toISO(), "2024-03-05T00:00:00.000Z");
      assert.equal(est.toISO()!.endsWith("-05:00"), true);
    });

    // ---- the program cache ----

    test("a pattern is compiled once however often it is formatted", async () => {
      const m = await loadLuxon(keys);
      const F = await formatterModule(keys);
      const real = F.parseFormat.bind(F);
      let compiles = 0;

      Object.defineProperty(F, "parseFormat", {
        configurable: true,
        value: (fmt: string) => {
          compiles++;
          return real(fmt);
        },
      });

      try {
        const dt = m.DateTime.fromObject({ year: 2024, month: 3, day: 5 }, { zone: "UTC", locale: "en-US" });
        const fmt = "yyyy-MM-dd HH:mm:ss";

        dt.toFormat(fmt);
        compiles = 0;

        for (let i = 0; i < 50; i++) dt.toFormat(fmt);

        assert.equal(compiles, 0, `50 repeats of one pattern compiled it ${compiles} times`);

        // and the cache is bounded: past the ceiling a new pattern is compiled
        // every time rather than remembered
        for (let i = 0; i < 1200; i++) dt.toFormat(`'p${i}' HH`);

        compiles = 0;
        dt.toFormat("'overflow' HH");
        dt.toFormat("'overflow' HH");

        assert.equal(compiles, 2, "a pattern past the ceiling was remembered anyway");
      } finally {
        Object.defineProperty(F, "parseFormat", { configurable: true, writable: true, value: real });
      }
    });

    test("a program is shared between locales without carrying one of them", async () => {
      const m = await loadLuxon(keys);
      const fmt = "cccc d MMMM yyyy";
      const mk = (locale: string) =>
        m.DateTime.fromObject({ year: 2024, month: 7, day: 4 }, { zone: "UTC", locale });

      // whichever order they arrive in, each gets its own names out of a program
      // compiled by whoever was first
      const first = mk("fr").toFormat(fmt);
      const second = mk("de").toFormat(fmt);
      const again = mk("fr").toFormat(fmt);

      assert.equal(again, first, "fr changed once de had been through the same program");
      assert.notEqual(first, second, "fr and de rendered identically");
      assert.match(first, /juillet/);
      assert.match(second, /Juli/);
    });

    // The memo and the English shortcut both answer the same strings the
    // unmemoized path does, so the only thing that separates them from doing
    // nothing is how often Intl is asked.
    test("a name is fetched once per distinct value, and never for English", async () => {
      const m = await loadLuxon(keys);
      const interned = keys.includes(patchKey("localeIntern"));
      const Real = Intl.DateTimeFormat;
      let fetched = 0;

      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
        const dtf = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
        const parts = dtf.formatToParts.bind(dtf);

        Object.defineProperty(dtf, "formatToParts", {
          configurable: true,
          value: (ts?: number) => (fetched++, parts(ts)),
        });

        return dtf;
      };

      try {
        m.Settings.resetCaches();

        const fr = m.DateTime.fromObject({ year: 2024, month: 3, day: 5 }, { zone: "UTC", locale: "fr" });

        fr.toFormat("MMMM cccc");
        const afterFirst = fetched;

        for (let i = 0; i < 40; i++) fr.toFormat("MMMM cccc");

        // The memo hangs off the Locale, and toFormat builds a fresh one per call
        // through redefaultToEN, so on its own this patch memoizes nothing. F is
        // what makes those the same object. Both halves are asserted, because the
        // one that does nothing here is still the one that has to be right.
        if (interned) {
          assert.equal(fetched, afterFirst, `forty repeats of one date fetched ${fetched - afterFirst} more names`);

          // a different day of the same month reuses the month and not the weekday
          fetched = 0;
          fr.plus({ days: 1 }).toFormat("MMMM cccc");

          assert.ok(fetched <= 1, `a new weekday in a known month fetched ${fetched} names`);
        } else {
          assert.ok(fetched > afterFirst, "a memo hit without interned locales, which should not be possible");
        }

        // English never asks at all
        const en = m.DateTime.fromObject({ year: 2024, month: 3, day: 5 }, { zone: "UTC", locale: "en-US" });
        fetched = 0;

        for (let i = 0; i < 20; i++) en.toFormat("MMMM cccc a G");

        assert.equal(fetched, 0, `en-US names went to Intl ${fetched} times`);
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
        m.Settings.resetCaches();
      }
    });

    test("English still comes off the constant arrays", async () => {
      const m = await loadLuxon(keys);
      const dt = m.DateTime.fromObject(
        { year: 2024, month: 3, day: 5, hour: 14 },
        { zone: "UTC", locale: "en-US" }
      );

      assert.equal(dt.toFormat("MMMM"), "March");
      assert.equal(dt.toFormat("MMM"), "Mar");
      assert.equal(dt.toFormat("MMMMM"), "M");
      assert.equal(dt.toFormat("cccc"), "Tuesday");
      assert.equal(dt.toFormat("ccc"), "Tue");
      assert.equal(dt.toFormat("a"), "PM");
      assert.equal(dt.toFormat("G"), "AD");
      assert.equal(dt.toFormat("GG"), "Anno Domini");
    });
  });
}
