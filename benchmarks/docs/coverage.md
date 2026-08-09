# The public API columns

> Part of [`upstream`](upstream.md)'s ladder: `node upstream.ts --ladder`. Timing
> methodology is in [methodology.md](methodology.md). The cases themselves are in
> [`lib/api-cases.ts`](../lib/api-cases.ts).

The other axis. Where the ladder's `formatting` and `parsing` tables go deep on
writing a date and reading one, these go wide: 45 public API calls — construction,
arithmetic, writing, `Duration`, `Interval`, `Info` — on every build in the ladder
and on moment.

They were a table of their own, `coverage.ts`, until that was merged into the
ladder. What changed in the move is the comparison available: the cases used to
carry stock luxon and the fully patched build, the two endpoints, because the
ladder owned the rung-by-rung story and re-deriving it would have been a second
answer to a question already answered. As columns they get every rung for free,
which is what makes a patch arguable from a public API call rather than only from
a format string.

Three cases did not survive the move. `fromMillis`, `fromISO` and `fromFormat`
turned out to be the same calls as `millis`, `iso+off` and `tokens` in the
`parsing` table — the same input pool read by the same entry point, differing only
in which timing segment they landed in. Two names for one measurement is worse
than one, and where the two segments disagreed on an identical call the
disagreement was the harness rather than the library.

## Why they exist

The narrowness of the other two tables became misleading once the patch set grew
past the formatter.

`G` hoists both `normalizeUnit` tables and the `SystemZone` probe, and replaces
the `Duration` round trip inside `adjustTime`. None of those are reachable from
any formatting or parsing case; they were found by profiling, not by any table,
and a reader of the other two tables would not know those paths exist. `A` and `D`
sit under every zoned operation, not just the ones that print something.

The `adjustTime` change is the reason this set has its current shape. It is under
every `plus` and `minus`, and so under `endOf`, `hasSame`, `diff`, `toRelative`
and `Interval#splitBy`, and the other two tables have a column for none of those.

## Reading the columns

moment-timezone is the top row of the ladder and what every cell below it is
shaded against, because it is the number the work is aimed at. Moment core sits
below it in process-local mode, pinned to the same America/New_York zone. The date-fns +
`@date-fns/tz` row can be enabled as an independent idiomatic baseline before
stock luxon, which records the distance travelled by the patches. Where moment
has no cell, stock luxon remains the shading anchor.

A `--` is a build with no semantically honest equivalent to run. moment ships no
`Interval`, compiled format-parser API, `Duration#shiftTo`, or
`Duration#toFormat`; date-fns likewise leaves cells blank where matching them
would benchmark a custom reimplementation rather than its public API, including
Luxon’s locale-listing helpers. Those
columns are shaded against stock luxon rather than against something a baseline
did not do.

### Isolated and whole-operation columns

The original `Duration as`, `Duration shiftTo`, and `Duration toHuman` columns
construct a receiver inside every timed call. That is intentional historical
coverage of the whole operation and their semantics have not changed. The
columns ending in `pooled` build their receivers outside timing, isolating the
named method so a constructor change cannot be mistaken for a method change.
`Interval toDuration pooled` and `Interval count pooled` likewise reuse prebuilt
intervals; the older `Interval length`, `contains`, and `splitBy` columns retain
their original whole-operation shapes.

The focused additions also cover the calendar-unit branches of `startOf` and
`endOf`, fixed-base `toRelativeCalendar`, zone-name and possible-offset reads,
and `fromFormatParser` with its parser compiled outside timing. Duration
formatting has separate numeric and literal-heavy patterns. Every added column
uses the ladder's existing per-column split-half floor, and runs under whichever
engine executes `upstream.ts`; run the same ladder sequentially with Node and Bun
when collecting promotion evidence.

One exploratory Bun ladder run reported a `toRelativeCalendar` slowdown. It did
not repeat in an isolated subtraction check: the complete stack was faster than
the same stack without G, I, or D, both with this column's minute-spaced pool and
with a day-spaced pool crossing calendar and DST boundaries. Fresh module
instances varied more than the initial result while returning identical
checksums. Treat the observation as JavaScriptCore tier/cache noise, amplified by
D's interval-cache hit shape, not as evidence against a retained production
change. It is not a promotion result unless it repeats in the interleaved full
ladder above the column's own floor.

