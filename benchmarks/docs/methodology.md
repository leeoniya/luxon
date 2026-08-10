# methodology

How everything here is timed, and how to read a number that comes out of it.
This is the part the five benches share; each of them documents its own tables
in its own file.

## Why not tinybench

Luxon's own suites (`datetime.js`, `info.js`) use tinybench, and they are right
to: they measure one build's cases against each other and want an ops/sec with a
confidence interval on it.

These benches want something different. They measure the *same* case across
several builds, and the thing that has to mean something is the difference
between those builds — often a few percent. That needs adaptive pass sizing and
interleaving rather than a confidence interval, which is what
[`lib/kernel.ts`](../lib/kernel.ts) is.

## Interleaving, and cooling

Drift over a run — thermal, GC state, an unrelated process — is the one error a
ratio does not cancel. Two things address it, in different places.

**Within a row**, the cells are interleaved: one pass of each, then another, and
so on, rather than running each cell to completion. So the readings being
compared are close together in time. Within a row the order also rotates from
pass to pass, because the cell measured immediately after the workload changes
pays for collecting the previous one's garbage, and without rotation that is the
same cell every pass.

**Between rows**, the machine idles. These benches are minutes of sustained load
on hosts that throttle, so a row measured late would otherwise be measured on a
hotter machine than a row measured early. `--cooldown <ms>` sets the idle, ten
seconds by default; `--cooldown 0` turns it off, which is what to do when
iterating on a patch and comparing a run against itself rather than reading rows
against each other. `--verify` also defaults to zero because its result is the
correctness checks, not the timing rows; an explicit cooldown still overrides it.

Rows are printed as they finish rather than at the end, which is what makes a
bench that runs for minutes watchable — and means a run stopped halfway has
still reported everything it completed.

On a terminal, tables with a moment baseline shade each timing by how it compares
to moment's: moment itself keeps the default colour, faster goes green, slower
goes red, on a log scale because these ratios span two orders of magnitude.
Anything within ~10% is left plain, which is loose on purpose — it is a rough
stand-in for the noise floor, not a substitute for the measured per-column
floors printed under each table. Redirected terminal output is never shaded.

`upstream` adds an independent row-to-row signal without replacing those
colours: a significant patch step is underlined in both the terminal and HTML.
The first patch is compared with stock luxon and each later patch with the rung
above it. An underline is added only when that movement stays within the same
baseline-relative colour bucket; reference and footer rows are never marked.
The threshold starts at 10%; either cell's measured spread can widen it so noise
does not acquire emphasis.
An absolute difference of 1.5ms or less is also left unmarked regardless of its
ratio, since movement that small is treated as thermal noise.
If the rendered values have different string lengths, the digit-boundary change
is left to speak for itself and no underline is added.

Columns for Luxon-only operations have no moment cell to shade against: moment
ships no `Interval`, compiled format-parser API, `Duration#shiftTo`, or
`Duration#toFormat`. Date-fns fills its row only where its public API expresses
the same operation; it is not a shading anchor. Missing moment cells take stock
luxon as their colour baseline instead, so they are read as what the patches did
to luxon rather than as a comparison between libraries.

A row is usually one interleaved group, but it can be several: `upstream`'s
ladder times its writing and its reading columns as two, because they need
different pass sizing. Interleaving is per group, which costs nothing when the
groups are the ones whose cells are not compared with each other in the first
place.

Each cell is the *fastest* pass rather than the mean or the median. The fastest
pass is the one with the least interference in it, and interference is
one-sided: nothing makes a run spuriously fast. Warmups are skipped for the same
reason — a pass that ran cold is simply not the fastest one, so it drops out on
its own rather than needing to be discarded by hand.

## The noise floor

Read every column no finer than its floor. A patch whose margin does not clear
the floor has not been shown to do anything, whatever the sign on it. Where a
table's rows span very different timing scales, the floor is reported per column,
because relative noise is larger on the fast rows.

The floor is measured, not assumed, and it comes from the passes each cell
already ran: split them into two halves, take each half's fastest, and compare.
Two readings of identical code, so a difference smaller than the gap between them
was not resolved.

These tables used to get that number from a *control* — the same stock source
loaded a second time as a separate module instance and timed as its own
neighbour. That measured the right thing and paid for it in the currency it was
measuring: a whole extra column of load, on a host where load is the problem.
The split-half figure is the same statistic without the extra column.

