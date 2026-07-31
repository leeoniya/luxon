// Do the patches in benchmarks/patches cost luxon anything ELSEWHERE?
//
// benchmarks/upstream.ts measures the two paths they were written for: writing a
// column of zoned values, and reading dates back. Neither says what happens to
// the rest of the library, and several patches are not confined to formatting —
// F interns Locales, and G memoizes the tokenizer both directions use as well as
// rewriting arithmetic in shared helpers. A patch that buys 40% on one path and
// costs 10% on twenty others is not filable, and no table there would have shown
// it.
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
//     measures one case across every build, and wants the difference between
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
//   * F interned only Locales built with no outputCalendar, and Info.months and
//     Info.monthsFormat pass "gregory" explicitly — so those two paid F's check
//     and got nothing, coming out 12-17% slower than stock while Info.weekdays
//     (which passes null) came out 45% faster. F now interns both shapes.
//   * B, D and E each added a module-level cache that Settings.resetCaches()
//     did not reach, which is what their two resetCaches() cases are for. A cache
//     that survives a documented reset is a behavior change rather than a
//     memoization, and these patches only claim the latter.
//
// Run: node suite.ts               (~15s of timing, plus a cooldown per row)
//      bun suite.ts                (the same under JavaScriptCore, which is
//                                   noisier — see the pass spread under the
//                                   table)
//      ... --only <substring>      (just the matching cases, for iterating)
//      ... --cooldown 0            (no idling between rows, for the same)
//
// Which patch moves which case, and why the two resetCaches() rows are supposed
// to read as null, is in benchmarks/docs/suite.md. This file prints the table.

import { measureRows, pkgVersion, runtime, type SampleBudget, type Work } from "./lib/kernel.ts";
import type { DateTimeWithLoc } from "./lib/luxon-types.ts";
import { cooldownMs } from "./lib/opts.ts";
import { loadLuxon, patchKeys, type LuxonModule, type PatchKey } from "./lib/patches.ts";
import { streamTable } from "./lib/stream-table.ts";

// Reported per call, which is what a suite of unrelated one-shot operations
// wants: these cases span ~0.1µs (DateTime.now) to ~100µs (a formatted value
// with the caches reset), and ms-per-N-values would print half of them as 0.
// The kernel reports ms per `REPORT` calls, so at 1000 the figure it hands back
// is already µs per call.
const REPORT = 1_000;

/** where the prose went */
const DOCS = "benchmarks/docs";

// Per-pass budget handed to the kernel's sizing, and the pass count, traded
// against each other: this table's error is jitter rather than resolution — no
// case here costs more than ~150µs, so every cell clears the kernel's own pass
// floor easily — and against jitter more passes buy more than longer ones do.
// Measured back when this table carried a control column, which is the same
// library twice and so reported exactly this error: 3 passes of 40ms drifted
// 1.3% median and 13% worst, 6 of 25ms drift 2.4-3.1% median and 7-11% worst,
// and 8 of 20ms were no better than 6. The middle setting was chosen there, at
// 116 cells (29 cases x the 4 columns this had at the time); it now runs 2
// columns wide, and the passes it keeps are also what the spread is read off.
const PASS_BUDGET_MS = 25;
const PASSES: SampleBudget = { min: 6, max: 8, budgetMs: 150 };

// Below either of these a difference is not worth reading as one, whatever the
// measured spread happened to be.
//
// Both were set against the control column this table used to carry, on a quiet
// host: the percentage from that control's median drift (~1-3%), and the
// absolute one from the cheapest cases, Info's four "with existing locale" calls
// at ~65ns of map lookups, which the control moved 5-15% — under 10ns, neither
// resolvable here nor actionable if it were. Both have to be cleared, which
// leaves the verdict listing only what a reader could act on.
//
// They have NOT been re-confirmed against the pass-spread floor that replaced
// the control, which wants a run on an idle machine rather than a thermally
// limited one. Treat them as inherited until then.
const MIN_INTERESTING_PCT = 3;
const MIN_INTERESTING_US = 0.02;

// ---- builds under test ------------------------------------------------------

interface Column {
  label: string;
  keys: readonly PatchKey[];
}

const COLUMNS: Column[] = [
  { label: "stock", keys: [] },
  // The whole set. There is no intermediate column: every patch in
  // benchmarks/patches is intended to land, so the question this table answers is
  // what a caller gets, and the per-patch attribution is benchmarks/upstream.ts's
  // ladder rather than a second column here.
  { label: `all ${patchKeys.length}`, keys: patchKeys },
];

const STOCK = "stock";

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
// caller actually takes, and F (localeIntern) is a patch to exactly that.
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
console.log(
  `µs per call, fastest of ${PASSES.min}-${PASSES.max} interleaved passes` +
    `${cooldownMs > 0 ? `, ${cooldownMs / 1000}s idle between rows` : ", no cooldown"}\n`
);

const modules = new Map<string, LuxonModule>();

for (const col of COLUMNS) {
  modules.set(col.label, await loadLuxon(col.keys));
}

const key = (col: string, name: string) => `${col}\u0000${name}`;

// ---- report -----------------------------------------------------------------

const us = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const pct = (v: number) => (v > 0 ? "+" : "") + v.toFixed(1);

const patched = COLUMNS.filter((c) => c.label !== STOCK);

const best = new Map<string, number>();
/** how far apart two independent readings of a cell landed, as a percentage */
const jitter = new Map<string, number>();

const delta = (col: string, name: string) => {
  const base = best.get(key(STOCK, name))!;

  return ((best.get(key(col, name))! - base) / base) * 100;
};

