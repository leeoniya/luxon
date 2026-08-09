# suite.ts — luxon's own cases, across builds

> `node suite.ts` (or `bun suite.ts`), `--only <substring>` to filter. Timing
> methodology is in [methodology.md](methodology.md).

Luxon's own benchmark cases from `benchmarks/datetime.js` and `benchmarks/info.js`,
reproduced across stock and the full patched build instead of run against a single
one. The deviations from the originals are listed at the top of `suite.ts`.

The value of using luxon's own cases is that nobody chose them to make these
patches look good.

## Reading the table

Cells are µs per call, `Δ%` is against stock, negative is faster.

The floor a real difference has to beat is measured per cell — how far apart two
readings of that same cell fell, see [methodology](methodology.md#the-noise-floor)
— and the bench reports its median, ninth decile and worst under the table.

A case counts as *moved* in the verdict when it clears that ninth decile, and its
own jitter, and a minimum percentage, **and** moves at least a minimum number of
microseconds. The last condition is for `Info`'s sub-0.1µs cases, where the
percentages are worth a few nanoseconds.

Using a table-wide percentile rather than only each case's own jitter is
deliberate. A per-case figure is a single comparison, so a case whose two halves
happened to agree closely gets an unrealistically tight floor and then reports the
next run's noise as a finding — which it did: successive runs each listed three
or four cases as several percent slower, and never the same ones.

The two minimum thresholds were calibrated against the control column this table
used to carry, on a quiet host. They have not been re-derived against the
split-half floor that replaced it, which reads wider; treat them as inherited.

The summary row is a **geometric mean**, which is the right average of ratios and
weights every case equally, as luxon's own suite does — having no notion of which
of its cases an app runs more often. A sum of the µs columns would instead let the
two cases that reset the caches decide the answer.

## What shows up here

**The zone patches**, on every case that names a zone: `DateTime#setZone`,
`DateTime.local` with a zone, and both token parsers with one. None of those
formats anything — they need an offset to place a local time, and B and D are what
that offset costs. The same four cases *without* a zone move by much less, which
is the size of the rest of the ladder on paths it was not written for.

**E**, on `Info.months` and `Info.weekdays`, both of which build a `Locale` per
call and now get an interned one.

**G**, which this is the only table that reaches at all. Its relative-time table
lands on `DateTime#toRelativeCalendar`; the reused `Date` inside `SystemZone` on
`DateTime.now` — the default zone, and so the one configuration
[`upstream`](upstream.md) never names; and the `Duration` unit table plus the
`adjustTime` fast path on `DateTime#add`. That last one is the largest by a wide
margin, and the ladder's [`other` table](coverage.md) is where its reach is
visible rather than here.

**F**, on `DateTime#toFormat`, which is the case [`format`](format.md) measures in
bulk.

## The two cases that reset the caches

The most expensive cases in the table are the two that call
`Settings.resetCaches()` every iteration. The German formatting case is a known
exception to the otherwise flat reset rows: it can report a substantial slowdown
on both engines because every iteration deliberately defeats the locale and
formatter caches.

That is a reset-path cost, not a regression introduced by this audit's retained
G arithmetic or F Duration-format changes: the case formats DateTimes and reaches
neither path. Each patch's cache is cleared where luxon clears the cache it stands
in for, so none of the speedups elsewhere is a cache quietly outliving its reset.
These rows are how the reset hooks in A, B, C and D came to be written.

## The case nothing moves

`DateTime#toLocaleString`, which is a finding rather than an oversight — it is the
formatting API luxon's own docs steer callers toward. The profile behind that, and
the two cache designs that were tried and dropped, are in
[coverage.md](coverage.md).
