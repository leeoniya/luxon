// The formatting paths compared by benchmarks/format.ts, in a module the driver
// and its Intl-counting subprocesses can both import.
//
// The question: formatting a column of timestamps in a named IANA zone is
// several times slower through luxon than through moment-timezone, and the cost
// is in the zone lookups rather than the formatting itself. Stock luxon resolves
// a zone from Intl on every call:
//
//   IANAZone.offset(ts)      -> formatToParts() on a per-zone cached formatter
//   IANAZone.offsetName(ts)  -> parseZoneInfo(), which constructs a BRAND NEW
//                               Intl.DateTimeFormat per call — nothing caches it
//
// moment-timezone consults a packed offset table and touches Intl never. easy-tz
// resolves the same two values from baked rules, also without Intl, so a subclass
// that overrides just those two methods keeps every other luxon behavior intact
// (zone identity, token handling, DateTime math) while dropping the per-value
// Intl work.
//
// Both of those are the OUTSIDE view. What the patches in benchmarks/patches do
// to the same two lookups from the inside is benchmarks/upstream.ts's subject —
// B and D for the offset, A, C and D for the name.

import moment from "moment-timezone";
import { canResolve, getTimeZoneAt } from "./easy-tz.ts";
import { makeEasyZoneClass, zoneMemo } from "./easy-zone.ts";
import type { ZoneOffsetOptions } from "luxon";
import type { OffsetNameOpts } from "./luxon-types.ts";
import { DateTime, IANAZone, SystemZone } from "./stock.ts";

// the binding itself lives apart so benchmarks/upstream.ts can bundle it without
// this module's moment and zone-table imports — see that file's bytes column
export { makeEasyZoneClass } from "./easy-zone.ts";

// Locale is pinned so luxon's ZZZZ token and moment's z token are compared on
// equal terms and the run is reproducible regardless of host locale.
export const LOCALE = "en-US";

const EasyTZZone = makeEasyZoneClass(IANAZone, getTimeZoneAt);

// mirrors luxon's own ianaZoneCache: constructing an IANAZone runs
// isValidZone(), which builds an Intl.DateTimeFormat, so instances are reused
const easyZoneCache = new Map<string, InstanceType<typeof EasyTZZone>>();

function easyZoneFor(name: string): InstanceType<typeof EasyTZZone> {
  let zone = easyZoneCache.get(name);

  if (zone === undefined) {
    easyZoneCache.set(name, (zone = new EasyTZZone(name)));
  }

  return zone;
}

/** The host zone, resolved once — luxon's SystemZone#name rebuilds a formatter on every access. */
export const hostZoneName = new Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The same treatment for the host zone. luxon's SystemZone already gets its
 * offset from Date#getTimezoneOffset — no Intl, and exact by definition — so
 * only the name lookup needs replacing; it goes through the very same uncached
 * parseZoneInfo() as IANAZone's, which is why an abbreviation-bearing format is
 * slow even on the default zone.
 *
 * `offset` therefore still tracks the live host zone while the abbreviation
 * comes from the baked tables. They agree because those tables are generated
 * from this runtime's ICU, but a process that mutates TZ mid-run would need this
 * instance discarded — the same caveat as luxon's own zone caches.
 */
class EasySystemZone extends SystemZone {
  readonly #at = zoneMemo(getTimeZoneAt, hostZoneName);

  override offsetName(ts: number, opts: OffsetNameOpts): string {
    // matches the IANAZone binding in ./easy-zone.ts: only the short
    // abbreviation comes from the tables, everything else stays on Intl
    return opts.format === "short" ? this.#at(ts).abbr : super.offsetName(ts, opts as ZoneOffsetOptions);
  }
}

let easySystem: EasySystemZone | undefined;

function easySystemZone(): EasySystemZone {
  return (easySystem ??= new EasySystemZone());
}

// ---- formats ----------------------------------------------------------------
// What each shape is for:
//
//   numeric  needs only offset(). The shape a data-table column uses.
//   abbr     also needs offsetName(), the uncached-formatter path.
//   text     names a weekday and a month, so it reaches neither of those any
//            differently from `numeric` and reaches the Formatter itself very
//            differently: a name never touches a numeric fast path. Its offset
//            token is the techie one, which is offset() and not offsetName(),
//            so it varies the pattern against `numeric` and nothing else.
//   text fr  the same pattern again, in a locale that is not English.
//
// The RFC 2822 shape rather than an invented one, so the row is something a
// caller actually emits — it is what DateTime#toRFC2822 formats, and moment's
// spelling of it produces a byte-identical string.
//
// `text fr` holds the pattern fixed and varies only the locale, which is the
// whole reason it earns a column. A name token has an English branch that reads
// a constant array and a branch for everything else that asks ICU, and those two
// are ~20x apart; nothing else in the ladder crosses that line, so a patch on it
// was invisible here. Paired with `text`, the difference between the two columns
// is that branch and nothing else.

export type FormatKey = "numeric" | "abbr" | "text" | "text fr";

const FORMATS: Record<FormatKey, { moment: string; luxon: string; locale?: string }> = {
  numeric: { moment: "YYYY-MM-DD HH:mm:ss", luxon: "yyyy-MM-dd HH:mm:ss" },
  abbr: { moment: "YYYY-MM-DD HH:mm:ss z", luxon: "yyyy-MM-dd HH:mm:ss ZZZZ" },
  text: { moment: "ddd, DD MMM YYYY HH:mm:ss ZZ", luxon: "EEE, dd LLL yyyy HH:mm:ss ZZZ" },
  "text fr": {
    moment: "ddd, DD MMM YYYY HH:mm:ss ZZ",
    luxon: "EEE, dd LLL yyyy HH:mm:ss ZZZ",
    locale: "fr",
  },
};

