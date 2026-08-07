// The timing kernel shared by benchmarks/suite.ts, upstream.ts and format.ts.
//
// These benches compare builds of luxon against each other rather than reporting
// an absolute rate, so what they need from a timer is that the ERROR BETWEEN
// COLUMNS be small — a systematic drift across the measurement window is the one
// error a ratio does not cancel. Hence the three things this does that a general
// benchmarking library does not: it sizes every entry's pass to a wall-time
// budget rather than a value count (paths here span a 20x cost range), it
// interleaves passes across the entries of one row rather than running each to
// completion, and it idles between rows so the host is in a comparable state for
// each of them.
//
// It is deliberately not tinybench, which luxon's own suites in datetime.js and
// info.js use. Those measure one build's cases against each other and want an
// ops/sec with a confidence interval; these measure the same case across several
// builds and want the difference between them to mean something.
//
// Drift is handled in two places for two reasons. Interleaving handles it WITHIN
// a row, where the cells are compared directly and the window is short. Cooling
// handles it BETWEEN rows, where interleaving would mean holding every row's
// state open at once and where the gaps are long enough for a thermally limited
// host to have moved. These benches used to carry control rows — the same build
// measured twice — to say how much drift was left over; those are gone, because
// a control is another row of the load it is measuring.

import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

export interface SampleBudget {
  min: number; // always take at least this many passes, however slow
  max: number; // never take more, however cheap
  budgetMs: number; // stop past `min` once this much per-entry wall time is spent
}

// ---- report headers ---------------------------------------------------------

const REPO = new URL("../../", import.meta.url);

/**
 * Version of luxon itself, or of an installed benchmark dependency, for the line
 * every bench opens with.
 */
export async function pkgVersion(name = "luxon"): Promise<string> {
  const path =
    name === "luxon" ? new URL("package.json", REPO) : new URL(`../node_modules/${name}/package.json`, import.meta.url);

  const pkg = JSON.parse(await readFile(path, "utf8")) as { version: string };

  return pkg.version;
}

/**
 * Which engine these numbers came off. Worth printing rather than assuming: bun
 * is JavaScriptCore and node is V8, and the patches turn on allocation and
 * inline-cache behavior that the two do not have to agree about.
 */
export function runtime(): string {
  const versions = process.versions as Record<string, string | undefined>;

  return versions["bun"] === undefined
    ? `node ${versions["node"]!} (V8 ${versions["v8"]!})`
    : `bun ${versions["bun"]} (JavaScriptCore)`;
}

// ---- measurement ------------------------------------------------------------

/**
 * One unit of the work being measured: given an instant, do the thing, and
 * return a number for the loop to sum so the engine cannot elide the call.
 *
 * A number rather than the output itself, because the tables measure different
 * work. A formatting entry returns its output's length; a parsing entry
 * (benchmarks/upstream.ts) returns the instant it parsed, which doubles as a
 * check — a parse that quietly fails returns NaN rather than a suspiciously fast
 * success, and NaN then poisons the checksum the caller asserts on.
 */
export type Work = (ts: number) => number;

export interface LoopResult {
  ms: number;
  /** summed Work results — consumed by the caller so the loop can't be elided */
  checksum: number;
}

export function timeLoop(work: Work, base: number, step: number, n: number): LoopResult {
  let checksum = 0;

  // performance.now() rather than Bun.nanoseconds(), so these benches run under
  // node too: luxon's users are overwhelmingly on V8, and bun is JavaScriptCore
  const t0 = performance.now();

  for (let i = 0; i < n; i++) {
    checksum += work(base + i * step);
  }

  return { ms: performance.now() - t0, checksum };
}

// Default wall-time budget for ONE timed pass. Paths here span a 20x cost range
// — stock luxon on an abbreviation format constructs an Intl.DateTimeFormat per
// value at ~100µs, against ~5µs for everything else — so timing them all over
// the same value count spends almost the whole benchmark inside the slowest
// column, which is also the column whose number nobody is surprised by. Each
// entry instead gets the number of values that fits this budget, and its result
// is scaled back to `report` values.
//
// This is a resolution knob, not just a speed one: a path whose full pass fits
// under the budget is timed in full, and shortening a pass costs precision. Set
// it above a full pass of everything the caller needs to resolve finely and only
// the outliers get shortened. The default clears a full 10k-value pass on the
// ~5µs/value paths.
const DEFAULT_BUDGET_MS = 75;

// Floor on a timed pass regardless of cost. Below a few hundred values the
// timing is dominated by whatever else the engine is doing: at n=250 the stock
// abbr path reads ~40% high, at n=500 it is back in line with n=2000.
const MIN_PASS = 500;

