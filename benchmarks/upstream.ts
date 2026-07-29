// How much of luxon's formatting cost can be removed from outside the library,
// and how much needs a change inside it?
//
// benchmarks/format.ts answered the zone half from the outside: sourcing offsets
// and abbreviations from easy-tz instead of Intl takes a named-zone column from
// ~3x moment-timezone to ~0.9x, and from ~26x to ~0.9x once the pattern includes
// an abbreviation. This bench asks what is left, and whether luxon can have it
// without anyone binding a custom zone.
//
// Profiling the post-easy-tz path (node --cpu-prof) put the remainder in luxon's
// own formatting machinery rather than anything zone-related:
//
//   tokenToString / stringifyTokens   ~24%   walking the token list
//   parseFormat (+ its regex)         ~15%   re-tokenizing the pattern per call
//   PolyNumberFormatter / num         ~13%   per-token formatter allocation
//   garbage collector                  ~9%   consequence of the above
//   Locale construction                ~6%   a fresh Locale per toFormat()
//
// Two ways to attack that, measured side by side here:
//
//   external  a fast path that skips luxon for the patterns a value formatter
//             emits in bulk — the ceiling from outside
//   upstream  patches to luxon itself, all pure memoization or provable
//             short-circuits (benchmarks/patches, one .patch file each)
//
// A second table runs the same ladder against reading dates rather than writing
// them — parsing ISO and Grafana's token formats, with and without an offset in
// the input, plus building a date from a timestamp. The split between the two
// directions is not guessable from the patches: the two biggest formatting wins
// do nothing for parsing, and the zone patches do nearly all of it.
//
// Each build is also reported by what it costs to ship: the minified bytes of
// everything that build bundles. What it costs to hold — rss and Intl formatter
// constructions, profiled one subprocess per row so no build's caches land on
// another's — is behind --footprint, having answered its question once.
//
// Run: node upstream.ts             (no parity scan, ~28s)
//      node upstream.ts --verify    (+ the parity scan, ~35s)
//      bun upstream.ts              (the same under JavaScriptCore, ~35s —
//                                    the reading table costs JSC more, see
//                                    PARSE_PASSES)
//      ... --footprint              (+ rss and Intl counts, ~2.5s)
//
// The three tables can be run alone, which is the loop for iterating on a patch:
// --patches (~1s), --format (~18s, and the findings come with it), --parse (~9s
// under node, ~14s under bun). Any combination works, and naming none runs all
// three. Only a full run writes the JSON that cross-engine.ts reads.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { bakedRules, tablesHost, yearStart } from "./lib/easy-tz.ts";
import { parseCases, parserFor, formatterFor, type BuildSpec, type ParseCase, type ParseCaseKey } from "./lib/build.ts";
import { formatKeys, LOCALE, makeFastFormatter, patternFor, type FormatKey } from "./lib/format-paths.ts";
import { interleavedBest, pkgVersion, runtime, type SampleBudget, type Work } from "./lib/kernel.ts";
import { allTables, tables, withFootprint, withVerify } from "./lib/opts.ts";
import {
  minifiedSize,
  patchedEntry,
  patchKey,
  patchKeys,
  patchLetter,
  patchNeeds,
  patchWhat,
  setId,
  writeEntry,
  type PatchKey,
} from "./lib/patches.ts";
import { printTable } from "./lib/print-table.ts";
import { DateTime } from "./lib/stock.ts";

const N = 20_000; // values the timings are reported per
const STEP_MS = 60_000;

// Interleaved passes per path. Was a fixed 7 with a median; three with a minimum
// resolves as finely, because a minimum needs one clean pass rather than enough
// samples to place a middle. On a host that thermally throttles, cutting the
// window from ~40s to ~18s is itself precision — a median over seven passes
// spanning a throttling episode tracks the episode, which is exactly the drift
// the control rows kept reporting.
//
// The budget is against the AVERAGE path's timed ms, not the slowest: most paths
// here are well inside the pass ceiling (15-170ms against PASS_BUDGET_MS's 400),
// so a budget set by the stock rows would never bind and every format would take
// `max`. 200 stops at `min` while still letting a format whose paths are all
// cheap take a fourth.
const PASSES: SampleBudget = { min: 3, max: 5, budgetMs: 200 };

// Per-pass wall-time budget handed to the kernel's pass sizing. Deliberately
// loose, because shortening a pass costs resolution and this bench attributes
// single patches worth 10-15%: measured against a budget that also caught the
// ladder rungs, the control rows went from ~1% to ~3-9% and the patch ranking
// reshuffled. Everything from `luxon C` down (a full pass costs ~380ms) stays at
// the full N. What it does cut is the unpatched abbr path, which at ~2.1s per
// pass would otherwise spend a third of this benchmark's runtime re-establishing
// the one number nobody disputes.
const PASS_BUDGET_MS = 400;

const BAKE_YEAR = new Date(yearStart).getUTCFullYear();
const BASE_TS = Date.UTC(BAKE_YEAR, 0, 1);
const ZONE = "America/New_York";

// The groupings the report reasons in. Each name is checked against what is
// actually in benchmarks/patches, so renaming a patch file breaks this loudly
// rather than silently measuring a smaller set.
//
// A-D were found by profiling stock luxon, E-H by re-profiling the A-D build.
// A-H are all caches or short-circuits; I is the structural one, and it makes B
// and E redundant by construction (it parses each pattern once and folds
// punctuation into literal runs), which the ACDFGHI row below checks.
const CORE = ["numFast", "parseFormatCache", "zoneInfoCache", "localeIntern"].map(patchKey);
const LATER = ["tokenLoop", "intRoundTo", "padStart2", "tsToObjMath"].map(patchKey);
const CACHES = [...CORE, ...LATER];
const ALL_PATCHES = [...CACHES, patchKey("compileFormat")];
// J and K are the zone lookup rather than the formatter, so the per-patch
// easy-tz rows leave them out: that zone overrides the offset() they patch and
// would time them as noise. The one easy-tz row that does carry them is the full
// one, where the point is what the full upstream build leaves easy-tz to win.
const OFFSET = ["offsetScan", "offsetInterval"].map(patchKey);
// L and M are the zone NAME lookup, and stand to J and K exactly as C stands to
// them: the same two tricks (read the cheap Intl call, then cache it across a
// transition-free span) applied to the other call a zoned format makes. Left out
// of the per-patch easy-tz rows for the same reason as J and K — that zone
// answers offsetName() itself, so neither would be timed doing anything.
const NAME = ["zoneNameScan", "zoneNameInterval"].map(patchKey);
const UPSTREAM = [...ALL_PATCHES, ...OFFSET, ...NAME];

// The letters are the patch files' own, not this file's numbering, so a report
// row and the diff it refers to cannot drift apart.
const LETTER = (k: PatchKey) => patchLetter.get(k)!;

if (UPSTREAM.length !== patchKeys.length) {
  throw new Error(
    `benchmarks/patches holds ${patchKeys.length} patches but this file groups ${UPSTREAM.length}: ` +
      `${patchKeys.filter((k) => !UPSTREAM.includes(k)).join(", ")} unaccounted for`
  );
}

