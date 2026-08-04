// One operation per case, across the public API, for the ladder's third band.
//
// These were benchmarks/coverage.ts's rows until that table was merged into
// upstream.ts's ladder. The reason they exist has not changed: upstream.ts's
// original columns time writing a date and reading one, because that is where
// the patches were found, and that narrowness became misleading once the patch
// set grew past the formatter. G hoists both normalizeUnit tables and the
// SystemZone probe and replaces the Duration round trip inside adjustTime, H
// removes three objects from under every setter, and no formatting or parsing
// case reaches any of it. A and E sit under every zoned operation, not just the
// ones that print something.
//
// adjustTime is the reason this set exists in its current form. It is under
// every plus and minus, and so under endOf, hasSame, diff, toRelative and
// Interval#splitBy, and the format and parse columns have a cell for none of
// those.
//
// A case is a closure factory rather than a call so that each build gets its own
// pools: a DateTime built by one module cannot be handed to another, and a pool
// shared across builds would hand the second one a warm cache the first paid for.
//
// The prose — why each case is here, which still trail moment and what is left to
// do about them — is in benchmarks/docs/coverage.md.

import type { DateTime } from "luxon";
import type moment from "moment-timezone";
import type { Work } from "./kernel.ts";
import type { LuxonModule } from "./luxon-types.ts";

type MomentTz = typeof moment;

// The same window the format and parse columns time over, so a case that appears
// in both is comparable: January, one minute apart, in a zone with a DST rule.
export const BASE_TS = Date.UTC(2024, 0, 1);
export const STEP_MS = 60_000;
export const ZONE = "America/New_York";
export const LOCALE = "en-US";

const OTHER_ZONE = "Europe/Paris";
// for the Info cases, where English takes a short-circuit that skips Intl entirely
const OTHER_LOCALE = "fr";

// Distinct inputs each pooled case cycles through. Large enough that a cache
// keyed on the instant cannot serve the whole loop from one entry, small enough
// that the pool itself stays in cache. Indexed off the timestamp rather than a
// counter so a case returns the same values whatever pass length it is given,
// which is what lets the agreement check compare checksums across builds.
const POOL = 512;

const idx = (ts: number) => (((ts - BASE_TS) / STEP_MS) | 0) % POOL;

// The instant every relative case is measured against, so `toRelative` and
// `fromNow` are deterministic rather than drifting with the clock.
const REL_BASE = BASE_TS + 90 * 24 * 3_600_000;

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

/** which band of the ladder a case is reported under */
export type ApiBand = "formatting" | "parsing" | "other";

export interface ApiCase {
  key: string;
  band: ApiBand;
  luxon: (m: LuxonModule) => Work;
  /** omitted where moment has no equivalent to call; handed an instance nobody else has called */
  moment?: (mo: MomentTz) => Work;
  /**
   * A Moment of the shape this case builds, so the harness can give cases that
   * would pollute each other separate instances. See momentRole in ./build.ts:
   * a Moment parsed from a string carries fields one built from a timestamp does
   * not, and one parse anywhere in the process turns format()'s field reads
   * polymorphic for the life of it. Defaults to the timestamp shape, which is
   * what all but the parsing cases build.
   */
  momentShape?: (mo: MomentTz) => object;
  /**
   * moment reaches the same USER-VISIBLE result by different means, so the
   * comparison is a library one and not like-for-like. The localized cases are
   * this: luxon's names come from ICU and moment's from tables it bundles, which
   * is a different quality of answer and part of what its bytes buy.
   */
  approx?: true;
  /** reads the clock, so its output cannot be checked across builds */
  live?: true;
  /**
   * Asks its zone for an offset or a name while it is being timed, so an
   * easy-tz row has something of its own to report here. The cases without it
   * either never touch a zone (Duration, Info) or read one that has already
   * answered — toISO reads the cached offset off the instance, toHTTP swaps in
   * a fixed-offset zone first, toLocaleString hands Intl the zone's NAME — and
   * an easy-tz cell under those would be stock's number printed twice.
   *
   * Checked rather than trusted: --verify counts the calls each case makes and
   * fails if the annotation and the count disagree, so a case that grows or
   * loses a zone lookup cannot leave a misattributed cell behind.
   */
  zoned?: true;
}