// Floor on how long a timed pass should RUN, which is the same concern in the
// other direction. The cheapest paths here get through `report` values in
// 10-20ms, and at that scale scheduling jitter rivals the signal — measured back
// when these tables carried controls, those were the rows whose control
// disagreed by ~11% while the expensive ones sat at 1-2%.
// A path that cheap is given more than `report` values so its pass reaches this
// floor, and the result is scaled back down the same way a shortened pass is
// scaled up. Unlike shortening, this only buys precision: it costs a few hundred
// ms across a whole bench, and the rows it lengthens are the ones that were
// least trustworthy.
const MIN_PASS_MS = 40;

// How long a calibration sample has to run before its rate is worth using. Only
// needs to be right to within a factor that would change the chosen n
// materially, and 4ms is ~40x the clock's resolution — at 8ms the doubling ran
// one extra round per entry, which across a bench's cells cost more than the
// sizing saved.
const CALIBRATE_MS = 4;

// How many values to time `work` over: what it gets through in `budgetMs`,
// bounded below by MIN_PASS and above by `report` — or by whatever exceeds
// `report` if a full pass would be too quick to time (MIN_PASS_MS). Grows a
// sample until it is long enough to extrapolate from, so a cheap path is never
// made to run a long pass just to be measured.
//
// The first sample is thrown away. Read cold it is worthless — first-call costs
// alone put a ~4µs/value path over the threshold, which sizes it like a ~60µs
// one — and by the time the doubling reaches a usable sample the entry has run a
// few thousand values, which is the warm-up the drivers used to do by hand. The
// best of two samples is taken at the end for the same reason timing noise is
// one-sided: a slow reading is interference, a fast one is not.
function passSize(
  work: Work,
  base: number,
  step: number,
  report: number,
  budgetMs: number
): { n: number; checksum: number } {
  let n = 256;
  let checksum = timeLoop(work, base, step, n).checksum;
  let run = timeLoop(work, base, step, n);

  checksum += run.checksum;

  while (run.ms < CALIBRATE_MS && n < report) {
    n *= 2;
    run = timeLoop(work, base, step, n);
    checksum += run.checksum;
  }

  const again = timeLoop(work, base, step, n);
  const ms = Math.min(run.ms, again.ms);

  checksum += again.checksum;

  const perValue = ms / n;
  // `report`, or more if that is too quick to time
  const ceiling = Math.max(report, Math.round(MIN_PASS_MS / perValue));
  const wanted = Math.min(Math.round(budgetMs / perValue), ceiling);

  return { n: Math.max(MIN_PASS, wanted), checksum };
}

/**
 * Repeatedly times every entry INTERLEAVED — one pass of each per round, rather
 * than all of one entry's passes back to back — and reports each entry's FASTEST
 * pass, normalized to `report` values.
 *
 * Fastest, not median: the slow passes are JIT ramp and ambient interference,
 * and both only ever add time. That matters more than usual here, because these
 * benches run long enough on a thermally limited host to throttle partway
 * through — under which a median tracks the throttling and a minimum does not.
 * It is also what lets the pass count come down: a median needs enough samples
 * to place a middle, whereas a minimum needs only one clean pass, so three
 * passes buy what seven did.
 *
 * Interleaving still earns its keep alongside the minimum. It spreads each
 * entry's passes across the whole measurement window, so a cool moment early or
 * a throttled stretch late is offered to every entry rather than to whichever
 * happened to be running — and since the reported number is a ratio between
 * entries, systematic drift across them is the one error that does not cancel.
 * Callers hand this one ROW's entries (see measureRows), so the window it
 * spreads them over is short and the entries in it are the ones compared
 * directly.
 *
 * There is no separate warm-up pass. Both engines allocate type feedback per
 * CALL SITE, so a warm-up loop trains different slots than the timed loop, and
 * only re-running the timed loop itself tiers it up. The pass sizing above
 * already runs a few thousand values per entry getting its rate, which covers
 * what a warm-up would have.
 *
 * `scaled` names the entries measured over fewer than `report` values, so the
 * caller can say so rather than implying every column was timed identically, and
 * `sizes` gives the value count each entry was actually timed over, for a caller
 * whose whole table is scaled and wants to print the range it really ran.
 * `passes` reports how many rounds the budget allowed — the reader's check that
 * a row was not measured once and believed. The summed checksum comes back so
 * the caller can keep feeding its sink.
 *
 * `group`, when the entry list is consecutive groups of that size measuring the
 * same operation different ways, rotates the order WITHIN each group per pass.
 * See rotateGroups for why that is not cosmetic.
 */
