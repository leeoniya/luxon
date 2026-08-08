// D is the patch where most of what can go wrong is not visible in an answer.
// A span that reaches over a transition returns a stale offset or name, and that
// is a bug a comparison finds. A span that is evicted every other lookup, or
// anchored the wrong way, or never allowed to grow, returns the right value
// every time and buys nothing — and the only instrument that sees it is a count
// of Intl calls.
//
// So this file is in two halves, and the counting half is not a lesser kind of
// test here: running benchmarks/mutations/04-transition-interval.ts shows six of
// the sixteen ways to break this patch are caught by a count and by nothing
// else.
//
// The comparison half checks against the pre-patch lookups recomputed in
// lib/stock-zone.ts, so no value below is recorded.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import moment from "moment-timezone";
import { loadLuxon, patchKey, patchKeys, type PatchKey } from "../lib/patches.ts";
import { stockName, stockOffset, type NameStyle } from "../lib/stock-zone.ts";

const KEYS: PatchKey[] = ["offsetScan", "zoneInfoCache", "transitionInterval"].map(patchKey);

const VARIANTS: [string, PatchKey[]][] = [
  ["transitionInterval", KEYS],
  ["every patch", [...patchKeys]],
];

const ZONES = [
  "America/New_York",
  "Europe/Dublin", // negative DST
  "Africa/Casablanca", // the densest modern schedule, twice a year plus Ramadan
  "Australia/Lord_Howe", // 30-minute step
  "Asia/Kolkata", // nothing ever happens
];

/** instants around every transition of `zone` in a decade */
function around(zone: string): number[] {
  const start = Date.UTC(2018, 0, 1);
  const end = Date.UTC(2028, 0, 1);

  // Derive boundaries from the independent tzdata oracle. Scanning for them
  // through the implementation under test is both expensive and unsafe: a
  // broken lookup could hide the boundary its test needed to visit.
  return (moment.tz.zone(zone)?.untils ?? [])
    .filter((ts) => ts >= start && ts < end)
    .flatMap((ts) => [
      ...[-3, -2, -1, 0, 1, 2, 3].map((days) => ts + days * 86400000),
      ts - 1,
      ts + 1,
    ]);
}

