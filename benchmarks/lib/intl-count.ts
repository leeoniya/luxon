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

let cap = Infinity;
let capWhat = "";

/**
 * Aborts the process once construction passes `max`.
 *
 * A formatter cache keyed on something that varies per call does not read as
 * slow, it reads as a hung machine: every iteration builds an ICU formatter,
 * which costs tens of microseconds and allocates heavily, so a loop sized for
 * cache hits becomes minutes of GC instead of seconds of work. A probe timing
 * such a cache knows roughly how many distinct formatters should ever exist —
 * usually a handful — so it can say so here and fail in a second rather than
 * taking the machine down with it.
 *
 * Implies installIntlCounter(). `what` names the expectation, since the useful
 * half of the message is which assumption turned out to be wrong.
 *
 * Written after a probe for a toLocaleString formatter cache keyed the cache on
 * the identity of the options object, which luxon rebuilds per call on its
 * macro-token path; see the toLocaleString paragraph in benchmarks/suite.ts.
 */
export function capIntlConstructions(max: number, what: string): void {
  installIntlCounter();
  cap = max;
  capWhat = what;
}

function counted(): void {
  constructions++;

  if (constructions > cap) {
    const msg =
      `Intl.DateTimeFormat constructed ${constructions} times, over the cap of ${cap} (${capWhat}). ` +
      `Something is building a formatter per call rather than reusing one; letting this run would ` +
      `spend minutes in ICU and GC.`;

    // the cap exists to stop a runaway loop, and a throw inside a benchmark's
    // inner function can be swallowed by the code under test, so leave directly
    console.error(msg);
    process.exit(1);
  }
}

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
      counted();
      return Reflect.construct(target, args as unknown[], newTarget) as object;
    },
    apply(target, thisArg, args): unknown {
      counted();
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
