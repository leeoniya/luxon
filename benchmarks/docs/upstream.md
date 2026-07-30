# upstream.ts — the patch ladder

> `node upstream.ts` (or `bun upstream.ts`). Timing methodology is in
> [methodology.md](methodology.md); the patches themselves are in
> [`../patches/`](../patches), each with its reasoning in its header.

What can be removed from *inside* luxon, patch by patch. Eight candidate patches,
lettered A through H, all of them memoization or provable short-circuits: no API
changes, no output changes.

The workload is a column of timestamps rendered in a named IANA zone — what a
dashboard or a data table produces thousands of at a time — plus the same ladder
run against parsing, and once more against the default zone.

## The tables

| table | flag | what it answers |
| --- | --- | --- |
| patches | `--patches` | what each patch costs in shipped bytes |
| format | `--format` | the ladder, writing a date in a named zone |
| parse | `--parse` | the same ladder reading one |
| default | `--default` | the same ladder with no zone named at all |

Any combination can be run alone, which is the loop for iterating on one patch.
`--verify` adds the output-parity table. `--footprint` adds rss and Intl-formatter
counts.

The baseline is moment-**timezone**, not moment: a named zone needs its packed
offset table, and only its `z` token renders an abbreviation. moment core is
underneath it doing the formatting, so both versions are reported — reproducing
these numbers means installing the pair.

## Where the ladder comes from

Each rung adds one patch to the one above it, so a rung's contribution is what it
adds *given everything above it* rather than what it is worth alone. The two
readings differ, sometimes a lot, and the difference is the point: C is the
largest single formatter win measured in isolation and one of the smaller rungs
in the ladder, because by the time it arrives the caches above it have already
taken the costs it would have removed.

Every rung is bounded by one of the two Intl calls a zoned format makes, and
which of the two formats a rung helps tells you which call it removed. A pattern
with no zone name in it only ever pays for the offset; a pattern with one pays
for both.

## The patches

### A — `zoneInfoCache`

The one that matters, and barely an optimization. `parseZoneInfo` built a fresh
`Intl.DateTimeFormat` per value, so any pattern containing a zone name paid
formatter construction *per formatted value*. Routing it through luxon's existing
`getCachedDTF` is a one-line change and is most of the abbreviated format's cost.

It is the only patch that pays for itself in bytes as well: it deletes a
constructor call in favour of a cache lookup luxon already has.

### B — `offsetScan`

The offset lookup read the cheap way rather than through a formatter. Together
with A this is nearly all of the numeric format, since a pattern with no zone
name in it has nothing else left to pay for. On the abbreviated format it helps
much less, because that one is still bounded by the name lookup no matter how
cheap the offset gets.

B is one of the three places in the whole set that restates logic rather than
adding a cache or a short-circuit, so it is one of the places to look first. It
is verified against stock `offset()` over every transition its zones have.

### C — `compileFormat`

The structural one. Compiling a pattern to handlers once removes three costs
together: the ~70-case switch per token per value, the eight closures
`formatDateTimeFromString` built per call, and the Intl options object literals
its branches allocated. It also folds punctuation into literal runs, so
separators cost a concat.

It is not a substitute for the caches — those are worth a great deal between
them, and C adds to the total on top of all of them. It is the largest single
formatter win in isolation.

### D — `tokenParserCache`

C's argument pointed the other way. `fromFormat` resolves a format string to a
compiled RegExp on every call and then throws it away, which is what the
Formatter used to do with a token list per value; the fix is the same one,
resolve it once per format and keep it.

It needs none of C's restructuring, because the object worth keeping is already
public: `buildFormatParser` hands a `TokenParser` out and `fromFormatParser`
takes one back, an API whose only purpose is to let a caller hoist exactly this
out of a loop. D does it for the callers who did not. The whole patch is a Map, a
lookup and a reset, and it takes better than half off both token-parsing columns.

### E — `zoneNameScan`

A aimed at the name instead of the offset: read the zone name out of
`dtf.format()` instead of allocating a part per field and walking them. It is
what unbounds the abbreviated format, and it does nothing at all on the numeric
one, because a pattern without a zone name never asks for it.

E is the clearest illustration of the split this table is built around — it takes
two thirds off the abbreviated format and moves no parse column at all.

### F — `transitionInterval`

One interval cache serving both lookups: the offset and the name are cached
together across the interval that two probes prove transition-free. It is the one
rung after C that helps both formats, because it is the one patch that touches
both calls.

