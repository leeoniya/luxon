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
// The ladder carries reading columns alongside the writing ones — parsing ISO
// and Grafana's token formats, with and without an offset in the input, plus
// building a date from a timestamp. Worth carrying because the split between the
// two directions is not guessable from the patches: the two biggest formatting
// wins do nothing for parsing, and the zone patches do nearly all of it.
//
// And a third band beyond both, `other`: arithmetic, Duration, Interval and Info
// — everything that neither writes a string nor reads one. Those were a table of
// their own until the patch set outgrew the two directions. H replaces the
// Duration round trip inside adjustTime, I stops toRelative asking for diffs it
// can already answer, and J trims three allocations from under the setters; none
// of the three is reachable from a format string or a parse, and all were found
// by profiling rather than by any column here. The cases are in
// lib/api-cases.ts and the reading of them is in benchmarks/docs/coverage.md.
//
// Each build is also reported by what it costs to ship: the minified bytes of
// everything that build bundles. What it costs to hold — rss and Intl formatter
// constructions, profiled one subprocess per row so no build's caches land on
// another's — is behind --footprint, having answered its question once.
//
// Run: node upstream.ts             (no parity scan, ~95s)
//      node upstream.ts --verify    (+ the parity scan, ~102s)
//      bun upstream.ts              (the same under JavaScriptCore, ~105s —
//                                    the ladder's reading half costs JSC more, see
//                                    PARSE_PASSES)
//      ... --footprint              (+ rss and Intl counts, ~2.5s)
//
// The three tables can be run alone, which is the loop for iterating on a patch:
// --patches (~1s), --ladder (~80s under node, ~90s under bun — the reading half
// costs JSC more, see PARSE_PASSES), --default (~13s). Any combination works,
// and naming none runs all three. Only a full run writes the JSON that
// cross-engine.ts reads.
//
// The first two name a zone. --default is the same ladder with none named, which
// is the configuration a caller who never sets one gets and the only one where
// SystemZone rather than IANAZone answers the offset.
//
// What the numbers mean is in benchmarks/docs/upstream.md rather than in this
// file's output — patch by patch, plus E's tzdata precondition and the order to
// file them in. This file prints tables.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { bakedRules, tablesHost, yearStart } from "./lib/easy-tz.ts";
import { API_CASES, defaultMomentShape, type ApiBand, type ApiCase } from "./lib/api-cases.ts";
import {
  momentFor,
  momentRole,
  parseCases,
  parserFor,
  formatterFor,
  type BuildSpec,
  type ParseCase,
  type ParseCaseKey,
} from "./lib/build.ts";
import { LOCALE, localeFor, patternFor, zoneFormatKeys, type FormatKey } from "./lib/format-paths.ts";
import {
  LEAN_BUDGET,
  LEAN_BUDGET_MS,
  cooldown,
  measureRows,
  pkgVersion,
  runtime,
  timeLoop,
  type SampleBudget,
  type Work,
} from "./lib/kernel.ts";
import type { LuxonModule } from "./lib/luxon-types.ts";
import { allTables, cooldownMs, tables, withFootprint, withVerify } from "./lib/opts.ts";
import {
  droppedPatches,
  hasPatch,
  loadLuxon,
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
import { colorEnabled, colorLegend, shade } from "./lib/color.ts";
import { printTable } from "./lib/print-table.ts";
import { streamTable } from "./lib/stream-table.ts";
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
// reshuffled. Everything from `luxon A` down (a full pass costs ~380ms) stays at
// the full N. What it does cut is the unpatched abbr path, which at ~2.1s per
// pass would otherwise spend a third of this benchmark's runtime re-establishing
// the one number nobody disputes.
const PASS_BUDGET_MS = 400;

const BAKE_YEAR = new Date(yearStart).getUTCFullYear();
const BASE_TS = Date.UTC(BAKE_YEAR, 0, 1);
const ZONE = "America/New_York";

/** where the prose went; every table points at it rather than restating it */
const DOCS = "benchmarks/docs";

// The groupings the report reasons in. Each name is checked against what is
// actually in benchmarks/patches, so renaming a patch file breaks this loudly
// rather than silently measuring a smaller set.
//
// A and the first of G's six were found by profiling stock luxon, the rest of
// G's by re-profiling that build, and H, I and J by profiling the build with all
// of them in. A, F and G through J are caches or short-circuits; K is the
// structural one, and it makes two of G's six redundant by construction (it
// parses each pattern once and folds punctuation into literal runs).
//
// Named through `inPlay` rather than `patchKey` directly because `--drop` can
// take any of them out from under this file, and a group that threw on a patch
// this run is not measuring would make the flag unusable for the patch it is
// most useful on.
const inPlay = (names: string[]) => names.filter(hasPatch).map(patchKey);

const CACHES = inPlay(["zoneInfoCache", "localeIntern", "numericPath", "arithDirect", "relativeSkip", "trimAllocs"]);
const ALL_PATCHES = [...CACHES, ...inPlay(["compileFormat"])];
// B is the zone lookup rather than the formatter.
const OFFSET = inPlay(["offsetScan"]);
// D is the zone NAME lookup, and stands to B exactly as A stands to it: the same
// trick (read the cheap Intl call) applied to the other call a zoned format
// makes. E then caches both across a transition-free span.
const NAME = inPlay(["zoneNameScan"]);
// C is the only patch here on the reading side: it touches fromFormat and no
// format path reaches it. The ladder's reading columns are where it shows, and
// it has a rung of its own.
const PARSE = inPlay(["tokenParserCache"]);
const UPSTREAM = [...ALL_PATCHES, ...OFFSET, ...NAME, ...PARSE, ...inPlay(["transitionInterval"])];

// The letters are the patch files' own, not this file's numbering, so a report
// row and the diff it refers to cannot drift apart.
const LETTER = (k: PatchKey) => patchLetter.get(k)!;

/** Whether a sorted letter list has no gaps, i.e. whether a range would be true of it. */
const contiguous = (letters: readonly string[]) =>
  letters.every((l, i) => i === 0 || l.charCodeAt(0) === letters[i - 1]!.charCodeAt(0) + 1);

/**
 * A rung's label: every letter it holds, spelled out.
 *
 * Ranges and an "all but X" for the rung one short of the set both read shorter,
 * and both were here. Together they put three notations in one column, so a
 * reader working out what "A-D" held had to first notice it was not "A+B+C" or
 * "all but K" — and the only thing this column exists to say is which patches a
 * row carries. Spelling them out is longer and cannot be misread, and the widest
 * label is the second-to-last row, which is not wide.
 */
const rungLabel = (keys: readonly PatchKey[]) => keys.map(LETTER).sort().join("+");

if (UPSTREAM.length !== patchKeys.length) {
  throw new Error(
    `benchmarks/patches holds ${patchKeys.length} patches but this file groups ${UPSTREAM.length}: ` +
      `${patchKeys.filter((k) => !UPSTREAM.includes(k)).join(", ")} unaccounted for`
  );
}

// The headline result: stacked one patch at a time so each rung's cost is
// attributable, and then everything piled on to show what the rest is worth once
// these land.
//
// Ordered by how easy each is to argue for upstream rather than by size: A and F
// are caches, B and D are self-contained rewrites of one method each, C is a
// memoization of an object luxon already hands out through buildFormatParser, E
// needs the tzdata-gap argument accepted, and G through J are sets of leaf
// short-circuits. D lands after C only because A and B were written first and the
// rungs are cumulative — the two Intl calls are independent of each other. The
// patch files are lettered and numbered in this order, so a rung's label reads in
// the order it built and the letter of the patch without a rung is the last one.
//
// K is deliberately absent, and is what the final row adds.
//
// Exactly one patch can be in that position, because the rungs are cumulative:
// every other patch is priced by what it ADDS to a partial tree, and whichever
// one goes last is priced by what the COMPLETE tree LOSES without it. Those are
// different questions, and for most patches the first is the one worth asking —
// it is the "should this land" question. K is the exception. It overlaps G,
// which is a rung, so a K measured before G would be credited with savings G
// would also have found, and a reader comparing a K-shaped rung against a
// G-shaped one further down would be comparing two prices for some of the same
// work. Putting K last removes the double count: the last two rows differ by K
// alone, so the step between them is what K is worth with everything else
// already in, which is the only form of the question a shipping decision turns
// on.
//
// The cost of that choice is G's rung, which is now measured in K's absence and
// so reads larger than the G in the shipped tree. See "What the merge cost".
//
// F's rung is the one to read across the whole width rather than off the
// formatting columns alone: it interns Locales, which every direction builds one
// of, but what it was written for is Info, and only the `other` band has any.
//
// H, I and J are all rows the `other` band exists for, and each was split out of
// what used to be one patch because each owns a column there that the other two
// do not. H is under plus, minus, diff, endOf and every Interval method; I is
// under toRelative and nothing else; J is under the setters, so the only part of
// it the formatting and parsing columns touch is the one clone that fromMillis
// does. Removing any one of them from the complete tree costs at least 1.9x on
// some column of that band, against a control that reaches 1.4x.
const RUNG_ORDER = [
  "zoneInfoCache", // A
  "offsetScan", // B
  "tokenParserCache", // C
  "zoneNameScan", // D
  "transitionInterval", // E
  "localeIntern", // F
  "numericPath", // G
  "arithDirect", // H
  "relativeSkip", // I
  "trimAllocs", // J, and last of the rungs because K is not one
];

/** each rung is the one above it plus one patch, so the list above is the table */
const RUNGS: string[][] = RUNG_ORDER.map((_, i) => RUNG_ORDER.slice(0, i + 1));

/**
 * The rungs, plus the everything-applied build. Written cumulatively and then
 * narrowed to what is in play, so `--drop` removes a patch from every rung that
 * named it — and any rung that thereby becomes its predecessor is folded away,
 * since two rows differing by nothing are two rows measuring the same build.
 */
const LADDER: { id: string; keys: PatchKey[] }[] = [...RUNGS.map(inPlay), UPSTREAM]
  // each row has to hold something the row above it did not. the everything row
  // is in the same filter as the rungs because it is the one that collapses when
  // K is dropped: K is the only patch with no rung of its own, so without it the
  // last rung already is the everything build
  .filter((keys, i, all) => keys.length > 0 && (i === 0 || keys.length > all[i - 1]!.length))
  .map((keys, i, all) => ({
    id: `luxon ${i === all.length - 1 ? `all (${fullLabel(keys)})` : rungLabel(keys)}`,
    keys,
  }));

/**
 * The last row's label. The one place a range is still worth having: this row is
 * every patch by definition, so the range is a restatement of "all" rather than
 * something the reader has to expand — and when `--drop` means it is not every
 * patch, it says which are missing instead.
 */
function fullLabel(keys: readonly PatchKey[]): string {
  const letters = keys.map(LETTER).sort();

  return contiguous(letters) ? `${letters[0]}-${letters.at(-1)}` : `no ${droppedPatches.join("")}`;
}

/** the everything-applied build, which most of the report quotes something of */
const FULL = LADDER.at(-1)!.id;

/** the same build with easy-tz's zone bound to it, the row the report ends on */
const FULL_EASY = "luxon all + easytz";

// ---- paths under test -------------------------------------------------------

interface Path {
  id: string;
  /** patches applied to the luxon instance, for the report */
  patches: readonly PatchKey[];
  /** whose bundle the bytes column reports */
  ships: "luxon" | "moment-timezone";
  /** false when the zone still comes from Intl */
  easyZone: boolean;
  /**
   * How to build this row's formatter. The footprint subprocesses are handed
   * this, so what they load is what `make` timed rather than a second
   * description of it.
   */
  spec: (fmt: FormatKey) => Promise<BuildSpec>;
  make: (fmt: FormatKey) => Promise<(ts: number) => string>;
}

function luxonPath(id: string, patches: readonly PatchKey[], easyZone: boolean): Path {
  const spec = async (fmt: FormatKey): Promise<BuildSpec> => ({
    luxonEntry: (await patchedEntry(patches)).pathname,
    easyZone,
    zone: ZONE,
    locale: localeFor(fmt),
    pattern: patternFor("luxon", fmt),
  });

  return { id, patches, ships: "luxon", easyZone, spec, make: (fmt) => spec(fmt).then(formatterFor) };
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
    locale: localeFor(fmt),
    pattern: patternFor("moment", fmt),
  });

