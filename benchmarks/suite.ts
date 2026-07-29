// Do the patches in benchmarks/patches cost luxon anything ELSEWHERE?
//
// benchmarks/upstream.ts measures the two paths they were written for: writing a
// column of zoned values, and reading dates back. Neither says what happens to
// the rest of the library, and several patches are not confined to formatting —
// B memoizes the tokenizer both directions use, D interns Locales, F/G/H are
// arithmetic in shared helpers. A patch that buys 40% on one path and costs 10%
// on twenty others is not filable, and no table there would have shown it.
//
// So this runs luxon's OWN benchmark suite against the same builds. The cases
// are the 21 + 8 in benchmarks/datetime.js and benchmarks/info.js, which makes
// the list the maintainers' rather than ours — it covers construction, four
// parsers, arithmetic, ISO and locale-string output, relative formatting and
// Info's month/weekday tables, most of which no other bench here touches.
//
// Reproduced, not imported, in three respects:
//
//   * tinybench is replaced by this repo's bench kernel (adaptive pass sizing,
//     interleaved passes, fastest one reported — see benchmarks/lib/kernel.ts),
//     so every build is measured under the same conditions rather than one after
//     another. tinybench measures one build's cases against each other; this
//     measures one case across four builds, and wants the difference between
//     them to mean something.
//   * their `dt = DateTime.now()` becomes a fixed instant, so a rerun measures
//     the same work and the checksums below can be compared across builds.
//   * info.js's `Locale.create(null, null, null)` becomes `DateTime.now().loc`.
//     Same object, reached through the public API — which matters here because
//     each column is a separate build, and importing Locale from one build's
//     impl/locale.js while formatting with another's would silently mix them.
//
// The suite doubles as a parity smoke test: every case returns a number derived
// from its result, and a build whose number differs from stock's is reported
// rather than timed quietly. That covers 29 API paths that upstream.ts's
// correctness scan and benchmarks/test/ never reach.
//
// It has already earned that: on its first run it caught two things the format
// and parse tables could not have, and both are now fixed in the patches.
//   * D interned only Locales built with no outputCalendar, and Info.months and
//     Info.monthsFormat pass "gregory" explicitly — so those two paid D's check
//     and got nothing, coming out 12-17% slower than stock while Info.weekdays
//     (which passes null) came out 45% faster. D now interns both shapes.
//   * J, K, L and M each added a module-level cache that Settings.resetCaches()
//     did not reach, which is what their two resetCaches() cases are for. A cache
//     that survives a documented reset is a behavior change rather than a
//     memoization, and these patches only claim the latter.
//
// Run: node suite.ts               (~21s)
//      bun suite.ts                (the same under JavaScriptCore, which is
//                                   noisier — see the control drift under the
//                                   table)
//      ... --only <substring>      (just the matching cases, for iterating)

import { printTable } from "./lib/print-table.ts";
import { interleavedBest, pkgVersion, runtime, type SampleBudget, type Work } from "./lib/kernel.ts";
import type { DateTimeWithLoc } from "./lib/luxon-types.ts";
import { loadLuxon, patchKey, patchKeys, patchLetter, type LuxonModule, type PatchKey } from "./lib/patches.ts";

// Reported per call, which is what a suite of unrelated one-shot operations
// wants: these cases span ~0.1µs (DateTime.now) to ~100µs (a formatted value
// with the caches reset), and ms-per-N-values would print half of them as 0.
// The kernel reports ms per `REPORT` calls, so at 1000 the figure it hands back
// is already µs per call.
const REPORT = 1_000;

// Per-pass budget handed to the kernel's sizing, and the pass count, traded
// against each other: this table's error is jitter rather than resolution — no
// case here costs more than ~150µs, so every cell clears the kernel's own pass
// floor easily — and against jitter more passes buy more than longer ones do.
// Measured on the control column, which is the same library twice and so reports
// exactly this error: 3 passes of 40ms drifted 1.3% median and 13% worst, 6 of
// 25ms drift 2.4-3.1% median and 7-11% worst, and 8 of 20ms were no better than
// 6. 116 cells (29 cases x 4 columns) put the middle setting at ~20s.
const PASS_BUDGET_MS = 25;
const PASSES: SampleBudget = { min: 6, max: 8, budgetMs: 150 };

// Below either of these a difference is not worth reading as one, whatever the
// control column happened to do.
//
// The percentage is set from the control column's median drift, which is ~1-3%.
// The absolute one is for the cheapest cases: Info's four "with existing locale"
// calls are ~65ns of map lookups, and the control moves them 5-15% — under 10ns,
// which is neither resolvable here nor actionable if it were. Both thresholds
// have to be cleared, which leaves them listing only what a reader could act on.
const MIN_INTERESTING_PCT = 3;
const MIN_INTERESTING_US = 0.02;

