// One operation per case, across the public API, for the ladder's third band.
//
// These were benchmarks/coverage.ts's rows until that table was merged into
// upstream.ts's ladder. The reason they exist has not changed: upstream.ts's
// original columns time writing a date and reading one, because that is where
// the patches were found, and that narrowness became misleading once the patch
// set grew past the formatter. F hoists both normalizeUnit tables and the
// SystemZone probe and replaces the Duration round trip inside adjustTime, G
// removes short-lived objects from setters, endOf and diff, and no formatting or parsing
// case reaches any of it. A and D sit under every zoned operation, not just the
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

import type { DateTime, Duration, Interval } from "luxon";
import type moment from "moment-timezone";
import type { Work } from "./kernel.ts";
import type { DateTimeParserClass, LuxonModule } from "./luxon-types.ts";

type MomentTz = typeof moment;

export interface DateFnsApi {
  core: typeof import("date-fns");
  tz: typeof import("@date-fns/tz");
  locales: {
    enUS: import("date-fns").Locale;
    fr: import("date-fns").Locale;
  };
}

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

const OBJECT_INPUTS = Array.from({ length: POOL }, (_, i) => ({
  year: 2024,
  month: 1 + (Math.floor(i / 672) % 12),
  day: 1 + (Math.floor(i / 24) % 28),
  hour: i % 24,
}));

const MOMENT_OBJECT_INPUTS = OBJECT_INPUTS.map(({ year, month, day, hour }) => ({
  year,
  month: month - 1,
  day,
  hour,
}));

const MINUTE_INPUTS = Array.from({ length: POOL }, (_, i) => ({ minutes: 100 + i }));
const HUMAN_INPUTS = Array.from({ length: POOL }, (_, i) => ({
  hours: 1 + (i % 9),
  minutes: 30,
}));

// The instant every relative case is measured against, so `toRelative` and
// `fromNow` are deterministic rather than drifting with the clock.
const REL_BASE = BASE_TS + 90 * 24 * 3_600_000;

const LUX_NUMERIC = "yyyy-MM-dd HH:mm:ss";
const MO_NUMERIC = "YYYY-MM-DD HH:mm:ss";

// Patterns that are not all-numeric, because an all-numeric one in en-US on the
// gregorian calendar is the input F's num()/padStart/roundTo fast paths were
// written for, and for a while it was the only input any bench here had. The
// three shapes below are the ones that fall outside it, and they are H's case
// rather than F's:
//
//   text     a month or weekday name never reaches a numeric fast path at all
//   wide     the per-token switch H removes runs once per token, so its cost
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
  dateFns?: (api: DateFnsApi) => Work;
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
   * easy-tz row can differ here. Every case is measured on every row either
   * way — what a configuration costs should be readable off one line — and this
   * is what the note under each table names, so that the columns where the
   * easy-tz row is the luxon row again are not read as a result.
   *
   * The cases without it either never touch a zone (Duration, Info) or read one
   * that has already answered: toISO reads the cached offset off the instance,
   * toHTTP swaps in a fixed-offset zone first, and toLocaleString hands Intl the
   * zone's NAME rather than asking it anything.
   *
   * Checked rather than trusted: --verify counts the calls each case makes and
   * fails if the annotation and the count disagree, so a case that grows or
   * loses a zone lookup cannot leave the note behind describing the old one.
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

function dateFnsPool({ tz }: DateFnsApi) {
  return Array.from({ length: POOL }, (_, i) => new tz.TZDate(BASE_TS + i * STEP_MS, ZONE));
}

function dateFnsDurationPool() {
  return Array.from({ length: POOL }, (_, i) => ({
    days: 1 + (i % 27),
    hours: i % 24,
    minutes: (i * 7) % 60,
    seconds: (i * 13) % 60,
  }));
}

/** Receivers for probes that need Duration construction outside the timed call. */
function durationPool(m: LuxonModule): Duration[] {
  return Array.from({ length: POOL }, (_, i) =>
    m.Duration.fromObject(
      {
        days: 1 + (i % 27),
        hours: i % 24,
        minutes: (i * 7) % 60,
        seconds: (i * 13) % 60,
        milliseconds: (i * 17) % 1_000,
      },
      { locale: LOCALE }
    )
  );
}

/** Receivers for probes that need Interval construction outside the timed call. */
function intervalPool(m: LuxonModule): Interval[] {
  const starts = pool(m);
  return starts.map((start, i) =>
    m.Interval.fromDateTimes(start, start.plus({ months: 2, days: i % 7, minutes: i % 60 }))
  );
}