The two easy-tz rows sit out these cases entirely — they are dropped from the
`other` table rather than printed as a row of dashes, and the `formatting` and
`parsing` tables show them only in the columns this file did not contribute. They
exist to ask whether binding easy-tz's zone is still worth it; the cases name
their zone as a string, so running them there would resolve it through Intl and
print a plain-luxon number under a row that claims otherwise. The format and
parse columns already answer the question those rows are there for.

Which internals a column reaches is in
[`lib/api-cases.ts`](../lib/api-cases.ts) rather than in the table, because it
does not follow the timings, and the places it comes apart are the interesting
ones. `toLocaleString` routes through E and barely moves, because E interns
locales and these cases hold the locale fixed. `toISO` never reaches the
`Formatter` at all — it builds its string directly — so F's compiled programs
do nothing for it and its `tsToObj` rewrite does.

### The format-pattern columns

`toFormat` appears several times because the pattern decides which internals run,
and for a long time every formatting bench in this repo used one shape: all
numeric, en-US, gregorian calendar. That is exactly the input F's numeric fast
paths were written for, so a table containing only it credits those fast paths
with most of what F's compiled programs do and makes the compilation look
redundant.

The other shapes are not that. A month or weekday **name** never reaches a
numeric fast path at all, so in the text columns the interpreter the compiled
program replaces is the whole cost. A **wide** pattern multiplies that,
because the per-token switch ran once per token per value while the other
patches' savings are per value. And words in a **non-English** locale leave the
English short-circuit for `Locale#extract` and ICU entirely, asking for a name
per token per value — the branch F's name memo answers from a per-locale slot
instead, and the one no other patch touches. That last is the largest of the
three by some distance: the columns naming a month or weekday in `fr` are the
only ones in the whole ladder that sit flat down every rung and then collapse on
F's, because every patch above it is on a path they never take.

`toRFC2822` and `toHTTP` are the text shape with the pattern fixed by a standard
rather than by the caller, which makes them the formatting most likely to sit on
a request path rather than in a rendered table. `toHTTP` is the dearer of the two
because it changes zone first: it is `toRFC2822` plus a `toUTC()`, and pricing
that is half of why it is here.

### The not-like-for-like columns

The footnote under the table names five: `text fr`, `toFormat text fr`,
`toLocaleString`, `toRelative` and `Duration toHuman`. In each, moment reaches
the same user-visible answer by different means — it expands its own bundled
locale tables where luxon's names come from ICU, which is part of what the bytes
column charges it for. Those are two libraries doing comparable work rather
than two implementations of one algorithm, so the shading across those columns is
a library comparison and should not be read as one implementation beating
another.

### The Info columns

These call `moment.localeData(x).months()`, which returns the list moment already
holds, rather than the public `moment.months()`, which reads a process-global
locale and rebuilds the list per call out of twelve freshly constructed Moments.
The cheaper one is the fairer comparison to make luxon beat, and it is the one
the columns are against.

## Where luxon still trails moment

Read it off the shading: a red cell in the bottom rung is a column the finished
tree is still behind moment on. They fall into two groups.

**The not-like-for-like columns** are the ICU boundary described above, and are
the trade each library made rather than something to fix here.

**The `Info` columns** are the same boundary at a scale where the ratio flatters
itself: both sides are well under a millisecond for the whole batch. The stock
row is where that column's argument is, and it is a large one.

This group used to have five like-for-like arithmetic columns in it, and they
are worth saying what became of, because none was fixed the same way.

`endOf` was the longest-standing. It made three `DateTime`s — a `plus` of one
unit, a `startOf`, and a `minus(1)` — where moment writes fields in place. I
sets the next civil boundary directly for every calendar unit and folds the
`minus(1)` in behind it, and the weekday behind the week columns is integer
math instead of a `Date` allocation per read, so all three `endOf` columns now
lead moment core. What that took is in
[pr/09-boundary-math.md](pr/09-boundary-math.md).

`Duration#as` was `shiftTo` and `normalizeValues` — a whole `Duration` built,
walked and cloned so one number could be read off it, against moment's `asHours`,
which divides. I computes the sum directly and the column now leads.

