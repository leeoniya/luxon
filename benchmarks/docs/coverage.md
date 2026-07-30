# coverage.ts — the public API, against moment

> `node coverage.ts` (or `bun coverage.ts`). Timing methodology is in
> [methodology.md](methodology.md).

The other axis. Where [`format`](format.md) and [`upstream`](upstream.md) go deep
on writing a date and reading one, this goes wide: 28 public API calls — reading,
arithmetic, writing, `Duration`, `Interval`, `Info` — each timed on stock luxon,
on the fully patched build, and on its moment equivalent.

## Why it exists

The narrowness of the other tables became misleading once the patch set grew past
the formatter.

`H` hoists both `normalizeUnit` tables and the `SystemZone` probe, and replaces
the `Duration` round trip inside `adjustTime`. None of those are reachable from
any formatting or parsing case; they were found by profiling, not by any table,
and a reader of `upstream.ts` would not know those paths exist. `A` and `F` sit
under every zoned operation, not just the ones that print something.

The `adjustTime` change is the reason this table has its current shape. It is
under every `plus` and `minus`, and so under `endOf`, `hasSame`, `diff`,
`toRelative` and `Interval#splitBy`, and `upstream.ts` has a row for none of
those.

## Reading the table

moment leads, because it is the number the work is aimed at. Nobody adopts a date
library to be a given multiple of its own previous self; the question a row
answers is whether luxon is now something you would pick over the thing people
already have. Stock luxon is the distance travelled rather than the target.

So the columns are moment's milliseconds, then stock's, then the patched build's,
then the same two as ratios in the same order. Lower is better in every column,
1.000 is parity, and a 4x speedup reads as 0.250. Above 1.000 the patched build
is behind.

Both ratios are kept because a row where the patches take a twentieth of stock's
time and still trail moment is a different result from one where they overtake
it, and neither the milliseconds nor a single ratio says which happened.

This table does not re-derive the ladder — [`upstream`](upstream.md) owns that,
rung by rung — and carries only the two endpoints.

Which internals a row reaches is in `coverage.ts` itself rather than in a column,
because it does not follow the timings, and the places it comes apart are the
interesting ones. `toLocaleString` routes through G and barely moves, because G
interns locales and this table holds the locale fixed. `toISO` never reaches the
`Formatter` at all — it builds its string directly — so C does nothing for it and
H does.

### The starred rows

Rows marked `*` are ones where moment reaches the same user-visible answer by
different means: it expands its own bundled locale tables where luxon calls into
ICU. Those are two libraries doing comparable work rather than two
implementations of one algorithm. `Interval` has no moment equivalent short of a
plugin.

### The Info rows

These call `moment.localeData(x).months()`, which returns the list moment already
holds, rather than the public `moment.months()`, which reads a process-global
locale and rebuilds the list per call out of twelve freshly constructed Moments.
The cheaper one is the fairer comparison to make luxon beat, and it is the one
the columns are against.

## Where luxon still trails moment

The bench prints the current list, computed from the run. It falls into four
groups.

**The starred rows** are the ICU boundary described above, and are the trade each
library made rather than something to fix here.

**The `Info` rows** are the same boundary at a scale where the ratio flatters
itself: both sides are well under a millisecond for the whole batch. The stock
column is where that row's argument is, and it is a large one.

**`Duration#as`** is `shiftTo` and `normalizeValues`, which is real work luxon
does and moment's `asHours` does not.

**`fromObject`, `endOf`, `diff` and `hasSame`** are the ones to read as
unfinished: luxon doing the same job moment does and taking longer at it. Three
of them are also where H's `adjustTime` fast path landed — those four rows are
what sent the profiler at `adjustTime` to begin with, and they moved a long way,
but not all the way.

`diff` is the one left with an obvious next step. It walks units largest-first
and calls `earlier.plus(results)` once or twice per unit to test each guess, so it
pays `adjustTime` up to ten times for one answer, and then builds two more
`Duration`s to combine the high- and low-order halves of a result it has already
computed. That is a change to the diffing algorithm rather than to a leaf
expression, so it wants its own patch and its own argument.

## Investigated and dropped

**A `toLocaleString` identity cache.** `toLocaleString` is the formatting API
luxon's own docs steer callers toward, and nothing in the patch set moves it.
Profiled under all eight patches it is 61–66% `Intl.DateTimeFormat#format` across
the presets, which nothing can remove without changing what luxon returns, and
another ~8% is the `Date` that `format` has to be handed, whose instant varies
per call. Of the ~29% left, ~9% is the `JSON.stringify` key `getCachedDTF` builds
per call to find the formatter, and ~20% is a `Formatter`, a `Locale.clone`, a
`PolyDateFormatter` and two option spreads between them.

No single piece of that is large enough to be worth a patch, and both ways of
taking the whole ~29% were tried and dropped:

- *Dropping the two spreads* leaves the cache keyed on the options object's
  **contents**, so a caller who mutates one between calls still gets a fresh
  formatter. Measured against a control column at the time, it came out at or
  behind stock loaded twice, and
  `toLocaleParts` comes out consistently slower — the guard needed to skip the
  merge apparently costing more than the merge.
- *Keying that cache on the **identity** of the options object* does take the
  whole ~29% where it hits, and is wrong twice over: it goes stale for that
  mutating caller, and luxon builds a fresh options object per call on its own
  macro-token path, so an identity key misses every time and constructs an ICU
  formatter per value. That is a cliff rather than a slowdown. It is why
  [`lib/intl-count.ts`](../lib/intl-count.ts) now has `capIntlConstructions()`,
  which trips a probe that starts building formatters per call instead of letting
  it spend minutes in ICU and GC.