// ---- builds under test ------------------------------------------------------

interface Column {
  label: string;
  keys: readonly PatchKey[];
  /** loads a second module instance of the same source — see the control below */
  copy?: number;
}

/**
 * The six patches benchmarks/upstream.ts recommends filing, which is the set
 * whose side effects matter most — they are the ones that would actually land.
 * Kept in step with that file's LADDER by hand; the letters are asserted below,
 * so a patch inserted ahead of them fails loudly rather than silently renaming
 * this column.
 */
const SHIP: PatchKey[] = [
  "zoneInfoCache",
  "compileFormat",
  "offsetScan",
  "offsetInterval",
  "zoneNameScan",
  "zoneNameInterval",
].map(patchKey);

const shipLabel = SHIP.map((k) => patchLetter.get(k)!)
  .sort()
  .join("");

if (shipLabel !== "CIJKLM") {
  throw new Error(
    `the ship list is no longer C+I+J+K+L+M but ${shipLabel} — is benchmarks/upstream.ts's ladder still the same?`
  );
}

const COLUMNS: Column[] = [
  { label: "stock", keys: [] },
  // The control: stock a second time, as a SEPARATE module instance of identical
  // source. Whatever it reports against the first column is what a difference has
  // to beat to be one, and loading it twice rather than timing one instance twice
  // is what makes that floor the right one — it carries the cost of being a
  // different module (its own inline caches, its own code objects, its own place
  // in the heap) as well as ambient noise. On the cheapest cases here, where an
  // operation is two map lookups, that is most of the spread: they moved 5-15%
  // between builds that do not touch them at all.
  { label: "control", keys: [], copy: 1 },
  { label: `ship ${shipLabel}`, keys: SHIP },
  { label: `all ${patchKeys.length}`, keys: patchKeys },
];

const STOCK = "stock";
const CONTROL = "control";

// ---- the cases --------------------------------------------------------------

interface Case {
  /** luxon's own name for it, verbatim, so a reader can find it in datetime.js */
  name: string;
  /**
   * Everything outside the timed loop happens here, as it does in luxon's suite:
   * the returned closure is the body of their `.add()` callback, and returns a
   * number derived from the result — a length, an instant, an offset — both to
   * stop the engine eliding the call and to be checked against stock's.
   */
  make: (lux: LuxonModule) => Work;
}

// Their `dt` is DateTime.now(); a fixed instant instead, so that reruns measure
// the same work and the cross-build checksums mean something. In the system
// zone, as theirs is.
const DT_TS = Date.UTC(2026, 4, 15, 16, 7, 35, 445);

const TOKENS = "yyyy/MM/dd HH:mm:ss.SSS";
const TOKEN_INPUT = "1982/05/25 09:10:11.445";
const LA = "America/Los_Angeles";

