// What the patches are worth across the public API, and where that leaves luxon
// against moment.
//
// The other benches here are narrow on purpose: format.ts and upstream.ts time
// writing a date and reading one, because that is where the patches were found
// and where their case has to be made. That narrowness became misleading once
// the patch set grew past the formatter. H hoists both normalizeUnit tables and
// the SystemZone probe and replaces the Duration round trip inside adjustTime,
// none of which any formatting or parsing case reaches — they were found by
// profiling, not by any table, and a reader of upstream.ts would not know those
// paths exist. A and F sit under every zoned operation, not just the ones that
// print something.
//
// The adjustTime change is the reason this table exists in its current form. It
// is under every plus and minus, and so under endOf, hasSame, diff, toRelative
// and Interval#splitBy, and upstream.ts has a row for none of those.
//
// So this table is the other axis: one operation per row, chosen for being what
// callers actually reach for, with the moment equivalent beside it. It does not
// re-derive the ladder — upstream.ts owns that, rung by rung — and carries only
// the two endpoints, stock and the full patched build.
//
// Three columns of absolute milliseconds, then the two ratios worth carrying:
// the patched build's time as a fraction of stock's, and of moment's. Lower is
// better in every column, so the whole table reads one way. Both ratios are kept
// because a row where the patches take a twentieth of stock's time and still
// trail moment is a different result from one where they overtake it, and
// neither the milliseconds nor a single ratio says which happened.
//
//   node coverage.ts
//   bun coverage.ts

import type { DateTime } from "luxon";
import moment from "moment-timezone";
import { LEAN_BUDGET, LEAN_BUDGET_MS, interleavedBest, pkgVersion, runtime, timeLoop, type Work } from "./lib/kernel.ts";
import type { LuxonModule } from "./lib/luxon-types.ts";
import { loadLuxon, patchKeys, type PatchKey } from "./lib/patches.ts";
import { printTable } from "./lib/print-table.ts";

// The same window upstream.ts times over, so a row that appears in both is
// comparable: January, one minute apart, in a zone with a DST rule.
const BASE_TS = Date.UTC(2024, 0, 1);
const STEP_MS = 60_000;
const ZONE = "America/New_York";
const OTHER_ZONE = "Europe/Paris";
const LOCALE = "en-US";
// for the Info rows, where English takes a short-circuit that skips Intl entirely
const OTHER_LOCALE = "fr";

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
function pool(m: LuxonModule): DateTime[] {
  return Array.from({ length: POOL }, (_, i) =>
    m.DateTime.fromMillis(BASE_TS + i * STEP_MS, { zone: ZONE, locale: LOCALE })
  );
}

function momentPool(): moment.Moment[] {
  return Array.from({ length: POOL }, (_, i) => moment.tz(BASE_TS + i * STEP_MS, ZONE));
}

function isoPool(m: LuxonModule): string[] {
  return pool(m).map((dt) => dt.toISO()!);
}

function tokenPool(m: LuxonModule): string[] {
  return pool(m).map((dt) => dt.toFormat(LUX_NUMERIC));
}

const LUX_NUMERIC = "yyyy-MM-dd HH:mm:ss";
const MO_NUMERIC = "YYYY-MM-DD HH:mm:ss";

// The instant every relative case is measured against, so `toRelative` and
// `fromNow` are deterministic rather than drifting with the clock.
const REL_BASE = BASE_TS + 90 * 24 * 3_600_000;

