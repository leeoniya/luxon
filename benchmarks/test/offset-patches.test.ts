// The two patches that touch the offset lookup (B and E in benchmarks/patches)
// must be invisible: the same offset, the same formatted output, and the same
// NaN cases as stock luxon.
//
// E (transitionInterval) is the one that needs the coverage. It is stateful and
// its answer depends on which instants it was asked about earlier, so every zone
// is replayed in four access orders — a sequential reader, a random one, a
// backwards one, and one interleaving each instant with `now` — each against a
// fresh module.
//
// E also carries the zone-NAME half of the same cache, which
// ./zone-name-patches.test.ts covers; loading it here pulls that in too, since it
// requires D. That is inert for these assertions — nothing below formats a name
// through parseZoneInfo — but it does mean this file no longer isolates the
// offset side the way it did when the two intervals were separate patches.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import moment from "moment-timezone";
import { loadLuxon, patchKey, type PatchKey } from "../lib/patches.ts";

const ZONES = [
  "America/New_York",
  "Europe/London",
  "Asia/Kolkata", // no DST at all
  "Australia/Lord_Howe", // 30-minute DST step, transitions off the UTC hour
  "America/Cambridge_Bay", // holds the tightest transition gap in all of tzdata
  "Africa/Casablanca", // Ramadan transitions, the densest modern schedule
  "Pacific/Chatham",
  "America/Santiago",
  "Asia/Kathmandu", // +05:45
  "Pacific/Kiritimati", // +14, and skipped a whole day in 1994
  "Europe/Dublin", // negative DST
  "Antarctica/Troll", // 2-hour DST step
];

const VARIANTS: [string, PatchKey[]][] = [
  ["offsetScan", [patchKey("offsetScan")]],
  ["offsetScan + transitionInterval", [patchKey("offsetScan"), patchKey("transitionInterval")]],
];

// ZZ and z together, so a wrong offset shows up in the rendered wall clock, in
// the numeric offset, and in the abbreviation the offset selects
const PATTERN = "yyyy-MM-dd HH:mm:ss 'x' ZZ z";

/** instants chosen to hit the cases the scanner and the interval cache can get wrong */
function instants(zone: string): number[] {
  const out: number[] = [];
  const base = Date.UTC(2026, 0, 1);

  for (let i = 0; i < 800; i++) {
    out.push(base + i * 3_600_000);
  }

  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let i = 0; i < 1500; i++) {
    out.push(Math.floor((rnd() * 2 - 1) * 4e12));
  }

  for (let i = 0; i < 300; i++) {
    out.push(Math.floor(rnd() * 6e13) - 63e12); // years 0-100, and BC
  }

  for (let i = 0; i < 200; i++) {
    out.push(base + Math.floor(rnd() * 1000)); // sub-second
  }

  // every real transition, to the millisecond on both sides
  const tz = moment.tz.zone(zone);

  if (tz !== null) {
    for (const until of tz.untils) {
      if (!isFinite(until)) {
        continue;
      }

      out.push(until - 1, until, until + 1, until - 1000, until + 1000);
    }
  }

  // the edges of the Date range, where luxon's Date.UTC round trip overflows
  out.push(NaN, 8.64e15, -8.64e15, 8.64e15 + 1, -8.64e15 - 1, Infinity, -Infinity);

  return out;
}

const stock = await loadLuxon([]);