const dateTimeCases: Case[] = [
  {
    name: "DateTime.now",
    // .year rather than the instant: the value is checked against stock's, and
    // "now" differs between two columns measured seconds apart
    make:
      ({ DateTime }) =>
      () =>
        DateTime.now().year,
  },
  {
    name: "DateTime.fromObject with locale",
    make:
      ({ DateTime }) =>
      () =>
        DateTime.fromObject({}, { locale: "fr" }).year,
  },
  {
    name: "DateTime.local with numbers",
    make:
      ({ DateTime }) =>
      () =>
        DateTime.local(2017, 5, 15).valueOf(),
  },
  {
    name: "DateTime.local with numbers and zone",
    make:
      ({ DateTime }) =>
      () =>
        DateTime.local(2017, 5, 15, 11, 7, 35, { zone: "America/New_York" }).valueOf(),
  },
  {
    name: "DateTime.fromISO",
    make:
      ({ DateTime }) =>
      () =>
        DateTime.fromISO("1982-05-25T09:10:11.445Z").valueOf(),
  },
  {
    name: "DateTime.fromSQL",
    make:
      ({ DateTime }) =>
      () =>
        DateTime.fromSQL("2016-05-14 10:23:54.2346").valueOf(),
  },
  {
    name: "DateTime.fromFormat",
    make:
      ({ DateTime }) =>
      () =>
        DateTime.fromFormat(TOKEN_INPUT, TOKENS).valueOf(),
  },
  {
    name: "DateTime.fromFormat with zone",
    make:
      ({ DateTime }) =>
      () =>
        DateTime.fromFormat(TOKEN_INPUT, TOKENS, { zone: LA }).valueOf(),
  },
  {
    name: "DateTime.fromFormatParser",
    make: ({ DateTime }) => {
      const parser = DateTime.buildFormatParser(TOKENS);

      return () => DateTime.fromFormatParser(TOKEN_INPUT, parser).valueOf();
    },
  },
  {
    name: "DateTime.fromFormatParser with zone",
    make: ({ DateTime }) => {
      const parser = DateTime.buildFormatParser(TOKENS);

      return () => DateTime.fromFormatParser(TOKEN_INPUT, parser, { zone: LA }).valueOf();
    },
  },
  {
    name: "DateTime#setZone",
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => dt.setZone(LA).offset;
    },
  },
  {
    name: "DateTime#toFormat",
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => dt.toFormat("yyyy-MM-dd").length;
    },
  },
  {
    name: "DateTime#toFormat with macro",
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => dt.toFormat("T").length;
    },
  },
  {
    name: "DateTime#toFormat with macro no cache",
    make: ({ DateTime, Settings }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => {
        const n = dt.toFormat("T").length;

        Settings.resetCaches();

        return n;
      };
    },
  },
  {
    name: "DateTime#format in german",
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => dt.setLocale("de-De").toFormat("d. LLL. HH:mm").length;
    },
  },
  {
    name: "DateTime#format in german and no-cache",
    make: ({ DateTime, Settings }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => {
        const n = dt.setLocale("de-De").toFormat("d. LLL. HH:mm").length;

        Settings.resetCaches();

        return n;
      };
    },
  },
  {
    name: "DateTime#add",
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => dt.plus({ milliseconds: 3434 }).valueOf();
    },
  },
  {
    name: "DateTime#toISO",
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => (dt.toISO() ?? "").length;
    },
  },
  {
    name: "DateTime#toLocaleString",
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => dt.toLocaleString().length;
    },
  },
  {
    name: "DateTime#toLocaleString in utc",
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => dt.toUTC().toLocaleString().length;
    },
  },
  {
    name: "DateTime#toRelativeCalendar",
    // base: DateTime.now() per call, as theirs is — the allocation is part of
    // what the case measures
    make: ({ DateTime }) => {
      const dt = DateTime.fromMillis(DT_TS);

      return () => (dt.toRelativeCalendar({ base: DateTime.now(), locale: "fi" }) ?? "").length;
    },
  },
];

// Their four Info suites, each a pair: once with a Locale handed in, once
// leaving Info to build one. The pair is the point — the second is the path a
// caller actually takes, and D (localeIntern) is a patch to exactly that.
const infoCases: Case[] = (["months", "monthsFormat", "weekdays", "weekdaysFormat"] as const).flatMap(
  (method): Case[] => [
    {
      name: `Info.${method} with existing locale`,
      make: ({ DateTime, Info }) => {
        // luxon's own info.js reaches for Locale.create() here. Through the
        // public API instead, because each column is a separate build and
        // importing one build's impl/locale.js while formatting with another's
        // would silently mix them. `loc` is internal, hence the named type.
        const { loc } = DateTime.now() as DateTimeWithLoc;

        return () => tableSize(Info[method]("long", { locObj: loc }));
      },
    },
    {
      name: `Info.${method}`,
      make:
        ({ Info }) =>
        () =>
          tableSize(Info[method]("long")),
    },
  ]
);

/**
 * Checksum for an Info result. Two property reads rather than joining twelve
 * strings: with a Locale handed in these calls are a memoized array read, and a
 * join would cost more than the case does.
 */
const tableSize = (names: string[]) => names.length + names[0]!.length;

const only = process.argv[process.argv.indexOf("--only") + 1];
const wanted = process.argv.includes("--only") && only !== undefined ? only.toLowerCase() : null;

const cases = [...dateTimeCases, ...infoCases].filter((c) => wanted === null || c.name.toLowerCase().includes(wanted));

if (cases.length === 0) {
  throw new Error(`--only ${only} matched none of the ${dateTimeCases.length + infoCases.length} cases`);
}

// ---- measure ----------------------------------------------------------------

console.log(`luxon ${await pkgVersion()}, its own benchmark suite (benchmarks/datetime.js + info.js)`);
console.log(`runtime: ${runtime()}, host ICU ${process.versions["icu"] ?? "?"}`);
console.log(`µs per call, fastest of ${PASSES.min}-${PASSES.max} interleaved passes\n`);

const modules = new Map<string, LuxonModule>();

for (const col of COLUMNS) {
  modules.set(col.label, await loadLuxon(col.keys, col.copy ?? 0));
}

const key = (col: string, name: string) => `${col}\u0000${name}`;