const NO_B_OR_E = ALL_PATCHES.filter((k) => k !== "parseFormatCache" && k !== "tokenLoop");

// The headline result: the six patches that carry the whole win, stacked one at
// a time so each rung's cost is attributable, and then everything else piled on
// top to show what the remaining seven are actually worth once these land.
//
// Ordered by how easy each is to argue for upstream rather than by size: C is a
// one-line cache, J and L are self-contained rewrites of one method each, K and
// M need the tzdata-gap argument accepted, and I is a structural change to the
// Formatter. L and M land after I only because C, J and K were written first and
// the rungs are cumulative — the two pairs are independent of each other.
const LADDER: { id: string; keys: PatchKey[] }[] = [
  { id: "C", keys: ["zoneInfoCache"] },
  { id: "C+J", keys: ["zoneInfoCache", "offsetScan"] },
  { id: "C+J+K", keys: ["zoneInfoCache", "offsetScan", "offsetInterval"] },
  { id: "C+J+K+I", keys: ["zoneInfoCache", "offsetScan", "offsetInterval", "compileFormat"] },
  { id: "C+J+K+I+L", keys: ["zoneInfoCache", "offsetScan", "offsetInterval", "compileFormat", "zoneNameScan"] },
  {
    id: "C+J+K+I+L+M",
    keys: ["zoneInfoCache", "offsetScan", "offsetInterval", "compileFormat", "zoneNameScan", "zoneNameInterval"],
  },
  { id: `all ${UPSTREAM.length} (A-${LETTER(UPSTREAM.at(-1)!)})`, keys: UPSTREAM },
].map((r) => ({ id: `luxon ${r.id}`, keys: r.keys.map(patchKey) }));

/** the everything-applied build, which most of the report quotes something of */
const FULL = LADDER.at(-1)!.id;

/** the same build with easy-tz's zone bound to it, the row the report ends on */
const FULL_EASY = "luxon all + easytz";

// ---- paths under test -------------------------------------------------------

interface Path {
  id: string;
  /** patches applied to the luxon instance, for the report */
  patches: readonly PatchKey[];
  /** whose bundle the bytes column reports; null for the rows that carry no size figure */
  ships: "luxon" | "moment-timezone" | null;
  /** false when the zone still comes from Intl */
  easyZone: boolean;
  /** id of the build this one is an increment over, for the savings the findings quote */
  base: string | undefined;
  /**
   * How to build this row's formatter, when the row is a configuration of a
   * library rather than a hand-written path. The footprint subprocesses are
   * handed this, so what they load is what `make` timed rather than a second
   * description of it.
   */
  spec: ((fmt: FormatKey) => Promise<BuildSpec>) | null;
  make: (fmt: FormatKey) => Promise<(ts: number) => string>;
}

function luxonPath(id: string, patches: readonly PatchKey[], easyZone: boolean, base?: string): Path {
  const spec = async (fmt: FormatKey): Promise<BuildSpec> => ({
    luxonEntry: (await patchedEntry(patches)).pathname,
    easyZone,
    zone: ZONE,
    locale: LOCALE,
    pattern: patternFor("luxon", fmt),
  });

  return { id, patches, ships: "luxon", easyZone, base, spec, make: (fmt) => spec(fmt).then(formatterFor) };
}

const EASY_ZONE_MODULE = new URL("lib/easy-zone.ts", import.meta.url).pathname;

/**
 * What a build ships, for the bytes column: the patched luxon, plus the easy-tz
 * zone binding on the rows that bind it — the baked rules and their 1995+
 * history table are the price of never calling Intl, so a column that left them
 * out would report the two zone strategies as the same size.
 *
 * easy-tz is imported here straight from the vendored bundle rather than through
 * benchmarks/lib/easy-tz.ts as the timed paths are, so that what the bundler
 * walks is the same tree-shakeable module surface a consumer would import — the
 * accessor module also reads a metadata sidecar and enumerates zones, neither of
 * which a build shipping only the zone binding would pull in. The binding itself
 * is the same module the timings run, which is why it takes its lookup as an
 * argument.
 *
 * `export *` rather than importing the handful of names the bench uses, so
 * nothing of luxon is shaken out and the figure stays comparable to the
 * pure-luxon rows above it. The moment baseline is sized the other way round,
 * from the one call it makes, because its bulk is data that no import list
 * shakes out anyway.
 */
async function shippedEntry(path: Path): Promise<URL> {
  if (path.ships === "moment-timezone") {
    // what the baseline row costs to ship is moment-timezone and its packed
    // tzdata, mirroring the call ./lib/build.ts makes for a named zone
    return writeEntry(
      "moment-timezone.ts",
      `import moment from 'moment-timezone';\n` +
        `export const format = (ts: number, zone: string, pattern: string) =>\n` +
        `  moment.tz(ts, zone).format(pattern);\n`
    );
  }

  const entry = await patchedEntry(path.patches);

  if (!path.easyZone) {
    return entry;
  }

  const luxon = JSON.stringify(entry.pathname);

  return writeEntry(
    `easytz-${setId(path.patches)}.ts`,
    `export * from ${luxon};\n` +
      `import { IANAZone } from ${luxon};\n` +
      `import { getTimeZoneAt } from ${JSON.stringify(bakedRules)};\n` +
      `import { makeEasyZoneClass } from ${JSON.stringify(EASY_ZONE_MODULE)};\n` +
      `export const EasyTZZone = makeEasyZoneClass(IANAZone, getTimeZoneAt);\n`
  );
}

const momentSpec = (fmt: FormatKey): Promise<BuildSpec> =>
  Promise.resolve({
    luxonEntry: null,
    easyZone: false,
    zone: ZONE,
    locale: LOCALE,
    pattern: patternFor("moment", fmt),
  });