/**
 * Pre-built instants, so an operation on a DateTime is not timed constructing
 * one. The locale is pinned rather than left to the system, so the cases that
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
function momentPool(mo: MomentTz, locale?: string): moment.Moment[] {
  return Array.from({ length: POOL }, (_, i) => {
    const at = mo.tz(BASE_TS + i * STEP_MS, ZONE);
    return locale === undefined ? at : at.locale(locale);
  });
}

export const API_CASES: ApiCase[] = [
  // ---- constructing ----
  //
  // Both need an offset to place a local time, so both are under A, B and E, and
  // fromObject is the only case here that normalizes unit names (G).
  //
  // There were three more: fromMillis, fromISO and fromFormat. Each turned out to
  // be the same call as one of the parse columns beside them — the same input
  // pool read by the same entry point, differing only in which timing segment it
  // landed in. Printing them was printing one measurement twice under two names,
  // and where two segments disagreed on an identical call (moment read 48.2 and
  // 60.3 for the same fromMillis) the disagreement was the harness, not the
  // library. millis, iso+off and tokens are those three.
  {
    // An odometer, and deliberately: consecutive values are an hour apart, so the
    // case walks 2024 rather than jumping around inside it.
    //
    // It used to jump. month, day and hour were each `i % n` off the same
    // counter, which advances all three at once and lands every construction in a
    // different month from the one before it. E caches the transition-free span
    // around the last offset it looked up, and no two consecutive values shared
    // one, so the case was measuring E's miss path at a rate no caller produces —
    // 3.69 ICU calls per construction, against 0.38 for the pattern here. That is
    // a real cost of E and worth knowing, but it is a fact about the cache and
    // this case is supposed to be about fromObject.
    //
    // Hours ascending is the shape of the callers that build dates in bulk: a
    // calendar filling a grid, a series filling buckets. A caller who really does
    // hop between months exists, and pays what the old shape measured.
    key: "fromObject",
    band: "parsing",
    zoned: true,
    luxon: (m) => (ts) => {
      const i = idx(ts);
      return m.DateTime.fromObject(
        { year: 2024, month: 1 + (Math.floor(i / 672) % 12), day: 1 + (Math.floor(i / 24) % 28), hour: i % 24 },
        { zone: ZONE }
      ).valueOf();
    },
    moment: (mo) => (ts) => {
      const i = idx(ts);
      return mo
        .tz({ year: 2024, month: Math.floor(i / 672) % 12, day: 1 + (Math.floor(i / 24) % 28), hour: i % 24 }, ZONE)
        .valueOf();
    },
    momentShape: (mo) => mo.tz({ year: 2024, month: 0, day: 1, hour: 0 }, ZONE),
  },
  {
    key: "now",
    band: "parsing",
    zoned: true,
    live: true,
    luxon: (m) => () => m.DateTime.now().setZone(ZONE).valueOf(),
    moment: (mo) => () => mo.tz(ZONE).valueOf(),
    momentShape: (mo) => mo.tz(ZONE),
  },

  // ---- arithmetic ----
  //
  // Every one of these names a unit, so every one goes through a normalizeUnit
  // (G), and every one needs an offset for the result, so every one is also under
  // A, B and E. None of them formats anything, which is why neither of the other
  // two bands reaches them. setZone is the exception that proves it: no unit, so
  // no G.
  {
    key: "plus",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.plus({ days: 1 }).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().add(1, "day").valueOf();
    },
  },
  {
    key: "minus",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.minus({ months: 1 }).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().subtract(1, "month").valueOf();
    },
  },
  {
    key: "startOf day",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.startOf("day").valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().startOf("day").valueOf();
    },
  },
  {
    key: "endOf month",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.endOf("month").valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().endOf("month").valueOf();
    },
  },
  {
    key: "set",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.set({ hour: 9, minute: 30 }).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().set({ hour: 9, minute: 30 }).valueOf();
    },
  },
  {
    key: "diff",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.diff(p[(idx(ts) + 137) % POOL]!, ["days", "hours"]).hours;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.diff(p[(idx(ts) + 137) % POOL]!, "hours");
    },
  },
  {
    key: "hasSame day",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => +p[idx(ts)]!.hasSame(p[(idx(ts) + 137) % POOL]!, "day");
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => +p[idx(ts)]!.isSame(p[(idx(ts) + 137) % POOL]!, "day");
    },
  },
  {
    key: "setZone",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.setZone(OTHER_ZONE).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().tz(OTHER_ZONE).valueOf();
    },
  },

  // ---- writing ----
  //
  // These format a DateTime that already exists, where the format columns above
  // build one per value. Both are worth having: a caller rendering a table holds
  // its DateTimes and formats them repeatedly, and the split is what shows which
  // patches are on the Formatter and which are on construction.
  {
    key: "toFormat num",
    band: "formatting",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toFormat(LUX_NUMERIC).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format(MO_NUMERIC).length;
    },
  },
  {
    key: "toFormat abbr",
    band: "formatting",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toFormat("ZZZZ").length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format("z").length;
    },
  },
  {
    key: "toFormat text",
    band: "formatting",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toFormat(LUX_TEXT).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format(MO_TEXT).length;
    },
  },
  {
    key: "toFormat text fr",
    band: "formatting",
    approx: true,
    luxon: (m) => {
      const p = pool(m, OTHER_LOCALE);
      return (ts) => p[idx(ts)]!.toFormat(LUX_TEXT).length;
    },
    moment: (mo) => {
      const p = momentPool(mo, OTHER_LOCALE);
      return (ts) => p[idx(ts)]!.format(MO_TEXT).length;
    },
  },
  {
    key: "toFormat wide",
    band: "formatting",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toFormat(LUX_WIDE).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format(MO_WIDE).length;
    },
  },
  {
    // a fixed eight-token pattern with two of them words, so it is the text case
    // with none of the caller's choices in it — and it is what an HTTP header or
    // a mail date costs, which is the shape of formatting most likely to be on a
    // request path rather than in a rendered table
    key: "toRFC2822",
    band: "formatting",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toRFC2822()!.length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format("ddd, DD MMM YYYY HH:mm:ss ZZ").length;
    },
  },
  {
    // the same pattern again, but through toUTC() first, so this is toRFC2822
    // plus a zone change rather than a second reading of it
    key: "toHTTP",
    band: "formatting",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toHTTP()!.length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().utc().format("ddd, DD MMM YYYY HH:mm:ss [GMT]").length;
    },
  },
  {
    // not the Formatter: toISO builds its string directly and normalizes only
    // its `precision` argument, which is why H does nothing for it and G does
    key: "toISO",
    band: "formatting",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toISO()!.length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format().length;
    },
  },
  {
    key: "toISODate",
    band: "formatting",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toISODate()!.length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format("YYYY-MM-DD").length;
    },
  },
  {
    key: "toLocaleString",
    band: "formatting",
    approx: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toLocaleString(m.DateTime.DATETIME_MED).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format("lll").length;
    },
  },
  {
    // most of what the patches win here is the diff it does internally, not the
    // relative-time formatting: the zone rungs move it before G is on at all
    key: "toRelative",
    band: "formatting",
    zoned: true,
    approx: true,
    luxon: (m) => {
      const p = pool(m);
      const base = m.DateTime.fromMillis(REL_BASE, { zone: ZONE });
      return (ts) => p[idx(ts)]!.toRelative({ base })!.length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      const base = mo.tz(REL_BASE, ZONE);
      return (ts) => p[idx(ts)]!.from(base).length;
    },
  },

  // ---- Duration ----
  {
    key: "Duration as",
    band: "other",
    luxon: (m) => (ts) => m.Duration.fromObject({ minutes: 100 + idx(ts) }).as("hours"),
    moment: (mo) => (ts) => mo.duration(100 + idx(ts), "minutes").asHours(),
  },
  {
    key: "Duration shiftTo",
    band: "other",
    luxon: (m) => (ts) => m.Duration.fromObject({ minutes: 100 + idx(ts) }).shiftTo("hours", "minutes").hours,
  },
  {
    key: "Duration toHuman",
    band: "other",
    approx: true,
    luxon: (m) => (ts) => m.Duration.fromObject({ hours: 1 + (idx(ts) % 9), minutes: 30 }).toHuman().length,
    moment: (mo) => (ts) => mo.duration({ hours: 1 + (idx(ts) % 9), minutes: 30 }).humanize().length,
  },

  // ---- Interval: no moment equivalent, the plugin that adds one is not here ----
  {
    key: "Interval length",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => m.Interval.fromDateTimes(p[idx(ts)]!, p[idx(ts)]!.plus({ months: 2 })).length("days");
    },
  },
  {
    key: "Interval contains",
    band: "other",
    zoned: true,
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
    band: "other",
    zoned: true,
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
  // spellings are here because the difference is the point: the en case is the
  // one most callers hit and costs a Locale construction and nothing else, and
  // the fr case is what the locale machinery actually costs when it runs.
  {
    key: "Info.months en",
    band: "other",
    luxon: (m) => () => m.Info.months("long", { locale: LOCALE }).length,
    moment: (mo) => () => mo.localeData("en").months().length,
  },
  {
    key: "Info.months fr",
    band: "other",
    luxon: (m) => () => m.Info.months("long", { locale: OTHER_LOCALE }).length,
    moment: (mo) => () => mo.localeData(OTHER_LOCALE).months().length,
  },
  {
    key: "Info.weekdays fr",
    band: "other",
    luxon: (m) => () => m.Info.weekdays("long", { locale: OTHER_LOCALE }).length,
    moment: (mo) => () => mo.localeData(OTHER_LOCALE).weekdays().length,
  },
];

/** the default shape: built from a timestamp, which is what all but the parsing cases do */
export const defaultMomentShape = (mo: MomentTz): object => mo.tz(0, ZONE);