export function interleavedBest<K>(
  entries: { key: K; work: Work }[],
  base: number,
  step: number,
  report: number,
  passBudget: SampleBudget,
  budgetMs = DEFAULT_BUDGET_MS,
  group = 0
): Measured<K> {
  const best = new Map<K, number>();
  // fastest pass within each half of the pass sequence, interleaved a rotation
  // cycle at a time — see `spread`
  const half: [Map<K, number>, Map<K, number>] = [new Map(), new Map()];
  const cycle = Math.max(1, group);
  const scaled: K[] = [];
  let checksum = 0;

  const sized = entries.map(({ key, work }) => {
    const sample = passSize(work, base, step, report, budgetMs);
    const n = sample.n;

    checksum += sample.checksum;

    if (n < report) scaled.push(key);

    return { key, work, n };
  });

  let passes = 0;
  let spent = 0; // per-entry timed ms, which the sizing has made roughly equal

  while (passes < passBudget.max) {
    let round = 0;

    for (const { key, work, n } of rotateGroups(sized, group, passes)) {
      const run = timeLoop(work, base, step, n);

      checksum += run.checksum;
      round += run.ms;

      // per-value cost is flat across n for every path here (the expensive one
      // does the same fixed work per value), so this is a unit conversion
      const ms = (run.ms * report) / n;
      const prev = best.get(key);

      if (prev === undefined || ms < prev) best.set(key, ms);

      const side = half[Math.floor(passes / cycle) % 2]!;
      const sidePrev = side.get(key);

      if (sidePrev === undefined || ms < sidePrev) side.set(key, ms);
    }

    passes++;
    spent += round / sized.length;

    if (passes >= passBudget.min && spent >= passBudget.budgetMs) break;
  }

  const spread = new Map<K, number>();

  for (const [key, fastest] of best) {
    const a = half[0]!.get(key);
    const b = half[1]!.get(key);

    spread.set(key, a === undefined || b === undefined ? NaN : Math.abs(a - b) / fastest);
  }

  return { best, spread, checksum, scaled, sizes: new Map(sized.map(({ key, n }) => [key, n])), passes };
}

// ---- rows -------------------------------------------------------------------

/**
 * A row's worth of results, plus what the row cost to get.
 *
 * `spread` is this kernel's replacement for the control rows these tables used
 * to carry: how far apart two independent readings of the SAME cell landed, so a
 * difference smaller than it was not resolved.
 *
 * It is built to be the statistic the control was. A control measured the gap
 * between two MINIMA of identical code — one column's fastest pass against its
 * twin's — and a minimum over several passes has already thrown away most of the
 * noise, so that gap is much tighter than the gap between two raw passes. Split
 * the passes into two halves, take each half's minimum, and read the difference:
 * same statistic, no second column, and it costs nothing because the passes were
 * run anyway.
 *
 * The halves interleave rather than being consecutive, so each spans the whole
 * measurement window. Consecutive halves would make this read the drift from the
 * first half of a row to the second, which is a different quantity and one the
 * cooldown between rows already addresses.
 *
 * They interleave a whole ROTATION CYCLE at a time rather than pass by pass,
 * which matters and is not obvious. rotateGroups moves the penalized front slot
 * along by one per pass, so with a group of two the even passes all have one
 * column in that slot and the odd passes all have the other. Splitting on pass
 * parity would then put every one of a column's penalized passes in one half and
 * none in the other, and this would report the boundary penalty as noise rather
 * than the noise. Whole cycles put the same set of slot positions in both
 * halves, which is what makes the two comparable at all.
 *
 * NaN when the passes did not cover two cycles, which is the honest answer:
 * there was nothing to compare against. Callers wanting a floor need a pass
 * count of at least twice their group size.
 *
 * It reads WIDER than the control did, systematically, and the reason is worth
 * knowing before treating a number off it as the same number. Each half has half
 * the passes, so each half's minimum is a worse estimate of the cell's floor
 * than the reported minimum — which is taken over all of them — and the gap
 * between two worse estimates is larger than the gap between two better ones.
 * So this overstates the uncertainty of the figure it guards, by more the fewer
 * passes there are. That is the safe direction for a threshold, but it means a
 * caller porting a control-calibrated constant across should re-derive it rather
 * than assume it carries.
 *
 * What it does not see is drift BETWEEN rows: both halves are inside one row.
 * That is the cooldown's job, and it is why this is a floor rather than a total
 * error bar.
 */