// Where each patch is attributed matters. All of them save a roughly fixed
// number of ms per value, so measuring one against stock luxon buries it under
// the Intl offset lookup that dominates that build — several patches came out at
// or below the noise floor there. Measured against the easy-tz zone, where that
// lookup is already gone, the same absolute saving is a large enough share of
// the remaining total to resolve. C is the exception: its entire purpose is the
// Intl zone-name path that easy-tz bypasses, so it is only meaningful against
// stock.
const paths: Path[] = [
  {
    // `moment` as an id only, to match the format table's variant naming; the
    // library is moment-timezone, which is what it reports as and is sized as —
    // this calls moment.tz() and formats `z`, neither of which moment core can
    // answer
    id: "moment",
    patches: [],
    ships: "moment-timezone",
    easyZone: false,
    base: undefined,
    spec: momentSpec,
    make: (fmt) => momentSpec(fmt).then(formatterFor),
  },
  luxonPath("luxon (stock)", [], false, undefined),
  // No control for stock, deliberately. A control is the same configuration
  // measured twice, and this configuration is the unpatched abbr path at ~2s a
  // pass — a tenth of the whole benchmark to produce one noise-floor percentage,
  // at the timing scale where relative noise matters least. The two controls
  // below sit where the margins are thin enough to argue about.
  ...LADDER.map((rung, i) => luxonPath(rung.id, rung.keys, false, LADDER[i - 1]?.id ?? "luxon (stock)")),
  // The formatter effort on its own, for contrast with the C+J+K rung: it is the
  // larger diff by far and the smaller win on both formats.
  luxonPath("luxon ABCDEFGHI (formatter only)", ALL_PATCHES, false, "luxon (stock)"),
  luxonPath("easytz zone", [], true, undefined),
  luxonPath("easytz zone (control)", [], true, "easytz zone"),
  ...ALL_PATCHES.filter((k) => k !== "zoneInfoCache").map((k) =>
    luxonPath(`easytz +${LETTER(k)} ${k}`, [k], true, "easytz zone")
  ),
  luxonPath("easytz ABCDEFGH (caches)", CACHES, true, "easytz zone"),
  luxonPath("easytz ABCDEFGHI (all)", ALL_PATCHES, true, "easytz ABCDEFGH (caches)"),
  // the control at the scale of the fastest rows: relative noise is larger down
  // here than it is at the stock row's ~10x slower timings, so the B/E redundancy
  // question below has to be judged against this, not against the control up top
  luxonPath("easytz ABCDEFGHI (control)", ALL_PATCHES, true, "easytz ABCDEFGHI (all)"),
  luxonPath("easytz ACDFGHI (no B/E)", NO_B_OR_E, true, "easytz ABCDEFGHI (all)"),
  // The question the report ends on: if all of them land upstream, is the easy-tz
  // zone still worth binding? It carries J and K even though its zone overrides
  // the offset() they patch, so this row landing on top of A-I + easy-tz is the
  // measurement of that, rather than a claim that they cannot matter here.
  luxonPath(FULL_EASY, UPSTREAM, true, "easytz zone"),
  {
    id: "easytz fast path",
    patches: [],
    // measured for the findings, never tabulated, so never sized or profiled
    ships: null,
    easyZone: true,
    base: "easytz ABCDEFGHI (all)",
    spec: null,
    make: (fmt) => {
      const fast = makeFastFormatter(ZONE, fmt);

      if (fast === null) {
        throw new Error(`no fast path for ${ZONE}/${fmt}`);
      }

      return Promise.resolve(fast);
    },
  },
];

const pathById = (id: string): Path => {
  const path = paths.find((p) => p.id === id);

  if (path === undefined) {
    throw new Error(`no path "${id}"`);
  }

  return path;
};

// ---- measurement ------------------------------------------------------------

let sink = 0;

// paths the kernel timed over fewer than N values and scaled up
const scaledPaths = new Set<string>();
const passCounts = new Set<number>();

/** All paths for one format, timed round-robin so drift lands on everyone equally. */
async function measureAll(fmt: FormatKey): Promise<Map<string, number>> {
  const built = [];

  for (const path of paths) {
    const format = await path.make(fmt);

    built.push({ key: path.id, work: (ts: number) => format(ts).length });
  }

  const { best, checksum, scaled, passes } = interleavedBest(built, BASE_TS, STEP_MS, N, PASSES, PASS_BUDGET_MS);

  sink += checksum;
  passCounts.add(passes);

  for (const id of scaled) {
    scaledPaths.add(id);
  }

  return best;
}

// The baseline is moment-timezone, not moment: a named zone needs its packed
// offset table, and only its `z` token renders an abbreviation. moment core is
// underneath it doing the formatting, so both versions are worth printing —
// reproducing these numbers means installing the pair.
console.log(
  `luxon ${await pkgVersion()} (this fork's src/) vs moment-timezone ${await pkgVersion("moment-timezone")} ` +
    `(on moment ${await pkgVersion("moment")})`
);
console.log(`runtime: ${runtime()}, easy-tz tables: ${tablesHost}, host ICU ${process.versions["icu"] ?? "?"}`);
// The scaling belongs to the format table — the reading table states its own
// under itself, and the patch table times nothing — so a run without the format
// table says only which zone the builds were pointed at.
console.log(
  tables.has("format")
    ? `${ZONE}, ms per ${N} values, fastest of ${PASSES.min}-${PASSES.max} interleaved passes` +
        `${tables.has("parse") ? " (the reading table states its own)" : ""}\n`
    : `${ZONE}\n`
);

// ---- the patches ------------------------------------------------------------
// Minified size per patch, because "worth filing upstream" is a trade against
// shipped bytes and not just ms: a cache that pays for itself in one column of
// values is a different proposition at 200 bytes than at 2 KB. Each patch is
// sized alone against stock, so the column is the patch's own cost rather than
// its position in a stack — except the three written against another's output,
// which are sized including what they need.
//
// Sized in parallel (one `bun build` each, ~60ms) so the whole column costs
// about as much as a single one.

if (tables.has("patches")) {
  const setKey = (keys: readonly PatchKey[]) => keys.join("+");
  const withNeeds = (k: PatchKey): PatchKey[] => [...patchNeeds.get(k)!, k];

  // every set the table needs a number for: each patch over its own base, and
  // each of those bases (stock, for all but the three with a prerequisite)
  const wanted = new Map<string, PatchKey[]>();

  for (const k of UPSTREAM) {
    wanted.set(setKey(withNeeds(k)), withNeeds(k));
    wanted.set(setKey(patchNeeds.get(k)!), [...patchNeeds.get(k)!]);
  }

  const sized = await Promise.all(
    [...wanted].map(async ([id, keys]) => [id, await minifiedSize(await patchedEntry(keys))] as [string, number])
  );
  const sizes = new Map(sized);
  const bytes = (n: number) => n.toLocaleString("en-US");
  const delta = (n: number) => (n < 0 ? bytes(n) : `+${bytes(n)}`);

  const rows: (string[] | null)[] = [
    [`stock luxon ${await pkgVersion()}`, bytes(sizes.get("")!), "--", "the fork's src/, unpatched"],
    null,
    ...UPSTREAM.map((k) => {
      const size = sizes.get(setKey(withNeeds(k)))!;
      const base = sizes.get(setKey(patchNeeds.get(k)!))!;

      return [`${LETTER(k)} ${k}`, bytes(size), delta(size - base), patchWhat.get(k)!];
    }),
  ];

  console.log("candidate upstream patches:\n");
  printTable(["patch", "bytes", "d bytes", "change"], rows, false, [3]);
  console.log(
    `\nbytes is src/ bundled through \`bun build --minify\`, no gzip; d bytes is what the patch adds to it.\n` +
      `C is the only one that pays for itself in bytes too — it deletes a constructor call in favor of a\n` +
      `cache lookup luxon already has. Three of them build on another and cannot be applied alone, so\n` +
      `their rows are the bundle including what they need, and the delta is over that: K on J, L on C,\n` +
      `and M on L (and so on C).\n`
  );
}