F is also the patch with a precondition rather than a proof from first
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

F also carries the one divergence from stock in the whole set, and it is stock
that is strange. Asked for a GENERIC name, ICU answers America/Cambridge_Bay with
"MT" everywhere except the single repeated hour of a fall-back transition, where
it returns "MT (Cambridge Bay)" — an instant-dependent answer for a name whose
whole point is not to depend on the instant. A span brackets that hour and serves
the neighbouring answer. Over 218,100 comparisons against stock spanning 16
zones, 5 locales, all 6 styles and 4 access orders, that is every one of the 258
differences. There are none in the offset, and none in `short` or `long`, which
are the only two styles luxon's own tokens ask for.

B and E rest on the same reading of tzdata but carry no such precondition.

### G — `localeIntern`

Interning `Locale` objects. Invisible on a formatting path that holds the locale
fixed, and dramatic on `Info.months` / `Info.weekdays` in a non-English locale,
which build a `Locale` per call — see [coverage.md](coverage.md), where that
collapses to almost nothing.

### H — `hotPath`

One idea applied twelve times, in three families.

**Six numeric fast paths on the formatting side.** These were six separate
patches before the merge, and they did not agree on which engine they helped: two
cleared the noise floor on V8 only, one on JavaScriptCore only, one on neither.
Together they clear it on both by a wide margin, which is the case for filing
them as one patch rather than six.

**Four hoisted constants.** Lookup tables and one `Date` object that luxon
rebuilt per call, in `DateTime.normalizeUnit`, `Duration.normalizeUnit`,
`formatRelativeTime` and `SystemZone#offset`. None of these are on a formatting
path, so the format table cannot see them at all — every row of it names a zone,
and `SystemZone` is the default. The same engine split runs through them: V8
escape-analyzes some of the allocations away and JavaScriptCore does not, so node
sees a few percent where bun sees a lot more.

**Two arithmetic round trips removed.** These are worth more than the other ten
together on the paths that reach them. `adjustTime` was building a nine-key
`Duration` and converting it to milliseconds on every `plus` and `minus`, where
an integer sum will do; `impl/diff.js`'s `dayDiff` was building another to reach
a single division. Every `plus` and `minus` goes through `adjustTime`, which puts
it under `endOf`, `hasSame`, `diff`, `toRelative` and `Interval#splitBy` as well
— and this file has a row for none of those. [coverage.md](coverage.md) is where
that lands.

The `adjustTime` fast path was found by taking coverage's four worst rows against
moment and profiling them. `diff`, `endOf('month')`, `toRelative` and
`hasSame('day')` were all behind, all four for the same reason.

H contains the other two rewrites in the set, alongside B: the `adjustTime` fast
path and the `tsToObj` civil-math replacement. Both are verified against stock
over 85,806 comparisons in
[`test/hot-path-patch.test.ts`](../test/hot-path-patch.test.ts) and against
`Date`'s own getters over 200k random instants across the full range. Writing
that sweep is also what turned up two bugs in the `tsToObj` rewrite, which had
lost the TimeClip the `Date` constructor was doing on its behalf: it neither
truncated a fractional timestamp toward zero nor went invalid outside
±`MAX_DATE`.

### What the merge cost

C subsumes two of H's six formatter fast paths by construction, since it parses
each pattern once and folds punctuation into literal runs. While those two were
their own patches, a build without them measured that redundancy directly. They
cannot be removed on their own now, and no build here stands in for one that
could: dropping H whole measures H's weight rather than C's redundancy, which is
a different question badly asked. Losing that check is the one thing merging
these six gave up, and it is not recoverable without unmerging them.

## Reading dates

Reading was not what most of this was aimed at, and the parse table shows which
of it carries over.

The biggest formatting wins do nothing here. A and E are the zone-name lookup and
no parse performs one; C compiles a format string for writing and no parse walks
one. None of the three moves a parse column by more than the column's own noise
floor. Three patches carry this table instead: B and F, both being `offset()`,
which every zoned parse needs before it can place a local time, and D, the only
one in the set written for reading.

The two ISO columns are the same parse differing only in how many zone lookups it
makes, and that count is the whole story of the table. A string with no offset on
it costs three: `fixOffset` cannot turn a local time into an instant without
knowing the offset, and cannot know the offset without an instant, so it seeds
itself with the offset at `Settings.now()` and then probes twice around the
answer. A string carrying its own offset supplies that seed, skips the probes,
and is read in a fixed-offset zone, so it costs one. That gap is why B alone
cannot close it — B only makes each lookup cheaper, and the gap is about how many
there are.