// the locale is set when the pool is built rather than per call, because
// moment's setter mutates the instance rather than returning a new one
function momentPool(mo: MomentTz, locale?: string): moment.Moment[] {
  return Array.from({ length: POOL }, (_, i) => {
    const at = mo(BASE_TS + i * STEP_MS);
    return locale === undefined ? at : at.locale(locale);
  });
}

function momentDurationPool(mo: MomentTz): moment.Duration[] {
  return Array.from({ length: POOL }, (_, i) =>
    mo.duration({
      days: 1 + (i % 27),
      hours: i % 24,
      minutes: (i * 7) % 60,
      seconds: (i * 13) % 60,
      milliseconds: (i * 17) % 1_000,
    })
  );
}

export const API_CASES: ApiCase[] = [
  // ---- constructing ----
  //
  // Both need an offset to place a local time, so both are under A, B and D, and
  // fromObject is the only case here that normalizes unit names (F).
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
    // different month from the one before it. D caches the transition-free span
    // around the last offset it looked up, and no two consecutive values shared
    // one, so the case was measuring D's miss path at a rate no caller produces —
    // 3.69 ICU calls per construction, against 0.38 for the pattern here. That is
    // a real cost of D and worth knowing, but it is a fact about the cache and
    // this case is supposed to be about fromObject.
    //
    // Hours ascending is the shape of the callers that build dates in bulk: a
    // calendar filling a grid, a series filling buckets. A caller who really does
    // hop between months exists, and pays what the old shape measured.
    key: "fromObject",
    band: "parsing",
    zoned: true,
    luxon: (m) => {
      const options = { zone: ZONE };
      return (ts) => m.DateTime.fromObject(OBJECT_INPUTS[idx(ts)]!, options).valueOf();
    },
    dateFns: ({ tz }) => (ts) => {
      const { year, month, day, hour } = OBJECT_INPUTS[idx(ts)]!;
      return new tz.TZDate(
        year,
        month - 1,
        day,
        hour,
        ZONE
      ).valueOf();
    },
    moment: (mo) => (ts) => mo(MOMENT_OBJECT_INPUTS[idx(ts)]!).valueOf(),
    momentShape: (mo) => mo({ year: 2024, month: 0, day: 1, hour: 0 }),
  },
  {
    // One construction in all three cells: moment's zone comes off its ambient
    // default and date-fns names it in the constructor, so luxon spells "now in
    // a zone" the one-step way too. now().setZone(ZONE) would build a second
    // DateTime and re-pay what the setZone column already measures.
    key: "now",
    band: "parsing",
    zoned: true,
    live: true,
    luxon: (m) => {
      const options = { zone: ZONE };
      return () => m.DateTime.local(options).valueOf();
    },
    dateFns: ({ tz }) => () => new tz.TZDate(Date.now(), ZONE).valueOf(),
    moment: (mo) => () => mo().valueOf(),
    momentShape: (mo) => mo(),
  },
  {
    // The parser is the reusable artifact this API exists to expose. Building it
    // in the closure keeps parser compilation out of the timed parse.
    key: "fromFormatParser",
    band: "parsing",
    zoned: true,
    luxon: (m) => {
      const DateTime = m.DateTime as DateTimeParserClass;
      const parserOptions = { locale: LOCALE };
      const parseOptions = { locale: LOCALE, zone: ZONE };
      const parser = DateTime.buildFormatParser("yyyy-MM-dd HH:mm", parserOptions);
      const inputs = Array.from({ length: POOL }, (_, i) => {
        const hour = Math.floor(i / 60) % 24;
        const minute = i % 60;
        return `2024-01-01 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      });
      return (ts) => DateTime.fromFormatParser(inputs[idx(ts)]!, parser, parseOptions).valueOf();
    },
  },

  // ---- arithmetic ----
  //
  // Every one of these names a unit, so every one goes through a normalizeUnit
  // (F), and every one needs an offset for the result, so every one is also under
  // A, B and D. None of them formats anything, which is why neither of the other
  // two bands reaches them. setZone is the exception that proves it: no unit, so
  // no F.
  {
    key: "plus",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      const duration = { days: 1 };
      return (ts) => p[idx(ts)]!.plus(duration).valueOf();
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.addDays(p[idx(ts)]!, 1).valueOf();
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
      const duration = { months: 1 };
      return (ts) => p[idx(ts)]!.minus(duration).valueOf();
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.subMonths(p[idx(ts)]!, 1).valueOf();
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.startOfDay(p[idx(ts)]!).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().startOf("day").valueOf();
    },
  },
  {
    key: "startOf month",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.startOf("month").valueOf();
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.startOfMonth(p[idx(ts)]!).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().startOf("month").valueOf();
    },
  },
  {
    key: "endOf day",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.endOf("day").valueOf();
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.endOfDay(p[idx(ts)]!).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().endOf("day").valueOf();
    },
  },
  {
    key: "endOf week",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.endOf("week").valueOf();
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const options = { weekStartsOn: 1 as const };
      return (ts) => api.core.endOfWeek(p[idx(ts)]!, options).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().endOf("week").valueOf();
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.endOfMonth(p[idx(ts)]!).valueOf();
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
      const values = { hour: 9, minute: 30 };
      return (ts) => p[idx(ts)]!.set(values).valueOf();
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const values = { hours: 9, minutes: 30 };
      return (ts) => api.core.set(p[idx(ts)]!, values).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      const values = { hour: 9, minute: 30 };
      return (ts) => p[idx(ts)]!.clone().set(values).valueOf();
    },
  },
  {
    // the like-for-like half of diff: a single lower-order unit is one
    // subtraction and a division in all three libraries, and no zone is asked
    key: "diff hours",
    band: "other",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.diff(p[(idx(ts) + 137) % POOL]!, "hours").hours;
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.differenceInMilliseconds(p[idx(ts)]!, p[(idx(ts) + 137) % POOL]!) / 3_600_000;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.diff(p[(idx(ts) + 137) % POOL]!, "hours");
    },
  },
  {
    // the calendar half: decomposing into days and hours walks the calendar
    // through the zone, which neither moment's nor date-fns's single-unit
    // difference APIs can express — so this column is luxon-only
    key: "diff d+h",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      const units: ("days" | "hours")[] = ["days", "hours"];
      return (ts) => p[idx(ts)]!.diff(p[(idx(ts) + 137) % POOL]!, units).hours;
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => +api.core.isSameDay(p[idx(ts)]!, p[(idx(ts) + 137) % POOL]!);
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => p[idx(ts)]!.withTimeZone(OTHER_ZONE).valueOf();
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().tz(OTHER_ZONE).valueOf();
    },
  },
  {
    key: "getPossibleOffsets",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.getPossibleOffsets().length;
    },
  },
  {
    key: "offsetNameShort",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.offsetNameShort!.length;
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.tz.tzName(ZONE, p[idx(ts)]!, "short").length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.zoneAbbr().length;
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.format(p[idx(ts)]!, "yyyy-MM-dd HH:mm:ss").length;
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.format(p[idx(ts)]!, "zzz").length;
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const options = { locale: api.locales.enUS };
      return (ts) => api.core.format(p[idx(ts)]!, "EEEE, MMMM d, yyyy 'at' h:mm a", options).length;
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const options = { locale: api.locales.fr };
      return (ts) => api.core.format(p[idx(ts)]!, "EEEE, MMMM d, yyyy 'at' h:mm a", options).length;
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const options = { useAdditionalDayOfYearTokens: true };
      return (ts) =>
        api.core.format(p[idx(ts)]!, "yyyy-MM-dd HH:mm:ss.SSS xx II DDD Q RRRR", options).length;
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const options = { locale: api.locales.enUS };
      return (ts) => api.core.format(p[idx(ts)]!, "EEE, dd MMM yyyy HH:mm:ss xx", options).length;
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
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => api.core.formatRFC7231(p[idx(ts)]!).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.clone().utc().format("ddd, DD MMM YYYY HH:mm:ss [GMT]").length;
    },
  },
  {
    // not the Formatter: toISO builds its string directly and normalizes only
    // its `precision` argument, which is why G does nothing for it and F does
    key: "toISO",
    band: "formatting",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toISO()!.length;
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const options = { fractionDigits: 3 as const };
      return (ts) => api.core.formatRFC3339(p[idx(ts)]!, options).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.toISOString(true).length;
    },
  },
  {
    key: "toISODate",
    band: "formatting",
    luxon: (m) => {
      const p = pool(m);
      return (ts) => p[idx(ts)]!.toISODate()!.length;
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const options = { representation: "date" as const };
      return (ts) => api.core.formatISO(p[idx(ts)]!, options).length;
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
      const preset = m.DateTime.DATETIME_MED;
      return (ts) => p[idx(ts)]!.toLocaleString(preset).length;
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const options = { locale: api.locales.enUS };
      return (ts) => api.core.format(p[idx(ts)]!, "PPp", options).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      return (ts) => p[idx(ts)]!.format("lll").length;
    },
  },
  {
    // most of what the patches win here is the diff it does internally, not the
    // relative-time formatting: the zone rungs move it before F is on at all
    key: "toRelative",
    band: "formatting",
    zoned: true,
    approx: true,
    luxon: (m) => {
      const p = pool(m);
      const base = m.DateTime.fromMillis(REL_BASE, { zone: ZONE });
      const options = { base };
      return (ts) => p[idx(ts)]!.toRelative(options)!.length;
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const base = new api.tz.TZDate(REL_BASE, ZONE);
      const options = { addSuffix: true, locale: api.locales.enUS };
      return (ts) => api.core.formatDistance(p[idx(ts)]!, base, options).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      const base = mo(REL_BASE);
      return (ts) => p[idx(ts)]!.from(base).length;
    },
  },
  {
    key: "toRelativeCalendar",
    band: "formatting",
    zoned: true,
    approx: true,
    luxon: (m) => {
      const p = pool(m);
      const base = m.DateTime.fromMillis(REL_BASE, { zone: ZONE, locale: LOCALE });
      const options = { base };
      return (ts) => p[idx(ts)]!.toRelativeCalendar(options)!.length;
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      const base = new api.tz.TZDate(REL_BASE, ZONE);
      const options = { locale: api.locales.enUS };
      return (ts) => api.core.formatRelative(p[idx(ts)]!, base, options).length;
    },
    moment: (mo) => {
      const p = momentPool(mo);
      const base = mo(REL_BASE);
      return (ts) => p[idx(ts)]!.calendar(base).length;
    },
  },

  // ---- Duration ----
  //
  // The original three cases below construct their receiver in the timed call.
  // They remain whole-operation columns for continuity. The explicitly pooled
  // columns isolate the named method for patch experiments.
  {
    key: "Duration plus pooled",
    band: "other",
    luxon: (m) => {
      const receivers = durationPool(m);
      const addends = Array.from({ length: POOL }, (_, i) =>
        m.Duration.fromObject({ hours: 1 + (i % 3), minutes: i % 60 })
      );
      return (ts) => receivers[idx(ts)]!.plus(addends[idx(ts)]!).minutes;
    },
  },
  {
    // both sides construct from the same pooled object — moment also has a
    // number+unit signature, but handing it a different input shape would
    // compare its cheapest constructor against luxon's only one
    key: "Duration as",
    band: "other",
    luxon: (m) => (ts) => m.Duration.fromObject(MINUTE_INPUTS[idx(ts)]!).as("hours"),
    moment: (mo) => (ts) => mo.duration(MINUTE_INPUTS[idx(ts)]!).asHours(),
  },
  {
    key: "Duration as pooled",
    band: "other",
    luxon: (m) => {
      const p = durationPool(m);
      return (ts) => p[idx(ts)]!.as("hours");
    },
    moment: (mo) => {
      const p = momentDurationPool(mo);
      return (ts) => p[idx(ts)]!.asHours();
    },
  },
  {
    key: "Duration shiftTo",
    band: "other",
    luxon: (m) => (ts) =>
      m.Duration.fromObject(MINUTE_INPUTS[idx(ts)]!).shiftTo("hours", "minutes").hours,
  },
  {
    key: "Duration shiftTo pooled",
    band: "other",
    luxon: (m) => {
      const p = durationPool(m);
      return (ts) => p[idx(ts)]!.shiftTo("days", "hours", "minutes").minutes;
    },
  },
  {
    key: "Duration toHuman",
    band: "other",
    approx: true,
    luxon: (m) => (ts) => m.Duration.fromObject(HUMAN_INPUTS[idx(ts)]!).toHuman().length,
    dateFns: (api) => {
      const options = { locale: api.locales.enUS };
      return (ts) =>
        api.core
          .formatDuration(
            HUMAN_INPUTS[idx(ts)]!,
            options
          )
          .length;
    },
    moment: (mo) => (ts) => mo.duration(HUMAN_INPUTS[idx(ts)]!).humanize().length,
  },
  {
    key: "Duration toHuman pooled",
    band: "other",
    approx: true,
    luxon: (m) => {
      const p = durationPool(m);
      return (ts) => p[idx(ts)]!.toHuman().length;
    },
    dateFns: (api) => {
      const p = dateFnsDurationPool();
      const options = { locale: api.locales.enUS };
      return (ts) => api.core.formatDuration(p[idx(ts)]!, options).length;
    },
    moment: (mo) => {
      const p = momentDurationPool(mo);
      return (ts) => p[idx(ts)]!.humanize().length;
    },
  },
  {
    key: "Duration toFormat num",
    band: "formatting",
    luxon: (m) => {
      const p = durationPool(m);
      return (ts) => p[idx(ts)]!.toFormat("dd:hh:mm:ss.SSS").length;
    },
  },
  {
    key: "Duration toFormat text",
    band: "formatting",
    luxon: (m) => {
      const p = durationPool(m);
      return (ts) => p[idx(ts)]!.toFormat("d 'days' h 'hours' m 'minutes'").length;
    },
  },

  // ---- Interval: no moment equivalent, the plugin that adds one is not here ----
  {
    key: "Interval length",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      const duration = { months: 2 };
      return (ts) => m.Interval.fromDateTimes(p[idx(ts)]!, p[idx(ts)]!.plus(duration)).length("days");
    },
    dateFns: (api) => {
      // date-fns has no fractional-day difference, so this cell is millisecond
      // arithmetic where luxon's length("days") walks the calendar. The answers
      // agree here — January plus two months never crosses a DST transition —
      // but the means differ, the same way the diff columns' halves do.
      const p = dateFnsPool(api);
      return (ts) => {
        const start = p[idx(ts)]!;
        return api.core.differenceInMilliseconds(api.core.addMonths(start, 2), start) / 86_400_000;
      };
    },
  },
  {
    key: "Interval contains",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      const intervalLength = { days: 30 };
      const containedOffset = { days: 3 };
      return (ts) => {
        const start = p[idx(ts)]!;
        return +m.Interval.fromDateTimes(start, start.plus(intervalLength)).contains(start.plus(containedOffset));
      };
    },
    dateFns: (api) => {
      const p = dateFnsPool(api);
      return (ts) => {
        const start = p[idx(ts)]!;
        return +api.core.isWithinInterval(api.core.addDays(start, 3), {
          start,
          end: api.core.addDays(start, 30),
        });
      };
    },
  },
  {
    key: "Interval splitBy",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = pool(m);
      const intervalLength = { days: 10 };
      const step = { days: 1 };
      return (ts) => {
        const start = p[idx(ts)]!;
        return m.Interval.fromDateTimes(start, start.plus(intervalLength)).splitBy(step).length;
      };
    },
  },
  {
    key: "Interval toDuration pooled",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = intervalPool(m);
      const units: ("days" | "hours")[] = ["days", "hours"];
      return (ts) => p[idx(ts)]!.toDuration(units).hours;
    },
  },
  {
    key: "Interval count pooled",
    band: "other",
    zoned: true,
    luxon: (m) => {
      const p = intervalPool(m);
      return (ts) => p[idx(ts)]!.count("days");
    },
    dateFns: (api) => {
      // the endpoints are the pool, mirroring intervalPool: "pooled" means the
      // receiver is prebuilt, so the add() that makes each end stays out of the
      // timed call here too
      const p = dateFnsPool(api);
      const ends = p.map((start, i) => api.core.add(start, { months: 2, days: i % 7, minutes: i % 60 }));
      return (ts) => {
        const i = idx(ts);
        return api.core.differenceInCalendarDays(ends[i]!, p[i]!) + 1;
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
    luxon: (m) => {
      const options = { locale: LOCALE };
      return () => m.Info.months("long", options).length;
    },
    moment: (mo) => () => mo.localeData("en").months().length,
  },
  {
    key: "Info.months fr",
    band: "other",
    luxon: (m) => {
      const options = { locale: OTHER_LOCALE };
      return () => m.Info.months("long", options).length;
    },
    moment: (mo) => () => mo.localeData(OTHER_LOCALE).months().length,
  },
  {
    key: "Info.weekdays fr",
    band: "other",
    luxon: (m) => {
      const options = { locale: OTHER_LOCALE };
      return () => m.Info.weekdays("long", options).length;
    },
    moment: (mo) => () => mo.localeData(OTHER_LOCALE).weekdays().length,
  },
];

/** the default shape: built from a timestamp, which is what all but the parsing cases do */
export const defaultMomentShape = (mo: MomentTz): object => mo(0);
