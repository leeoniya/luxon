# F — intern `Locale`, and memoize the three things rebuilt off it per value

`src/impl/locale.js` · `src/duration.js`

`datetime.js` calls `Locale.fromObject` on each `fromMillis` / `fromObject` /
`setZone`, so every `DateTime` allocates a `Locale`. That is self-defeating on
its own terms: `weekdaysCache`, `monthsCache`, `eraCache` and `fastNumbersCached`
exist to be reused, and a `Locale` per `DateTime` guarantees they never are.
`toFormat()` then calls `loc.redefaultToEN()`, whose `return this` fast path can
never fire because the spread always adds `defaultToEN`.

`Locale`s are immutable value objects apart from those memo fields, so identical
ones can be shared. The intern and the `redefaultToEN` memo both have to notice
mutation of the `Settings` fields `create()` falls back to, so both go through
one generation check — four identity compares. An earlier attempt that built a
string cache key covering every field measured slower than no cache at all.

**Which shapes get interned is not a detail.** A caller outside the interned set
pays the generation check and gets nothing back. `Info.months` and
`Info.monthsFormat` pass `outputCalendar: "gregory"` explicitly, so with only the
no-`outputCalendar` shape interned they came out slower than stock while
`Info.weekdays`, which passes null, came out faster — a split with no reason
behind it. Hence the second map: the `"gregory"` shape is interned separately and
keyed the same way, so neither path pays a compound key to get there.

**`Duration#toHuman`'s formatters** belong on the interned `Locale` once it has a
generation counter. `toHuman` asks for one number formatter per unit it prints
and one list formatter, and builds a fresh options object to ask for each. Called
with no options every one of those is determined by the locale and the unit
alone. Any option at all is spread into both formatters' options, including ones
Intl ignores, so the memo is only taken when the caller passed none — which keeps
the semantics for a caller who reuses and mutates an options object between
calls. The same loop now pushes the units it actually formats directly instead
of allocating an eight-slot `map()` result and immediately filtering its nulls.

It has to hang off the `Locale` rather than off the `Duration` for
`Settings.resetCaches()` to reach it: a `Duration` built before the reset still
holds its `Locale` instance and nothing looks that instance up again, so a memo
there would go on rendering through the `Intl` objects the reset was meant to
drop. That is the case `resetCaches()` exists for, and the test swaps
`Intl.NumberFormat` out from under a `Duration` that has already rendered.