F is what closes it, though the first version of it did not. Three lookups per
parse is precisely the pattern a one-span cache cannot serve: each evicts the
next, so a span never survives to be hit and the budget that would widen it never
grows. That version hit exactly never on the no-offset column while hitting 99%
of the time on the column that makes one lookup — and not because the instants
were far apart, either. It missed as reliably reading today's dates as dates
years out. Two spans, anchored around the instant that missed rather than
extended the way the last miss went, close it, and the two ISO shapes end up
level because the count stops mattering once the lookups are free.

(A `fixOffset` that asked for the offset once instead of three times would reach
the same place from the other direction, and is a larger change to argue for.)

That also settles the two comparisons this table used to lose. easy-tz's zone no
longer beats the patch set on the zone-bound column, because both are now bounded
by luxon's own parsing rather than by a zone lookup. And the two token formats,
the last columns where moment-timezone was still ahead, have gone the other way.
The patched builds are ahead on every shape in the table, and on a bare timestamp
it is not close.

## The default zone

Every other table names a zone, which is the configuration the patches were
written for. `--default` is the same ladder with no zone named at all — what a
caller who never configures one gets.

Luxon falls back to `SystemZone`, whose `offset()` is a `getTimezoneOffset` call
rather than an Intl one, so stock is already far cheaper there than against a
named zone. A, B, E and F exist to remove Intl calls, so against the default zone
there is much less for them to remove. What is left is D on the reading cases, G,
and H's non-Intl half — its hoisted constants and the `adjustTime` fast path.

The table is short for that reason. Several of its cases have no patch on them at
all, and a run where those sit inside the floor printed under the table is the
table working rather than a null result. Its last column is stock again with a
zone named, which is what every other table on the page measures — a baseline for
how much of stock's cost was the named zone in the first place, not a control.

## Verdict

Stacked, the set moves both the easy-tz path and stock luxon a long way against
moment-timezone, without touching a public API or changing a byte of output. That
is verified across every token in the switch, all macro tokens, four zones and
four locales including a non-gregory calendar with non-latn digits, and for the
name patches over ten zones, five locales and all six `timeZoneName` styles
either side of every modern transition
([`test/zone-name-patches.test.ts`](../test/zone-name-patches.test.ts)).

That answers the question the last two rows of the format table are for: same
patches on both sides, so the only difference is where the zone comes from. It
used to be pattern-dependent, and with E and F it is not — the full upstream
build is level with the easy-tz-bound one on both formats, where before them
easy-tz was an order of magnitude ahead on abbreviations. A luxon carrying all of
these would leave easy-tz nothing to win inside luxon's `Formatter`, on either
kind of pattern.

Skipping the `Formatter` entirely for the patterns a value formatter emits in
bulk — easy-tz's own fast path — is a further large multiple beyond even that,
and is where the remaining case for easy-tz lives.

That one is no longer measured. It had a build here for a while that was timed
and never printed, and it went with the rest of the untabulated set. The path
itself is still in [`lib/format-paths.ts`](../lib/format-paths.ts) as
`makeFastFormatter`, so putting a row back is adding a row rather than writing a
path; nothing calls it today.

## Filing order

In the order they are lettered, which is what the letters are for.

1. **A, B, D and E.** All four are self-contained and none needs a design
   argument. A and B together close most of the numeric gap to moment; E is the
   same shape of change on the other Intl call; D is the cheapest of the four to
   argue for, since it only reuses an object luxon already hands callers for the
   purpose.
2. **F.** Needs the tzdata-gap argument accepted once, and pays off on both calls
   for it.
3. **C.** Sits third in the ladder because the rungs are cumulative, but it is
   the last of the six to file: the largest single win in isolation, and the one
   that changes how the `Formatter` is built rather than what it calls.
4. **G and H.** Last, not because they are smaller but because they are the two
   this table understates. Both are independent of the zone work above and of
   each other, and each is argued on [coverage.md](coverage.md), where they reach
   calls that never format anything.

A, B, C and E are the ones that hold on any engine — all four remove an Intl call
or most of one, which no engine can be fast at — and D does the same on the
reading side by removing a RegExp compile. See
[cross-engine.md](cross-engine.md) for the ones that do not.
