// What the patches are worth across the public API, and where that leaves luxon
// against moment.
//
// The other benches here are narrow on purpose: format.ts and upstream.ts time
// writing a date and reading one, because that is where the patches were found
// and where their case has to be made. That narrowness became misleading once
// the patch set grew past the formatter. G hoists both normalizeUnit tables and
// the SystemZone probe and replaces the Duration round trip inside adjustTime,
// none of which any formatting or parsing case reaches — they were found by
// profiling, not by any table, and a reader of upstream.ts would not know those
// paths exist. A and E sit under every zoned operation, not just the ones that
// print something.
//
// The adjustTime change is the reason this table exists in its current form. It
// is under every plus and minus, and so under endOf, hasSame, diff, toRelative
// and Interval#splitBy, and upstream.ts has a row for none of those.
//
// So this table is the other axis: one operation per row, chosen for being what
// callers actually reach for. It does not re-derive the ladder — upstream.ts owns
// that, rung by rung — and carries only the two endpoints, stock and the full
// patched build.
//
// moment leads the columns because it is the number the work is aimed at; stock
// luxon is the distance travelled rather than the target.
//
// The reading of it — why each row is here, which rows still trail moment and
// what is left to do about them, and the two toLocaleString cache designs that
// were tried and dropped — is in benchmarks/docs/coverage.md. This file prints
// the table.
//
//   node coverage.ts
//   bun coverage.ts

import type { DateTime } from "luxon";
import moment from "moment-timezone";
import { colorEnabled, colorLegend, shade } from "./lib/color.ts";
import { LEAN_BUDGET, LEAN_BUDGET_MS, measureRows, pkgVersion, runtime, timeLoop, type Work } from "./lib/kernel.ts";
import type { LuxonModule } from "./lib/luxon-types.ts";
import { cooldownMs } from "./lib/opts.ts";
import { loadLuxon, patchKeys, type PatchKey } from "./lib/patches.ts";
import { streamTable } from "./lib/stream-table.ts";

// The same window upstream.ts times over, so a row that appears in both is
// comparable: January, one minute apart, in a zone with a DST rule.
const BASE_TS = Date.UTC(2024, 0, 1);
const STEP_MS = 60_000;
const ZONE = "America/New_York";
const OTHER_ZONE = "Europe/Paris";
const LOCALE = "en-US";
// for the Info rows, where English takes a short-circuit that skips Intl entirely
const OTHER_LOCALE = "fr";

/** where the prose went */
const DOCS = "benchmarks/docs";

// Values reported per row. Nothing is timed over exactly this — the kernel sizes
// each entry to a wall-time budget and scales — it is just the unit the ms
// columns are quoted in.
const N = 5_000;

// Distinct inputs each pooled case cycles through. Large enough that a cache
// keyed on the instant cannot serve the whole loop from one entry, small enough
// that the pool itself stays in cache. Indexed off the timestamp rather than a
// counter so a case returns the same values whatever pass length it is given,
// which is what lets the agreement check below compare checksums across builds.
const POOL = 512;

const idx = (ts: number) => (((ts - BASE_TS) / STEP_MS) | 0) % POOL;

// ---- what gets timed --------------------------------------------------------

interface Case {
  key: string;
  luxon: (m: LuxonModule) => Work;
  /** omitted where moment has no equivalent to call */
  moment?: () => Work;
  /**
   * moment reaches the same USER-VISIBLE result by different means, so the
   * ratio is a library comparison and not a like-for-like one. Both the
   * localized cases are this: luxon calls into ICU and moment expands its own
   * token table, which is a different amount of work for a different quality of
   * answer.
   */
  approx?: true;
  /** reads the clock, so its output cannot be checked across builds */
  live?: true;
}

/**
 * Pre-built instants, so an operation on a DateTime is not timed constructing
 * one. The locale is pinned rather than left to the system, so the rows that
 * render words (toLocaleString, toRelative, toHuman) measure the same work on
 * any host.
 */