// ---- results ----------------------------------------------------------------
// One table for the whole benchmark. Both formats side by side, because they are
// two different problems: the zone-less pattern is bounded by offset() and the
// abbreviated one by the zone name lookup, so a rung that transforms one can do
// nothing at all for the other, and that only reads at a glance on one row.
//
// Raw ms and bytes, with both baselines carrying a row of their own. No ratio
// columns: a ratio against either baseline is a division the reader can do off
// those two rows. The findings below still quote ratios, since prose cannot ask
// for a division.
//
// Everything in `paths` is measured; these are the builds worth a row. The rest
// — one build per individual patch, and the controls that repeat a
// configuration — exist for the findings section's ranking and noise floor, and
// printing every one of them buried the handful that answer the question.

const results = new Map<FormatKey, Map<string, number>>();

if (tables.has("format")) {
  for (const fmt of formatKeys) {
    results.set(fmt, await measureAll(fmt));
  }
}

// enough to expose per-value formatter construction and to fill the caches the
// patches add, without spending 2s of stock luxon's abbr path per row
const FOOTPRINT_N = 2_000;

interface Footprint {
  rssMB: number;
  intl: number;
}

const FOOTPRINT_PROBE = new URL("lib/footprint-probe.ts", import.meta.url).pathname;

/**
 * rss and Intl.DateTimeFormat constructions for one build, in a fresh
 * subprocess. See benchmarks/lib/footprint-probe.ts for why it has to be fresh.
 *
 * Run in the driver's own engine, since a heap figure printed beside V8
 * milliseconds should be V8's heap, and after the timings, so the spawns cannot
 * land in the middle of a timed pass.
 */
async function footprint(path: Path): Promise<Footprint | null> {
  const specs = await Promise.all(formatKeys.map((fmt) => path.spec!(fmt)));
  const args = [FOOTPRINT_PROBE, JSON.stringify(specs), String(FOOTPRINT_N), String(BASE_TS), String(STEP_MS)];

  // node hands over gc() only when asked; bun has Bun.gc unconditionally
  if (process.versions["bun"] === undefined) {
    args.unshift("--expose-gc");
  }

  try {
    const { stdout } = await promisify(execFile)(process.execPath, args, { maxBuffer: 1 << 20 });

    return JSON.parse(stdout) as Footprint;
  } catch {
    // a row that cannot be profiled must not take the timings down with it
    return null;
  }
}

const named = (id: string, label = id) => ({ id, label });

// The rows both result tables carry, shared so the formatting table and the
// parsing one below it are the same builds in the same order — the point of the
// second table is what the ladder does to a different code path, which only
// reads if the ladder is identical.
//
// The ladder keeps only its letters, since the group it sits in is all luxon
// builds; the group below it mixes luxon and easy-tz, so those keep the prefix.
const groups = [
  [named("moment", "moment-timezone"), named("luxon (stock)", "luxon")],
  LADDER.map((r) => named(r.id, r.id.replace("luxon ", ""))),
  // What binding easy-tz's offset() and offsetName() to luxon is worth, before
  // and after the patches: the same two zone methods either way, so the pair
  // isolates the zone from the formatter.
  [named("easytz zone", "luxon + easy-tz"), named(FULL_EASY, "luxon (all) + easy-tz")],
];

const tabulatedPaths = groups.flat().map(({ id }) => pathById(id));

if (tables.has("format")) {
  // Bytes and heap alongside the ms, so a rung can be read as a trade rather
  // than as a speedup alone — the ladder is ordered by how easy each patch is to
  // argue upstream, and what it costs to ship and to hold is part of that
  // argument. Profiled in parallel: rss is what a process allocates, which
  // contention does not change, and the Intl counts are exact.
  const CONTROL = FULL;
  // one build profiled twice, so the columns report their own resolution: rss
  // read after a forced gc is an allocator's answer, not an exact one, and the
  // middle rungs differ by little enough that a reader needs to know by how
  // little
  const [profiled, control] = withFootprint
    ? await Promise.all([
        Promise.all(
          tabulatedPaths.map(async (p) => [p.id, p.spec === null ? null : await footprint(p)] as const)
        ).then((entries) => new Map(entries)),
        footprint(pathById(CONTROL)),
      ])
    : [new Map<string, Footprint | null>(), null];

  const rows: (string[] | null)[] = [];

  for (const group of groups) {
    if (rows.length > 0) {
      rows.push(null);
    }

    for (const { id, label } of group) {
      const path = pathById(id);
      const ms = formatKeys.map((fmt) => results.get(fmt)!.get(id)!);
      const fp = profiled.get(id) ?? null;
      const size = path.ships === null ? "--" : (await minifiedSize(await shippedEntry(path))).toLocaleString("en-US");

      // a row whose subprocess failed says so, rather than taking the timings
      // and everything below them down with it
      const held = !withFootprint
        ? []
        : fp === null
          ? ["err", "err"]
          : [fp.rssMB.toFixed(1), fp.intl.toLocaleString("en-US")];

      rows.push([label, ...ms.map((t) => t.toFixed(1)), ...held, size]);
    }
  }

  console.log(`the ladder in the middle adds one patch per rung to the one above it\n`);

  const heldHeaders = withFootprint ? ["rss MB", "intl instances"] : [];

  printTable(["build", ...formatKeys.map((fmt) => `${fmt} ms`), ...heldHeaders, "bytes"], rows);
  console.log(`\n${formatKeys.map((fmt) => `${fmt}: ${patternFor("moment", fmt)}`).join("   ")}`);
  console.log(`passes taken per format: ${[...passCounts].sort((a, b) => a - b).join(", ")}`);

  // moment core sized on its own, so the baseline row can report how much of
  // itself is the dependency rather than leaving the reader to wonder whether it
  // was counted at all
  const core = await minifiedSize(
    await writeEntry(
      "moment-core.ts",
      `import moment from 'moment';\nexport const format = (ts: number, pattern: string) => moment(ts).format(pattern);\n`
    )
  );

  const controlled = profiled.get(CONTROL);
  const rssFloor =
    control === null || controlled == null ? null : Math.abs(control.rssMB - controlled.rssMB).toFixed(1);

  if (withFootprint) {
    console.log(
      `rss MB and intl instances come from a fresh subprocess per row, formatting ` +
        `${FOOTPRINT_N.toLocaleString("en-US")} values in each\n` +
        `pattern: rss is the growth over a bare runtime, so it carries the build's own load as well as\n` +
        `whatever its caches retain, and intl instances counts every Intl.DateTimeFormat constructed.\n` +
        (rssFloor === null
          ? ""
          : `Profiling \`${CONTROL.replace("luxon ", "")}\` a second time moved rss by ${rssFloor} MB — ` +
            `read that column no finer.\n`)
    );
  } else {
    // the finding survives the columns: it is why C leads the ladder, and unlike
    // every timing here it is exact and the same on both engines
    console.log(
      `rss and Intl.DateTimeFormat counts are not shown — one look at them answered the question. Stock\n` +
        `luxon constructs a formatter per value formatted; every rung from C on constructs three for the\n` +
        `whole run, and moment-timezone none. rss separates the two baselines and little else on V8.\n` +
        `Pass --footprint for both as columns, profiled one subprocess per row (~2.5s).\n`
    );
  }

  console.log(
    `bytes is everything that build ships, bundled and minified together: luxon, plus easy-tz's baked\n` +
      `rules and 1995+ history where they are bound. moment-timezone's row includes moment core\n` +
      `(${core.toLocaleString("en-US")} B of it) and its packed tzdata, which is nearly all of the rest. ` +
      `A webpack build of\n` +
      `that package measures larger, since webpack expands moment's dynamic locale require into every\n` +
      `locale file and bun ships none — this bench formats en-US only.\n`
  );
}

