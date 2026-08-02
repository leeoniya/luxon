# The public API columns

> Part of [`upstream`](upstream.md)'s ladder: `node upstream.ts --ladder`. Timing
> methodology is in [methodology.md](methodology.md). The cases themselves are in
> [`lib/api-cases.ts`](../lib/api-cases.ts).

The other axis. Where the ladder's `formatting` and `parsing` tables go deep on
writing a date and reading one, these go wide: 30 public API calls — construction,
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

`H` hoists both `normalizeUnit` tables and the `SystemZone` probe, and replaces
the `Duration` round trip inside `adjustTime`. None of those are reachable from
any formatting or parsing case; they were found by profiling, not by any table,
and a reader of the other two tables would not know those paths exist. `A` and `E`
sit under every zoned operation, not just the ones that print something.

The `adjustTime` change is the reason this set has its current shape. It is under
every `plus` and `minus`, and so under `endOf`, `hasSame`, `diff`, `toRelative`
and `Interval#splitBy`, and the other two tables have a column for none of those.

## Reading the columns

moment is the top row of the ladder and what every cell below it is shaded
against, because it is the number the work is aimed at. Nobody adopts a date
library to be a given multiple of its own previous self; the question a column
answers is whether luxon is now something you would pick over the thing people
already have. Stock luxon, the row under it, is the distance travelled rather
than the target.

A `--` is a build with no equivalent to run. moment ships no `Interval` and has no
`Duration#shiftTo`, so those four columns are luxon-only and are left unshaded
rather than shaded against something moment did not do.

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
ones. `toLocaleString` routes through F and barely moves, because F interns
locales and these cases hold the locale fixed. `toISO` never reaches the
`Formatter` at all — it builds its string directly — so K does nothing for it and
G does.

### The format-pattern columns

`toFormat` appears several times because the pattern decides which internals run,
and for a long time every formatting bench in this repo used one shape: all
numeric, en-US, gregorian calendar. That is exactly the input G's numeric fast
paths were written for, so a table containing only it credits G with most of what
K does and makes K look redundant.

The other shapes are not that. A month or weekday **name** never reaches a
numeric fast path at all, so in the text columns G has nothing to contribute and the
interpreter K replaces is the whole cost. A **wide** pattern multiplies that,
because the per-token switch runs once per token per value while the other
patches' savings are per value. And words in a **non-English** locale leave the
English short-circuit for `Locale#extract` and ICU entirely, asking for a name
per token per value — the branch K's name memo answers from a per-locale slot
instead, and the one no other patch touches. That last is the largest of the
three by some distance: the columns naming a month or weekday in `fr` are the
only ones in the whole ladder that sit flat down every rung and then collapse on
K's, because every other patch is on a path they never take.

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
tree is still behind moment on. They fall into three groups.

**The not-like-for-like columns** are the ICU boundary described above, and are
the trade each library made rather than something to fix here.

**The `Info` columns** are the same boundary at a scale where the ratio flatters
itself: both sides are well under a millisecond for the whole batch. The stock
row is where that column's argument is, and it is a large one.

**`endOf` and `diff`** are the ones to read as unfinished: luxon doing the same
job moment does and taking longer at it.

This group used to have four in it, and the other two are worth saying what
became of, because neither was fixed the same way.

`Duration#as` was `shiftTo` and `normalizeValues` — a whole `Duration` built,
walked and cloned so one number could be read off it, against moment's `asHours`,
which divides. J computes the sum directly and the column now leads.

`fromObject` was a measurement artifact. Its inputs advanced month, day and hour
off one counter, which lands every construction in a different month from the one
before it, and E caches the transition-free span around the offset it last looked
up. Nothing hit that cache, so the column was paying 3.69 ICU calls per
construction where the same code paying 0.38 is what an ordinary caller sees. It
now walks hours the way a caller filling a calendar does. The old shape is a real
cost of E, and a caller who really does hop between months pays it; it just is
not what a column named `fromObject` should be reporting.

`diff` is the one left with an obvious next step, and it is not a leaf. It walks
units largest-first and calls `earlier.plus(results)` once or twice per unit to
test each guess, so it pays `adjustTime` up to ten times for one answer, and then
builds two more `Duration`s to combine halves of a result it has already computed.
H took the arithmetic under it and J took the allocation, which is why the column
has moved as far as it has; what is left is the algorithm, so it wants its own
patch and its own argument.

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
walks E's transition-free interval cache, which holds two spans, so the calls
that did not need making were evicting the working set and the calls that did
need making then missed. Removing them takes the column's ICU traffic to zero,
not down. Both are in I, which is a patch rather than two lines folded into H
because that column is the only one either of them moves that far; the effect
belongs as much to E, since this is worth little without it and it is worth more
now.

The general shape — that a wasted lookup in a cached zone costs more than the
lookup, because of what it does to the next one — is the thing to carry to the
rest of this list. `diff` is the obvious place to look for it next.

## Investigated and dropped

**A `toLocaleString` identity cache.** `toLocaleString` is the formatting API
luxon's own docs steer callers toward, and nothing in the patch set moves it.
Profiled under all eleven patches it is 61–66% `Intl.DateTimeFormat#format` across
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