function pool(m: LuxonModule, locale = LOCALE): DateTime[] {
  return Array.from({ length: POOL }, (_, i) =>
    m.DateTime.fromMillis(BASE_TS + i * STEP_MS, { zone: ZONE, locale })
  );
}

// the locale is set when the pool is built rather than per call, because
// moment's setter mutates the instance rather than returning a new one
function momentPool(locale?: string): moment.Moment[] {
  return Array.from({ length: POOL }, (_, i) => {
    const mo = moment.tz(BASE_TS + i * STEP_MS, ZONE);
    return locale === undefined ? mo : mo.locale(locale);
  });
}

function isoPool(m: LuxonModule): string[] {
  return pool(m).map((dt) => dt.toISO()!);
}

function tokenPool(m: LuxonModule): string[] {
  return pool(m).map((dt) => dt.toFormat(LUX_NUMERIC));
}

const LUX_NUMERIC = "yyyy-MM-dd HH:mm:ss";
const MO_NUMERIC = "YYYY-MM-DD HH:mm:ss";

// Patterns that are not all-numeric, because an all-numeric one in en-US on the
// gregorian calendar is the input G's num()/padStart/roundTo fast paths were
// written for, and for a while it was the only input any bench here had. The
// three shapes below are the ones that fall outside it, and they are I's case
// rather than G's:
//
//   text     a month or weekday name never reaches a numeric fast path at all
//   wide     the per-token switch I removes runs once per token, so its cost
//            scales with the pattern and the other patches' savings do not
//   fr       words in a non-English locale go through Locale#extract, where the
//            interpreter rebuilds an Intl options literal per token per value
//
// moment's offset tokens are one Z behind luxon's: moment ZZ is luxon ZZZ.
const LUX_TEXT = "cccc, LLLL d, yyyy 'at' h:mm a";
const MO_TEXT = "dddd, MMMM D, YYYY [at] h:mm A";
const LUX_WIDE = "yyyy-MM-dd HH:mm:ss.SSS ZZZ WW ooo q kkkk";
const MO_WIDE = "YYYY-MM-DD HH:mm:ss.SSS ZZ WW DDDD Q GGGG";

// The instant every relative case is measured against, so `toRelative` and
// `fromNow` are deterministic rather than drifting with the clock.
const REL_BASE = BASE_TS + 90 * 24 * 3_600_000;