const table = streamTable(["case", "stock µs", ...patched.flatMap((col) => [`${col.label} µs`, "Δ%"])], {
  minWidths: { 0: 40, 1: 8, 2: 8, 3: 6 },
});

// Case-major, so the columns of one case are timed next to each other: what is
// compared is their ratio, and drift over the window is the one error a ratio
// does not cancel. Rows are then cooled between, since nothing compares one case
// against another.
//
// Every case ignores the instant it is handed — luxon's suite feeds each of its
// callbacks one fixed input, and the point here is to reproduce their case, not
// to sweep it — so the step is 0 and the base is only there to satisfy the kernel.
const run = await measureRows(
  cases,
  (kase) => [
    {
      entries: COLUMNS.map((col) => ({ key: key(col.label, kase.name), work: kase.make(modules.get(col.label)!) })),
      passBudget: PASSES,
      budgetMs: PASS_BUDGET_MS,
      // COLUMNS.length as the group size, which is what makes the columns of a
      // case comparable at all: the cell measured right after the previous case
      // pays for that case, by up to 2.5x on the allocating cases, and without
      // the rotation it is the same column every pass. See rotateGroups in the
      // kernel.
      group: COLUMNS.length,
    },
  ],
  { base: DT_TS, step: 0, report: REPORT, cooldownMs },
  (kase, measured) => {
    for (const [k, v] of measured.best) best.set(k, v);
    for (const [k, v] of measured.spread) jitter.set(k, v * 100);

    table.row([
      kase.name,
      us(best.get(key(STOCK, kase.name))!),
      ...patched.flatMap((col) => [us(best.get(key(col.label, kase.name))!), pct(delta(col.label, kase.name))]),
    ]);
  }
);

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
  table.rule();
  table.row(["geometric mean", "", ...patched.flatMap((col) => ["", pct(geomean(col.label))])]);
}

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

// ---- what a difference has to beat ------------------------------------------
//
// This used to be a control column: stock loaded a second time, timed as its own
// neighbour, its Δ% read as the floor. That measured the right thing and paid for
// it in the currency it was measuring — a third more time under sustained load on
// a host that throttles, to find out how much the load was distorting things.
//
// The replacement is free, because the passes were run anyway: each cell's
// passes split in half, each half's fastest taken, and the two compared. That is
// the same statistic the control reported — the gap between two minima of
// identical code — without the second column. See `spread` in the kernel.
//
// It is narrower than the control in one respect: both halves are inside one
// row, so it cannot see drift between rows. That is what the cooldown is for.

/** the noisier of a case's two cells, since either can be the unresolved one */
const caseJitter = (name: string) => {
  const seen = COLUMNS.map((col) => jitter.get(key(col.label, name))).filter(
    (v): v is number => v !== undefined && !Number.isNaN(v)
  );

  // NaN from the kernel means the passes did not cover two rotation cycles, so
  // there is nothing to read a floor off. PASSES is set well above that; if it
  // ever is not, fall through to the fixed thresholds rather than to zero.
  return seen.length === 0 ? Infinity : Math.max(...seen);
};

const drift = cases.map((k) => caseJitter(k.name)).sort((a, b) => a - b);
const median = drift[drift.length >> 1]!;

/**
 * The table's jitter on all but its worst tenth of cases, used as a floor for
 * every case rather than only for the case it came from.
 *
 * A single case's jitter is one comparison, so a case whose two halves happened
 * to agree closely gets an unrealistically tight floor and then reports the next
 * run's noise as a finding — which it did, back when this was per-case control
 * drift: successive runs each listed three or four cases as 3-7% slower and
 * never the same ones. The high percentile is the table's own answer to "how far
 * apart can two readings of identical code land", and it is what makes the
 * verdict repeatable.
 */
const spread = drift[Math.min(drift.length - 1, Math.floor(drift.length * 0.9))]!;

// Per case, the larger of its own jitter and that table-wide spread, so a case
// that is noisier than most is held to its own standard.
const floor = (name: string) => Math.max(MIN_INTERESTING_PCT, spread, caseJitter(name));

const movedUs = (col: string, name: string) => Math.abs(best.get(key(col, name))! - best.get(key(STOCK, name))!);

const verdict = patched
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

// The floor is the only thing here a reader has to have to read the Δ% column at
// all. What the moved cases mean is in DOCS/suite.md.
console.log(`
Δ% is against stock, negative faster. Two passes of the same cell landed ${pct(median)}% apart at the median,
${pct(spread)}% at the ninth decile, ${pct(drift.at(-1)!)}% worst, which is the floor a difference has to clear. A case
counts as moved below when it clears the decile and moves at least ${MIN_INTERESTING_US.toFixed(2)}µs.

verdict against ${cases.length} of luxon's own cases:
${verdict}`);

console.log(`\nwhat this table means: ${DOCS}/suite.md   how it is timed: ${DOCS}/methodology.md`);

if (mismatched.length > 0) {
  console.log(`\nCHECKSUM MISMATCH — these cases did not return stock's value:`);
  for (const line of mismatched) console.log(`  ${line}`);
}

// Keeps the loops from being elided. Printed rather than voided so it is visibly
// consumed, but it is not a run-to-run signal and does not stay put across runs:
// the pass sizing adapts to the host, so what varies is how many iterations got
// summed. The cross-build parity check is `mismatched` above, which compares
// each build's value against stock's on identical inputs.
console.log(`\nchecksum: ${run.checksum.toFixed(0)}`);