for (const [label, keys] of VARIANTS) {
  describe(label, () => {
    for (const zone of ZONES) {
      test(`${zone} matches stock luxon in every access order`, async () => {
        const points = instants(zone);
        const orders: [string, number[]][] = [
          ["sequential", points],
          ["shuffled", [...points].sort(() => 0.5 - Math.random())],
          ["reversed", [...points].reverse()],
          // Every real parse looks like this: fixOffset seeds itself with the
          // offset at Settings.now() and then probes around the instant it is
          // actually placing, so the zone is asked about the two in turn,
          // forever. It is the pattern a one-span cache cannot serve — each
          // lookup evicts the other's span — and the reason there are two.
          ["interleaved with now", points.flatMap((ts) => [Date.now(), ts])],
        ];

        for (const [order, list] of orders) {
          // One module instance for all three orders, so each inherits whatever
          // the previous one left in the interval cache. More adversarial than a
          // cold start, and the reason the orders are worth running at all: a
          // cache that is only ever asked for ascending instants is not being
          // tested for the thing that can go wrong with it.
          const patched = await loadLuxon(keys);
          const want = stock.IANAZone.create(zone);
          const got = patched.IANAZone.create(zone);
          const offsetDiffs: string[] = [];
          const formatDiffs: string[] = [];

          for (const ts of list) {
            const a = want.offset(ts);
            const b = got.offset(ts);

            if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) {
              offsetDiffs.push(`${ts}: ${a} vs ${b}`);
            }

            if (Number.isFinite(ts) && Math.abs(ts) <= 8.64e15) {
              const fa = stock.DateTime.fromMillis(ts, { zone: want }).toFormat(PATTERN);
              const fb = patched.DateTime.fromMillis(ts, { zone: got }).toFormat(PATTERN);

              if (fa !== fb) {
                formatDiffs.push(`${ts}: "${fa}" vs "${fb}"`);
              }
            }
          }

          // sliced so a systematic break reports three examples rather than
          // thousands of lines of the same thing
          assert.deepEqual(offsetDiffs.slice(0, 3), [], `${order}: offset differs`);
          assert.deepEqual(formatDiffs.slice(0, 3), [], `${order}: formatted output differs`);
        }
      });
    }
  });
}

// The orders above prove the cache is INVISIBLE. They cannot prove it is doing
// anything, because a cache that never hits is still correct — and the one that
// shipped first never hit on this pattern at all, which no parity assertion
// would have noticed. So this counts instead of comparing.
describe("transitionInterval actually caches", () => {
  /**
   * Intl reads the zone performs over `list`, with a formatter that counts them.
   *
   * resetCache() first, because loadLuxon hands back one module per patch set
   * and the interval cache would otherwise arrive warm from whatever ran before
   * — which is exactly how a cache that cannot serve this pattern still measures
   * as though it can.
   */
  async function intlReadsPerLookup(zone: string, list: number[]): Promise<number> {
    const Real = Intl.DateTimeFormat;
    let reads = 0;

    // installed before the zone exists, so the scanner's own formatter is the
    // counting one
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
      const f = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);

      for (const m of ["format", "formatToParts"] as const) {
        // `format` is a prototype getter, so this has to be an own property
        const real = (f[m] as (...a: unknown[]) => unknown).bind(f);
        Object.defineProperty(f, m, {
          configurable: true,
          value: (...a: unknown[]) => (reads++, real(...a)),
        });
      }

      return f;
    };

    try {
      const lux = await loadLuxon([patchKey("offsetScan"), patchKey("transitionInterval")]);
      lux.IANAZone.resetCache();

      const z = lux.IANAZone.create(zone);
      // the scanner itself is built on the first lookup and is not what this
      // counts, so warm it and start the count after
      z.offset(list[0]!);
      reads = 0;

      for (const ts of list) z.offset(ts);
      // per lookup, not per instant: the interleaved list is twice as long, and
      // comparing its total against the plain one's would flatter it by half
      return reads / list.length;
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
    }
  }

  for (const zone of ["America/New_York", "Europe/Dublin", "Asia/Kolkata"]) {
    test(`${zone} serves a run interleaved with \`now\` from the cache`, async () => {
      // an hour apart, which is far finer than the 2-day probe spacing, so a
      // working cache answers nearly all of them without asking Intl
      const run = Array.from({ length: 400 }, (_, i) => Date.UTC(2026, 0, 1) + i * 3_600_000);
      const now = Date.now();

      const plain = await intlReadsPerLookup(zone, run);
      const interleaved = await intlReadsPerLookup(zone, run.flatMap((ts) => [now, ts]));

      // Generous on purpose: the point is the difference between "caches" and
      // "cannot cache", which is an order of magnitude, not a tuned ratio. The
      // single-span version read Intl 1.06 times per lookup here against 0.14
      // for the same instants in order.
      assert.ok(plain < 0.3, `sequential run cost ${plain.toFixed(2)} Intl reads per lookup`);
      assert.ok(
        interleaved < 0.3,
        `run interleaved with \`now\` cost ${interleaved.toFixed(2)} Intl reads per lookup against ` +
          `${plain.toFixed(2)} for the same instants in order — the cache is being evicted by the other ` +
          `call site rather than serving both`
      );
    });
  }
});
