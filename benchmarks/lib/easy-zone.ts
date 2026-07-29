// The easy-tz/luxon binding on its own, apart from the rest of the formatting
// kernel: a luxon zone whose offset and abbreviation come from baked rules
// instead of Intl.
//
// Separate module, and with NO imports of its own, because benchmarks/upstream.ts
// bundles it to report what an easy-tz row would ship. The module it would
// otherwise live in imports moment-timezone and the zone tables for its other
// exports, none of which a luxon consumer binding this zone would pull in, so
// measuring it from there would have sized the benchmark rather than the
// integration.
//
// That is also why the lookup arrives as an argument rather than being imported.
// ./easy-tz.ts finds easy-tz by path at runtime, through a dynamic import a
// bundler cannot follow — so a sized entry that went through it would report
// this binding as costing nothing but luxon, leaving out the baked rules that
// are the whole point of it. Taking the function lets that entry import easy-tz
// statically and get an honest figure, while the benches still route through
// ./easy-tz.ts.

import type { IANAZone, ZoneOffsetOptions } from "luxon";
import type { OffsetNameOpts } from "./luxon-types.ts";

/** A zone's DST-correct abbreviation and UTC offset at an instant. easy-tz's `getTimeZoneAt`. */
export interface TimeZoneInfo {
  name: string;
  abbr: string;
  offset: number;
  aliasOf?: string;
}

export type GetTimeZoneAt = (name: string, timestamp: number) => TimeZoneInfo;

// luxon asks for the offset and the offset name of the SAME instant back to back
// while formatting one value, so a single-slot memo halves the lookups for
// abbreviation-bearing formats. Keyed on the exact ts, so it cannot skew a result
// the way an hour-bucket memo could across a DST transition.
//
// Exported for the SystemZone subclass in benchmarks/lib/format-paths.ts, which
// extends a different luxon base and so has no common superclass to hang this
// on. The two copies that replaces are exactly the kind of thing that drifts
// into making one benchmark row measure something the other doesn't.
export function zoneMemo(getTimeZoneAt: GetTimeZoneAt, name: string): (ts: number) => TimeZoneInfo {
  let at = NaN;
  let info: TimeZoneInfo | undefined;

  return (ts) => {
    if (info === undefined || ts !== at) {
      at = ts;
      info = getTimeZoneAt(name, ts);
    }

    return info;
  };
}

/**
 * A real luxon IANAZone whose offset and short offset name come from easy-tz's
 * baked rules instead of Intl. Everything else — `type`, `name`, `equals`,
 * validity, and the whole DateTime/Formatter path above it — is inherited
 * untouched, so luxon still treats it as the named IANA zone it is.
 *
 * Built against a supplied IANAZone rather than an imported one so the same
 * implementation can be bound to a patched luxon build (benchmarks/upstream.ts)
 * as well as the stock one.
 */
export function makeEasyZoneClass(Base: typeof IANAZone, getTimeZoneAt: GetTimeZoneAt) {
  return class EasyTZZone extends Base {
    readonly #at: (ts: number) => TimeZoneInfo;

    constructor(name: string) {
      super(name);
      this.#at = zoneMemo(getTimeZoneAt, name);
    }

    override offset(ts: number): number {
      return this.#at(ts).offset;
    }

    override offsetName(ts: number, opts: OffsetNameOpts): string | null {
      // easy-tz carries only the short abbreviation ("EST"); every other style,
      // including the long form ("Eastern Standard Time") and the four that no
      // luxon token asks for, stays on luxon's Intl path. The cast is
      // @types/luxon understating what this method accepts — see OffsetNameOpts.
      return opts.format === "short" ? this.#at(ts).abbr : super.offsetName(ts, opts as ZoneOffsetOptions);
    }
  };
}