for (const [label, keys] of VARIANTS) {
  describe(`transitionInterval fixtures > ${label}`, () => {
    // A span is built around whatever was asked for first and then reused for
    // whatever comes next, so the order of the questions is part of the case.
    // JEST-PARTIAL (sync shared cases; not removable): test/zones/IANA.test.js — "stays correct across forward, backward, and interleaved access"
    // JEST-PARTIAL (sync shared cases; not removable): test/zones/IANA.test.js — "matches Intl on both sides of every New York transition in a decade"
    test("the value is the same whatever order it is asked in", async () => {
      const m = await loadLuxon(keys);

      for (let zoneIndex = 0; zoneIndex < ZONES.length; zoneIndex++) {
        const name = ZONES[zoneIndex]!;
        const zone = m.IANAZone.create(name);
        const list = around(name);

        const orders: [string, number[]][] = [
          ["forward", list],
          ["backward", [...list].reverse()],
          // a second call site landing between every lookup, which is what
          // fixOffset does and what one span cannot survive
          ["interleaved with now", list.flatMap((ts) => [Date.now(), ts])],
          ["scattered", [...list].sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101))],
        ];
        // Transition geometry belongs to the zone; cache traversal belongs to
        // the access order. Pair the independent dimensions while retaining
        // every transition in every zone and every traversal shape.
        const [order, ordered] = orders[zoneIndex % orders.length]!;

        m.IANAZone.resetCache();
        const z = m.IANAZone.create(name);

        for (const ts of ordered) {
          assert.equal(z.offset(ts), stockOffset(name, ts), `${name} ${order} @${ts}`);
        }
      }
    });

    // JEST-PARTIAL (sync shared cases; not removable): test/zones/IANA.test.js — "stays correct when reads cross transitions in either direction"
    test("the zone name is the same whatever order it is asked in", async () => {
      const m = await loadLuxon(keys);
      const styles: NameStyle[] = ["short", "long", "shortGeneric"];
      const names = ["America/New_York", "Africa/Casablanca", "Australia/Lord_Howe"];

      for (const [localeIndex, locale] of ["en-US", "de-DE"].entries()) {
        for (const [styleIndex, format] of styles.entries()) {
          // Locale/style select the scanner. Pair each scanner with one zone;
          // the offset-side sweep above independently covers every zone and
          // traversal, while each style still sees two transition geometries.
          const name = names[(localeIndex + styleIndex) % names.length]!;
          const list = around(name);
          const ordered = (localeIndex + styleIndex) % 2 === 0 ? list : [...list].reverse();

          m.Settings.resetCaches();
          const z = m.IANAZone.create(name);

          for (const ts of ordered) {
            assert.equal(
              z.offsetName(ts, { format, locale } as never),
              stockName(ts, format, locale, name),
              `${name} / ${locale} / ${format} @${ts}`
            );
          }
        }
      }
    });

    // A span starts empty, and "empty" has to be a range no instant falls in.
    // The epoch is the one that a lo/hi of 0/0 would swallow, and it would come
    // back as the null a fresh span carries rather than an offset.
    // JEST-MIRROR (sync until transitionInterval merges, then remove): test/zones/IANA.test.js — "matches Intl across calendar, range, and sub-second partitions"
    // JEST-MIRROR (sync until transitionInterval merges, then remove): test/zones/IANA.test.js — "handles the epoch and representable Date edges"
    test("the epoch is not inside a span nothing has been asked for yet", async () => {
      const m = await loadLuxon(keys);

      for (const name of ZONES) {
        m.IANAZone.resetCache();
        // first question this zone is ever asked
        assert.equal(m.IANAZone.create(name).offset(0), stockOffset(name, 0), `${name} @0`);
      }

      m.Settings.resetCaches();
      assert.equal(
        m.IANAZone.create("America/New_York").offsetName(0, { format: "short", locale: "en-US" } as never),
        stockName(0, "short", "en-US", "America/New_York")
      );
    });

    // A probe is taken two days out from whatever was asked for, so asking near
    // the end of representable time puts the probe past it. The offset side
    // answers NaN there and the widening stops on its own; the name side calls
    // format(), which throws.
    // JEST-PARTIAL (sync shared cases; not removable): test/zones/IANA.test.js — "matches Intl across calendar, range, and sub-second partitions"
    // JEST-PARTIAL (sync shared cases; not removable): test/zones/IANA.test.js — "handles the epoch and representable Date edges"
    test("asking at the edge of representable time does not probe past it", async () => {
      const m = await loadLuxon(keys);
      const name = "America/New_York";

      for (const ts of [8.64e15 - 86400000, -8.64e15 + 86400000]) {
        m.Settings.resetCaches();
        assert.equal(m.IANAZone.create(name).offset(ts), stockOffset(name, ts), `offset @${ts}`);
      }

      // At exactly ±8.64e15 the offsetScan patch deliberately answers the true
      // offset where stock's Date.UTC overflowed for one sign, so the oracle
      // here is structural: the edge agrees with the instant a day inside it,
      // which also proves the widening probes never stepped past the edge.
      for (const [edge, inside] of [
        [8.64e15, 8.64e15 - 86400000],
        [-8.64e15, -8.64e15 + 86400000],
      ] as const) {
        m.Settings.resetCaches();
        const zone = m.IANAZone.create(name);

        assert.equal(zone.offset(edge), zone.offset(inside), `offset @${edge}`);
      }

      for (const ts of [8.64e15 - 86400000, -8.64e15 + 86400000]) {
        m.Settings.resetCaches();
        assert.equal(
          m.IANAZone.create(name).offsetName(ts, { format: "short", locale: "en-US" } as never),
          stockName(ts, "short", "en-US", name),
          `name @${ts}`
        );
      }
    });

    // Spans are held per zone, and two zones asked about the same instants in
    // turn is the pattern that finds one that is not — the second zone's lookup
    // lands inside the first's span and is answered with the first's value.
    // JEST-PARTIAL (sync shared cases; not removable): test/zones/IANA.test.js — "keeps alternating zones independent at the same instants"
    test("two zones asked about the same instants do not share a span", async () => {
      const m = await loadLuxon(keys);
      const a = "America/New_York";
      const b = "Australia/Lord_Howe";

      m.IANAZone.resetCache();
      const za = m.IANAZone.create(a);
      const zb = m.IANAZone.create(b);

      for (let i = 0; i < 200; i++) {
        const ts = Date.UTC(2026, 0, 1) + i * 3_600_000;
        assert.equal(za.offset(ts), stockOffset(a, ts), `${a} @${ts}`);
        assert.equal(zb.offset(ts), stockOffset(b, ts), `${b} @${ts}`);
      }
    });

    // JEST-PARTIAL (sync shared cases; not removable): test/zones/IANA.test.js — "does not step over a transition after warming on quiet dates"
    test("a transition is never stepped over, however wide the span has grown", async () => {
      const m = await loadLuxon(keys);

      for (const name of ZONES) {
        m.IANAZone.resetCache();
        const zone = m.IANAZone.create(name);

        // Walk a long way in even steps first, which is what widens the span to
        // its ceiling, and only then approach a boundary. A span that grew on
        // quiet ground and was not re-checked on the way in is the failure.
        for (let ts = Date.UTC(2026, 0, 1); ts < Date.UTC(2026, 5, 1); ts += 6 * 3_600_000) {
          assert.equal(zone.offset(ts), stockOffset(name, ts), `${name} warming @${ts}`);
        }

        for (const ts of around(name)) {
          assert.equal(zone.offset(ts), stockOffset(name, ts), `${name} approaching @${ts}`);
        }
      }
    });
  });
}