// Case-major, so the four columns of one case are timed next to each other:
// what is compared is their ratio, and drift over the window is the one error a
// ratio does not cancel.
const entries = cases.flatMap((kase) =>
  COLUMNS.map((col) => ({ key: key(col.label, kase.name), work: kase.make(modules.get(col.label)!) }))
);

// Every case ignores the instant it is handed — luxon's suite feeds each of its
// callbacks one fixed input, and the point here is to reproduce their case, not
// to sweep it — so the step is 0 and the base is only there to satisfy the kernel.
//
// COLUMNS.length as the group size, which is what makes the four columns of a
// case comparable at all: the cell measured right after the previous case pays
// for that case, by up to 2.5x on the allocating cases, and without the rotation
// it is the same column every pass. See rotateGroups in the kernel.
const timed = interleavedBest(entries, DT_TS, 0, REPORT, PASSES, PASS_BUDGET_MS, COLUMNS.length);

// Checksums, gathered outside the timed loop: one call per cell, compared across
// columns. A patch is supposed to be invisible from the API, and a case whose
// number moved is a bug rather than a benchmark result.
const checks = new Map<string, number>();

for (const kase of cases) {
  for (const col of COLUMNS) {
    checks.set(key(col.label, kase.name), kase.make(modules.get(col.label)!)(DT_TS));
  }
}

const mismatched = cases.flatMap((kase) => {
  const want = checks.get(key(STOCK, kase.name))!;
  const off = COLUMNS.filter((col) => checks.get(key(col.label, kase.name)) !== want);

  return off.length === 0
    ? []
    : [`${kase.name}: stock ${want}, ${off.map((c) => `${c.label} ${checks.get(key(c.label, kase.name))}`).join(", ")}`];
});

// ---- report -----------------------------------------------------------------

const us = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const pct = (v: number) => (v > 0 ? "+" : "") + v.toFixed(1);

const patched = COLUMNS.filter((c) => c.label !== STOCK);

const delta = (col: string, name: string) => {
  const base = timed.best.get(key(STOCK, name))!;

  return ((timed.best.get(key(col, name))! - base) / base) * 100;
};

const rows: (string[] | null)[] = cases.map((kase) => [
  kase.name,
  us(timed.best.get(key(STOCK, kase.name))!),
  ...patched.flatMap((col) => [us(timed.best.get(key(col.label, kase.name))!), pct(delta(col.label, kase.name))]),
]);

/**
 * The suite's overall verdict on one column: the geometric mean of its per-case
 * ratios, which is the right average of ratios and weights every case equally —
 * as luxon's own suite does, having no notion of which of its cases an app runs
 * more often. A sum of the µs columns would instead let the two cases that reset
 * the caches decide the answer.
 */
const geomean = (col: string) =>
  (Math.exp(cases.reduce((s, k) => s + Math.log(1 + delta(col, k.name) / 100), 0) / cases.length) - 1) * 100;

if (cases.length > 1) {
  rows.push(null, ["geometric mean", "", ...patched.flatMap((col) => ["", pct(geomean(col.label))])]);
}

printTable(["case", "stock µs", ...patched.flatMap((col) => [`${col.label} µs`, "Δ%"])], rows);

const controlDrift = cases.map((k) => Math.abs(delta(CONTROL, k.name))).sort((a, b) => a - b);
const median = controlDrift[controlDrift.length >> 1]!;

/**
 * What the control column drifted on all but its worst tenth of cases, used as a
 * floor for every case rather than only for the case it came from.
 *
 * A per-case control drift alone is one sample, so a case whose control happened
 * to come in clean gets an unrealistically tight floor and then reports the next
 * run's jitter as a finding — which it did: successive runs each listed three or
 * four cases as 3-7% slower and never the same ones. The high percentile is the
 * table's own answer to "how far apart can identical code land", and it is the
 * threshold that makes the verdict repeatable.
 */
const spread = controlDrift[Math.min(controlDrift.length - 1, Math.floor(controlDrift.length * 0.9))]!;

// Per case, the larger of its own control drift and that table-wide spread, so a
// case that is noisier than most is held to its own standard.
const floor = (name: string) => Math.max(MIN_INTERESTING_PCT, spread, Math.abs(delta(CONTROL, name)));

const movedUs = (col: string, name: string) =>
  Math.abs(timed.best.get(key(col, name))! - timed.best.get(key(STOCK, name))!);