`Duration toHuman` is still on the not-like-for-like list and still behind, but
by much less, and what closed most of the gap was not the Intl boundary. Only
about a third of the method is the `Intl.NumberFormat#format` calls it exists to
make. The rest was asking for the formatters: one per unit printed plus a list
formatter, each requested with a freshly built options object, so a two-unit
duration paid three `JSON.stringify` cache keys and two `PolyNumberFormatter`
constructions per call. With default options every one of those is fixed by the
locale and the unit, and E already interns the locale, so they now hang off it —
about 40% of the method. E also fills the result list directly instead of
allocating and filtering an eight-slot intermediate array. What is left is
mostly the ICU boundary, and that part is the trade rather than an oversight.

`hasSame` has left this group too: G took it to parity, and I — whose fused
`endOf` is half of what `hasSame day` does — puts it clearly ahead of both
moment rows.

`fromObject` was a measurement artifact. Its inputs advanced month, day and hour
off one counter, which lands every construction in a different month from the one
before it, and D caches the transition-free span around the offset it last looked
up. Nothing hit that cache, so the column was paying 3.69 ICU calls per
construction where the same code paying 0.38 is what an ordinary caller sees. It
now walks hours the way a caller filling a calendar does. The old shape is a real
cost of D, and a caller who really does hop between months pays it; it just is
not what a column named `fromObject` should be reporting.

`diff` left the group by being split into what it always was: two different
comparisons sharing a cell. A difference in a single lower-order unit
(`diff hours`) is one subtraction and a division in all three libraries, and the
finished tree leads moment there. Decomposing into days and hours (`diff d+h`)
walks the calendar through the zone, which neither moment's nor date-fns's
single-unit difference APIs can express, so that column is luxon-only and reads
against the stock row. The walk is the part with an obvious next step, and it is
not a leaf. It walks units largest-first and calls `earlier.plus(results)` once or twice per unit to
test each guess, so it pays `adjustTime` up to ten times for one answer. I now
avoids the final `Duration#plus` when the result has one lower-order unit — the
measured `["days", "hours"]` shape — by writing `as("hours")` into the result
before its one final construction. G took the arithmetic under the walk and I
took that allocation, but what remains is the calendar-guessing algorithm, so a
larger win wants its own patch and argument.

`toRelative` was in this group and is not any more, and how it left is worth the
paragraph, because the column was reporting something other than what it looked
like. Its own work is one `diff` and one `Intl.RelativeTimeFormat` call, and
profiled it was better than three quarters zone lookups — 15.2 ICU calls to
answer "3 months ago", where the same code holding still needs none. Two calls
it makes cannot affect its answer. `padding` defaults to 0 and the method calls
`this.plus(0)` anyway, cloning the receiver and re-deriving its offset to get the
receiver back. And its unit loop asks `diff` for years before months, so an
answer in months pays for a calendar-year diff that could not have come back as
anything but zero — a unit cannot reach 1 unless the instants are at least one of
it apart, and the shortest each unit can be in local time is a constant.

Neither is large on its own, and that is the part that generalises. Each `plus`
walks D's transition-free interval cache, which holds three spans, so the calls
that did not need making were evicting the working set and the calls that did
need making then missed. Removing them takes the column's ICU traffic to zero,
not down. Both are in H, which is a patch rather than two lines folded into G
because that column is the only one either of them moves that far; the effect
belongs as much to D, since this is worth little without it and it is worth more
now.

The general shape — that a wasted lookup in a cached zone costs more than the
lookup, because of what it does to the next one — is the thing to carry to the
rest of this list. The `diff d+h` walk is the obvious place to look for it next.

## Investigated and dropped

**A `toLocaleString` identity cache.** `toLocaleString` is the formatting API
luxon's own docs steer callers toward, and nothing in the patch set moves it.
Profiled under the full ladder it is 61–66% `Intl.DateTimeFormat#format` across
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
- *Spelling the same contents-based key more cheaply* — a concat over the option
  object's own keys in place of `JSON.stringify`, which keeps every one of the
  semantics above, including going fresh for the mutating caller. Verified over
  3,720 renders across every preset, five locales and three zones with nothing
  differing, it measured 0%, +2% and −5% on three presets, which is noise. A
  later profile puts `getCachedDTF` at 15.5% rather than the ~9% above, so the
  target was bigger than first thought and still did not move: what is being
  paid there is the `Map` lookup and the call, not the key.

Three attempts, three unrelated reasons for failing, against a function that is
63% ICU and 5% the `Date` handed to it. The remaining third is spread across five
small things and resists being taken either piecemeal or whole. This is a ceiling
rather than an oversight, and further attempts want a new idea rather than
another pass at the same ~29%.