const CASES: Case[] = [
  // ---- constructing and parsing ----
  //
  // All five need an offset to place a local time, so all five are under A, B and
  // E. fromFormat is the only one that reaches C, and fromObject the only one
  // that normalizes unit names (G).
  {
    key: "fromMillis",
    luxon: (m) => (ts) => m.DateTime.fromMillis(ts, { zone: ZONE }).valueOf(),
    moment: () => (ts) => moment.tz(ts, ZONE).valueOf(),
  },
  {
    key: "fromISO",
    luxon: (m) => {
      const p = isoPool(m);
      return (ts) => m.DateTime.fromISO(p[idx(ts)]!, { zone: ZONE }).valueOf();
    },
    moment: () => {
      const p = isoPool(stock);
      return (ts) => moment.tz(p[idx(ts)]!, moment.ISO_8601, ZONE).valueOf();
    },
  },
  {
    key: "fromFormat",
    luxon: (m) => {
      const p = tokenPool(m);
      return (ts) => m.DateTime.fromFormat(p[idx(ts)]!, LUX_NUMERIC, { zone: ZONE }).valueOf();
    },
    moment: () => {
      const p = tokenPool(stock);
      return (ts) => moment.tz(p[idx(ts)]!, MO_NUMERIC, ZONE).valueOf();
    },
  },
  {
    // An odometer, and deliberately: consecutive values are an hour apart, so the
    // row walks 2024 rather than jumping around inside it.
    //
    // It used to jump. month, day and hour were each `i % n` off the same
    // counter, which advances all three at once and lands every construction in a
    // different month from the one before it. E caches the transition-free span
    // around the last offset it looked up, and no two consecutive values shared
    // one, so the row was measuring E's miss path at a rate no caller produces —
    // 3.69 ICU calls per construction, against 0.38 for the pattern here. That is
    // a real cost of E and worth knowing, but it is a fact about the cache and
    // this row is supposed to be about fromObject.
    //
    // Hours ascending is the shape of the callers that build dates in bulk: a
    // calendar filling a grid, a series filling buckets. A caller who really does
    // hop between months exists, and pays what the old shape measured.
    key: "fromObject",
    luxon: (m) => (ts) => {
      const i = idx(ts);
      return m.DateTime.fromObject(
        { year: 2024, month: 1 + (Math.floor(i / 672) % 12), day: 1 + (Math.floor(i / 24) % 28), hour: i % 24 },
        { zone: ZONE }
      ).valueOf();
    },
    moment: () => (ts) => {
      const i = idx(ts);
      return moment
        .tz({ year: 2024, month: Math.floor(i / 672) % 12, day: 1 + (Math.floor(i / 24) % 28), hour: i % 24 }, ZONE)
        .valueOf();
    },
  },
  {
    key: "now",
    live: true,
    luxon: (m) => () => m.DateTime.now().setZone(ZONE).valueOf(),
    moment: () => () => moment.tz(ZONE).valueOf(),
  },

  // ---- arithmetic ----
  //
  // Every one of these names a unit, so every one goes through a normalizeUnit
  // (G), and every one needs an offset for the result, so every one is also under
  // A, B and E. None of them formats anything, which is why no other table here
  // reaches them. setZone is the exception that proves it: no unit, so no G.
  {
    key: "plus",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.plus({ days: 1 }).valueOf();
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.clone().add(1, "day").valueOf();
    },
  },
  {
    key: "minus",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.minus({ months: 1 }).valueOf();
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.clone().subtract(1, "month").valueOf();
    },
  },
  {
    key: "startOf day",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.startOf("day").valueOf();
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.clone().startOf("day").valueOf();
    },
  },
  {
    key: "endOf month",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.endOf("month").valueOf();
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.clone().endOf("month").valueOf();
    },
  },
  {
    key: "set",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.set({ hour: 9, minute: 30 }).valueOf();
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.clone().set({ hour: 9, minute: 30 }).valueOf();
    },
  },
  {
    key: "diff",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.diff(p[(idx(ts) + 137) % POOL]!, ["days", "hours"]).hours;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.diff(p[(idx(ts) + 137) % POOL]!, "hours");
    },
  },
  {
    key: "hasSame day",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => +p[idx(ts)]!.hasSame(p[(idx(ts) + 137) % POOL]!, "day");
    },
    moment: () => {
      const p = momentPool();
      return (ts) => +p[idx(ts)]!.isSame(p[(idx(ts) + 137) % POOL]!, "day");
    },
  },
  {
    key: "setZone",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.setZone(OTHER_ZONE).valueOf();
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.clone().tz(OTHER_ZONE).valueOf();
    },
  },

  // ---- writing ----
  {
    key: "toFormat num",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toFormat(LUX_NUMERIC).length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.format(MO_NUMERIC).length;
    },
  },
  {
    key: "toFormat abbr",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toFormat("ZZZZ").length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.format("z").length;
    },
  },
  {
    key: "toFormat text",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toFormat(LUX_TEXT).length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.format(MO_TEXT).length;
    },
  },
  {
    key: "toFormat text fr",
    approx: true,
    luxon: (m) => {
      const p = pool(m, OTHER_LOCALE);
      return (ts) => p[idx(ts)]!.toFormat(LUX_TEXT).length;
    },
    moment: () => {
      const p = momentPool(OTHER_LOCALE);
      return (ts) => p[idx(ts)]!.format(MO_TEXT).length;
    },
  },
  {
    key: "toFormat wide",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toFormat(LUX_WIDE).length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.format(MO_WIDE).length;
    },
  },
  {
    // a fixed eight-token pattern with two of them words, so it is the text case
    // with none of the caller's choices in it — and it is what an HTTP header or
    // a mail date costs, which is the shape of formatting most likely to be on a
    // request path rather than in a rendered table
    key: "toRFC2822",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toRFC2822()!.length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.format("ddd, DD MMM YYYY HH:mm:ss ZZ").length;
    },
  },
  {
    // the same pattern again, but through toUTC() first, so this is toRFC2822
    // plus a zone change rather than a second reading of it
    key: "toHTTP",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toHTTP()!.length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.clone().utc().format("ddd, DD MMM YYYY HH:mm:ss [GMT]").length;
    },
  },
  {
    // not the Formatter: toISO builds its string directly and normalizes only
    // its `precision` argument, which is why I does nothing for it and G does
    key: "toISO",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toISO()!.length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.format().length;
    },
  },
  {
    key: "toISODate",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toISODate()!.length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.format("YYYY-MM-DD").length;
    },
  },
  {
    key: "toLocaleString",
    approx: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toLocaleString(m.DateTime.DATETIME_MED).length;
    },
    moment: () => {
      const p = momentPool();
      return (ts) => p[idx(ts)]!.format("lll").length;
    },
  },
  {
    // most of what the patches win here is the diff it does internally, not the
    // relative-time formatting: the zone rungs move it before G is on at all
    key: "toRelative",
    approx: true,
    luxon: (m) => {
      const p = pool(m);
      const base = m.DateTime.fromMillis(REL_BASE, { zone: ZONE });
      return (ts) => p[idx(ts)]!.toRelative({ base })!.length;
    },
    moment: () => {
      const p = momentPool();
      const base = moment.tz(REL_BASE, ZONE);
      return (ts) => p[idx(ts)]!.from(base).length;
    },
  },

  // ---- Duration ----
  {
    key: "Duration as",
    luxon: (m) => (ts) => m.Duration.fromObject({ minutes: 100 + idx(ts) }).as("hours"),
    moment: () => (ts) => moment.duration(100 + idx(ts), "minutes").asHours(),
  },
  {
    key: "Duration shiftTo",
    luxon: (m) => (ts) => m.Duration.fromObject({ minutes: 100 + idx(ts) }).shiftTo("hours", "minutes").hours,
  },
  {
    key: "Duration toHuman",
    approx: true,
    luxon: (m) => (ts) => m.Duration.fromObject({ hours: 1 + (idx(ts) % 9), minutes: 30 }).toHuman().length,
    moment: () => (ts) => moment.duration({ hours: 1 + (idx(ts) % 9), minutes: 30 }).humanize().length,
  },

  // ---- Interval: no moment equivalent, the plugin that adds one is not here ----
  {
    key: "Interval length",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => m.Interval.fromDateTimes(p[idx(ts)]!, p[idx(ts)]!.plus({ months: 2 })).length("days");
    },
  },
  {
    key: "Interval contains",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => {
        const start = p[idx(ts)]!;
        return +m.Interval.fromDateTimes(start, start.plus({ days: 30 })).contains(start.plus({ days: 3 }));
      };
    },
  },
  {
    key: "Interval splitBy",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => {
        const start = p[idx(ts)]!;
        return m.Interval.fromDateTimes(start, start.plus({ days: 10 })).splitBy({ days: 1 }).length;
      };
    },
  },

  // ---- Info: straight into the locale machinery ----
  //
  // In English these do not reach it at all. Locale#months routes through
  // listStuff, which for an English listingMode returns English.months — a
  // module-level array — without constructing anything or calling Intl. Both
  // spellings are here because the difference is the point: the en row is the
  // one most callers hit and costs a Locale construction and nothing else, and
  // the fr row is what the locale machinery actually costs when it runs.
  {
    key: "Info.months en",
    luxon: (m) => () => m.Info.months("long", { locale: LOCALE }).length,
    moment: () => () => moment.localeData("en").months().length,
  },
  {
    key: "Info.months fr",
    luxon: (m) => () => m.Info.months("long", { locale: OTHER_LOCALE }).length,
    moment: () => () => moment.localeData(OTHER_LOCALE).months().length,
  },
  {
    key: "Info.weekdays fr",
    luxon: (m) => () => m.Info.weekdays("long", { locale: OTHER_LOCALE }).length,
    moment: () => () => moment.localeData(OTHER_LOCALE).weekdays().length,
  },
];