if (tables.has("format") && scaledPaths.size > 0) {
  console.log(
    `note: ${scaledPaths.size} of the ${paths.length} builds measured cost enough per value that timing ` +
      `${N} of them takes\n~2s a pass, or ~${(2 * PASSES.min * scaledPaths.size).toFixed(0)}s of this benchmark ` +
      `across their passes. Those are timed over fewer\nvalues and scaled to ${N}; their per-value cost is flat ` +
      `in the pass length, so the ratios stand.\nEvery other build is timed over the full ${N}, and each control ` +
      `exactly like what it controls.\n`
  );
}

// ---- reading dates ----------------------------------------------------------
// The same ladder against the other direction: parsing a date, and building one
// from a timestamp. Formatting is where the profiling started, but an app that
// renders a date usually read one first — Grafana parses every time range in the
// URL, and every value a user types into a picker.
//
// Worth a table of its own because the patches split unevenly across the two
// directions, and the split is not guessable from the patch descriptions. Some
// are formatter-only by construction (I compiles a format string to handlers; C
// caches the zone-NAME lookup, which no parse performs). Some are shared
// machinery that parsing happens to route through (B memoizes the tokenizer both
// directions use; D interns Locales that both build). And J/K are the zone's
// offset(), which every zoned parse needs before it can place a local time.
//
// The columns are the shapes a caller actually has, not a sweep: an ISO string
// with and without an offset on it, Grafana's two token formats likewise, and a
// timestamp. The pair that differ only in whether the input carries an offset is
// the interesting one — with no offset the zone has to resolve the local time,
// which is the work easy-tz replaces, and with one the parse can skip it.

// A parse costs 3-40µs a value against formatting's ~5-100µs, and there are 50
// cells here (five shapes, the nine builds, and the control), so a per-pass
// budget set like the formatting table's would spend a third of this benchmark
// re-reading strings. Every cell is sized to this instead, which means none of
// them completes the full `N` and all are scaled up from what fits. Sound here
// for the reason the kernel gives: per-value cost is flat in the pass length,
// and neither library caches by input string, so a shorter pass is the same work
// per value.
const PARSE_BUDGET_MS = 40;

// A fixed pass count rather than the formatting table's budget-driven 3-5: that
// budget is spent per pass, so a table of passes this short clears it slowly and
// every cell would take the maximum regardless — 5 passes for 60% more runtime
// than the methodology asks for.
//
// How to spend a cell was measured rather than assumed. Three 45ms passes, six
// 25ms ones and four 40ms ones all cost about the same; under node the control
// disagreed with its twin by ~2%, ~2% and ~1.3% at the median. Four 40ms passes
// wins on two counts beyond the median: 40ms is the kernel's own floor for a
// pass worth believing, and it leaves the slowest cells around 700 values a
// pass, where a 25ms budget put them on the kernel's small-`n` floor of 500 —
// the count below which it measured a path 40% high.
//
// JavaScriptCore needs nearly twice as many. Passes this short are also short in
// VALUES for the expensive cells (~700), and JSC's ramp to its optimizing tier
// is the longer of the two, so four passes there can leave every one of them
// partly tiered: its control came back up to 19% out, against node's ~1.3%.
// Seven puts it back in line (~2.4% at the median). Engine-specific because the
// cost is engine-specific — spending node's budget the same way would buy
// nothing.
const PARSE_PASSES: SampleBudget = {
  min: process.versions["bun"] === undefined ? 4 : 7,
  max: process.versions["bun"] === undefined ? 4 : 7,
  budgetMs: 0,
};

// Distinct inputs per case, cycled if a pass wants more values than this (the
// cheap cells are given several times `N` to reach a timeable pass). Neither
// library caches by input string, so a repeat costs what a first read costs.
const PARSE_POOL = 4_096;

// Rendered once, ahead of every timed loop, by the fork's own unpatched src/:
// the builds differ in how fast they READ a string, not in what the string says,
// so one pool per case serves all of them and no build is timed generating its
// own input. The patches are behavior-preserving (the parity scan below is what
// establishes that), so this is also what any of them would have written.
function inputPool(kase: ParseCase): string[] | null {
  if (kase.input === "millis") {
    return null;
  }

  return Array.from({ length: PARSE_POOL }, (_, i) => {
    const dt = DateTime.fromMillis(BASE_TS + i * STEP_MS, { zone: ZONE, locale: LOCALE });

    switch (kase.input) {
      case "iso-local":
        return dt.toISO({ includeOffset: false })!;
      case "iso-offset":
        return dt.toISO()!;
      default:
        return dt.toFormat(kase.input);
    }
  });
}

type Parse = (ts: number, input: string) => number;

/** The instant the loop is on, paired with its rendered input. */
const workFor =
  (parse: Parse, pool: readonly string[] | null): Work =>
  pool === null
    ? (ts) => parse(ts, "")
    : (ts) => parse(ts, pool[((ts - BASE_TS) / STEP_MS) % pool.length]!);

const parseResults = new Map<ParseCaseKey, Map<string, number>>();
// the fully patched build, measured a second time as its own neighbour, so each
// column reports the resolution it was read at rather than implying more
const PARSE_CONTROL = "control";
const parseControl = new Map<ParseCaseKey, number>();
// values each cell was actually timed over, for the note: this table's cells are
// all shorter than `N`, so it says what they really ran rather than implying it
const parseSizes: number[] = [];
const parsePasses = new Set<number>();
// instants whose parse is checked before anything is timed: a build that cannot
// read one of these shapes would otherwise post the best number in its column,
// and reading nothing is very fast. Every instant here is a whole minute, so all
// five shapes round-trip exactly — including the token format with no
// milliseconds in it.
const PARSE_CHECKS = [0, 1, 500, 1_501, PARSE_POOL - 1];
const parseBroken: string[] = [];

for (const kase of tables.has("parse") ? parseCases : []) {
  const pool = inputPool(kase);
  const entries: { key: string; work: Work }[] = [];

  for (const path of [...tabulatedPaths, pathById(FULL)]) {
    // the spec carries the formatting pattern too, which parsing has no use for
    const parse = await parserFor(await path.spec!(formatKeys[0]!), kase);
    const key = entries.some((e) => e.key === path.id) ? PARSE_CONTROL : path.id;

    for (const i of PARSE_CHECKS) {
      const ts = BASE_TS + i * STEP_MS;
      const got = parse(ts, pool?.[i] ?? "");

      if (got !== ts) {
        parseBroken.push(`${key} / ${kase.key}: read ${got} for ${ts} (d${got - ts})`);
      }
    }

    entries.push({ key, work: workFor(parse, pool) });
  }

  const { best, checksum, sizes, passes } = interleavedBest(
    entries,
    BASE_TS,
    STEP_MS,
    N,
    PARSE_PASSES,
    PARSE_BUDGET_MS
  );

  // NaN here would mean a parse failed inside a timed loop, which the checks
  // above only sample for
  if (!Number.isFinite(checksum)) {
    throw new Error(`parse checksum for ${kase.key} is not finite — a timed parse returned NaN`);
  }

  sink += checksum % 1_000;
  parsePasses.add(passes);

  for (const n of sizes.values()) {
    parseSizes.push(n);
  }

  parseControl.set(kase.key, best.get(PARSE_CONTROL)!);
  best.delete(PARSE_CONTROL);
  parseResults.set(kase.key, best);
}