One caveat on it. Each half has half the passes, so each half's minimum is a
worse estimate than the reported minimum, which is taken over all of them — and
the gap between two worse estimates is wider than the gap between two better
ones. So the floor errs wide. That is the safe direction for a threshold, but a
constant calibrated against the old control does not carry across unchanged.

Reference rows are not controls and have not gone anywhere: moment,
moment-timezone, stock luxon, the unpatched easy-tz zone, and stock luxon with a
zone named are all still there; date-fns with `@date-fns/tz` is available as an
optional row. A control repeats a configuration to measure noise; a reference
is a distinct implementation or configuration worth reading beside the ladder.

## Pass sizing and scaling

A pass runs for a time budget rather than a fixed iteration count, so a cheap
cell runs more iterations than an expensive one and both stay above the clock's
resolution. Cells are then scaled to a common denominator for reporting.

That is safe here because per-value cost is flat in the pass length — the work
is fixed per value, and none of these paths amortize anything across a loop that
the pool doesn't already defeat. Where a bench scales a row it says so under the
table, and every reference used for a comparison is timed over the full count.

Inputs come from a pre-rendered pool, cycled, since neither library caches by
input string and a single repeated input would measure a branch predictor.

Setup that a repeated caller would naturally retain is built before timing:
resolved zones and date-fns contexts, locales, parser references, fixed options,
unit lists, and method receivers. The broad formatting columns deliberately
remain whole operations from a timestamp — `fromMillis(...).toFormat(...)`,
`moment(...).format(...)`, or date-fns `format(timestamp, ..., { in })` — while
the adjacent `toFormat` columns use prebuilt receiver pools to isolate formatting
from construction. Keeping both avoids charging method-only columns for caller
setup without hiding construction from the end-to-end columns.

## What a "patched build" is

Nothing here modifies `src/`. A build is a copy of `src/` with some subset of the
diffs in [`patches/`](../patches) applied textually, written to
`.tmp/builds/<set>/` and imported from there. Each distinct subset gets its own
directory and therefore its own module instance, so one variant's internal caches
can never warm another's — which matters, because most of these patches *are*
caches.

The same rule reaches the baselines. moment is loaded more than once too, and the
reason is not caches but object shapes: it hands back differently shaped objects
depending on whether you parsed a date or built one from a timestamp, and a
single call of the one kind permanently slows a loop doing the other. Cells that
build the same shape share an instance; cells that do not, do not. See the
[upstream](upstream.md#the-moment-row-gets-several-moments) note for the
measurement — it is a real property of moment, not of this harness, and it cost
the formatting columns 13-19% the once it went unnoticed.

## Correctness before speed

A patch that changes an answer fails the bench rather than winning it. Every
check that establishes this is behind `--verify`, and none of them runs in a
plain timing run:

- `upstream` and `format` compare rendered output across builds exhaustively,
  across zones, locales, styles and transitions.
- `upstream`'s API columns require every build in the ladder to return identical
  results for every case, checked during setup before anything is timed.
- The reading columns read each value back to the instant it was rendered from,
  since a build that cannot read a shape would otherwise post the best number in
  its column.
- `suite` checksums every cell and reports any that did not return stock's
  value.

They are opt-in for where they run rather than for what they cost. All but the
last happen while the process is setting up, and the next thing that happens is
the first row of the first table — which is the one row with no cooldown in
front of it, on the argument that every row begins on a host that has just been
loading modules. Several seconds of every build answering every case at full
tilt is not a module load, and the row that follows it is the one that pays.

One check is free and therefore always on: a timed reading cell returns the
instant it parsed, so a parse that quietly fails returns `NaN`, and `NaN`
poisons the checksum each band asserts on. That catches the failure the sampled
round-trips were there for without running anything extra.

The intended shape of a session is a `--verify` run when the patches change, and
plain runs for every timing after that.

## Bytes

Where a table reports bytes, it is `src/` bundled through `bun build --minify`,
no gzip. Each patch is sized alone against stock, so the column is the patch's
own cost rather than its position in a stack — except the ones written against
another patch's output, which are sized including what they need.

## Footprint

`upstream --footprint` adds resident-memory and Intl-formatter-count columns,
profiled one fresh subprocess per row, before any timing starts. rss is growth
over a bare runtime, so it carries the build's own load as well as whatever its
caches retain, and it is an allocator's answer rather than an exact one — read it
to about a megabyte. The Intl count is exact and identical on both engines, which
is why it is worth having at all next to timings that are neither.