// ---- builds -----------------------------------------------------------------

const ALL: PatchKey[] = [...patchKeys];

const BUILDS: { id: string; keys: PatchKey[] }[] = [
  { id: "stock", keys: [] },
  { id: `all ${ALL.length}`, keys: ALL },
];

const loaded = new Map<string, LuxonModule>();

for (const b of BUILDS) loaded.set(b.id, await loadLuxon(b.keys));

const stock = loaded.get("stock")!;

console.log(
  `luxon ${await pkgVersion()} (this fork's src/) vs moment ${await pkgVersion("moment")} / ` +
    `moment-timezone ${await pkgVersion("moment-timezone")}`
);
console.log(`runtime: ${runtime()}, zone ${ZONE}, locale ${LOCALE}`);
const passes = LEAN_BUDGET.min === LEAN_BUDGET.max ? `${LEAN_BUDGET.min}` : `${LEAN_BUDGET.min}-${LEAN_BUDGET.max}`;

console.log(
  `ms per ${N.toLocaleString("en-US")} calls, fastest of ${passes} interleaved passes at ${LEAN_BUDGET_MS}ms each` +
    `${cooldownMs > 0 ? `, ${cooldownMs / 1000}s idle between rows` : ", no cooldown"}\n`
);

// ---- do the builds still agree? ---------------------------------------------
//
// Every patch here is supposed to be invisible, and a timing table is the last
// place a behavior change would announce itself — a build that skips work is
// exactly what this bench rewards. The cases are deterministic by construction
// (pool indices come off the timestamp, not a counter), so summing each one over
// a fixed window and comparing across builds is nearly free and catches a patch
// that changed an answer rather than just the time taken to get it.