const verdict = patched
  .filter((col) => col.label !== CONTROL)
  .map((col) => {
    const moved = cases
      .map((kase) => ({ name: kase.name, d: delta(col.label, kase.name), floor: floor(kase.name) }))
      .filter((m) => Math.abs(m.d) > m.floor && movedUs(col.label, m.name) >= MIN_INTERESTING_US);
    const slower = moved.filter((m) => m.d > 0);
    const faster = moved.filter((m) => m.d < 0);
    const worst = [...slower].sort((a, b) => b.d - a.d);

    return (
      `${col.label}: ${faster.length} faster, ${cases.length - moved.length} unchanged, ${slower.length} slower` +
      ` (geomean ${pct(geomean(col.label))}%)` +
      (worst.length === 0 ? "" : `\n  slower: ${worst.map((m) => `${m.name} ${pct(m.d)}%`).join(", ")}`)
    );
  })
  .join("\n");

console.log(`
passes taken: ${timed.passes}, calls timed per pass: ${Math.min(...timed.sizes.values()).toLocaleString()}-${Math.max(
  ...timed.sizes.values()
).toLocaleString()}. Cells are the fastest pass, scaled to ${REPORT.toLocaleString()} calls,
with the four columns of a case timed adjacently. Δ% is against stock, negative faster.
The control column is a second module instance of the same stock source, so its Δ% is what a
real difference has to beat: ${pct(median)}% median here, ${pct(spread)}% at the ninth decile, ${pct(
  controlDrift.at(-1)!
)}% worst. The
verdict below counts a case as moved when it clears that decile (and its own control drift, and
${MIN_INTERESTING_PCT}%) AND moves at least ${MIN_INTERESTING_US.toFixed(
  2
)}µs, the last being for Info's ~0.07µs cases where the control's
own percentages are worth a few nanoseconds.

Reproduced from benchmarks/datetime.js and info.js with the deviations listed at the top of this
file. Two of their cases call Settings.resetCaches() every iteration; what that clears is luxon's
own caches, so those two rows also report whether a patch's cache is reachable from the reset
path — which is how the J/K/L/M reset hooks in benchmarks/patches came to be written.

verdict against ${cases.length} of luxon's own cases:
${verdict}`);

// Quoted from this run rather than written down, so a patch that changes one of
// these stops the paragraph agreeing with the table above it. Only for a full
// run: on a --only run most of what it refers to was not measured.
if (wanted === null) {
  const ship = COLUMNS[2]!.label;
  const all = COLUMNS[3]!.label;
  const d = (name: string, col = ship) => `${pct(delta(col, name))}%`;
  const cost = (name: string, col = STOCK) => `${us(timed.best.get(key(col, name))!)}µs`;

  console.log(`
findings

The zone patches are what shows up outside formatting, and they show up on every case that names
a zone: DateTime#setZone ${d("DateTime#setZone")}, DateTime.local with a zone ${d(
    "DateTime.local with numbers and zone"
  )}, and both token parsers into
one, ${d("DateTime.fromFormat with zone")} and ${d(
    "DateTime.fromFormatParser with zone"
  )}. None of those formats anything — they need an offset to place a
local time, and J and K are what that offset costs. The same four cases without a zone move by
${d("DateTime.local with numbers")} to ${d(
    "DateTime.fromFormatParser"
  )}, which is the size of the rest of the ladder on paths it was not written for.

I is visible on DateTime#toFormat (${d("DateTime#toFormat")}, and ${d(
    "DateTime#toFormat",
    all
  )} with the other seven), which is the case
benchmarks/format.ts measures in bulk. D is visible on Info: ${d("Info.months", all)} on Info.months and ${d(
    "Info.weekdays",
    all
  )} on
Info.weekdays under all ${patchKeys.length}, both of which build a Locale per call and now get an interned one.

The two most expensive cases here are the ones that call Settings.resetCaches() every iteration
(${cost("DateTime#toFormat with macro no cache")} and ${cost(
    "DateTime#format in german and no-cache"
  )}), and they sit within the control's drift of stock in every column.
That is the intended reading rather than a null result: each patch cache is cleared where luxon
clears the cache it stands in for, so a caller who resets pays what stock pays, and none of the
speedups above are a cache quietly outliving its reset.`);
}

if (mismatched.length > 0) {
  console.log(`\nCHECKSUM MISMATCH — these cases did not return stock's value:`);
  for (const line of mismatched) console.log(`  ${line}`);
}

// Keeps the loops from being elided. Printed rather than voided so it is visibly
// consumed, but it is not a run-to-run signal and does not stay put across runs:
// the pass sizing adapts to the host, so what varies is how many iterations got
// summed. The cross-build parity check is `mismatched` above, which compares
// each build's value against stock's on identical inputs.
console.log(`\nchecksum: ${timed.checksum.toFixed(0)}`);