export interface Measured<K> {
  best: Map<K, number>;
  spread: Map<K, number>;
  checksum: number;
  scaled: K[];
  sizes: Map<K, number>;
  passes: number;
}

/**
 * One independently budgeted group of cells within a row.
 *
 * A row is usually one segment. It is more than one when the cells in it want
 * different pass settings and still belong on the same line — benchmarks/
 * upstream.ts's ladder is the case: its writing columns cost ~5-100µs a value
 * and its reading columns 3-40µs, and the two were separate tables with
 * separately measured budgets before they were merged. Sizing them to a single
 * budget would spend most of the bench in whichever direction is dearer.
 *
 * Segments are interleaved within themselves and not across each other, which
 * costs nothing: what a segment exists for is that its cells are NOT comparable
 * with the other segment's. Nothing reads a writing column against a reading one.
 */
export interface RowSegment<K> {
  entries: { key: K; work: Work }[];
  passBudget: SampleBudget;
  budgetMs?: number;
  group?: number;
}

/** One row's cells, merged across its segments. */
export interface RowResult<K> {
  best: Map<K, number>;
  spread: Map<K, number>;
  sizes: Map<K, number>;
  /** passes taken, per segment in the order they were given */
  passes: number[];
}

/**
 * Idles for `ms`, letting a thermally limited host come back toward the state
 * the previous row was measured in.
 *
 * Deliberately a plain sleep and not a busy loop: the point is for the machine
 * to be doing nothing. Whether it has actually cooled by the end is not
 * something a benchmark can check from inside the process, so this is a
 * best-effort control on the input rather than a guarantee about the output —
 * which is the honest description of every thermal mitigation short of pinning
 * the clock.
 */
export async function cooldown(ms: number): Promise<void> {
  if (ms > 0) await sleep(ms);
}

/**
 * Measures a list of rows one at a time, handing each result to `emit` as soon
 * as it exists and idling `cooldownMs` between them.
 *
 * Streaming rather than collecting is the point of the shape: these benches run
 * for minutes, and a table that appears all at once at the end is a table nobody
 * watches. It also means a run killed halfway still reported everything it
 * finished.
 *
 * Interleaving happens inside a row and not across the table. That is a real
 * narrowing — a row measured late is measured on a host that has been working
 * for longer — and the cooldown between rows is what pays for it. The comparison
 * a row is FOR (its own cells against each other) keeps the tight interleaved
 * window it always had.
 *
 * A row is measured as one or more RowSegments, each with its own pass settings,
 * and printed as one line. One segment is the usual case; see RowSegment for
 * when it is not.
 */
export async function measureRows<R, K>(
  rows: R[],
  segmentsFor: (row: R) => RowSegment<K>[],
  opts: { base: number; step: number; report: number; cooldownMs: number },
  emit: (row: R, result: RowResult<K>) => void
): Promise<{ checksum: number; scaled: K[]; passes: Set<number>; sizes: number[] }> {
  let checksum = 0;
  const scaled: K[] = [];
  const passes = new Set<number>();
  const sizes: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    // Before rather than after, so the LAST row is not followed by a wait
    // nothing is waiting for, and the first row is measured on a host that has
    // just been loading modules and sizing passes like every other row.
    if (i > 0) await cooldown(opts.cooldownMs);

    const row = rows[i]!;
    const result: RowResult<K> = { best: new Map(), spread: new Map(), sizes: new Map(), passes: [] };

    for (const segment of segmentsFor(row)) {
      const measured = interleavedBest(
        segment.entries,
        opts.base,
        opts.step,
        opts.report,
        segment.passBudget,
        segment.budgetMs,
        segment.group ?? 0
      );

      checksum += measured.checksum;
      scaled.push(...measured.scaled);
      passes.add(measured.passes);
      sizes.push(...measured.sizes.values());

      result.passes.push(measured.passes);

      for (const [k, v] of measured.best) result.best.set(k, v);
      for (const [k, v] of measured.spread) result.spread.set(k, v);
      for (const [k, v] of measured.sizes) result.sizes.set(k, v);
    }

    emit(row, result);
  }

  return { checksum, scaled, passes, sizes };
}

// ---- sizing for a wide table ------------------------------------------------

