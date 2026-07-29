// The two patches that touch the zone-name lookup (D and E in
// benchmarks/patches) must be invisible: the same name out of offsetName(), and
// the same formatted output, as stock luxon.
//
// Each has its own way of being wrong, so each gets its own dimension.
//
// D (zoneNameScan) learns where the name sits inside one formatter's output and
// reuses that position, so what can break it is a locale — one that puts the
// name first, renders the hour in a different script, or counts years off a
// different calendar. Hence the locale and style sweep, which also covers the
// four styles no luxon token reaches but offsetName() accepts.
//
// E (transitionInterval) is stateful: its answer depends on which instants it was
// asked about earlier, and its interval is only sound because names cannot
// change and change back inside a probe window. So every zone is replayed in
// three access orders over an instant list that puts values either side of every
// real transition — including the two Nunavut ones where America/Cambridge_Bay's
// name moves while its offset stays put. That case is why the shared interval is
// bounded by the name rather than by the offset: the offset bound alone cannot
// see it.
//
// Run: node --test benchmarks/test/
//      bun --test benchmarks/test/        (the same, on JavaScriptCore)

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import moment from "moment-timezone";
import { offsetNameOf, type OffsetNameOpts } from "../lib/luxon-types.ts";
import { loadLuxon, patchKey, type PatchKey } from "../lib/patches.ts";

const ZONES = [
  "America/New_York",
  "America/Cambridge_Bay", // renamed itself without moving, twice, in 2000
  "Europe/Dublin", // negative DST
  "Africa/Casablanca", // Ramadan transitions, the densest modern schedule
  "Australia/Lord_Howe", // 30-minute DST step
  "Asia/Kathmandu", // +05:45, and no name but its offset
  "Pacific/Kiritimati", // +14
  "Asia/Kolkata", // no DST at all
  "Antarctica/Troll", // 2-hour DST step
  "UTC",
];

// Names come out of CLDR, so the locale decides both the text and where it sits.
// th-TH here carries a non-gregory calendar and non-latn digits, which is what
// makes the surround around the name a different width from every other row.
const LOCALES = ["en-US", "de-DE", "ja-JP", "ar-EG", "th-TH-u-ca-buddhist-nu-thai"];

// what luxon's ZZZZ and ZZZZZ ask for, then the four an offsetName() caller can
// ask for directly
const STYLES: NonNullable<OffsetNameOpts["format"]>[] = [
  "short",
  "long",
  "shortOffset",
  "longOffset",
  "shortGeneric",
  "longGeneric",
];

// Both carry A, whose DTF cache D reads the formatter out of; the second also
// pulls in B, since E covers both lookups and requires the offset scanner too.
const VARIANTS: [string, PatchKey[]][] = [
  ["zoneNameScan", ["zoneInfoCache", "zoneNameScan"].map(patchKey)],
  ["zoneNameScan + transitionInterval", ["zoneInfoCache", "zoneNameScan", "transitionInterval"].map(patchKey)],
];

// ZZZZ only, not ZZZZ + ZZZZZ: a second zone-name token doubles what the stock
// reference below costs to derive, and the locale grid already reads every style
// either side of every modern transition.
const PATTERN = "yyyy-MM-dd HH:mm:ss 'x' ZZZZ";

/** instants chosen to hit the cases the scanner and the interval cache can get wrong */
function instants(zone: string): number[] {
  const out: number[] = [];
  const base = Date.UTC(2026, 0, 1);

  for (let i = 0; i < 200; i++) {
    out.push(base + i * 3_600_000);
  }

  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let i = 0; i < 100; i++) {
    out.push(Math.floor((rnd() * 2 - 1) * 4e12));
  }

  for (let i = 0; i < 25; i++) {
    out.push(Math.floor(rnd() * 6e13) - 63e12); // years 0-100, and BC
  }

  for (let i = 0; i < 25; i++) {
    out.push(base + Math.floor(rnd() * 1000)); // sub-second
  }

  // every real transition, to the millisecond on both sides: a name that moves
  // is a transition, and an interval that reached past one shows up here
  const tz = moment.tz.zone(zone);

  if (tz !== null) {
    for (const until of tz.untils) {
      if (!isFinite(until)) {
        continue;
      }

      out.push(until - 1, until, until + 1, until - 1000, until + 1000);
    }
  }

  // the edges of the Date range, where luxon's own Intl call throws
  out.push(8.64e15, -8.64e15);

  return out;
}