describe("transitionInterval actually caches", () => {
  /** Intl reads the zone performs per lookup over `list` */
  async function intlReadsPerLookup(keys: PatchKey[], zone: string, list: number[]): Promise<number> {
    const Real = Intl.DateTimeFormat;
    let reads = 0;

    // installed before the zone exists, so the scanner's own formatter is the
    // counting one
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
      const f = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);

      for (const meth of ["format", "formatToParts"] as const) {
        // `format` is a prototype getter, so this has to be an own property
        const real = (f[meth] as (...a: unknown[]) => unknown).bind(f);
        Object.defineProperty(f, meth, {
          configurable: true,
          value: (...a: unknown[]) => (reads++, real(...a)),
        });
      }

      return f;
    };

    try {
      const lux = await loadLuxon(keys);
      // loadLuxon hands back one module per patch set, so the cache would
      // otherwise arrive warm from whatever ran before — which is how a cache
      // that cannot serve a pattern still measures as though it can
      lux.IANAZone.resetCache();

      const z = lux.IANAZone.create(zone);
      // building the scanner is not what this counts
      z.offset(list[0]!);
      reads = 0;

      for (const ts of list) z.offset(ts);

      // per lookup, not per instant: the interleaved list is twice as long, and
      // a total would flatter it by half
      return reads / list.length;
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
    }
  }

  for (const [label, keys] of VARIANTS) {
    for (const zone of ["America/New_York", "Europe/Dublin", "Asia/Kolkata"]) {
      test(`${label} > ${zone} is served from the cache in both directions and interleaved`, async () => {
        // an hour apart, far finer than the two-day probe spacing, so a working
        // cache answers nearly all of them without asking Intl
        const run = Array.from({ length: 400 }, (_, i) => Date.UTC(2026, 0, 1) + i * 3_600_000);
        const now = Date.now();

        const forward = await intlReadsPerLookup(keys, zone, run);
        // NOT in the sweep: a span anchored only in the direction the last miss
        // travelled serves a forward reader and misses on every step of a
        // backward one
        const backward = await intlReadsPerLookup(keys, zone, [...run].reverse());
        const interleaved = await intlReadsPerLookup(keys, zone, run.flatMap((ts) => [now, ts]));

        // Generous on purpose: the distance between "caches" and "cannot cache"
        // is an order of magnitude, not a tuned ratio. One span read Intl 1.06
        // times per lookup interleaved against 0.14 in order.
        assert.ok(forward < 0.3, `forward run cost ${forward.toFixed(2)} Intl reads per lookup`);
        assert.ok(backward < 0.3, `backward run cost ${backward.toFixed(2)} Intl reads per lookup`);
        assert.ok(
          interleaved < 0.3,
          `run interleaved with \`now\` cost ${interleaved.toFixed(2)} Intl reads per lookup against ` +
            `${forward.toFixed(2)} for the same instants in order — the cache is being evicted by the ` +
            `other call site rather than serving both`
        );
      });
    }

    // The budget is what the last span paid back, so a run long enough to reach
    // the ceiling should cost less per lookup than a short one. A span pinned at
    // its floor covers two days per miss however far the reader goes, and its
    // cost per lookup is flat.
    test(`${label} > a long run costs less per lookup than a short one`, async () => {
      const from = (n: number) => Array.from({ length: n }, (_, i) => Date.UTC(2030, 0, 1) + i * 3_600_000);
      const short = await intlReadsPerLookup(keys, "Asia/Kolkata", from(400));
      const long = await intlReadsPerLookup(keys, "Asia/Kolkata", from(20000));

      assert.ok(
        long < short / 2,
        `50x the lookups cost ${long.toFixed(4)} reads each against ${short.toFixed(4)} for the short run — ` +
          `the span is not widening with the ground it covers`
      );
    });

    // The budget is capped, and what the cap buys is a bound on one lookup
    // rather than on the run. After a long quiet stretch the reach is at its
    // ceiling, and the next miss pays for probes at that reach — uncapped, that
    // is a stall proportional to how long the caller has been reading.
    test(`${label} > a miss after a long run costs a bounded number of reads`, async () => {
      const run = Array.from({ length: 20000 }, (_, i) => Date.UTC(2030, 0, 1) + i * 3_600_000);
      const warm = await intlReadsPerLookup(keys, "Asia/Kolkata", run);
      // one lookup a century away, which no span can already contain
      const withMiss = await intlReadsPerLookup(keys, "Asia/Kolkata", [...run, Date.UTC(2130, 0, 1)]);

      // 256 probes is the ceiling, so the miss can cost at most 129 either way
      const missCost = withMiss * (run.length + 1) - warm * run.length;

      assert.ok(missCost < 300, `the miss after a long run cost ${missCost.toFixed(0)} Intl reads`);
    });

    test(`${label} > the name side keeps a span too`, async () => {
      const Real = Intl.DateTimeFormat;
      let reads = 0;

      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function (...args: unknown[]) {
        const f = new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);

        for (const meth of ["format", "formatToParts"] as const) {
          const real = (f[meth] as (...a: unknown[]) => unknown).bind(f);
          Object.defineProperty(f, meth, {
            configurable: true,
            value: (...a: unknown[]) => (reads++, real(...a)),
          });
        }

        return f;
      };

      try {
        const lux = await loadLuxon(keys);
        lux.Settings.resetCaches();

        const z = lux.IANAZone.create("America/New_York");
        const list = Array.from({ length: 400 }, (_, i) => Date.UTC(2026, 0, 1) + i * 3_600_000);

        z.offsetName(list[0]!, { format: "short", locale: "en-US" } as never);
        reads = 0;

        for (const ts of list) z.offsetName(ts, { format: "short", locale: "en-US" } as never);

        const cost = reads / list.length;
        assert.ok(cost < 0.3, `a run of name lookups cost ${cost.toFixed(2)} Intl reads each`);
      } finally {
        (Intl as { DateTimeFormat: unknown }).DateTimeFormat = Real;
      }
    });
  }
});