const CHECK_N = 256;
const disagree: string[] = [];

for (const kase of CASES) {
  if (kase.live === true) continue;

  const sums = BUILDS.map((b) => timeLoop(kase.luxon(loaded.get(b.id)!), BASE_TS, STEP_MS, CHECK_N).checksum);

  if (sums.some((s) => s !== sums[0]!)) {
    disagree.push(`${kase.key}: ${BUILDS.map((b, i) => `${b.id}=${sums[i]!}`).join(" ")}`);
  }
}

if (disagree.length > 0) {
  throw new Error(`builds disagree on ${disagree.length} case(s), so the timings below are not comparable:\n${disagree.join("\n")}`);
}

// ---- report -----------------------------------------------------------------

// Fixed decimals across the whole table, not significant figures. The columns
// are here to be compared down as well as across — the point of a row is which
// of three numbers is bigger — and a column that switches precision partway
// misaligns the decimal points and stops reading as a column at all. Two places
// is what the sub-millisecond Info rows need to say anything.
const ms = (v: number) => v.toFixed(2);

// Both ratios are the patched build's time as a FRACTION of the column named, so
// they read the same way round as the milliseconds beside them — lower is better,
// 1.000 is parity — and a 4x speedup is 0.250.
//
// Three places rather than two because this direction compresses the wins into
// the bottom of the range: the largest here is Info.months in a non-English
// locale at 0.001, and at two places that row and everything near it would print
// as 0.00 and stop distinguishing anything. The extra digit below a thousandth
// is a guard rather than a format — nothing currently reaches it — so that a
// future patch big enough to round to 0.000 cannot silently do so.
const ratio = (patched: number, baseline: number) => {
  const v = patched / baseline;
  return v.toFixed(v < 0.001 ? 4 : 3);
};