const CASES: Case[] = [
  // ---- constructing and parsing ----
  //
  // All five need an offset to place a local time, so all five are under A, B and
  // F. fromFormat is the only one that reaches D, and fromObject the only one
  // that normalizes unit names (H).
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
    key: "fromObject",
    luxon: (m) => (ts) => {
      const i = idx(ts);
      return m.DateTime.fromObject({ year: 2024, month: 1 + (i % 12), day: 1 + (i % 28), hour: i % 24 }, { zone: ZONE })
        .valueOf();
    },
    moment: () => (ts) => {
      const i = idx(ts);
      return moment.tz({ year: 2024, month: i % 12, day: 1 + (i % 28), hour: i % 24 }, ZONE).valueOf();
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
  // (H), and every one needs an offset for the result, so every one is also under
  // A, B and F. None of them formats anything, which is why no other table here
  // reaches them. setZone is the exception that proves it: no unit, so no H.
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
    // not the Formatter: toISO builds its string directly and normalizes only
    // its `precision` argument, which is why C does nothing for it and H does
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
    // relative-time formatting: the zone rungs move it before H is on at all
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

// No control column (stock loaded a second time as its own neighbour). The other
// benches here carry one to show what a difference has to beat, and it earns its
// place there because they report percentage deltas, where a 3% row and a 3%
// noise floor look identical on the page. This table prints absolute
// milliseconds and its differences are mostly an order of magnitude, so the
// column was buying an answer to a question the numbers no longer raise — at the
// cost of a third more time under load, on a host that throttles.
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
  `ms per ${N.toLocaleString("en-US")} calls, fastest of ${passes} interleaved passes at ${LEAN_BUDGET_MS}ms each\n`
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

// ---- timing -----------------------------------------------------------------

const results = new Map<string, Map<string, number>>();
let sink = 0;

for (const kase of CASES) {
  // one case's builds timed adjacently, so drift between cases cannot be read as
  // a difference between builds
  const entries = BUILDS.map((b) => ({ key: b.id, work: kase.luxon(loaded.get(b.id)!) }));

  if (kase.moment !== undefined) entries.push({ key: "moment", work: kase.moment() });

  // one group, so the kernel rotates which build runs first each pass. Without
  // it the same column is always the one measured right after the previous case
  // and pays for collecting its garbage, which does not cancel in a ratio and
  // which taking the fastest pass cannot remove — every pass penalizes the same
  // column. It showed up as the control drifting 7-13% from stock on the two
  // allocation-heaviest rows.
  const { best, checksum } = interleavedBest(entries, BASE_TS, STEP_MS, N, LEAN_BUDGET, LEAN_BUDGET_MS, entries.length);

  sink += checksum;
  results.set(kase.key, best);
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
  ["write", 6],
  ["Duration", 3],
  ["Interval", 3],
  ["Info", 3],
];

const rows: (string[] | null)[] = [];
let at = 0;

for (const [, count] of SECTIONS) {
  if (at > 0) rows.push(null);

  for (const kase of CASES.slice(at, at + count)) {
    const got = results.get(kase.key)!;
    const mo = got.get("moment");
    const base = got.get("stock")!;
    const all = got.get(`all ${ALL.length}`)!;

    rows.push([
      kase.key + (kase.approx === true ? " *" : ""),
      ms(base),
      ms(all),
      mo === undefined ? "--" : ms(mo),
      ratio(all, base),
      mo === undefined ? "--" : ratio(all, mo),
    ]);
  }

  at += count;
}

if (at !== CASES.length) {
  throw new Error(`the section list covers ${at} cases but there are ${CASES.length}`);
}

printTable(["case", "stock ms", `all ${ALL.length} ms`, "moment ms", "vs stock", "vs moment"], rows);

// The rows still above 1.000, named from the run rather than written down, so the
// paragraph below cannot drift from the table above it.
const behind = CASES.filter((kase) => {
  const got = results.get(kase.key)!;
  const mo = got.get("moment");
  return mo !== undefined && got.get(`all ${ALL.length}`)! > mo;
});

console.log(
  `\n* moment reaches the same user-visible answer by different means on these rows -- it expands its own\n` +
    `  locale tables where luxon calls into ICU -- so those are two libraries doing comparable work rather\n` +
    `  than two implementations of one algorithm. Interval has no moment equivalent short of a plugin.\n` +
    `\nBoth ratios are the patched build's time as a fraction of the named column's, so lower is better\n` +
    `everywhere, 1.000 is parity, and a 4x speedup reads as 0.250. Above 1.000 the patched build is\n` +
    `behind. Which internals a row reaches is in the source above rather than a column;\n` +
    `it does not follow the timings, and the places it comes apart are the interesting ones. toLocaleString\n` +
    `routes through G and barely moves, because G interns locales and this table holds the locale fixed,\n` +
    `while toISO never reaches the Formatter at all -- it builds its string directly -- so C does nothing\n` +
    `for it and H does.\n` +
    `\nThe Info rows call moment.localeData(x).months(), which returns the list moment already holds, rather\n` +
    `than the public moment.months(), which reads a process-global locale and rebuilds the list per call\n` +
    `out of twelve freshly constructed Moments. The cheaper one is the fairer comparison to make luxon\n` +
    `beat, and it is the one these columns are against.`
);

console.log(
  `\nStill behind moment: ${behind.map((k) => `${k.key}${k.approx === true ? " *" : ""} (${ratio(results.get(k.key)!.get(`all ${ALL.length}`)!, results.get(k.key)!.get("moment")!)})`).join(", ")}.\n` +
    `\nThose are four different results. The starred ones are the ICU boundary above, and are the trade\n` +
    `each library made rather than something to fix here. The Info rows are the same boundary at a scale\n` +
    `where the ratio flatters itself: both sides are under half a millisecond for ${N.toLocaleString("en-US")} calls, and\n` +
    `the stock column is where that row's argument is. Duration as is shiftTo and normalizeValues, which\n` +
    `is work luxon does and moment's asHours does not.\n` +
    `\nfromObject, endOf, diff and hasSame are the ones to read as unfinished: luxon doing the same job\n` +
    `moment does and taking longer at it. Three of them are also where H's adjustTime fast path landed --\n` +
    `diff, endOf, toRelative and hasSame were 7x, 5x, 3x and 2x behind before it, which is what sent the\n` +
    `profiler at adjustTime to begin with. diff is the one left with an obvious next step. It walks units\n` +
    `largest-first and calls earlier.plus(results) once or twice per unit to test each guess, so it pays\n` +
    `adjustTime up to ten times for one answer, and then builds two more Durations to combine the high\n` +
    `and low order halves of a result it has already computed.`
);

console.log(`\nchecksum ${sink.toFixed(0)}`);