if (tables.has("parse")) {
  const rows: (string[] | null)[] = [];

  for (const group of groups) {
    if (rows.length > 0) {
      rows.push(null);
    }

    for (const { id, label } of group) {
      rows.push([label, ...parseCases.map((kase) => parseResults.get(kase.key)!.get(id)!.toFixed(1))]);
    }
  }

  console.log(`reading a date: the same builds, parsing instead of formatting\n`);
  printTable(["build", ...parseCases.map((kase) => `${kase.key} ms`)], rows);

  // the control's disagreement with its own twin, which is the floor under every
  // difference in the table — the ladder's parse-side steps are smaller than its
  // formatting ones, so this is what separates a real step from a coincidence
  const floors = parseCases.map((kase) => {
    const twin = parseControl.get(kase.key)!;
    const main = parseResults.get(kase.key)!.get(FULL)!;

    return (Math.abs(twin - main) / Math.min(twin, main)) * 100;
  });

  console.log(
    `\n${parseCases.map((kase) => `${kase.key}: ${kase.what}`).join("\n")}\n\n` +
      `Also ms per ${N} values, though no cell runs exactly that many: each is timed over what fits a\n` +
      `${PARSE_BUDGET_MS}ms pass and scaled to ${N} — ${Math.min(...parseSizes).toLocaleString("en-US")} values ` +
      `for the slowest cell, ${Math.max(...parseSizes).toLocaleString("en-US")} for the cheapest, which\n` +
      `needs that many to be timeable at all — fastest of ` +
      `${[...parsePasses].sort((a, b) => a - b).join("/")} interleaved passes. Inputs are rendered\n` +
      `ahead of every loop and read from a pool of ${PARSE_POOL.toLocaleString("en-US")}, cycled, since neither ` +
      `library caches by\ninput string. Each cell is checked against the instant it was rendered from before ` +
      `being timed,\nsince a build that cannot read a shape would post the best number in its column.\n\n` +
      `Each column carries its own resolution: the fully patched build was measured twice, as its own\n` +
      `neighbour, and the two readings came out this far apart. Read a column no finer than its figure,\n` +
      `and treat one that is well above the others as a column this run measured badly.\n\n` +
      `  ${parseCases.map((kase, i) => `${kase.key} ${floors[i]!.toFixed(1)}%`).join("   ")}\n`
  );
}

if (parseBroken.length > 0) {
  console.log(`PARSE MISMATCH — these cells did not read back the instant they were given:`);

  for (const line of parseBroken) {
    console.log(`  ${line}`);
  }

  console.log();
}

// ---- agreement --------------------------------------------------------------
// The patches are supposed to be behavior-preserving, so every patched path must
// match stock luxon byte for byte. The easy-tz paths are expected to differ on
// abbreviations (easy-tz supplies a tzdata-style abbreviation where ICU returns
// a "GMT-5" fallback — established in benchmarks/format.ts), so those rows are
// informational rather than pass/fail.
//
// Opt-in (--verify): 20k values per path per format, which the timings do not
// need. It is still the only check that covers all 13 patches — the tests in
// benchmarks/test/ cover the offset and zone-name ones — so it has to pass
// before any is argued for upstream.
//
// Every hour is compared here, unlike the agreement scan in benchmarks/format.ts
// which samples runs of constant offset and abbreviation. That shortcut is sound
// for three unpatched implementations reading a table and unsound here: most of
// these patches are caches, so what a path answers depends on which instants it
// was asked about before, and the dense walk in instant order IS the stimulus.
// Sampling every twelfth hour would exercise a different sequence of cache
// states than any real formatting loop, so a narrow wrong answer could hide in
// the values never asked for.

if (tables.has("format") && !withVerify) {
  console.log(
    `output parity vs stock luxon skipped — pass --verify to run it (~7s, near enough the same on\n` +
      `both engines now that the reference strings are derived once instead of per path).\n`
  );
}

if (tables.has("format") && withVerify) {
  const PARITY_N = 20_000;
  const PARITY_STEP = 3_600_000;
  const rows: (string[] | null)[] = [];
  let patchedMismatches = 0;

  for (const fmt of formatKeys) {
    const reference = await luxonPath("ref", [], false).make(fmt);

    // Materialized once rather than called inside each path's loop. It is stock
    // luxon, the slowest formatter here by 20x on `abbr`, and re-deriving the
    // same 20k strings for all 23 paths was the single largest cost in this
    // benchmark — more than every timed pass put together.
    const expect = Array.from({ length: PARITY_N }, (_, i) => reference(BASE_TS + i * PARITY_STEP));

    for (const path of paths) {
      // Control rows exist to put a noise floor under the TIMING columns by
      // measuring one configuration twice. Same module, same patch set, so their
      // output is the row they control's output and comparing it again only
      // costs a fifth of this section.
      if (path.id === "luxon (stock)" || path.id.includes("control")) {
        continue;
      }

      const format = await path.make(fmt);
      let diff = 0;

      for (let i = 0; i < PARITY_N; i++) {
        if (format(BASE_TS + i * PARITY_STEP) !== expect[i]) {
          diff++;
        }
      }

      const expected = path.easyZone && fmt === "abbr" ? "by design" : "must be 0";

      if (expected === "must be 0") {
        patchedMismatches += diff;
      }

      rows.push([`${fmt} / ${path.id}`, String(diff), expected]);
    }

    if (fmt !== formatKeys.at(-1)) {
      rows.push(null);
    }
  }

  console.log(`output vs stock luxon — mismatching values out of ${PARITY_N} (hourly)\n`);
  printTable(["format / path", "mismatches", "expectation"], rows);

  console.log(
    patchedMismatches === 0
      ? `\nall ${UPSTREAM.length} patches are output-identical to stock luxon; the only differences are the\n` +
          `intended easy-tz abbreviations.`
      : `\nFAIL: ${patchedMismatches} unexpected mismatch(es) — a patch changed behavior.`
  );

  if (patchedMismatches > 0) {
    process.exitCode = 1;
  }
}

// ---- findings ---------------------------------------------------------------

// The paragraphs about the reading table, held apart from the rest because the
// two tables can be run separately: they belong inside the findings below when
// both ran, they are the whole of the findings when only `parse` did, and they
// quote cells that do not exist when it did not.
let reading = "";

