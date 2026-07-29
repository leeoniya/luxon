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

import { pathToFileURL } from "node:url";
import type { DateTimeOptions, Zone } from "luxon";
import type { LuxonModule } from "./luxon-types.ts";

export interface BuildSpec {
  /** entry point of a patched src tree, or null for the moment-timezone baseline */
  luxonEntry: string | null;
  /** resolve the zone through easy-tz's baked rules instead of Intl */
  easyZone: boolean;
  zone: string;
  locale: string;
  pattern: string;
}

export async function formatterFor(spec: BuildSpec): Promise<(ts: number) => string> {
  const { luxonEntry, zone, pattern } = spec;

  if (luxonEntry === null) {
    // a named zone needs moment-timezone's offset table; moment core has none
    const { default: moment } = await import("moment-timezone");

    return (ts) => moment.tz(ts, zone).format(pattern);
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
  what: string;
}

export const parseCases: readonly ParseCase[] = [
  {
    key: "iso",
    input: "iso-local",
    moment: null,
    what: "ISO with no zone on it, so the zone has to place the local time",
  },
  { key: "iso+off", input: "iso-offset", moment: null, what: "ISO carrying its own offset" },
  {
    key: "tokens",
    input: "yyyy-MM-dd HH:mm:ss",
    moment: "YYYY-MM-DD HH:mm:ss",
    what: "grafana's systemDateFormats.fullDate, no zone on it",
  },
  {
    key: "tokens+off",
    input: "yyyy-MM-dd'T'HH:mm:ss.SSSZZ",
    moment: "YYYY-MM-DDTHH:mm:ss.SSSZ",
    what: "grafana's URL-param format, offset included",
  },
  { key: "millis", input: "millis", moment: null, what: "a timestamp: object creation with no parsing at all" },
];

/**
 * Reads one input shape into a build's DateTime and returns the instant it
 * landed on — which the caller sums as its checksum, so a parse that fails
 * returns NaN instead of a suspiciously fast success.
 *
 * Takes both the instant and its rendered string so every case has one shape,
 * and the harness passes whichever the case reads.
 */
export async function parserFor(spec: BuildSpec, kase: ParseCase): Promise<(ts: number, input: string) => number> {
  const { input } = kase;

  if (spec.luxonEntry === null) {
    const { default: moment } = await import("moment-timezone");
    const { zone } = spec;

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