// Every build here has a row. There used to be several that did not — one per
// individual patch over the easy-tz zone, plus a few variant stacks — measured
// only to feed a per-patch ranking in benchmarks/cross-engine.ts. They cost a
// row's worth of measurement and cooling each, the ladder below already
// attributes a patch at a time, and half of them had stopped being read at all
// when the patches were re-lettered and that file's ids went stale.
const paths: Path[] = [
  {
    // `moment` as an id only, to match the ladder's variant naming; the
    // library is moment-timezone, which is what it reports as and is sized as —
    // this calls moment.tz() and formats `z`, neither of which moment core can
    // answer
    id: "moment",
    patches: [],
    ships: "moment-timezone",
    easyZone: false,
    spec: momentSpec,
    make: (fmt) => momentSpec(fmt).then(formatterFor),
  },
  luxonPath("luxon (stock)", [], false),
  ...LADDER.map((rung) => luxonPath(rung.id, rung.keys, false)),
  luxonPath("easytz zone", [], true),
  // The question the report ends on: if all of them land upstream, is the easy-tz
  // zone still worth binding? It carries B and D even though its zone overrides
  // the offset() they patch, so this row landing on top of everything + easy-tz
  // is the measurement of that, rather than a claim that they cannot matter here.
  luxonPath(FULL_EASY, UPSTREAM, true),
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

// The baseline is moment-timezone, not moment: a named zone needs its packed
// offset table, and only its `z` token renders an abbreviation. moment core is
// underneath it doing the formatting, so both versions are worth printing —
// reproducing these numbers means installing the pair.
console.log(
  `luxon ${await pkgVersion()} (this fork's src/) vs moment-timezone ${await pkgVersion("moment-timezone")} ` +
    `(on moment ${await pkgVersion("moment")})`
);
console.log(`runtime: ${runtime()}, easy-tz tables: ${tablesHost}, host ICU ${process.versions["icu"] ?? "?"}`);
// Each timed table states its own value count and pass count underneath itself,
// because they differ: the ladder's two halves are calibrated separately, and
// the default table is a third setting again. All the header can say for all of
// them is which zone the builds were pointed at.
console.log(`${ZONE}\n`);

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
    // in letter order rather than in the groups the rest of this file reasons
    // in: this table is the one place every patch is listed once, so it is the
    // one that should read as the lettering does
    ...[...UPSTREAM].sort((a, b) => LETTER(a).localeCompare(LETTER(b))).map((k) => {
      const size = sizes.get(setKey(withNeeds(k)))!;
      const base = sizes.get(setKey(patchNeeds.get(k)!))!;

      return [`${LETTER(k)} ${k}`, bytes(size), delta(size - base), patchWhat.get(k)!];
    }),
  ];

  console.log("candidate upstream patches:\n");
  printTable(["patch", "bytes", "d bytes", "change"], rows, false, [3]);
  // The one thing a reader cannot get from the column itself: two rows are not
  // sized the way the rest are.
  console.log(
    `\nminified, no gzip. D and E cannot be applied alone, so their rows are the bundle including what\n` +
      `they need and d bytes is over that: D on A, E on B and D.`
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
// — one build per individual patch — exist for the per-patch ranking that
// benchmarks/cross-engine.ts reads, and printing every one of them buried the
// handful that answer the question.

/**
 * The writing columns of the ladder: the two the zone benches share, plus a
 * pattern with words in it.
 *
 * `text` is here and not in `zoneFormatKeys` because it varies the thing this
 * table varies and not the thing that one does. The ladder walks patch sets over
 * a fixed zone, and its other two writing columns are both all-numeric en-US
 * gregorian patterns — the one input for which G's numeric fast paths cover most
 * of what K's compiled program covers, so a ladder made only of those is the
 * place most likely to understate K. format.ts walks zones over a fixed patch
 * set, and a third pattern there would cost it a table, a correctness sweep and
 * an Intl-counting subprocess to answer a question it is not asking.
 */
const ladderFormats: FormatKey[] = [...zoneFormatKeys, "text", "text fr"];

const results = new Map<FormatKey, Map<string, number>>(ladderFormats.map((fmt) => [fmt, new Map()]));

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
  const specs = await Promise.all(ladderFormats.map((fmt) => path.spec!(fmt)));
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

// The rows of the ladder. The reading columns are worth carrying only because
// they sit against the same builds in the same order as the writing ones — what
// they say is what the ladder does to a different code path, which is not a
// comparison at all unless the ladder is identical.
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

/** every build, in the order it is printed — `groups` supplies the labels */
const rowPaths = groups.flat().map(({ id }) => pathById(id));

// Every build measured is a build printed. That was not always so, and the
// builds that were not printed cost as much to measure as the ones that were,
// so this is checked rather than assumed.
if (rowPaths.length !== paths.length) {
  const extra = paths.filter((p) => !rowPaths.includes(p)).map((p) => p.id);

  throw new Error(`${extra.length} build(s) measured with no row to print them in: ${extra.join(", ")}`);
}

// ---- reading dates ----------------------------------------------------------
// The other half of the ladder's columns: parsing a date, and building one from
// a timestamp. Formatting is where the profiling started, but an app that
// renders a date usually read one first — Grafana parses every time range in the
// URL, and every value a user types into a picker.
//
// Worth its own columns because the patches split unevenly across the two
// directions, and the split is not guessable from the patch descriptions. Some
// are formatter-only by construction (K compiles a format string to handlers; A
// and D cache and then cheaply read the zone-NAME lookup, which no parse
// performs). One is parse-only for the mirror-image reason: C compiles a format
// string for reading, which no format path walks. Some are shared machinery that
// parsing happens to route through (F interns Locales that both build, and G
// memoizes the tokenizer both directions use). And B and E are the zone's
// offset(), which every zoned parse needs before it can place a local time.
//
// The columns are the shapes a caller actually has, not a sweep: an ISO string
// with and without an offset on it, Grafana's two token formats likewise, and a
// timestamp. The pair that differ only in whether the input carries an offset is
// the interesting one — with no offset the zone has to resolve the local time,
// which is the work easy-tz replaces, and with one the parse can skip it.

// A parse costs 3-40µs a value against formatting's ~5-100µs, and there are five
// shapes across every tabulated build, so a per-pass budget set like the
// formatting table's would spend a third of this benchmark re-reading strings.
// Every cell is sized to this instead, which means none of
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
// How to spend a cell was measured rather than assumed, against the control this
// table used to carry. Three 45ms passes, six 25ms ones and four 40ms ones all
// cost about the same; under node the control disagreed with its twin by ~2%,
// ~2% and ~1.3% at the median. Four 40ms passes wins on two counts beyond the
// median: 40ms is the kernel's own floor for a pass worth believing, and it
// leaves the slowest cells around 700 values a pass, where a 25ms budget put
// them on the kernel's small-`n` floor of 500 — the count below which it
// measured a path 40% high.
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

const parseResults = new Map<ParseCaseKey, Map<string, number>>(parseCases.map((kase) => [kase.key, new Map()]));
// instants whose parse is checked before anything is timed: a build that cannot
// read one of these shapes would otherwise post the best number in its column,
// and reading nothing is very fast. Every instant here is a whole minute, so all
// five shapes round-trip exactly — including the token format with no
// milliseconds in it.
const PARSE_CHECKS = [0, 1, 500, 1_501, PARSE_POOL - 1];
const parseBroken: string[] = [];

/** a column of the ladder: a format written, a shape read, or a public API call */
type LadderKey = string;

// The API cases in the order they are printed: by band, so a column sits under
// the band that describes it, and within a band in the order they were written.
//
// These are timed as their own segment because they were calibrated as their own
// table — every one of them is short enough per value that a pass has to be sized
// by time and scaled, where the writing columns run the full N. Merging the
// tables merged the printing, not the timing.
const apiCases: ApiCase[] = (["formatting", "parsing", "other"] as ApiBand[]).flatMap((band) =>
  API_CASES.filter((kase) => kase.band === band)
);

/**
 * The moment instance a case is timed on: one per shape of Moment built, not one
 * per case. See momentRole in lib/build.ts — a single string parse anywhere in
 * the process turns format()'s field reads polymorphic for the life of it, which
 * cost the formatting cells 13-19% before this existed. The cases that only
 * build from a timestamp collapse to one instance and so still share its warmth.
 */
const momentInstanceFor = (kase: ApiCase) => momentFor(momentRole(kase.momentShape ?? defaultMomentShape));

if (tables.has("ladder")) {
  // Everything a row needs is built before the first row is timed: the
  // formatters, the parsers, the input pools, the parse checks, the byte counts,
  // and the subprocess profiles. All of it is real work — esbuild runs, five
  // parses per cell get called — and a row is measured with the rows around it
  // cooled rather than crowded. Doing any of it between two timed rows would put
  // the load back where the cooldown just took it out of.
  const pools = new Map(parseCases.map((kase) => [kase.key, inputPool(kase)]));
  const built = new Map<string, Map<LadderKey, Work>>();

  for (const path of rowPaths) {
    const perKey = new Map<LadderKey, Work>();

    for (const fmt of ladderFormats) {
      const format = await path.make(fmt);

      perKey.set(fmt, (ts: number) => format(ts).length);
    }

    for (const kase of parseCases) {
      const pool = pools.get(kase.key)!;
      // the spec carries the formatting pattern too, which parsing has no use for
      const parse = await parserFor(await path.spec!(ladderFormats[0]!), kase, pool?.[0]);

      for (const i of PARSE_CHECKS) {
        const ts = BASE_TS + i * STEP_MS;
        const got = parse(ts, pool?.[i] ?? "");

        if (got !== ts) {
          parseBroken.push(`${path.id} / ${kase.key}: read ${got} for ${ts} (d${got - ts})`);
        }
      }

      perKey.set(kase.key, workFor(parse, pool));
    }

    // The API cases, where a build that has no answer for one leaves the cell
    // empty rather than filling it with a number from something else.
    //
    // The two easy-tz rows are the whole band's worth of that. They exist to ask
    // whether binding easy-tz's zone is still worth it, and the API cases name
    // their zone as a string, so running them here would resolve it through Intl
    // and print a plain-luxon number under a row that claims otherwise. Passing
    // the zone down instead would work, and would also mean every Duration, Info
    // and Interval cell — none of which touch a zone at all — got measured twice
    // to say the same thing. The format and parse columns already answer the
    // question those rows are there for.
    if (!path.easyZone) {
      for (const kase of apiCases) {
        const work =
          path.ships === "moment-timezone"
            ? kase.moment?.(momentInstanceFor(kase))
            : kase.luxon(await loadLuxon(path.patches));

        if (work !== undefined) perKey.set(kase.key, work);
      }
    }

    built.set(path.id, perKey);
  }

  // ---- do the builds still agree? ----
  //
  // Every patch here is supposed to be invisible, and a timing table is the last
  // place a behavior change would announce itself — a build that skips work is
  // exactly what this bench rewards. The format and parse columns are checked
  // already: parsing round-trips the instant it was given (PARSE_CHECKS above),
  // and --verify renders 20k strings per build against stock. The API columns had
  // no such check until they moved here, so this is the one they arrived with.
  //
  // The cases are deterministic by construction — pool indices come off the
  // timestamp, not a counter — so summing each over a fixed window and comparing
  // across builds is nearly free and catches a patch that changed an answer
  // rather than just the time taken to reach it.
  const CHECK_N = 256;
  const checked = rowPaths.filter((p) => p.ships === "luxon" && !p.easyZone);
  const disagree: string[] = [];

  for (const kase of apiCases) {
    if (kase.live === true) continue;

    const sums = checked.map((p) => timeLoop(built.get(p.id)!.get(kase.key)!, BASE_TS, STEP_MS, CHECK_N).checksum);

    if (sums.some((s) => s !== sums[0]!)) {
      disagree.push(`${kase.key}: ${checked.map((p, i) => `${p.id}=${sums[i]!}`).join(" ")}`);
    }
  }

  if (disagree.length > 0) {
    throw new Error(
      `builds disagree on ${disagree.length} API case(s), so the table below is not comparable:\n${disagree.join("\n")}`
    );
  }

  // Bytes and heap alongside the ms, so a rung can be read as a trade rather
  // than as a speedup alone — the ladder is ordered by how easy each patch is to
  // argue upstream, and what it costs to ship and to hold is part of that
  // argument. Profiled in parallel: rss is what a process allocates, which
  // contention does not change, and the Intl counts are exact.
  const profiled = withFootprint
    ? new Map(await Promise.all(rowPaths.map(async (p) => [p.id, await footprint(p)] as const)))
    : new Map<string, Footprint | null>();

  const bytesFor = new Map(
    await Promise.all(
      rowPaths.map(async (p) => [p.id, (await minifiedSize(await shippedEntry(p))).toLocaleString("en-US")] as const)
    )
  );

  const heldHeaders = withFootprint ? ["rss MB", "intl instances"] : [];
  // The bytes column is the one whose values are reliably wider than its header
  // — six-digit figures with separators under a five-letter word — and a column
  // narrower than its contents does not right-align, it just runs over. Sized
  // from the values, which are all in hand before the first row is timed.
  //
  // The timing columns are given more room than today's numbers need for the
  // same reason: these are ms figures on whatever host runs them, and a
  // throttled machine reads several times a quiet one.
  const bytesWidth = Math.max(...[...bytesFor.values()].map((v) => v.length));

  const label = new Map(groups.flat().map(({ id, label }) => [id, label]));
  /** which of the three blocks — baselines, ladder, easy-tz — a build sits in */
  const groupOf = new Map<string, number>();

  groups.forEach((group, i) => group.forEach(({ id }) => groupOf.set(id, i)));

  /** builds whose writing cells were shortened, which the legend has to admit to */
  const shortened = new Set<string>();

  // ---- the three tables -----------------------------------------------------
  //
  // One table per question, rather than one table with a band over each third.
  // The banded version held every column a build can answer on one line, which is
  // the right shape for the argument — a patch is made by reading one row against
  // the one above it — and the wrong shape for a terminal. At 38 columns it ran
  // to ~550 characters, so every row arrived wrapped into four fragments
  // interleaved with its neighbours', which is not a table. Turning the
  // terminal's wrapping off instead only traded that for silently losing two
  // thirds of the columns.
  //
  // Split, each table is a width a terminal can hold, and the rows are the same
  // rows in the same order, so a patch still reads down a column and the three
  // tables still stack into one argument.
  //
  // A segment is a calibration, not a band. The format-string columns run the
  // full N and take as many passes as their budget allows; the API cases cost
  // little enough per value that a pass is sized by time and scaled. Two of the
  // tables hold both kinds, so they are timed in two segments and printed as one.
  interface Segment {
    /** what this segment's columns are, for the line that states its pass settings */
    label: string;
    keys: LadderKey[];
    passBudget: SampleBudget;
    budgetMs: number;
    /** timed over fewer than N values and scaled up, rather than running the full count */
    scaled: boolean;
  }

  interface Band {
    label: string;
    /** what the table is asking, printed above it */
    what: string;
    segments: Segment[];
    /** the column legend printed under it, for columns whose names are not the whole story */
    legend: string;
  }

  const inBand = (band: ApiBand) => apiCases.filter((kase) => kase.band === band).map((kase) => kase.key);
  const lean = (label: string, keys: LadderKey[]): Segment => ({
    label,
    keys,
    passBudget: LEAN_BUDGET,
    budgetMs: LEAN_BUDGET_MS,
    scaled: true,
  });

  const BANDS: Band[] = [
    {
      label: "formatting",
      what: "writing a date",
      segments: [
        {
          label: "the three format strings",
          keys: [...ladderFormats],
          passBudget: PASSES,
          budgetMs: PASS_BUDGET_MS,
          scaled: false,
        },
        lean("the toFormat and ISO calls", inBand("formatting")),
      ],
      // a format that only varies the locale points at the twin it shares a
      // pattern with, rather than printing the same string twice
      legend: ladderFormats
        .map((fmt, i) => {
          const pattern = patternFor("moment", fmt);
          const twin = ladderFormats.slice(0, i).find((seen) => patternFor("moment", seen) === pattern);

          return `${fmt}: ${twin === undefined ? pattern : `${twin}'s pattern, in ${localeFor(fmt)}`}`;
        })
        .join("   "),
    },
    {
      label: "parsing",
      what: "reading one, and the two constructors that read no string at all",
      segments: [
        {
          label: "the five input shapes",
          keys: parseCases.map((kase) => kase.key),
          passBudget: PARSE_PASSES,
          budgetMs: PARSE_BUDGET_MS,
          scaled: true,
        },
        lean(inBand("parsing").join(" and "), inBand("parsing")),
      ],
      legend: parseCases.map((kase) => `${kase.key}: ${kase.what}`).join("\n"),
    },
    {
      label: "other",
      what: "everything that neither writes a string nor reads one",
      segments: [lean("every column", inBand("other"))],
      legend: "",
    },
  ];

  // Each column's own resolution, gathered as the rows land: how far apart two
  // readings of that cell fell. Kept per column rather than per table because
  // the columns differ by an order of magnitude in cost and so in steadiness,
  // and the ladder's smaller steps are small enough that the difference between
  // a real step and a coincidence turns on which column it is in.
  const floors = new Map<LadderKey, number[]>(
    BANDS.flatMap((band) => band.segments.flatMap((seg) => seg.keys)).map((key) => [key, []])
  );
  // What every other row is shaded against, filled by the row that supplies it.
  // moment is rowPaths[0], so it is in hand before anything needs it — but read
  // off the row rather than assumed, since a table whose colours silently
  // inverted if the rows were reordered would be worse than one with no colours.
  const anchor = new Map<LadderKey, number>();

  /** the worse half of a column's cells, so one steady cell cannot speak for it */
  const columnFloor = (key: LadderKey) => {
    const seen = floors.get(key)!.sort((a, b) => a - b);

    return seen.length === 0 ? NaN : seen[Math.min(seen.length - 1, Math.floor(seen.length * 0.75))]!;
  };

  /** a floors list runs to seventeen entries, and one line of it is not a list */
  const wrap = (parts: string[], width = 110) => {
    const lines = [""];

    for (const part of parts) {
      const at = lines.length - 1;

      if (lines[at]!.length + part.length + 3 > width && lines[at] !== "") lines.push("");
      lines[lines.length - 1] += (lines.at(-1) === "" ? "" : "   ") + part;
    }

    return lines.map((l) => `  ${l}`).join("\n");
  };

  /** cases whose shading is a library comparison rather than a like-for-like one */
  const approxKeys = new Set<string>([
    ...apiCases.filter((kase) => kase.approx === true).map((kase) => kase.key),
    // a format column rendered in another locale is the same comparison the
    // localized API cases are, and is a FormatKey rather than a case, so it is
    // derived here rather than flagged there
    ...ladderFormats.filter((fmt) => localeFor(fmt) !== LOCALE),
  ]);

  // Said once rather than over each table: the three carry the same rows in the
  // same order, which is the property that lets them be read as one.
  console.log(
    `three questions, the same builds in the same order.\n` +
      `the ladder in the middle of each adds one patch per rung to the one above it\n`
  );

  // Once, above all three, rather than under each. The tables are far enough
  // apart that repeating it would read as three different legends.
  if (colorEnabled) console.log(`${colorLegend("moment-timezone")}\n`);

  for (const band of BANDS) {
    const columns = band.segments.flatMap((seg) => seg.keys);
    // Builds with nothing to say here are left out rather than printed as a row
    // of dashes. It is the two easy-tz rows in the `other` table: they exist to
    // ask whether binding easy-tz's zone is worth it, and arithmetic, Duration,
    // Interval and Info never touch a zone.
    const rows = rowPaths.filter((path) => columns.some((key) => built.get(path.id)!.has(key)));
    /** rules go where the block changes, which moves when rows are left out */
    const ruleAt = new Set(
      rows.flatMap((path, i) => (i > 0 && groupOf.get(path.id) !== groupOf.get(rows[i - 1]!.id) ? [i] : []))
    );
    // No unit on the timing headers: it was on every one of them, which spent
    // three characters per column repeating one fact that does not vary. The
    // heading above the table carries it instead, once.
    const headers = ["build", ...columns, ...heldHeaders, "bytes"];
    console.log(`${band.label} (ms) — ${band.what}\n`);

    // bytes on every table rather than only the first. It is a property of the
    // build, not of the question, and a table whose rows cannot be priced is a
    // table you have to scroll back from to finish reading.
    const table = streamTable(headers, {
      minWidths: Object.fromEntries([
        [0, 22],
        ...columns.map((_, i) => [i + 1, 10]),
        [headers.length - 1, bytesWidth],
      ]),
    });

    /** per segment, since each is calibrated separately and quotes its own range */
    const sizesPer = band.segments.map(() => [] as number[]);
    const passesPer = band.segments.map(() => new Set<number>());
    /** builds that printed a dash, so the note explains the reasons this table actually has */
    const dashed = new Set<string>();
    let index = 0;

    // A row is one build across this table's columns, and a row is what the
    // table compares — so the builds are separated by a cooldown while each
    // row's cells stay inside one interleaved window.
    const run = await measureRows(
      rows,
      (path) =>
        band.segments.map((seg) => ({
          // only the cases this build has an answer for, so a row with no easy-tz
          // equivalent or no moment one costs nothing to skip rather than being
          // timed against a stub
          entries: seg.keys.flatMap((key) => {
            const work = built.get(path.id)!.get(key);

            return work === undefined ? [] : [{ key, work }];
          }),
          passBudget: seg.passBudget,
          budgetMs: seg.budgetMs,
        })),
      { base: BASE_TS, step: STEP_MS, report: N, cooldownMs },
      (path, measured) => {
        if (ruleAt.has(index)) table.rule();
        index++;

        for (const key of columns) {
          const s = measured.spread.get(key);

          if (s !== undefined && Number.isFinite(s)) floors.get(key)!.push(s * 100);
        }

        band.segments.forEach((seg, i) => {
          for (const key of seg.keys) {
            const size = measured.sizes.get(key);

            if (size !== undefined) sizesPer[i]!.push(size);
          }
        });

        // a segment a build has no cells for (the easy-tz rows, in the API
        // columns) reports no pass count, which is not the same as reporting zero
        measured.passes.forEach((n, i) => passesPer[i]!.add(n));

        // The two sets cross-engine.ts reads. Recorded here rather than derived
        // afterwards, since only the table that measured a column knows it.
        for (const fmt of ladderFormats) {
          if (!columns.includes(fmt)) continue;

          results.get(fmt)!.set(path.id, measured.best.get(fmt)!);

          if (measured.sizes.get(fmt)! < N) shortened.add(path.id);
        }

        for (const kase of parseCases) {
          if (!columns.includes(kase.key)) continue;

          parseResults.get(kase.key)!.set(path.id, measured.best.get(kase.key)!);
        }

        if (path.id === "moment") {
          for (const key of columns) {
            const v = measured.best.get(key);

            // Interval and Duration#shiftTo have no moment equivalent, so those
            // columns have no anchor and print unshaded. Better than shading them
            // against something moment did not do.
            if (v !== undefined) anchor.set(key, v);
          }
        }

        const fp = profiled.get(path.id) ?? null;
        // a row whose subprocess failed says so, rather than taking the timings
        // and everything below them down with it
        const held = !withFootprint
          ? []
          : fp === null
            ? ["err", "err"]
            : [fp.rssMB.toFixed(1), fp.intl.toLocaleString("en-US")];

        table.row([
          label.get(path.id)!,
          ...columns.map((key) => {
            const v = measured.best.get(key);

            if (v === undefined) dashed.add(path.id);

            return v === undefined ? "--" : shade(v.toFixed(1), v, anchor.get(key));
          }),
          ...held,
          bytesFor.get(path.id)!,
        ]);
      }
    );

    // NaN here would mean a parse failed inside a timed loop, which the checks
    // above only sample for
    if (!Number.isFinite(run.checksum)) {
      throw new Error(`a ${band.label} checksum is not finite — a timed cell returned NaN`);
    }

    sink += run.checksum % 1_000;

    // The columns are keys, so the ones whose names are not self-explanatory need
    // a legend; and each carries its OWN resolution rather than the table
    // carrying one, which is not guessable.
    //
    // The API columns get no legend line. They are named after the call they
    // make, which is the whole description — `Interval splitBy` does not read
    // better for a line saying it splits an Interval — and thirty of those lines
    // would bury the ones above them that do carry information.
    const approx = columns.filter((key) => approxKeys.has(key));
    // Both reasons a cell can be empty, but only the ones this table has. In the
    // formatting table it is the easy-tz rows; in `other` it is moment as well.
    const why = [
      dashed.has("moment") ? "moment ships no Interval and no Duration#shiftTo" : "",
      [...dashed].some((id) => id !== "moment")
        ? "the easy-tz rows answer only the columns built on a zone, and the rest name theirs as a string"
        : "",
    ].filter((s) => s !== "");
    const notes = [
      band.legend,
      approx.length === 0
        ? ""
        : `${approx.join(", ")}: luxon gets its month, weekday and day-period names from ICU where\n` +
          `moment expands tables it bundles — the same user-visible answer out of a different source,\n` +
          `and part of what the bytes column charges moment for.`,
      why.length === 0 ? "" : `--: the build has no equivalent.\n${why.join(". ")}.`,
    ].filter((s) => s !== "");

    console.log(
      `\n${notes.join("\n")}\n\n` +
        `Read each column no finer than its own floor — how far apart two readings of the same cell fell:\n\n` +
        `${wrap(columns.map((key) => `${key} ${columnFloor(key).toFixed(1)}%`))}\n`
    );

    // Each segment ran on its own pass settings, so one sentence covering both
    // would have to round something away.
    band.segments.forEach((seg, i) => {
      const sizes = sizesPer[i]!;

      if (sizes.length === 0) return;

      const passes = [...passesPer[i]!].sort((a, b) => a - b).join("/");
      const span = `${Math.min(...sizes).toLocaleString("en-US")}-${Math.max(...sizes).toLocaleString("en-US")}`;

      console.log(
        seg.scaled
          ? `${seg.label}: ms per ${N}, scaled from ${span} values in a ${seg.budgetMs}ms pass, fastest of ${passes}.`
          : `${seg.label}: ms per ${N}, fastest of ${passes} passes.` +
            (shortened.size === 0
              ? ``
              : ` ${shortened.size} of the ${rows.length} builds cost enough per value to run fewer than ${N} and be scaled up.`)
      );
    });

    console.log();
    // between tables as well as between their rows: the next one otherwise opens
    // with the row measured straight after a table's worth of load
    if (band !== BANDS.at(-1)) await cooldown(cooldownMs);
  }

  // moment core sized on its own, so the baseline row can report how much of
  // itself is the dependency rather than leaving the reader to wonder whether it
  // was counted at all
  const core = await minifiedSize(
    await writeEntry(
      "moment-core.ts",
      `import moment from 'moment';\nexport const format = (ts: number, pattern: string) => moment(ts).format(pattern);\n`
    )
  );

  // moment-timezone's row would otherwise look like it excluded the dependency
  // it cannot run without.
  console.log(`bytes: minified, no gzip. moment-timezone's row includes moment core, ${core.toLocaleString("en-US")} B of it.`);

  if (!withFootprint) {
    console.log(`\n--footprint adds rss and Intl.DateTimeFormat counts, one subprocess per row (~2.5s).`);
  }

  console.log();
}

if (parseBroken.length > 0) {
  console.log(`PARSE MISMATCH — these cells did not read back the instant they were given:`);

  for (const line of parseBroken) {
    console.log(`  ${line}`);
  }

  console.log();
}

// ---- the default zone -------------------------------------------------------
// Every table above names a zone, which is the configuration the patches were
// written for and not the one most callers run. With no zone option, luxon uses
// SystemZone, whose offset() is a getTimezoneOffset call rather than an Intl
// one — so stock is already several times cheaper there, and the Intl-removing
// patches have correspondingly less to remove. This table is here so that gap is
// a measured number rather than an assumption, and so the rungs that do reach
// the default path (C, F, G, H) are visible somewhere.
//
// It shares the ladder's kernel and reads its own cases: these are whole
// operations rather than formatter closures, since the point is the API a caller
// uses, and half of them do not format anything.

const NUM_PATTERN = patternFor("luxon", "numeric");

interface DefaultCase {
  key: string;
  what: string;
  /** the operation with no zone named, which is what this table is about */
  system: (m: LuxonModule) => Work;
  /** the same against ZONE, for the column that says what the default is worth */
  named: (m: LuxonModule) => Work;
}

const DEFAULT_CASES: DefaultCase[] = [
  {
    key: "toFormat",
    what: `writing ${NUM_PATTERN}`,
    system: (m) => (ts) => m.DateTime.fromMillis(ts).toFormat(NUM_PATTERN).length,
    named: (m) => (ts) => m.DateTime.fromMillis(ts, { zone: ZONE }).toFormat(NUM_PATTERN).length,
  },
  {
    key: "fromISO",
    what: "reading an ISO string with no offset in it",
    system: (m) => {
      const pool = isoPool(m, undefined);
      let i = 0;
      return () => m.DateTime.fromISO(pool[i++ % pool.length]!).valueOf();
    },
    named: (m) => {
      const pool = isoPool(m, ZONE);
      let i = 0;
      return () => m.DateTime.fromISO(pool[i++ % pool.length]!, { zone: ZONE }).valueOf();
    },
  },
  {
    key: "fromFormat",
    what: "reading that same numeric pattern back",
    system: (m) => {
      const pool = tokenPool(m, undefined);
      let i = 0;
      return () => m.DateTime.fromFormat(pool[i++ % pool.length]!, NUM_PATTERN).valueOf();
    },
    named: (m) => {
      const pool = tokenPool(m, ZONE);
      let i = 0;
      return () => m.DateTime.fromFormat(pool[i++ % pool.length]!, NUM_PATTERN, { zone: ZONE }).valueOf();
    },
  },
  {
    key: "startOf",
    what: "startOf('day'), which formats nothing and still needs an offset",
    system: (m) => (ts) => m.DateTime.fromMillis(ts).startOf("day").valueOf(),
    named: (m) => (ts) => m.DateTime.fromMillis(ts, { zone: ZONE }).startOf("day").valueOf(),
  },
  {
    key: "plus",
    what: "plus({ days: 1 }), H's unit tables and its adjustTime fast path",
    system: (m) => (ts) => m.DateTime.fromMillis(ts).plus({ days: 1 }).valueOf(),
    named: (m) => (ts) => m.DateTime.fromMillis(ts, { zone: ZONE }).plus({ days: 1 }).valueOf(),
  },
  {
    key: "now",
    what: "DateTime.now(), which can only be the default zone",
    system: (m) => () => m.DateTime.now().valueOf(),
    named: (m) => () => m.DateTime.now().valueOf(),
  },
];

/** rendered by the build under test, so every column reads identical strings */
function isoPool(m: LuxonModule, zone: string | undefined): string[] {
  const opts = zone === undefined ? {} : { zone };
  return Array.from({ length: PARSE_POOL }, (_, i) =>
    m.DateTime.fromMillis(BASE_TS + i * STEP_MS, opts).toISO({ includeOffset: false })!
  );
}

function tokenPool(m: LuxonModule, zone: string | undefined): string[] {
  const opts = zone === undefined ? {} : { zone };
  return Array.from({ length: PARSE_POOL }, (_, i) =>
    m.DateTime.fromMillis(BASE_TS + i * STEP_MS, opts).toFormat(NUM_PATTERN)
  );
}

// Stock and the fully patched build. The last column is stock again but with the
// zone NAMED, which is a baseline rather than a control: it is what every other
// table on this page measures, here so the reader can see how much of stock's
// cost was the named zone in the first place.
const DEFAULT_BUILDS: { id: string; keys: PatchKey[] }[] = [
  { id: "stock", keys: [] },
  { id: FULL.replace("luxon ", ""), keys: [...UPSTREAM] },
];

// Three cells to a row, so a full rotation takes three passes, and the kernel's
// spread wants two complete rotations to have anything to compare. The format
// table's 3-5 would leave some rows with one rotation and no floor at all.
const DEFAULT_PASSES: SampleBudget = { min: 6, max: 6, budgetMs: 0 };

if (tables.has("default")) {
  const loaded = new Map<string, LuxonModule>();

  for (const build of DEFAULT_BUILDS) {
    loaded.set(build.id, await loadLuxon(build.keys));
  }

  const patchedId = DEFAULT_BUILDS[1]!.id;
  const best = new Map<string, Map<string, number>>();
  /** how far apart two readings of a cell fell, the floor a d has to clear */
  const jitter = new Map<string, number>();

  const delta = (kase: string, id: string) => {
    const got = best.get(kase)!;
    return `${(((got.get(id)! - got.get("stock")!) / got.get("stock")!) * 100).toFixed(1)}%`;
  };

  console.log(`the default zone: the same cases with no zone named at all\n`);

  // Unitless headers, as in the ladder; the footnote under this table gives the
  // ms, and `d` is a percentage rather than a time either way.
  const table = streamTable(["case", "stock", patchedId, "d", `stock, ${ZONE}`], {
    minWidths: { 0: 12, 1: 9, 3: 7 },
  });

  const run = await measureRows(
    DEFAULT_CASES,
    // the builds of one case timed adjacently, so drift between cases cannot be
    // read as a difference between builds
    (kase) => [
      {
        entries: [
          ...DEFAULT_BUILDS.map((b) => ({ key: b.id, work: kase.system(loaded.get(b.id)!) })),
          { key: "named", work: kase.named(loaded.get("stock")!) },
        ],
        passBudget: DEFAULT_PASSES,
        budgetMs: PASS_BUDGET_MS,
        group: DEFAULT_BUILDS.length + 1,
      },
    ],
    { base: BASE_TS, step: STEP_MS, report: N, cooldownMs },
    (kase, measured) => {
      best.set(kase.key, measured.best);

      for (const id of [...DEFAULT_BUILDS.map((b) => b.id), "named"]) {
        const s = measured.spread.get(id)!;

        if (Number.isFinite(s)) jitter.set(`${kase.key}\u0000${id}`, s * 100);
      }

      table.row([
        kase.key,
        measured.best.get("stock")!.toFixed(1),
        measured.best.get(patchedId)!.toFixed(1),
        delta(kase.key, patchedId),
        measured.best.get("named")!.toFixed(1),
      ]);
    }
  );

  sink += run.checksum;

  const floors = [...jitter.values()].sort((a, b) => a - b);
  const floor = floors.length === 0 ? NaN : floors[Math.min(floors.length - 1, Math.floor(floors.length * 0.75))]!;

  // The rows are keys, and the d column is meaningless without something to read
  // it against. Several of these cases have no patch on them at all and should
  // read as zero, so the floor is what says whether they do.
  console.log(
    `\n${DEFAULT_CASES.map((kase) => `${kase.key}: ${kase.what}`).join("\n")}\n\n` +
      `ms per ${N}, fastest of ${[...run.passes].sort((a, b) => a - b).join("/")} interleaved passes. Two readings of\n` +
      `the same cell fell ${floor.toFixed(1)}% apart at the upper quartile, so read d no finer than that.\n`
  );
}

// ---- agreement --------------------------------------------------------------
// The patches are supposed to be behavior-preserving, so every patched path must
// match stock luxon byte for byte. The easy-tz paths are expected to differ on
// abbreviations (easy-tz supplies a tzdata-style abbreviation where ICU returns
// a "GMT-5" fallback — established in benchmarks/format.ts), so those rows are
// informational rather than pass/fail.
//
// Opt-in (--verify): 20k values per path per format, which the timings do not
// need. It is still the only check that covers all eleven patches — the tests in
// benchmarks/test/ cover the offset, zone-name and parser-cache ones — so it has
// to pass before any is argued for upstream.
//
// Every hour is compared here, unlike the agreement scan in benchmarks/format.ts
// which samples runs of constant offset and abbreviation. That shortcut is sound
// for three unpatched implementations reading a table and unsound here: most of
// these patches are caches, so what a path answers depends on which instants it
// was asked about before, and the dense walk in instant order IS the stimulus.
// Sampling every twelfth hour would exercise a different sequence of cache
// states than any real formatting loop, so a narrow wrong answer could hide in
// the values never asked for.

if (tables.has("ladder") && !withVerify) {
  console.log(`output parity vs stock luxon skipped — pass --verify to run it (~7s).`);
}

if (tables.has("ladder") && withVerify) {
  const PARITY_N = 20_000;
  const PARITY_STEP = 3_600_000;
  const rows: (string[] | null)[] = [];
  let patchedMismatches = 0;

  for (const fmt of ladderFormats) {
    const reference = await luxonPath("ref", [], false).make(fmt);

    // Materialized once rather than called inside each path's loop. It is stock
    // luxon, the slowest formatter here by 20x on `abbr`, and re-deriving the
    // same 20k strings for all 23 paths was the single largest cost in this
    // benchmark — more than every timed pass put together.
    const expect = Array.from({ length: PARITY_N }, (_, i) => reference(BASE_TS + i * PARITY_STEP));

    for (const path of paths) {
      // stock is what `expect` was rendered from, so comparing it against itself
      // costs a share of this section to prove an identity
      if (path.id === "luxon (stock)") {
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

    if (fmt !== ladderFormats.at(-1)) {
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
// In benchmarks/docs/upstream.md, not here: what each patch is, which of the two
// Intl calls it removes, why the ladder's order flatters some rungs over others,
// E's tzdata precondition, and the order to file them in.
//
// That document is about the shape of these results rather than their
// magnitudes, so it quotes no cell from any table above and cannot go stale
// against one. A magnitude stays in the table that measured it.

console.log(`\nwhat these tables mean: ${DOCS}/upstream.md   how they are timed: ${DOCS}/methodology.md`);

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
        // The row order, so benchmarks/cross-engine.ts does not have to
        // reconstruct it. It used to name the builds it wanted by hand, and
        // silently dropped half of them when the patches were re-lettered and
        // those names stopped matching anything — the failure mode of guessing
        // at ids across a file boundary.
        builds: rowPaths.map((p) => p.id),
        ms: Object.fromEntries([...results].map(([fmt, ms]) => [fmt, Object.fromEntries(ms)])),
        // the reading columns, same shape. Nothing diffs these across engines yet;
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