const SECTIONS: [string, number][] = [
  ["read", 5],
  ["arithmetic", 8],
  ["write", 11],
  ["Duration", 3],
  ["Interval", 3],
  ["Info", 3],
];

const sectionTotal = SECTIONS.reduce((s, [, count]) => s + count, 0);

if (sectionTotal !== CASES.length) {
  throw new Error(`the section list covers ${sectionTotal} cases but there are ${CASES.length}`);
}

/** case index at which each section starts, for the rules between them */
const sectionStarts = new Set<number>();
let at = 0;

for (const [, count] of SECTIONS) {
  if (at > 0) sectionStarts.add(at);
  at += count;
}

// ---- timing -----------------------------------------------------------------
// One row at a time, printed as it lands and with an idle between, so the table
// is watchable over the minutes it takes and each row starts from a comparable
// thermal state. See measureRows and cooldownMs.

const table = streamTable(["case", "moment ms", "stock ms", `all ${ALL.length} ms`, "vs moment", "vs stock"], {
  minWidths: { 0: 18, 1: 9, 2: 9, 3: 9, 4: 9, 5: 8 },
});

let printed = 0;

const run = await measureRows(
  CASES,
  // one case's builds timed adjacently, so drift between cases cannot be read as
  // a difference between builds
  (kase) => {
    const entries = BUILDS.map((b) => ({ key: b.id, work: kase.luxon(loaded.get(b.id)!) }));

    if (kase.moment !== undefined) entries.push({ key: "moment", work: kase.moment() });

    return [
      {
        entries,
        passBudget: LEAN_BUDGET,
        budgetMs: LEAN_BUDGET_MS,
        // one group, so the kernel rotates which build runs first each pass.
        // Without it the same column is always the one measured right after the
        // previous case and pays for collecting its garbage, which does not
        // cancel in a ratio and which taking the fastest pass cannot remove —
        // every pass penalizes the same column. Back when this table had a
        // control it showed up as that column drifting 7-13% from stock on the
        // two allocation-heaviest rows.
        group: BUILDS.length + 1,
      },
    ];
  },
  { base: BASE_TS, step: STEP_MS, report: N, cooldownMs },
  (kase, { best }) => {
    if (sectionStarts.has(printed)) table.rule();

    printed++;

    const mo = best.get("moment");
    const base = best.get("stock")!;
    const all = best.get(`all ${ALL.length}`)!;

    // Shaded against this row's moment rather than the table's, since here the
    // baseline is a column and every case has its own. The rows whose moment is
    // `--` are the ones with no equivalent to compare against, and they come out
    // plain, which is the right amount of nothing to say about them.
    table.row([
      kase.key + (kase.approx === true ? " *" : ""),
      mo === undefined ? "--" : ms(mo),
      shade(ms(base), base, mo),
      shade(ms(all), all, mo),
      mo === undefined ? "--" : ratio(all, mo),
      ratio(all, base),
    ]);
  }
);

const sink = run.checksum;

// Two things a reader cannot get from the columns themselves: which way the
// ratios point, and that the starred rows are not comparing like with like.
// Everything else about this table -- why each row is here, and what to make of
// the ones still above 1.000 -- is in DOCS/coverage.md.
console.log(
  `\n* not like for like: moment expands its own bundled locale tables where luxon calls into ICU.\n` +
    `  Interval has no moment equivalent short of a plugin.\n` +
    `\nRatios are the patched build over the named column, so lower is better and 1.000 is parity.\n` +
    (colorEnabled ? `\n${colorLegend("this row's moment")}\n` : ``) +
    `\nwhat this table means: ${DOCS}/coverage.md   how it is timed: ${DOCS}/methodology.md`
);

console.log(`\nchecksum ${sink.toFixed(0)}`);
