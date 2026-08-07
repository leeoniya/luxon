// Builds the formatter or parser for one configuration under test, and nothing
// else.
//
// Deliberately free of static imports beyond node builtins. benchmarks/upstream.ts
// measures each row's footprint in a fresh subprocess, and a module that reached
// for moment-timezone or easy-tz's tables at load time would put both in every
// row's rss no matter which build the row is. Each is imported inside the branch
// that needs it, so a process only loads what its own build ships.
//
// Shared by the driver and those subprocesses, so a row's footprint is measured
// on the same formatter its milliseconds came from rather than on a second
// description of it.

import { createRequire } from "node:module";
import { dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { DateTimeOptions, Zone } from "luxon";
import type { LuxonModule } from "./luxon-types.ts";

type MomentTz = typeof import("moment-timezone");

const require = createRequire(import.meta.url);

/**
 * moment's own files, so evicting them cannot reach anything else. Matched by
 * directory rather than by name: a path with "moment" somewhere in it is not a
 * moment module, and this repo could easily live under one.
 */
const momentDirs = ["moment", "moment-timezone"].map((p) => dirname(require.resolve(p)) + sep);

const momentByRole = new Map<string, MomentTz>();

/**
 * A moment-timezone instance nobody outside `role` has called.
 *
 * Every luxon build already gets its own module instance, and every timed entry
 * its own zone, so that nothing one cell warms is inherited by the cell it is
 * being compared against. moment was the one participant exempt from that,
 * because it arrives as a package rather than as a tree this harness writes —
 * and it turned out to be the one that needed it.
 *
 * A Moment parsed from a string carries `_a` and `_f`; one built from a
 * timestamp does not; one parsed from a string with an offset in it adds `_tzm`.
 * Three shapes, and `format()` reads five properties off whichever it is given.
 * A single parse anywhere in the process is enough to turn those reads
 * polymorphic for the life of it, which cost the formatting cells 13-19% as soon
 * as this file built a parser before a formatter had been timed. That is a real
 * property of moment, and an app doing both directions really does pay it — but
 * it is not what a column headed "format" is asking, and which cell paid it
 * depended on nothing more principled than the order the tables printed in.
 *
 * Roles rather than one instance per caller: benchmarks/format.ts builds a
 * formatter per zone across hundreds of them, and they all want the same one.
 * ~10ms and ~3MB each.
 */
export function momentFor(role: string): MomentTz {
  let m = momentByRole.get(role);

  if (m === undefined) {
    for (const id of Object.keys(require.cache)) {
      if (momentDirs.some((d) => id.startsWith(d))) delete require.cache[id];
    }

    // the instances already handed out are held by this map, so evicting the
    // cache only decides what the NEXT require builds
    momentByRole.set(role, (m = require("moment-timezone") as MomentTz));
  }

  return m;
}

/**
 * The role a cell belongs in: the shape of the Moment it builds, read off one.
 *
 * Keying on the shape rather than on the cell means cells that cannot pollute
 * each other still share an instance, and so still share its warmth — the four
 * string-parsing cells collapse to two roles, and `millis` shares the
 * formatter's, all three being what they were before the tables merged. Reading
 * it off a real Moment rather than declaring it per case is what keeps it true:
 * a case added later lands in the right role, or in a new one, without anyone
 * having to notice that it should.
 *
 * Probed on an instance that is never timed, since probing is itself a call of
 * the kind this is here to keep out of the timed instances.
 */
export function momentRole(build: (m: MomentTz) => object): string {
  return Object.keys(build(momentFor("probe"))).sort().join(",");
}

export interface BuildSpec {
  library: "luxon" | "moment-timezone" | "date-fns";
  /** entry point of a patched src tree, or null for a package baseline */
  luxonEntry: string | null;
  /** resolve the zone through easy-tz's baked rules instead of Intl */
  easyZone: boolean;
  zone: string;
  locale: string;
  formatKey: string;
  pattern: string;
}

export async function formatterFor(spec: BuildSpec): Promise<(ts: number) => string> {
  const { library, zone, pattern, locale, formatKey } = spec;

  if (library === "date-fns") {
    const [{ format }, { TZDate, tzName }, { enUS }, { fr }] = await Promise.all([
      import("date-fns"),
      import("@date-fns/tz"),
      import("date-fns/locale/en-US"),
      import("date-fns/locale/fr"),
    ]);
    const dateLocale = /^fr\b/i.test(locale) ? fr : enUS;

    return (ts) => {
      const date = new TZDate(ts, zone);
      const rendered = format(date, pattern, { locale: dateLocale });

      return formatKey === "abbr" ? `${rendered} ${tzName(zone, date, "short")}` : rendered;
    };
  }

  if (library === "moment-timezone") {
    // a named zone needs moment-timezone's offset table; moment core has none
    //
    // moment ships English built in and lazily requires everything else, so an
    // English tag is the path every cell took before locales entered this file
    // and anything else is the one that needs telling.
    //
    // A localized cell gets its own instance, appended to the role rather than
    // probed into it: setting a locale changes no own property of a Moment, so
    // the shape probe cannot see it, and sharing would leave the English columns
    // formatting through call sites a French one had already made polymorphic.
    // Their role string is untouched, so they read what they read before this
    // existed.
    const localized = !/^en\b/i.test(locale);
    const role = momentRole((m) => m.tz(0, zone)) + (localized ? `|${locale}` : "");
    const moment = momentFor(role);

    if (localized) {
      // moment falls back to its default silently for a tag it does not ship,
      // which would put an English string in a column headed otherwise. Asked of
      // the instance that will do the work rather than a shared probe: a lazily
      // loaded locale is defined on whichever instance the module cache holds at
      // the time, so an older one answers "en" for a locale it never received.
      const resolved = moment().locale(locale).locale();

      if (resolved === moment.locale()) {
        throw new Error(`moment-timezone has no locale data for "${locale}"; it would format in "${resolved}"`);
      }
    }

    return localized
      ? (ts) => moment.tz(ts, zone).locale(locale).format(pattern)
      : (ts) => moment.tz(ts, zone).format(pattern);
  }

  const { lux, opts } = await luxonBuild(spec);

  return (ts) => lux.DateTime.fromMillis(ts, opts).toFormat(pattern);
}

/**
 * Loads a build's luxon and resolves its zone the way that build resolves zones.
 *
 * A fresh zone (and, for the easy-tz builds, a fresh class) per caller, on
 * purpose: each timed entry then owns its zone's caches instead of inheriting a
 * neighbour's warmed ones, which is the same reason each patch set gets its own
 * module instance.
 */
async function luxonBuild(spec: BuildSpec): Promise<{ lux: LuxonModule; opts: DateTimeOptions }> {
  const lux = (await import(pathToFileURL(spec.luxonEntry!).href)) as LuxonModule;
  let zone: Zone;

  if (spec.easyZone) {
    const [{ makeEasyZoneClass }, { getTimeZoneAt }] = await Promise.all([
      import("./easy-zone.ts"),
      import("./easy-tz.ts"),
    ]);

    zone = new (makeEasyZoneClass(lux.IANAZone, getTimeZoneAt))(spec.zone);
  } else {
    zone = lux.IANAZone.create(spec.zone);
  }

  return { lux, opts: { zone, locale: spec.locale } };
}

// ---- parsing ----------------------------------------------------------------
// The other direction: a build reading a date rather than writing one.
//
// One table for the whole thing, because the input shape and the two format
// strings that consume it are one fact in three dialects. Splitting them left
// the door open to generating input a library was no longer being asked to parse
// — which would not fail, it would just quietly time a rejection.
//
// The token formats are Grafana's, from a codebase that runs moment on every
// dashboard: `fullDate` is what systemDateFormats hands the parser for a user's
// date input, and the second is the format its URL-param branch forces when a
// value arrives with a zone on it.
//
// The ISO cases go through each library's built-in ISO reader (luxon's fromISO,
// moment's ISO_8601) rather than a format string, since that is the path a real
// caller lands on and it is a different parser from the token one in both
// libraries.

export type ParseCaseKey = "iso" | "iso+off" | "tokens" | "tokens+off" | "millis";

export interface ParseCase {
  key: ParseCaseKey;
  /**
   * How an input is produced, and for the token cases the luxon pattern that
   * also reads it back. Any of the three markers selects a built-in entry point
   * instead: an ISO string without an offset, with one, or no string at all.
   */
  input: string;
  /** moment format that reads the same input; null uses moment.ISO_8601 */
  moment: string | null;
  /** date-fns format that reads the same input; null uses parseISO */
  dateFns: string | null;
  what: string;
}

export const parseCases: readonly ParseCase[] = [
  {
    key: "iso",
    input: "iso-local",
    moment: null,
    dateFns: null,
    what: "ISO with no zone on it, so the zone has to place the local time",
  },
  { key: "iso+off", input: "iso-offset", moment: null, dateFns: null, what: "ISO carrying its own offset" },
  {
    key: "tokens",
    input: "yyyy-MM-dd HH:mm:ss",
    moment: "YYYY-MM-DD HH:mm:ss",
    dateFns: "yyyy-MM-dd HH:mm:ss",
    what: "grafana's systemDateFormats.fullDate, no zone on it",
  },
  {
    key: "tokens+off",
    input: "yyyy-MM-dd'T'HH:mm:ss.SSSZZ",
    moment: "YYYY-MM-DDTHH:mm:ss.SSSZ",
    dateFns: "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
    what: "grafana's URL-param format, offset included",
  },
  {
    key: "millis",
    input: "millis",
    moment: null,
    dateFns: null,
    what: "a timestamp: object creation with no parsing at all",
  },
];

/**
 * Reads one input shape into a build's DateTime and returns the instant it
 * landed on — which the caller sums as its checksum, so a parse that fails
 * returns NaN instead of a suspiciously fast success.
 *
 * Takes both the instant and its rendered string so every case has one shape,
 * and the harness passes whichever the case reads.
 *
 * `sample` is one input of the kind this parser will be given, used only to work
 * out which moment instance the case belongs on — see momentRole. Omitting it
 * falls back to isolating the case on its own, which is never wrong, only colder.
 */
export async function parserFor(
  spec: BuildSpec,
  kase: ParseCase,
  sample?: string
): Promise<(ts: number, input: string) => number> {
  const { input } = kase;

  if (spec.library === "date-fns") {
    const [{ parse, parseISO }, { TZDate, tz }, { enUS }] = await Promise.all([
      import("date-fns"),
      import("@date-fns/tz"),
      import("date-fns/locale/en-US"),
    ]);
    const context = tz(spec.zone);

    if (input === "millis") {
      return (ts) => new TZDate(ts, spec.zone).valueOf();
    }

    if (input === "iso-local" || input === "iso-offset") {
      return (_ts, s) => parseISO(s, { in: context }).valueOf();
    }

    return (_ts, s) => parse(s, kase.dateFns!, new TZDate(0, spec.zone), { in: context, locale: enUS }).valueOf();
  }

  if (spec.library === "moment-timezone") {
    const { zone } = spec;
    const role =
      input === "millis"
        ? momentRole((m) => m.tz(0, zone))
        : sample === undefined
          ? `parse:${kase.key}`
          : momentRole((m) => m.tz(sample, kase.moment ?? m.ISO_8601, zone));
    const moment = momentFor(role);

    if (input === "millis") {
      return (ts) => moment.tz(ts, zone).valueOf();
    }

    const fmt = kase.moment ?? moment.ISO_8601;

    return (_ts, s) => moment.tz(s, fmt, zone).valueOf();
  }

  const { lux, opts } = await luxonBuild(spec);

  if (input === "millis") {
    return (ts) => lux.DateTime.fromMillis(ts, opts).valueOf();
  }

  if (input === "iso-local" || input === "iso-offset") {
    return (_ts, s) => lux.DateTime.fromISO(s, opts).valueOf();
  }

  return (_ts, s) => lux.DateTime.fromFormat(s, input, opts).valueOf();
}