// What the API columns of benchmarks/upstream.ts's ladder run `interleavedBest`
// at. Those are 30 columns across ten luxon builds plus a moment row, where
// the default DEFAULT_BUDGET_MS and a 3-7 pass range put the bench into minutes
// of sustained load — long enough on a thermally limited host that it starts
// measuring its own cooling.
//
// Calibrated when they were a table of their own (benchmarks/coverage.ts, since
// merged into the ladder); the per-entry cost range they were swept over is the
// same, which is what the calibration is a function of.
//
// Swept against a deliberately expensive reference (150ms x 5-9 passes) over
// entries spanning this table's cost range, worst per-entry deviation:
//
//   10ms x 3-3    46.7%     737ms      calibration falls apart
//   15ms x 3-4    41.4%     859ms      same
//   25ms x 3-4     8.8%    1171ms
//   40ms x 3-5     5.6%    1453ms
//   75ms x 3-7     8.1%    2433ms      the default
//
// Two readings of the reference itself disagreed by up to 4.5%, so everything
// from 25ms up is at the noise floor and the default buys nothing over 40ms for
// 1.7x the time. Below 25ms it is not a matter of precision: `passSize` cannot
// calibrate in that little time, picks a tiny n, and `fromISO` reads 40% high.
//
// The pass count is then pinned rather than ranged, and pinned to the caller's
// GROUP SIZE. Rotation moves the front slot along by one per pass, and that slot
// is the penalized one: it holds the entry measured right after the workload
// changed, which pays for collecting the previous entry's garbage. Stopping
// after fewer passes than there are entries leaves some of them having never
// held that slot and some having held it once, which the fastest-pass rule then
// bakes in rather than cancels. Under JavaScriptCore that showed up, back when
// these tables carried a control, as the control column sitting 10-18% BELOW
// stock on a third of the rows, one-sided and reproducible; a full rotation put
// it back inside a few percent. The control is gone and the constraint is not:
// keep the pass count at or above the group size.
export const LEAN_BUDGET: SampleBudget = { min: 3, max: 3, budgetMs: 120 };
export const LEAN_BUDGET_MS = 40;

// A note on warming, since the obvious next economy is to stop paying for it on
// every pass: size each entry's warm-up separately, run it until its per-call
// rate stops improving, and then time passes only long enough to read a clock.
// That was built and measured, and it is worse on every axis.
//
// It does not buy anything, because there is nothing to buy. Measured cold in a
// FRESH PROCESS per cell, an entry given no warm-up at all reads within 20% of
// one given 32,000 warm calls, and most of that gap closes by the first few
// hundred. Taking the FASTEST of several passes is already the warm-up: by the
// last pass the entry has run tens of thousands of times, and the minimum is
// what that pass reports. An explicit ramp re-derives a number the pass loop
// gets for free.
//
// It costs roughly twice the calls it certifies, since a doubling ramp spends as
// much reaching a size as it spent getting there, and that is exactly the load
// the exercise set out to remove.
//
// And it does not survive contact with the entries. Detecting "stopped
// improving" needs a per-batch rate to be stable, and it is not: a single batch
// varies ±40% here even at 65,536 values, so the rule fired on noise and the
// same entry ramped to 39k calls on one run and 157k on the next. The ramp's own
// allocation churn then perturbed the short passes it was supposed to make
// trustworthy, and moment#add — timed at 1,300 values per pass after a ramp —
// read 2.16x its settled cost.
//
// `interleavedBest` above therefore has no warm-up phase, by measurement rather
// than by oversight. Cheaper passes come from a smaller budget, not from a ramp.

/**
 * Rotates each consecutive run of `size` entries left by `by`, leaving the runs
 * themselves in place. A no-op for size 0 or 1.
 *
 * What this is for: the entry measured immediately after the workload CHANGES
 * pays for the change, and on an allocation-heavy path it pays a lot — up to 2.5x
 * on `DateTime#add` in benchmarks/suite.ts, reproducibly, and it survives a
 * warm-up prologue, so it is the previous entry's garbage being collected rather
 * than this one being cold. When the list is grouped by case, that penalty always
 * lands on the same member of every group (the one right after the previous
 * case), so it does not cancel in a ratio and taking the fastest pass does not
 * remove it: every pass penalizes the same member.
 *
 * Rotating the whole list per pass would not help — that preserves who follows
 * whom — so the rotation has to be inside the group, which moves the boundary
 * slot from one member to the next each pass. Over a few passes every member gets
 * at least one pass away from the boundary, and since the reported figure is the
 * fastest pass, that is the one that survives. Costs nothing: the same entries
 * run the same number of times, in a different order.
 */
function rotateGroups<T>(entries: T[], size: number, by: number): T[] {
  if (size < 2) {
    return entries;
  }

  const out: T[] = [];

  for (let start = 0; start < entries.length; start += size) {
    const chunk = entries.slice(start, start + size);
    const at = by % chunk.length;

    out.push(...chunk.slice(at), ...chunk.slice(0, at));
  }

  return out;
}
