# upstream.ts — the patch ladder

> `node upstream.ts` (or `bun upstream.ts`). Timing methodology is in
> [methodology.md](methodology.md); the patches themselves are in
> [`../patches/`](../patches), each with its reasoning in its header.

What can be removed from *inside* luxon, patch by patch. Nine candidate
patches, lettered A through I, all of them memoization or provable
short-circuits: no API changes, and no output changes beyond the argued
boundary corrections I documents ([9](pr/09-boundary-math.md)), neither of
which a benchmark zone can reach.

The workload is a column of timestamps rendered in a named IANA zone — what a
dashboard or a data table produces thousands of at a time — plus the same column
read back rather than written, and the whole ladder once more against the default
zone.

## The tables

| table | flag | what it answers |
| --- | --- | --- |
| patches | `--patches` | what each patch costs in shipped bytes |
| ladder | `--ladder` | what each rung is worth writing and reading a date in a named zone, and what it ships |
| default | `--default` | the same ladder with no zone named at all |

Any combination can be run alone, which is the loop for iterating on one patch:
`--patches` (~1s), `--ladder` (~90s), `--default` (~13s). `--verify` turns on
every correctness check, including the output-parity table and the two that run
during setup — see [methodology.md](methodology.md#correctness-before-speed) for
why they are off by default. Verification also disables row cooldowns unless an
explicit `--cooldown` is supplied. `--footprint` adds rss and Intl-formatter
counts.

The ladder is four tables of the same shape — the same builds, in the same
order, with a row per build and the shipped bytes at the end. The split is by
subject, since the column names alone stopped being self-evident long before
there were forty of them: `text` formats a pattern, `tokens` parses one, and
`set` does neither.

- **`formatting`** — writing a date. Four columns that build a `DateTime` per
  value and format it, then the `toFormat` and ISO-writer calls on a `DateTime`
  built beforehand. The first four vary the pattern and the locale rather than
  the zone: `numeric` pays only for an offset, `abbr` also renders a zone
  abbreviation, `text` names a weekday and a month, which is the only one of the
  first three that reaches the `Formatter` anywhere other than its numeric path,
  and `text fr` renders `text`'s pattern in a locale that is not English, where
  those names take a different branch entirely.
- **`parsing`** — reading one, plus the two constructors that take no string.
- **`other — DateTime`** — `DateTime` operations that neither write a string nor
  read one.
- **`other — Info, Duration and Interval`** — the remaining non-string API
  operations.

Each heading carries the unit — `formatting (ms)` — because no column does. The
unit does not vary anywhere, and repeating it under every column would spend
three characters apiece on one fact. Repeated API prefixes are likewise lifted
into centered group headings: `Duration`, `Interval`, `Info`, `startOf`,
`endOf`, and the two `toFormat` families. The paired ISO, relative-time and
token-parsing columns use the same layout.

Two columns are not what their table describes, both deliberately: `millis`
parses nothing, being the same construction with the string taken away, and sits
under `parsing` as that table's floor; `fromObject` and `now` are there for the
same reason.

These were one banded table until the column count made that unworkable. It was
the right shape for the argument — a patch is argued from one row against the row
above it, and every column that row can answer is part of that — and at ~550
characters the wrong shape for a terminal, since each row arrived wrapped into
four fragments interleaved with its neighbours'. Turning the terminal's wrapping
off instead only traded that for silently dropping two thirds of the columns.
Split, each table fits, and the argument survives the split because the rows are
the same rows in the same order: a patch still reads down a column, and the four
tables still stack.

Splitting the *timing* was already free and already done. A segment is a
calibration, not a subject: the format-string columns run the full count, while
parsing and the API calls cost enough per value that their passes are sized by
time and scaled. Two of the four tables hold both kinds and so are timed in two
segments and printed as one, and each states its own settings underneath.
Nothing compares a column in one table against a column in another, which is what
makes that free.

A `--` is a build with no semantically honest equivalent to run. moment ships
no `Interval` or `Duration#shiftTo`; date-fns has intervals and duration values,
but no reusable compiled parser, ambiguous-offset enumeration, or Luxon-style
Duration arithmetic, token formatting, or locale-listing API.

The easy-tz rows carry every column, including the ones easy-tz cannot affect, so
that what stock luxon with easy-tz bound to it costs can be read off one line
instead of assembled from two. Which columns it *can* affect is named in a note
under each table, and is measured rather than declared: `--verify` counts the
`offset()` and `offsetName()` calls each case makes and fails if a column is
annotated as one thing and behaves as another. Under the rest — `toISO`, which
reads the offset already on the instance; `toHTTP`, which swaps in a fixed-offset
zone before formatting; `toLocaleString`, which hands Intl the zone's name rather
than asking it anything; and `Duration` and `Info`, which never touch a zone —
the easy-tz row is the luxon row above it measured again, on its own module
instance.

[coverage.md](coverage.md) reads the API columns; the rest of this file reads the
patches.


The first baseline is moment-**timezone**, not moment: a named zone needs its
packed offset table, and only its `z` token renders an abbreviation. moment core
is underneath it doing the formatting, so the next row reports moment by itself.
Because core has no IANA database, the process-local zone is pinned to the same
`America/New_York` workload and the row uses moment's idiomatic local mode.
Abbreviation/name cells and `setZone` remain `--`: filling those would quietly
put moment-timezone back into the core row. An optional date-fns row with its
official `@date-fns/tz` integration hoists `tz(zone)` as the date-fns v4 context,
formats timestamps directly through that context, and uses explicit locale
objects. Its API-method cells use prebuilt `TZDate` receivers; uncommenting its
line in `upstream.ts`'s `optionalPaths` places it before stock luxon.

### The moment row gets several moments

Merging the two tables made moment's formatting columns 13-19% slower without
touching a line of formatting code, and the reason is worth writing down because
it is a real property of moment rather than a harness artifact.

A Moment parsed from a string carries `_a` and `_f`; one built from a timestamp
does not; one parsed from a string with an offset in it adds `_tzm`. Three
shapes. `format()` reads five properties off whichever it is handed — `_d`,
`_isUTC`, `_offset`, `_locale`, and `_pf` by way of `isValid()` — so once more
than one shape has flowed through, those reads go from monomorphic to
polymorphic and stay there for the life of the process.

A *single* parse anywhere beforehand is enough to do it. With no benchmark
harness involved, one `moment.tz(str, fmt, zone)` call ahead of a formatting loop
costs that loop about 15%; zero parses costs it nothing. So **moment formats
dates measurably slower in any process that has also parsed one**, which an
application doing both directions really does pay.

It is not what a column headed "format" is asking, though, and which cells pay
it should not be decided by anything as unprincipled as the order the tables
happen to print in. So the moment row draws its instance from
[`../lib/build.ts`](../lib/build.ts)'s `momentFor`, keyed by the shape of the
Moment the cell builds: cells that build the same shape share an instance and its
warmth, cells that build different shapes cannot see each other. The key is read
off a real Moment rather than declared per case, so a case added later sorts
itself.

Each isolated moment-timezone instance also calls `moment.tz.setDefault(zone)`
once during setup. The timed path can then use `moment(ts)`, avoiding a repeated
zone-name lookup just as Luxon receives a pre-resolved `IANAZone` and date-fns
receives a prebuilt `tz(zone)` context. Locales, parser formats and fixed options
are likewise selected once per cell, not once per value.

Luxon needs none of this — a `DateTime` has the same shape however it was built,
which is why every luxon row was unmoved by the merge — and every luxon build
already gets its own module instance and every timed entry its own zone. moment
was the one participant with no isolation at all, because it arrives as a package
rather than as a tree this harness writes.

## Where the ladder comes from

Each rung adds one patch to the one above it, so a rung's contribution is what it
adds *given everything above it* rather than what it is worth alone. The two
readings differ, sometimes a lot, and the difference is the point.

Every rung is bounded by one of the two Intl calls a zoned format makes, and
which of the two formats a rung helps tells you which call it removed. A pattern
with no zone name in it only ever pays for the offset; a pattern with one pays
for both.

A rung being small is not a verdict on the patch, only on what those columns ask
of it. E is the clearest case: interning `Locale` objects barely shows against a
pattern that holds its locale fixed, and the calls it was written for are in the
`other` table — see [coverage.md](coverage.md).

### Why I comes last

Eight of the nine patches have a rung. I does not, so the final row is the one
that adds it, and the last two rows of the table differ by I alone.

The last position answers a different question from the rest of the ladder.
Every other rung is priced by what it **adds** to a partial tree — the "should
this land" question. Whichever patch goes last is priced by what the **complete
tree loses without it**, which is the "should this stay" question, and the two
differ by exactly the overlap between that patch and everything below it.

I takes the position because it is the patch the second question fits. Its
civil math stands on the arithmetic G rebuilt, and it is the one patch arguing
output corrections rather than none, so the number a shipping decision on it
turns on is what the finished tree loses without it. No patch overlaps
another, so no rung's price depends on an ordering choice this table made.

## The patches

### A — `zoneInfoCache`

The one that matters, and barely an optimization. `parseZoneInfo` built a fresh
`Intl.DateTimeFormat` per value, so any pattern containing a zone name paid
formatter construction *per formatted value*. Routing it through luxon's existing
`getCachedDTF` is a one-line change and is most of the abbreviated format's cost.

The same patch reads the zone name out of `dtf.format()` instead of allocating a
part per field and walking them. That is what unbounds the abbreviated format,
and it does nothing on the numeric one, because a pattern without a zone name
never asks for it. Together the two changes make A the clearest illustration of
the table's formatting/parsing split: it takes most of the abbreviated format
and moves no parse column at all.

The cache lookup itself is a one-line substitution; the measured scanner,
layout validation, reset hook and fallback bring the whole patch to 710
minified bytes.

### B — `offsetScan`

The offset lookup read the cheap way rather than through a formatter. Together
with A this is nearly all of the numeric format, since a pattern with no zone
name in it has nothing else left to pay for. On the abbreviated format it helps
much less, because that one is still bounded by the name lookup no matter how
cheap the offset gets.

B also owns the paired forward and inverse civil-date helpers used by F, G, H
and I. Keeping the proleptic-Gregorian conversion in one utility prevents the
offset scanner, DateTime field extraction, calendar differences and weekday
math from drifting into separate implementations. It is verified across BCE,
years 0–99, leap centuries, the Date limits, and against stock `offset()` over
every transition its zones have.

### C — `tokenParserCache`

The same argument as F's compiled formats, pointed the other way. `fromFormat`
resolves a format string to a compiled RegExp on every call and then throws it
away, which is what the Formatter used to do with a token list per value; the
fix is the same one, resolve it once per format and keep it.

It needs none of F's restructuring, because the object worth keeping is already
public: `buildFormatParser` hands a `TokenParser` out and `fromFormatParser`
takes one back, an API whose only purpose is to let a caller hoist exactly this
out of a loop. C does it for the callers who did not. The whole patch is a Map, a
lookup and a reset, and it takes better than half off both token-parsing columns.

### D — `transitionInterval`

One interval cache serving both lookups: the offset and the name are cached
together across the interval that two probes prove transition-free. Apart from F
it is the only rung that helps both formats, because it is the one patch that
touches both calls. Its diff builds on both zone lookup rewrites, so D requires
A and B.

D is also the patch with a precondition rather than a proof from first
principles. It assumes nothing changes and changes back inside a single two-day
probe window. It needs that of the offset, where the tightest gap in all of
tzdata is 6.92 days (America/Cambridge_Bay, Oct–Nov 2000) across all 219,232
transitions moment-timezone ships. Because one cache now serves both lookups, it
needs it of the *name* too, which is the stricter claim — a zone can be renamed
without moving, which is exactly what Cambridge_Bay did in 2000. Measured against
the runtime's own ICU rather than a bundled copy that bound is 6.96 days, so both
margins are about 3.5x, and sharing the cache costs nothing because the two
bounds coincide. If tzdata ever tightened past either, the failure mode is a
stale offset or a stale name rather than a crash.

D also carries the one divergence from stock in the whole set, and it is stock
that is strange. Asked for a GENERIC name, ICU answers America/Cambridge_Bay with
"MT" everywhere except the single repeated hour of a fall-back transition, where
it returns "MT (Cambridge Bay)" — an instant-dependent answer for a name whose
whole point is not to depend on the instant. A span brackets that hour and serves
the neighbouring answer. Over 218,100 comparisons against stock spanning 16
zones, 5 locales, all 6 styles and 4 access orders, that is every one of the 258
differences. There are none in the offset, and none in `short` or `long`, which
are the only two styles luxon's own tokens ask for.

A and B rest on the same reading of tzdata but carry no such precondition.

### E — `localeIntern`

Interning `Locale` objects. Invisible on a formatting path that holds the locale
fixed, and dramatic on `Info.months` / `Info.weekdays` in a non-English locale,
which build a `Locale` per call — see [coverage.md](coverage.md), where that
collapses to almost nothing.

Once the `Locale` is a shared object with a generation counter on it, it is also
where `Duration#toHuman`'s formatters belong. `toHuman` asks for one number
formatter per unit it prints and one list formatter, and builds a fresh options
object to ask for each, so a two-unit duration pays three `JSON.stringify` cache
keys and two `PolyNumberFormatter` constructions per call. Called with no options
all of that is fixed by the locale and the unit — about 40% of the method. The
same loop now pushes formatted units directly instead of allocating an
eight-element `map()` result and filtering it. Any option at all is spread into
both formatters' options, so the memo is only taken when the caller passed none.

Hanging it off the `Locale` rather than off the `Duration` is what makes
`Settings.resetCaches()` reach it. A `Duration` built before the reset still
holds its `Locale` instance and nothing looks that instance up again, so a memo
there would go on rendering through the `Intl` objects the reset dropped — which
is the case `resetCaches()` exists for.
[`test/locale-intern-patch.test.ts`](../test/locale-intern-patch.test.ts) swaps
`Intl.NumberFormat` out from under a `Duration` that has already rendered.

### F's fast paths, G and H — one idea, three places

F's numeric fast paths, G and H all do the same thing — take work out of a step
without changing what the step means — and the resemblance invites grouping
them. It is the wrong axis. What separates them is where the work is: the fast
paths are on the route a numeric token takes out of the formatter, G is on the
arithmetic under every `plus`, and H is on `toRelative` alone.

G and H are patches of their own because each is priced by removing just it
from the complete tree, and each costs at least 1.9x on some column the other
barely moves, against a control — the same tree built twice and timed against
itself — that reaches 1.4x:

| patch | its column | node | bun |
| ----- | ---------- | ---: | --: |
| G | `Interval length` | 3.41x | 3.15x |
| H | `toRelative` | 7.80x | 3.93x |

A fourth group does not clear that bar. Four hoisted constants —
`DateTime.normalizeUnit`, `Duration.normalizeUnit`, `formatRelativeTime` and
`SystemZone#offset`, each a lookup table or `Date` rebuilt inside the function
that reads it — peak at 1.26x on node and 1.57x on bun, at or under that
control. There is no column a row of their own could point at, so they ride in
G, which is what reads most of them.

### F — `compileFormat`

Two layers on one route. The structural layer compiles the format walk to a
program; the leaf layer is the fast paths a numeric token still crosses on the
way into that program's output.

Three of the leaf paths are in `Formatter` and `impl/util.js`: `num` pads its
own digits when the numbering system is `latn`, `roundTo` returns integers
unchanged, and `padStart` answers two-digit pads from a table. A fourth,
`parseFormat`, caches the token split — it runs at most once per pattern, when
the compiler asks.

The one that reaches furthest is `tsToObj`: integer civil math in place of a
wrapper `Date` and seven getter calls, under every `DateTime` that reads a
calendar field. It writes B's shared inverse conversion into the result object,
retaining one allocation. That is why this patch moves `millis`, a column that
formats nothing.

Writing the verification sweep turned up two bugs in that rewrite, both from the
same cause: replacing `new Date(ts)` also dropped the TimeClip the constructor
was running on the way in. Without it `DateTime.fromSeconds(1.0005).toISO()`
rendered `1970-01-01T00:00:01.0.5Z` — malformed rather than merely different —
and a `plus` that overflowed answered `+287168-08-24` where luxon says invalid.
Neither is reachable from any benchmark, since every timestamp a benchmark builds
is a whole number well inside the range, which is how both survived until there
was a sweep. Both are now in
[`test/numeric-path-patch.test.ts`](../test/numeric-path-patch.test.ts), which
also checks `tsToObj` against `Date`'s own getters over 200k random instants.

Compiling a DateTime pattern to handlers once removes three costs together: the
~70-case switch per token per value, the eight closures
`formatDateTimeFromString` built per call, and the Intl options object literals
its branches allocated. It also folds punctuation into literal runs, so
separators cost a concat. It is the largest patch here in shipped bytes.

The name memo is a bigger number than the DateTime compile step for
any caller not writing English. A name token — month, weekday, era, day period —
has an English branch that reads a constant array and no fast path at all for
anything else: it asks ICU, per token, per value. Nothing else in this patch set
is anywhere near that path, all of it being aimed at zone lookups and the numeric
tokens, which is why a non-English column sat flat down the ladder until this
landed.

What makes it a defect rather than a cost is that luxon has already computed
these. `Locale` caches the month, weekday and day-period lists per instance, and
`Info.months` reads them while the formatter never has. The `other` table shows
both ends of that: `Info.months fr` against a `toFormat` naming a month in fr.

Rerouting the formatter to `Locale`'s lists is the obvious fix and the wrong one.
The two ask ICU for slightly different things — a format-context weekday there
carries `year: "numeric"` and here it does not — which is enough to change the
form ICU returns, and swapping them re-renders fi and fa. So the patch memoizes
the formatter's own call instead, keyed on the field the answer depends on. Two
boundaries came out of sweeping locales rather than out of reading the code: a
month or era name is only a function of the Gregorian field when the resolved
calendar is Gregorian, which fa's is not, so those two consult it and fall back;
and day periods are keyed by hour rather than by `hour < 12`, which declines to
import `Locale#meridiems`' assumption that a locale has exactly two of them.

It leaves one pre-existing inconsistency alone: `toFormat("LLLL")` in ja renders
`4` where `Info.months` and `toLocaleString` render `4月`, because `Locale#months`
carries a ja workaround the formatter never had. Memoizing what the formatter
already returns does not change what it returns.

The compilation is not a substitute for the caches — those are worth a great
deal between them, and it adds to the total on top of all of them. It is the
largest single formatter win in isolation.

Duration formatting compiles its fields, widths and literal runs too, instead
of rebuilding three closures and four arrays per call. The value still goes
through `shiftTo`, sign handling and `num`, preserving custom matrices,
flooring and fractional behavior. Numeric and literal-heavy pooled cases both
improved by low-twenties percent on Node and Bun.

The two layers pull different weight in a writing cell, which times
`DateTime.fromMillis(ts, opts).toFormat(pattern)` — construction as well as
formatting, and construction is something like two fifths of it. The compiled
program is a `Formatter` change and does nothing whatever for the construction
share; the leaf `tsToObj` rewrite is where construction spends its time.

The `text` and `text fr` columns both exist because of the compiled half, and
specifically because a ladder without them understates it. `numeric` and
`abbr` are both all-numeric patterns in en-US on the gregorian calendar, which
is the one input for which the `num`, `padStart` and `roundTo` fast paths
cover most of what the compiled program covers — so a table made only of those
buries the compilation inside its own patch's leaf paths. A weekday or month
name reaches no numeric fast path at all, which is what `text` varies.

`text fr` then varies one thing against `text`: the locale, holding the pattern
identical. That makes the pair a reading of the English branch and nothing else,
which is the whole of what the name memo is about. The rungs above F — the zone
patches and E — are on paths the non-English column never takes, so `text fr`
sits flat for five rungs and collapses on the sixth, which is not a shape that
noise produces and is why one column was worth its width here where a second
English pattern would not have been. (The memo hangs off the `Locale` that E
interns, which is why E files first: each is independently correct and only
together fast.)

The shapes further out — a long pattern, a non-gregorian calendar, the same
locale question asked of a pre-built `DateTime` rather than of construction plus
formatting — are the `toFormat` columns in the `formatting` table rather than
variations on these four, since they vary the caller's pattern rather than the
patch set. [coverage.md](coverage.md) reads them.

### G — `arithDirect`

Temporary objects built, converted or normalized to reach values plain
arithmetic already has, one offset round trip that re-derives what the receiver
is already carrying, one exact-unit shortcut, plus the four constants above.

`adjustTime` was building a nine-key `Duration` and converting it to milliseconds
on every `plus` and `minus`, where an integer sum will do; `impl/diff.js`'s
`dayDiff` was building four DateTimes, two Dates and a Duration where subtracting
B's shared civil-day values gives the result directly. Every `plus` and
`minus` goes through `adjustTime`, which puts it under `endOf`, `hasSame`,
`diff`, `toRelative` and `Interval#splitBy` as well — and the `formatting` and
`parsing` tables have a column for none of those. The `other` table is where this
lands; see [coverage.md](coverage.md).

The `adjustTime` fast path was found by taking the four API columns furthest
behind moment and profiling them. `diff`, `endOf('month')`, `toRelative` and
`hasSame('day')` were all behind, all four for the same reason.

The offset round trip is the third change to the same function and is a return
rather than a rewrite. A duration that sets no calendar field leaves the civil
object `adjustTime` assembles identical to the receiver's, so the `objToLocalTS`
and `fixOffset` that follow recompute the instant and offset the instance already
holds. Returning first is worth about 10% of `endOf('month')` and 6-7% of
`hasSame('day')` on both engines — those two pay it twice, since `endOf` is a
`plus`, a `startOf` and a `minus(1)`, and the `minus` is calendar-free.

What it skips is also where `wasHole` comes from, and `wasHole` is public, so the
sweep compares it alongside the instant. `false` is right even for a receiver
resolved out of a DST hole, because a hole resolution lands on a civil time
outside the hole, so re-reading it cannot reach `fixOffset`'s hole branch.

The third object is the argument itself, and it is the largest of the three.
`plus({ days: 1 })` is the way every caller writes this, and `plus` handed that
literal to `Duration.fromDurationLike`, which built a keyed object out of it, a
`Locale` for it and a `Duration` around both — so that `adjustTime` could read
nine getters off it and drop it. `minus` built a second one, because `negate()`
clones. The nine numbers are now produced directly, which takes roughly a
quarter to a third off `plus` and `minus` and carries into everything above
them.

That is a normalization rather than a validation shortcut: every argument
`Duration.fromObject` rejects is still rejected, with the same error and the
same message, which is what most of the sweep is checking. The subtler half of
the win is shape — `normalizeObject`'s result has computed keys and a layout
that depends on which units the caller named, so those nine reads saw a
different object for `{ days: 1 }` than for `{ hours: 1 }`, and now see one.

Neither of the first two replacements is unconditional, because `as()` is not the
plain sum it looks like: the fast path holds only when every field is an integer
and only while the sum stays finite. The shared civil conversion keeps
`dayDiff` proleptic Gregorian and avoids treating years under 100 as 19xx. The guards are the correctness
argument and the sweep is built to break them over five zones, 32 duration
shapes and both DST directions, in
[`test/arith-direct-patch.test.ts`](../test/arith-direct-patch.test.ts). Finding
the finite-range guard took 1,200 parity failures.

The argument sweep in the same file is organised by the shape of the argument
instead: singular against plural spellings and both in one object, inherited
against own properties, non-enumerable and symbol keys, getters, the values
`asNumber` coerces against the ones it rejects, a bad unit beside a bad value,
and every non-object luxon throws on. Both sweeps were built by mutating the
patch until they failed. One hazard is worth passing on to anyone doing the
same: `Interval#splitBy` loops until `plus` carries its cursor past the end and
guards only the `Duration` it was handed, so a mutation that stops `plus`
advancing does not fail the suite — it appends until the machine is out of
memory. Cap each run's wall time and heap.

`Duration#plus` and `minus` already hold canonical unit names, so they read the
two value records directly and write one result, without `get()` normalization
or a cloned negated addend. An exact
`diff(..., "milliseconds")` now returns the endpoint subtraction directly,
which also reaches `Interval#toDuration("milliseconds")`.

`DateTime.local()` and `DateTime.local(options)` now reach `quickDT` directly
instead of copying and slicing `arguments`, destructuring seven absent fields,
and rebuilding them as seven `undefined` properties. Positional overloads retain
the generic parser, and the original options object remains observable.

The four constants are moves rather than rewrites — none captures anything — so
the same file checks every key of both unit tables in both spellings and mixed
case, and interleaves zones across DST so a stale `SystemZone` probe would show
up as one zone reading another's answer. The engine split runs through all twelve
changes: V8 escape-analyzes some of these allocations away and JavaScriptCore
does not.

### H — `relativeSkip`

Direct decisions on the relative-time path. `padding` defaults to
0 and the method calls `this.plus(0)` regardless, cloning the receiver and
re-deriving its offset to arrive back at the receiver. And its unit loop asks
`diff` for years before months, so an answer in months pays for a calendar-year
diff first — where a unit cannot reach 1 unless the instants are at least one of
it apart, and the shortest each unit can be in local time is a constant. The
floors are set below even that, so a zone rule nobody anticipated lands above
them rather than under.

`toRelativeCalendar` counts boundaries instead of elapsed time, so it does not
use those floors. For valid DateTimes in one built-in zone, its year, month and
day counts come directly from the existing civil fields and B's shared
`daysFromCivil()`. Differing or custom zones, weeks, quarters and unsupported
units keep the generic `hasSame`/`startOf`/`diff` route. Moment's `calendar()`
cell is blank for this benchmark because its 90-day input falls back to an
absolute date rather than returning a comparable relative phrase.

Neither is large by itself, and the reason the column moves as far as it does
belongs partly to D. Every `plus` walks D's two-slot interval cache, so the calls
that did not need making were evicting the working set and the ones that did then
missed. Taking them out takes the column's ICU traffic to zero rather than down,
which is why this is worth little without D and D is worth more with it. That
pattern — a wasted lookup in a cached zone costing more than the lookup —
is the thing to look for elsewhere; [coverage.md](coverage.md) reads it against
`diff`, which is the obvious next candidate.

It is also why this is a patch and not two lines in G. G is under the same method
through `adjustTime` and costs 1.70x on that column; this costs 7.80x. They are
on the same column for different reasons and at different sizes, and only one of
them is on any other column. Verified against stock in
[`test/relative-skip-patch.test.ts`](../test/relative-skip-patch.test.ts), across
every zone, anchor, spread and direction in the temporal matrix, with each option
paired separately rather than multiplied through it. The zones include Lord
Howe's half-hour DST and Chatham's 45-minute offset.

### I — `boundaryMath`

Read-once arithmetic plumbing dropped, and calendar boundaries computed as
integer math rather than assembled from intermediate `DateTime`s.

The plumbing half is `clone`'s second config, the `Duration` that `Duration#as`
constructs in order to read one number off it, the `{ [unit]: 1 }` literal
`endOf` makes per call, and `diff`'s final lower/higher-result merge.

It is the same shape as G's two round trips and a separate argument. G's two
are on the arithmetic *math*, where the thing that could go wrong is floating
point; these are on the arithmetic *plumbing*, where the thing that could go
wrong is a caller depending on a property of an object being removed.

`clone` is the one that carries the half, and not only for the allocation it
saves. Its config was `{ ...current, ...alts, old: current }`, and `alts` is a
different set of keys at each of the six call sites — `{ts}`, `{ts, zone,
wasHole}`, `{loc}`, `{ts, o, wasHole}` — so the object the `DateTime` constructor
reads had a different shape on every path into it, and its field reads never
settled. Naming the seven fields gives every call site one shape. Every setter
`DateTime` has goes through it.

`as` is the fiddly one. `shiftTo` is not the plain sum it reduces to: it takes
whole target units from lower fields, snaps near-integers, then adds the
lower-field remainders in value-key order. That operation order is copied
rather than simplified, preserving `shiftTo`'s fractional corrections. The
`|| 0` that the getter it returns through ends in is *not* copied, and that is a
deliberate divergence: nothing `fromObject` accepts can reach it, but
`Duration#plus` writes sums directly, so an `Infinity` field produced a `NaN`
sum the getter silently turned into `0`. The rewritten `as`
answers `NaN` there; an infinite duration is not 0 minutes long. The sweep for
it also turned up that stock's `as("__proto__")` threw a `TypeError` out of
`shiftTo` rather than `InvalidUnitError`, because `Duration.normalizeUnit`
looks its argument up in an object literal where `"__proto__"` and
`"constructor"` both find something truthy enough to pass the check meant to
throw on them. The rewrite throws `InvalidUnitError` for any answer that is not
one of the nine ordered units — belt-and-braces on the full ladder, where G's
null-prototype tables already make `normalizeUnit` itself throw it.

`endOf`'s memo is the small part. It is a null-prototype bag rather than an
object literal for the same reason from the other direction: the key is
whatever string the caller passed, and on a literal `oneOf["constructor"]`
finds `Object` off the prototype — before the cache was ever written to — and
would hand `plus()` a function.

`diff`'s measured `["days", "hours"]` shape has one lower-order unit. In that
case `fromMillis(...).as("hours")` is the value `shiftTo("hours").get("hours")`
would return, so it can be added to the result before its final construction.
That skips `Duration#plus`, its unit walk and its clone; multiple lower-order
units retain the general path.

The boundary half is three changes sharing one idea. `dayOfWeek` loses its
per-call `Date` allocation to B's shared Hinnant civil-day math;
`startOf("week")` stops asking what week it is and steps
back `weekday - 1` days directly; and `endOf` fuses to a single construction
for every calendar unit, the trailing `minus(1)` folded in, since the
constructor re-derives the offset for a changed timestamp anyway.

I has no rung; its step is the last two rows of the ladder. The `formatting`
and `parsing` tables barely see it, expectedly — the only part of I on those
routes is the one `clone` that `fromMillis` does. The `other` table is where it
is priced: `plus`, `set`, `startOf`, `endOf`, `diff`, `Duration#as`, and above
all the three `endOf` columns and `hasSame day`, which is `startOf` and `endOf`
back to back. `endOf day` and `endOf month` move from behind moment-timezone to
ahead of moment core; `endOf week` was the worst arithmetic column in the table
and lands the same place, because the week round trip it no longer takes was
calling the old `dayOfWeek` four times per operation.

I's diff applies against stock, but its civil math stands on the arithmetic G
rebuilt, so it requires G. It is also the one patch whose document argues
output corrections rather than none — `endOf` at a midnight fold now ends the
period on the receiver's side, and leap days before year 100 answer their own
weekday where stock reads off March 1 — both unreachable from any benchmark
zone, both pinned by its fixtures
([09-boundary-math.md](pr/09-boundary-math.md)).

### Asking what a patch is worth, rather than what it adds

A rung measures what a patch adds *given everything above it*. That is the right
question for "should this land", and the wrong one for "should this stay",
because the two differ by exactly the overlap between the patch and everything
below it. The ladder answers the second question for I, by putting it last — but
it can only do that for one patch at a time.

`--drop <letters>` answers it for any of them, by leaving a patch out of every
build a run makes — the ladder, the byte table, the parity scan, `suite`, and
both engines under `cross-engine`. Run the bench with and without,
and the difference between the two full-set rows is what that patch is worth once
everything else is in.

Two cautions on reading that difference. It is a comparison **between two runs**,
where every other comparison this bench makes is between cells interleaved inside
one process, so it carries drift that nothing cancels — read it against the
per-column floors and prefer a margin several times them. And it is not needed for
I, whose answer is already the last step of the ladder in a single run.

Rows that collapse into the one above them are folded away — including the last
row under `--drop I`, since I is the only patch without a rung and the ladder
therefore already ends at the full set without it. Rung labels spell out every
letter they hold, so a dropped patch shows as a gap in them; the last row is the
only one that abbreviates, and it says `all (no C)` rather than a range when
`--drop` has made "all" not quite true.

A patch whose diff is written against another's output cannot be dropped alone.
`--drop A` refuses and names the closure to use instead (`AD`), rather than
quietly measuring a smaller set than the flag describes.

## Reading dates

Reading was not what most of this was aimed at, and the ladder's five reading
columns show which of it carries over.

The biggest formatting wins do nothing here. A is the zone-name lookup and no
parse performs one; F's compiled programs are for writing and no parse walks
one — its tokenizer cache is the sliver of it a parse sees. Neither moves a
reading column by more than that column's own noise floor.
Three patches carry these columns instead: B and D, both being
`offset()`, which every zoned parse needs before it can place a local time, and
C, the only one in the set written for reading.

The two ISO columns are the same parse differing only in how many zone lookups it
makes, and that count is the whole story of them. A string with no offset on
it costs three: `fixOffset` cannot turn a local time into an instant without
knowing the offset, and cannot know the offset without an instant, so it seeds
itself with the offset at `Settings.now()` and then probes twice around the
answer. A string carrying its own offset supplies that seed, skips the probes,
and is read in a fixed-offset zone, so it costs one. That gap is why B alone
cannot close it — B only makes each lookup cheaper, and the gap is about how many
there are.

D is what closes it, though the first version of it did not. Three lookups per
parse is precisely the pattern a one-span cache cannot serve: each evicts the
next, so a span never survives to be hit and the budget that would widen it never
grows. That version hit exactly never on the no-offset column while hitting 99%
of the time on the column that makes one lookup — and not because the instants
were far apart, either. It missed as reliably reading today's dates as dates
years out. Spans anchored around the instant that missed rather than extended
the way the last miss went close it — two for the parse pattern, and a third
for the whole operations that construct and then diff across a transition — and
the two ISO shapes end up level because the count stops mattering once the
lookups are free.

(A `fixOffset` that asked for the offset once instead of three times would reach
the same place from the other direction, and is a larger change to argue for.)

That also settles the two comparisons the reading side used to lose. easy-tz's
zone no longer beats the patch set on the zone-bound column, because both are now
bounded by luxon's own parsing rather than by a zone lookup. And the two token
formats, the last columns where moment-timezone was still ahead, have gone the
other way. The patched builds are ahead on every shape measured, and on a bare
timestamp it is not close.

## The default zone vs the named one

The ladder names a zone, which is the configuration the patches were
written for. `--default` is the same ladder with no zone named at all — what a
caller who never configures one gets.

Luxon falls back to `SystemZone`, whose `offset()` is a `getTimezoneOffset` call
rather than an Intl one, so stock is already far cheaper there than against a
named zone. A, B and D exist to remove IANAZone's Intl calls, so against the
default zone they have nothing to remove. The rest of the set still reaches it:
C on the token-reading case, E and F wherever a locale, a number or a format is
written, H under `toRelative`, and G and I under the arithmetic — none of which
was a named-zone cost to begin with.

Some of its cases still have no patch on them at all, and a run where those sit
inside the floor printed under the table is the table working rather than a null
result. It reads like the tables above — a moment/moment-timezone/stock-luxon
block on top, shaded against its first row, which here is local-mode moment core
rather than moment-timezone because the zoneless configuration is the one being
measured — and its last block, under the rule, is the two luxon builds again with a zone
named, which is what the ladder measures: a baseline for how much of stock's
cost was the named zone in the first place, and what the patches do to that
configuration measured as these whole operations, not a control.

The moment rows are the same configurations the ladder times — a configured
default (moment-timezone's `setDefault`, core's process-local zone) is the only
mode moment has, per-call zones being a luxon idiom. They are re-measured here
rather than quoted because these cells are whole operations from a raw timestamp
where the ladder's formatting and API cells operate on pooled instances, and
because a within-table comparison has to share one measurement window.

## Verdict

Stacked, the set moves both the easy-tz path and stock luxon a long way against
moment-timezone, without touching a public API or changing a byte of output. That
is verified across every token in the switch, all macro tokens, four zones and
four locales including a non-gregory calendar with non-latn digits, and for the
name patches over ten zones, five locales and all six `timeZoneName` styles
either side of every modern transition
([`test/zone-name-patches.test.ts`](../test/zone-name-patches.test.ts)).

That answers the question the two easy-tz rows at the foot of the table are for:
same patches on both sides, so the only difference is where the zone comes from. It
used to be pattern-dependent, and with A and D it is not — the full upstream
build is level with the easy-tz-bound one on both formats, where before them
easy-tz was an order of magnitude ahead on abbreviations. A luxon carrying all of
these would leave easy-tz nothing to win inside luxon's `Formatter`, on either
kind of pattern.

Skipping the `Formatter` entirely for the patterns a value formatter emits in
bulk — easy-tz's own fast path — is a further large multiple beyond even that,
and is where the remaining case for easy-tz lives.

### If none of this is accepted

The `easytz zone` row answers the other question, and it is the one that matters
if the patches go nowhere: how much of the gap a consumer stuck on stock luxon
can close by binding easy-tz's zone and changing nothing else. It closes most of
it, and where it does not is predictable from what it replaces.

The abbreviation case is the extreme. Stock luxon spends two orders of magnitude
more than moment-timezone on `toFormat abbr` because every value is an Intl name
lookup, and easy-tz reads it from a table instead — enough to bring a column that
was ~200x moment to low single digits. The offset-bearing patterns behave the
same way for the same reason: `toFormat wide` and the ISO and token parses go
from behind moment to ahead of it, and `fromObject` with them, since placing a
local time is three offset lookups and easy-tz answers all three from rules.

What it cannot close is the part that was never the zone. `hasSame day`,
`endOf month` and `Interval splitBy` each ask for many offsets per call, so
easy-tz moves them several-fold and they stay well behind moment, which is doing
different arithmetic rather than cheaper lookups — that gap is G's and I's, not a
zone's. `toRelative` is the same story with a `diff` under it. And the columns
that never touch a zone do not move at all, which is what the note under each
table is for: they are carried so the row is complete, not because anything
happened in them.

So: binding easy-tz is worth roughly the whole of luxon's Intl zone cost and
nothing else. That is most of what separates stock luxon from moment on formatting
and parsing, and about half of what separates it on date arithmetic.

That one is no longer measured. It had a build here for a while that was timed
and never printed, and it went with the rest of the untabulated set. The path
itself is still in [`lib/format-paths.ts`](../lib/format-paths.ts) as
`makeFastFormatter`, so putting a row back is adding a row rather than writing a
path; nothing calls it today.

## Filing order

In the order they are lettered, which is what the letters are for.

1. **A, B and C.** All three are self-contained and need no dependency
   argument. A removes the per-value zone-name formatter and scan, B makes the
   offset lookup cheap, and C reuses an object luxon already hands callers for
   compiled parsing.
2. **D.** File after A and B because its shared transition-interval cache is
   written against both lookup rewrites. It also needs the tzdata-gap argument
   accepted once, and pays off on both calls for it.
3. **E, then F.** E interns the `Locale` objects F's name memo hangs off, so it
   reads first; each is independently correct and only together fast. F requires
   B for the shared inverse civil conversion. It is the design review of the set
   — changing how the `Formatter` is built rather than what it calls — with its
   numeric fast paths riding along.
4. **G and H.** Both require B's shared civil-day conversion and otherwise sit
   off the string directions, so this table understates them; each is argued on
   [coverage.md](coverage.md), and each owns a column the other does not.
5. **I.** File after G, whose arithmetic its civil math stands on, and last on
   the ladder. It is the one patch arguing output corrections, so its position
   asks "what does the finished tree lose without this" — and the answer is
   the three `endOf` columns and `hasSame day`.

A, B, D and F are the ones that hold on any engine — all four remove an Intl call
or most of one, which no engine can be fast at — and C does the same on the
reading side by removing a RegExp compile. See
[cross-engine.md](cross-engine.md) for the ones that do not.