/**
 * A week, plus this zone's next two dozen transitions after 1995, for the locale
 * grid. Capped because the grid multiplies out by locale and style and the stock
 * side of it is ~100µs a value: what this dimension is for is the surround the
 * scanner slices against, which does not vary by instant, and the two dozen
 * cover Cambridge_Bay's pair of Nunavut renames at the front of the window.
 */
function gridPoints(zone: string): number[] {
  return [
    ...Array.from({ length: 14 }, (_, i) => Date.UTC(2026, 0, 1) + i * 43_200_000),
    ...(moment.tz.zone(zone)?.untils ?? [])
      .filter((u) => isFinite(u) && u > Date.UTC(1995, 0, 1))
      .slice(0, 24)
      .flatMap((u) => [u - 1, u]),
  ];
}

const stock = await loadLuxon([]);

// Both reference sets are derived once, here, rather than inside each test.
// Stock luxon is the expensive side by an order of magnitude — it builds a
// formatter per value, which is what A fixed and what these two build on — and
// it is also stateless, so the same strings serve every patch set, every access
// order and every repeat.
const points = new Map(ZONES.map((zone) => [zone, instants(zone)]));

const wantFormatted = new Map(
  ZONES.map((zone) => {
    const luxZone = stock.IANAZone.create(zone);

    return [zone, points.get(zone)!.map((ts) => stock.DateTime.fromMillis(ts, { zone: luxZone }).toFormat(PATTERN))];
  })
);

const wantNames = new Map(
  LOCALES.flatMap((locale) =>
    ZONES.flatMap((zone) => {
      const luxZone = stock.IANAZone.create(zone);

      return STYLES.map((format): [string, (string | null)[]] => [
        `${locale}|${zone}|${format}`,
        gridPoints(zone).map((ts) => offsetNameOf(luxZone, ts, { format, locale })),
      ]);
    })
  )
);

for (const [label, keys] of VARIANTS) {
  describe(label, () => {
    for (const zone of ZONES) {
      test(`${zone} matches stock luxon in every access order`, async () => {
        const list = points.get(zone)!;
        const want = wantFormatted.get(zone)!;
        const orders: number[][] = [
          list.map((_, i) => i),
          [...list.keys()].sort(() => 0.5 - Math.random()),
          [...list.keys()].reverse(),
        ];

        for (const order of orders) {
          // one module instance per patch set, so each order inherits whatever
          // the previous one left in the interval cache — more adversarial than
          // a cold start, and the reason the orders are worth running at all
          const patched = await loadLuxon(keys);
          const luxZone = patched.IANAZone.create(zone);
          const diffs: string[] = [];

          for (const i of order) {
            const got = patched.DateTime.fromMillis(list[i]!, { zone: luxZone }).toFormat(PATTERN);

            if (got !== want[i]) {
              diffs.push(`${list[i]}: "${want[i]}" vs "${got}"`);
            }
          }

          assert.deepEqual(diffs.slice(0, 3), []);
        }
      });
    }

    for (const locale of LOCALES) {
      test(`${locale} reads the same name in every style`, async () => {
        const patched = await loadLuxon(keys);
        const diffs: string[] = [];

        for (const zone of ZONES) {
          const luxZone = patched.IANAZone.create(zone);
          const list = gridPoints(zone);

          for (const format of STYLES) {
            const want = wantNames.get(`${locale}|${zone}|${format}`)!;

            list.forEach((ts, i) => {
              const got = offsetNameOf(luxZone, ts, { format, locale });

              if (got !== want[i]) {
                diffs.push(`${zone} / ${format} / ${ts}: "${want[i]}" vs "${got}"`);
              }
            });
          }
        }

        assert.deepEqual(diffs.slice(0, 3), []);
      });
    }
  });
}