if (tables.has("parse")) {
  /** a cell of the reading table */
  const read = (kase: ParseCaseKey, id: string) => parseResults.get(kase)!.get(id)!;
  const readMs = (kase: ParseCaseKey, id: string) => read(kase, id).toFixed(0);
  const readX = (kase: ParseCaseKey, a: string, b: string) => `${(read(kase, a) / read(kase, b)).toFixed(1)}x`;

  reading = `
Reading dates was never what any of this was aimed at, and the reading table shows
where that leaves it. The biggest formatting wins do nothing there: C, L and M are
all the zone-NAME lookup and no parse performs one, I compiles a format string and
no parse walks one, so all four sit within noise of stock in every parse column.
The name patches are the clearest case of it — they take two thirds off the
abbreviated format above and move no parse column at all. J and K carry the entire
parse-side improvement instead — they are offset(), which every zoned parse needs
before it can place a local time — taking an ISO string without an offset from
${readMs("iso", "luxon (stock)")}ms to ${readMs("iso", "luxon C+J+K")}ms and a bare timestamp from ${readMs("millis", "luxon (stock)")}ms to ${readMs("millis", "luxon C+J+K")}ms.
That makes the input's shape decide what any of it is worth: an ISO string
carrying its own offset needs the zone barely at all (stock reads it in ${readMs("iso+off", "luxon (stock)")}ms
against ${readMs("iso", "luxon (stock)")}ms without), so on that column the ladder has much less to remove.

Which is also where easy-tz's zone lands hardest. It beats the entire patch set on
the zone-bound column (${readMs("iso", "easytz zone")}ms against ${readMs("iso", FULL)}ms fully patched, ${readX("iso", "luxon (stock)", "easytz zone")} off stock) and it
flattens the difference between the two ISO shapes to nothing — with the offset
lookup that cheap, a string that supplies its own stops being an advantage. What
neither reaches is moment-timezone on token parsing: fully patched luxon still
needs ${readMs("tokens", FULL)}ms against moment-timezone's ${readMs("tokens", "moment")}ms on Grafana's own format, because that
path is bounded by luxon's tokenizer rather than by anything a zone does. On the
other three shapes the patched builds are ahead, and on a bare timestamp it is not
close: ${readMs("millis", FULL)}ms against ${readMs("millis", "moment")}ms.
`;
}