/** The locale a format is rendered in — `LOCALE` unless the format names another. */
export function localeFor(fmt: FormatKey): string {
  return FORMATS[fmt].locale ?? LOCALE;
}

/**
 * The formats the ZONE benches compare, which is deliberately not "every format
 * defined above".
 *
 * These two vary the zone work and hold the pattern shape roughly fixed, which
 * is the question format.ts asks: it runs a table per format across four zones
 * and three variants, plus a correctness sweep and an Intl-counting subprocess
 * per format, so a format added here costs several minutes and a table nobody
 * asked for. A bench that wants a different set names it, and `FORMATS` can grow
 * without deciding anything on that bench's behalf.
 */
export const zoneFormatKeys: FormatKey[] = ["numeric", "abbr"];

export function patternFor(variant: VariantId, fmt: FormatKey): string {
  return variant === "moment" ? FORMATS[fmt].moment : FORMATS[fmt].luxon;
}

// ---- variants ---------------------------------------------------------------
// `utc` is a context row only: FixedOffsetZone answers both the offset and the
// name without Intl already, so there's nothing for easy-tz to replace.

export type VariantId = "moment" | "luxon" | "luxon-easytz";

export const variantIds: VariantId[] = ["moment", "luxon", "luxon-easytz"];

export const SYSTEM = "system";
export const UTC = "utc";

export function variantAvailable(variant: VariantId, zone: string): boolean {
  if (variant !== "luxon-easytz") {
    return true;
  }

  if (zone === UTC) {
    return false;
  }

  return canResolve(zone === SYSTEM ? hostZoneName : zone);
}

/** A `(ts) => string` closure holding every per-column setup a real formatter would hoist. */
export function makeFormatter(variant: VariantId, zone: string, fmt: FormatKey): (ts: number) => string {
  const pattern = patternFor(variant, fmt);

  if (variant === "moment") {
    if (zone === SYSTEM) {
      return (ts) => moment(ts).format(pattern);
    }

    if (zone === UTC) {
      return (ts) => moment.utc(ts).format(pattern);
    }

    return (ts) => moment.tz(ts, zone).format(pattern);
  }

  const luxonZone =
    variant === "luxon-easytz"
      ? zone === SYSTEM
        ? easySystemZone()
        : easyZoneFor(zone)
      : zone === SYSTEM || zone === UTC
        ? zone
        : IANAZone.create(zone);

  const opts = { zone: luxonZone, locale: LOCALE };

  return (ts) => DateTime.fromMillis(ts, opts).toFormat(pattern);
}

// ---- external fast path -------------------------------------------------------
// For the handful of patterns a value formatter actually emits in bulk, skip
// luxon's Formatter (and DateTime) and build the string straight from the
// timestamp plus easy-tz's offset.
//
// This is the ceiling on what can be done from OUTSIDE luxon, and the point of
// measuring it is to size what's left inside.
//
// Nothing calls it at the moment. benchmarks/upstream.ts carried a row for it
// that was timed and never printed, and that row went when the untabulated
// builds did — each of them cost a full row of measurement and cooling to feed a
// ranking that the ladder already gives. Kept because the ceiling is a real
// question and this is the answer to it, so restoring the row is adding a row
// rather than rewriting a path. Its output was diffed against luxon's when it
// last ran; a row put back should do that again rather than assume it.

const DAY_MS = 86_400_000;

// '00'..'99', so two-digit fields are an array read rather than a pad call
const D2 = Array.from({ length: 100 }, (_, i) => (i < 10 ? "0" : "") + i);

/**
 * Civil fields from an offset-shifted epoch time, using the same Hinnant
 * algorithm as the tsToObj fast path in patch G — no Date allocation.
 */
function formatCivil(localMs: number, abbr: string | null): string {
  const days = Math.floor(localMs / DAY_MS);
  const secOfDay = Math.floor((localMs - days * DAY_MS) / 1000);

  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);

  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);

  const hour = Math.floor(secOfDay / 3600);
  const minute = Math.floor(secOfDay / 60) % 60;
  const second = secOfDay % 60;

  // luxon's yyyy pads to four; years outside 1000-9999 are not what this path is
  // for, but stay correct rather than silently truncating
  const y = year >= 1000 && year <= 9999 ? String(year) : String(year).padStart(4, "0");
  const stamp = `${y}-${D2[month]}-${D2[day]} ${D2[hour]}:${D2[minute]}:${D2[second]}`;

  return abbr === null ? stamp : `${stamp} ${abbr}`;
}

/**
 * A formatter for `zone`/`fmt` that never enters luxon, or null when easy-tz
 * can't resolve the zone exactly (irregular zones, or `utc` which has no zone
 * cost to avoid) and the caller should stay on luxon.
 */
export function makeFastFormatter(zone: string, fmt: FormatKey): ((ts: number) => string) | null {
  if (zone === UTC) {
    return null;
  }

  const name = zone === SYSTEM ? hostZoneName : zone;

  if (!canResolve(name)) {
    return null;
  }

  if (fmt === "numeric") {
    return (ts) => formatCivil(ts + getTimeZoneAt(name, ts).offset * 60_000, null);
  }

  if (fmt === "abbr") {
    return (ts) => {
      const info = getTimeZoneAt(name, ts);

      return formatCivil(ts + info.offset * 60_000, info.abbr);
    };
  }

  // Every pattern here is hand-rolled, so one this has not been written for has
  // no ceiling to report and says so. Tested for explicitly rather than left as
  // the fallthrough: the fallthrough used to be `abbr`, which would have answered
  // a third format with confidently formatted wrong output.
  return null;
}
