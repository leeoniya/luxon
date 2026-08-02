// Where @types/luxon and luxon disagree, and the module shape the harness passes
// patched builds around as.
//
// Everything else comes from @types/luxon, a devDependency here. That package
// describes the PUBLISHED luxon, while these benches import the fork's src/
// directly — see ./stock.ts and ./patches.ts for how the two are joined up. It
// fits anyway, because a patch that changed the public surface would not be a
// candidate for upstream in the first place; the benches only ever call luxon
// the way its users do.
//
// The three exceptions below are all cases where the published types are
// narrower than the library. None is a reason to hand-roll the whole surface,
// which is what used to be in this file.

import type { DateTime, Zone, ZoneOffsetOptions } from "luxon";

/** One loaded copy of luxon — the fork's own src/, or a patched build of it. */
export type LuxonModule = typeof import("luxon");

declare module "luxon" {
  interface InfoOptions {
    /**
     * An existing Locale to use instead of building one from `locale`.
     *
     * @types/luxon documents this on Info.months, monthsFormat, weekdays and
     * weekdaysFormat but only declares it on Info.getStartOfWeek's separate
     * options type, so the four that take InfoOptions reject it. luxon accepts
     * it on all of them, and luxon's own benchmarks pass it — the "with existing
     * locale" cases in benchmarks/info.js exist to time exactly this path.
     */
    locObj?: object | null | undefined;
  }

  interface DateTime {
    /**
     * Whether this instant's civil time fell in a DST gap and was moved out of
     * it.
     *
     * luxon documents and exposes this getter, and it is the visible half of
     * what `adjustTime` returns, so a patch that skips `fixOffset` has to be
     * checked against it — see benchmarks/test/arith-direct-patch.test.ts.
     * @types/luxon does not declare it.
     */
    readonly wasHole: boolean;
  }
}

/**
 * The options Zone#offsetName actually accepts.
 *
 * @types/luxon types `format` as "short" | "long", which is what luxon's own
 * ZZZZ and ZZZZZ tokens ask for. But IANAZone hands the value straight to
 * Intl's timeZoneName, so a caller can pass any of the six, and
 * benchmarks/test/zone-name-patches.test.ts does — a patch to that method has to
 * hold for whatever reaches it, not just for what luxon's tokens send.
 *
 * A superset of ZoneOffsetOptions rather than a replacement for it, so that a
 * zone subclass overriding the method still accepts everything the base does.
 * Widening an existing property is the one thing declaration merging cannot do,
 * which is why this is a separate type and not another augmentation above.
 */
export interface OffsetNameOpts extends Omit<ZoneOffsetOptions, "format"> {
  format?: "short" | "long" | "shortOffset" | "longOffset" | "shortGeneric" | "longGeneric" | undefined;
}

/** Zone#offsetName, callable with the styles above. The one place that cast is made. */
export function offsetNameOf(zone: Zone, ts: number, opts: OffsetNameOpts): string | null {
  return zone.offsetName(ts, opts as ZoneOffsetOptions);
}

/**
 * luxon's internal Locale, which neither the package nor its types export.
 * Opaque here: the only thing the benchmarks do with one is hand it back to
 * Info, which is what luxon's own benchmarks do to time the path that skips
 * building one.
 */
export interface LocaleObj {
  readonly locale: string;
}

/**
 * A DateTime with that accessor. `loc` is internal and undocumented, so this is
 * a deliberate reach past the public surface rather than an oversight — named,
 * so the one place that needs it (benchmarks/suite.ts) says so instead of
 * casting to any.
 */
export type DateTimeWithLoc = DateTime & { readonly loc: LocaleObj };