if (tables.has("format")) {
  const abbr = results.get("abbr")!;
  const num = results.get("numeric")!;

  /** what a build saves over the one it was an increment over (Path.base) */
  const saved = (ms: Map<string, number>, id: string) => {
    const over = ms.get(pathById(id).base!)!;

    return `${(((over - ms.get(id)!) / over) * 100).toFixed(0)}%`;
  };

  const noiseBetween = (a: string, b: string) =>
    Math.max(...[num, abbr].map((ms) => Math.abs(ms.get(a)! - ms.get(b)!) / ms.get(a)!));

  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

  /**
   * Every patch except C, ranked by what it saves on the easy-tz numeric path
   * and bucketed against the noise floor. Computed rather than asserted in
   * prose, because the ranking is not the same on V8 and JavaScriptCore.
   */
  function tiers(): string {
    const zone = num.get("easytz zone")!;
    const floor = Math.abs(zone - num.get("easytz zone (control)")!) / zone;

    const ranked = ALL_PATCHES.filter((k) => k !== "zoneInfoCache")
      .map((k) => ({
        label: `${LETTER(k)} ${k}`,
        save: (zone - num.get(`easytz +${LETTER(k)} ${k}`)!) / zone,
      }))
      .sort((a, b) => b.save - a.save);

    const bucket = (s: number) =>
      s >= Math.max(3 * floor, 0.04) ? "worth keeping" : s >= Math.max(1.5 * floor, 0.02) ? "marginal" : "at noise";

    return ["worth keeping", "marginal", "at noise"]
      .map((name) => {
        const hits = ranked.filter((r) => bucket(r.save) === name);

        return `  ${`${name}:`.padEnd(16)}${hits.length === 0 ? "--" : hits.map((r) => `${r.label} ${pct(r.save)}`).join(", ")}`;
      })
      .join("\n");
  }

  const noiseMid = noiseBetween("easytz zone", "easytz zone (control)");
  const noiseFast = noiseBetween("easytz ABCDEFGHI (all)", "easytz ABCDEFGHI (control)");

  const ratio = (ms: Map<string, number>, id: string) => (ms.get(id)! / ms.get("moment")!).toFixed(2);

  // ladder rungs are always quoted the same two ways below: a percentage against
  // stock, and this rung's own contribution in ms
  const rungs = ["luxon (stock)", ...LADDER.map((r) => r.id)];
  const cum = (ms: Map<string, number>, id: string) => pct(1 - ms.get(id)! / ms.get("luxon (stock)")!);
  const step = (ms: Map<string, number>, id: string) => (ms.get(rungs[rungs.indexOf(id) - 1]!)! - ms.get(id)!).toFixed(0);

  console.log(`
findings (noise floor from two configurations measured twice each, which the table
above does not report: ~${pct(noiseMid)} at the easy-tz zone and ~${pct(noiseFast)} at the fully patched — the
two timing scales where a patch's margin is close enough to the floor to matter)

C is the one that matters and is barely an optimization: parseZoneInfo built a
fresh Intl.DateTimeFormat per value, so any pattern containing a zone name paid
formatter construction per formatted value. Routing it through luxon's existing
getCachedDTF saves ${saved(abbr, "luxon C")} of that format's cost — ${(abbr.get("luxon (stock)")! / abbr.get("moment")!).toFixed(1)}x moment-timezone
down to ${(abbr.get("luxon C")! / abbr.get("moment")!).toFixed(1)}x — as a one-line change.

I is the biggest single patch: ${saved(num, "easytz +I compileFormat")} of the numeric format against the easy-tz zone,
more than any one cache. Compiling a pattern to handlers once removes three costs
together — the ~70-case switch per token per value, the eight closures
formatDateTimeFromString built per call, and the Intl options object literals its
branches allocated — and folds punctuation into literal runs so separators cost a
concat. It is not a substitute for the caches, though: those still come to
${saved(num, "easytz ABCDEFGH (caches)")} between them, and I adds ${saved(num, "easytz ABCDEFGHI (all)")} on top of all of them.

The rest are individually modest, and which of them are worth keeping is engine
dependent — cross-engine.ts runs this under both and diffs the two. Sorted by what
they save here, against the easy-tz zone on the numeric format with a ~${pct(noiseMid)} noise
floor:

${tiers()}

I should also make B and E redundant by construction, since it parses each pattern
once and folds punctuation into literal runs. Building ACDFGHI supports that:
dropping both moves numeric by ${saved(num, "easytz ACDFGHI (no B/E)")} (positive meaning faster without them), against
~${pct(noiseFast)} noise at that timing scale, and the sign is not stable across runs. Keep B
if it is already written; do not write it for I's sake.

C, J, L and I are the shippable core on any engine — all four remove an Intl call
or most of one, which no engine can be fast at. Of the rest, cross-engine puts B
above the floor on both V8 and JavaScriptCore and leaves A, D and H helping V8 and
not JavaScriptCore, with E, F and G clearing neither — a single run of this file
cannot tell those apart, so do not read the buckets above as a ship list on their
own. H is the only patch that rewrites logic rather than adding a cache, and is
verified against Date's own getters over 200k random instants across the full
range.

Reading the ladder: each rung is bounded by one of the two Intl calls a zoned
format makes, and which format it helps says which call it removed. C, J and K
all attack the offset: C caches the formatter, J reads it the cheap way, K stops
calling it. That takes ${cum(num, "luxon C+J+K")} of stock off numeric — a pattern with no zone
name in it has nothing else left to pay for — and ${cum(abbr, "luxon C+J+K")} off abbr, which is
still bounded by the name lookup no matter how cheap the offset gets.

L and M are those same two tricks aimed at the name, and they are what unbounds
the second format. L reads it out of dtf.format() instead of allocating a part
per field and walking them (${step(abbr, "luxon C+J+K+I+L")}ms off abbr, 4.7x on the lookup in isolation),
and M then caches it across the interval two probes prove transition-free
(${step(abbr, "luxon C+J+K+I+L+M")}ms more). Between them the abbreviated format goes from ${abbr.get("luxon C+J+K+I")!.toFixed(0)}ms to
${abbr.get("luxon C+J+K+I+L+M")!.toFixed(0)}ms, and neither costs numeric anything, because a pattern without a
zone name never asks. I compiles the pattern and is the one rung that helps both
(${step(num, "luxon C+J+K+I")}ms and ${step(abbr, "luxon C+J+K+I")}ms).

Ordering matters to how these read, and the ms column is the honest one: C alone
takes ${(abbr.get("luxon (stock)")! - abbr.get("luxon C")!).toFixed(0)}ms off the abbreviated format, more than everything the six rungs
below it remove from both formats put together (${(
    num.get("luxon C")! -
    num.get(FULL)! +
    (abbr.get("luxon C")! - abbr.get(FULL)!)
  ).toFixed(0)}ms). Arriving fourth, I removes
less than any rung above it despite being the largest formatter win in isolation.
${reading}
The last rung answers whether the other seven still matter once these six land.
They are worth nearly the same on both formats — ${step(num, FULL)}ms on numeric and ${step(abbr, FULL)}ms on
abbr — which is what you would expect from per-value formatter costs that do not
care which zone path ran, and it is ${pct((num.get("luxon C+J+K+I+L+M")! - num.get(FULL)!) / num.get("luxon (stock)")!)} and ${pct((abbr.get("luxon C+J+K+I+L+M")! - abbr.get(FULL)!) / abbr.get("luxon (stock)")!)} of stock. So the six rungs
carry the result, and the seven are a tidy-up worth taking only if C, J, K, I, L
and M are already in.

K and M are the two with a precondition rather than a proof from first
principles: both assume nothing changes and changes back inside one 2-day probe
window. K needs that of the offset, where the tightest gap in all of tzdata is
6.92 days (America/Cambridge_Bay, Oct-Nov 2000) across all 219,232 transitions
moment-timezone ships. M needs it of the name, which is the stricter claim — a
zone can be renamed without moving, which is what Cambridge_Bay did in 2000 — and
measured against the runtime's own ICU rather than a bundled copy that bound is
6.96 days, so both margins are 3.5x. The failure mode if tzdata ever tightened
past either is a stale offset or a stale name rather than a crash. J and L have no
such precondition and are worth filing regardless.

Stacked, all of it takes the easy-tz path from ${ratio(num, "easytz zone")}x moment-timezone to ${ratio(num, FULL_EASY)}x and
stock luxon from ${ratio(num, "luxon (stock)")}x to ${ratio(num, FULL)}x, without touching a public API or changing a byte
of output — verified across every token in the switch, all macro tokens, four
zones and four locales including a non-gregory calendar with non-latn digits, and
for the name patches over ten zones, five locales and all six timeZoneName styles
either side of every modern transition (benchmarks/test/zone-name-patches.test.ts).

That answers the question the last two rows of the table are for: same patches on
both sides, so the only difference is where the zone comes from. It used to be
pattern-dependent, and with L and M it is not — the full upstream build is level
with the easy-tz-bound one on both formats (${ratio(num, FULL)}x vs ${ratio(num, FULL_EASY)}x on numeric, ${ratio(abbr, FULL)}x vs
${ratio(abbr, FULL_EASY)}x on abbr), where before them easy-tz was an order of magnitude ahead on
abbreviations. A luxon carrying all six would leave easy-tz nothing to win inside
luxon's Formatter, on either kind of pattern. Skipping the Formatter entirely for
the patterns a value formatter emits in bulk — easy-tz's own fast path, measured
but not tabulated — is a further ${(num.get(FULL_EASY)! / num.get("easytz fast path")!).toFixed(1)}x beyond even that, and is where the remaining
case for it lives.

Recommended to file, in order: C, J and L first — all three are self-contained and
none needs a design argument. C and J together take stock luxon from ${ratio(num, "luxon (stock)")}x moment
to ${ratio(num, "luxon C+J")}x on numeric, and L is the same shape of change on the other Intl call,
worth ${step(abbr, "luxon C+J+K+I+L")}ms of abbr at the rung it lands on. Then K and M, which share the
tzdata-gap argument and are the same patch twice, so accepting it once buys both.
Then I: the largest single win of the six in isolation, and last anyway, because
it is the one that changes how the Formatter is built rather than what it calls.
The remaining seven are not worth filing separately.`);
} else if (reading !== "") {
  // A `--parse` run still gets the part of the findings it measured. The rest
  // ranks patches by what they save on a formatting path, and there is nothing
  // honest to say about that ranking without those timings.
  console.log(`findings (reading only — the patch ranking comes from the format table)\n${reading}`);
}

// ---- machine-readable results -----------------------------------------------
// benchmarks/cross-engine.ts runs this file under node and bun and diffs the
// two, since the small patches do not rank the same on V8 and JavaScriptCore.
//
// Only written by a full run: cross-engine reads these files back by name, and a
// file left behind by a single-table run would silently answer with the tables
// that run happened to skip.

if (allTables) {
  const tag = process.versions["bun"] === undefined ? "node" : "bun";
  const dir = new URL(".tmp/", import.meta.url);

  await mkdir(dir, { recursive: true });
  await writeFile(
    new URL(`upstream-${tag}.json`, dir),
    JSON.stringify(
      {
        runtime: runtime(),
        icu: process.versions["icu"] ?? null,
        ms: Object.fromEntries([...results].map(([fmt, ms]) => [fmt, Object.fromEntries(ms)])),
        // the reading table, same shape. Nothing diffs these across engines yet;
        // they are written because they were measured, and because which patches
        // pay off on the parse path is exactly the kind of thing the two engines
        // could disagree about.
        parse: Object.fromEntries([...parseResults].map(([kase, ms]) => [kase, Object.fromEntries(ms)])),
      },
      null,
      2
    )
  );
}

if (sink < 0) {
  throw new Error("unreachable");
}
