// Process-wide counters for Intl.DateTimeFormat traffic.
//
// This is what turns the timings in benchmarks/format.ts and upstream.ts from
// numbers into an explanation. Every one of those tables is some arrangement of
// the same fact — luxon reaches Intl per value where the alternatives reach a
// table — and counting the calls says so directly, in a figure that does not
// move with the host, the engine or the thermal state.
//
// Counts PUBLIC constructor and formatToParts traffic, wherever it comes from,
// which is the point: the interesting calls are the ones luxon makes internally,
// not ones the benchmark makes on its own behalf. Engine-internal formatting
// (Date#toLocaleString and friends) is invisible here, as is any formatter the
// engine caches behind its own API.
//
// Install before the code under measurement first runs. Formatter construction
// is lazy everywhere that matters, so any time after module load and before
// first use will do. Because the counters are process-wide and permanent, the
// callers run each measurement in a FRESH subprocess rather than trying to
// unwind them.
//
// Ported from easy-tz's shared/intl-count.ts.

let constructions = 0;
let installed = false;

/**
 * Counts `new Intl.DateTimeFormat(...)` and the no-new call form, by swapping
 * the global for a counting Proxy. Statics (supportedLocalesOf) and instanceof
 * keep working because the Proxy target IS the original constructor.
 */
export function installIntlCounter(): void {
  if (installed) {
    return;
  }

  installed = true;

  Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
    construct(target, args, newTarget): object {
      constructions++;
      return Reflect.construct(target, args as unknown[], newTarget) as object;
    },
    apply(target, thisArg, args): unknown {
      constructions++;
      return Reflect.apply(target, thisArg, args as unknown[]);
    },
  });
}

export const intlConstructCount = (): number => constructions;

let partsCalls = 0;
let partsInstalled = false;

/**
 * Counts calls to Intl.DateTimeFormat#formatToParts.
 *
 * Constructions alone don't separate "builds one formatter, then calls it per
 * value" (luxon's IANAZone#offset, whose formatter is cached) from "builds a
 * formatter per value" (parseZoneInfo, behind offsetName, which caches nothing)
 * — the first is invisible to the counter above once the formatter exists.
 * Counting the per-value calls measures that work directly, and the two columns
 * side by side are what distinguishes the two shapes of cost.
 *
 * formatToParts is a plain method, so a straight assignment is enough; `format`
 * is an accessor and is left alone, since nothing measured here routes through
 * it.
 */
export function installIntlPartsCounter(): void {
  if (partsInstalled) {
    return;
  }

  partsInstalled = true;

  const proto = Intl.DateTimeFormat.prototype;
  // read through the descriptor rather than `proto.formatToParts` so the
  // original is never referenced as an unbound method
  const original = Object.getOwnPropertyDescriptor(proto, "formatToParts")!.value as typeof proto.formatToParts;

  proto.formatToParts = new Proxy(original, {
    apply(target, thisArg, args): Intl.DateTimeFormatPart[] {
      partsCalls++;
      return Reflect.apply(target, thisArg, args as Parameters<typeof original>);
    },
  });
}

export const intlPartsCount = (): number => partsCalls;
