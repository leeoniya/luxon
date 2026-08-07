# K — compile DateTime and Duration formats, and memoize DateTime names

`src/impl/formatter.js`

Three changes to the same file. DateTime and Duration patterns are compiled once;
the third change memoizes the non-English names DateTime tokens resolve to.

## Compiling

Per formatted value, `formatDateTimeFromString` builds eight closures over `dt`,
walks the token list calling a ~70-case string switch per token, and re-allocates
the Intl options object literals inside whichever branches it takes. None of that
depends on the value.

Resolving each token to a handler once per pattern turns formatting into a walk
over a prebuilt array. The representation is alternating literal and handler
runs — `lits[0] + fns[0]() + lits[1] + … + lits[n]` — so literal text is
concatenated rather than dispatched, and adjacent literals collapse at compile
time. The two locale-derived flags stay per call, passed as arguments rather than
baked into the program, which is what lets the cache key on the format string
alone.

If G lands as well, this subsumes two of its six: `parseFormat` runs once per
pattern rather than once per value, and punctuation and unknown tokens fold into
the literal runs, which is what the interpreter's default branch effectively did.

### Duration formats

`Duration#toFormat` had the same per-call shape at a smaller scale: it parsed the
pattern, rebuilt three closures and four temporary arrays, then shifted the
duration into the discovered fields. K now caches only the fields, widths and
literal runs; shifting, sign mode, flooring and number formatting remain
per-value. After `shiftTo` fills those already-canonical fields, the compiled
loop reads `Duration#values` directly instead of normalizing each field again
through `Duration#get`.

## The name a token resolves to

A name token — month, weekday, era, day period — has an English fast path that
reads a constant array and no fast path at all for anything else: it calls
`loc.extract()`, which builds an `Intl.DateTimeFormat`, calls `formatToParts()`
and searches the parts, once per token per value.

`Locale` has already computed these. `monthsCache`, `weekdaysCache` and
`meridiemCache` hold exactly these lists, built once per `Locale`, and
`Info.months` reads them while the formatter does not.

**Having the formatter read `Locale`'s lists is the obvious fix and the wrong
one.** `Locale` asks Intl for a format-context weekday with `year: "numeric"` in
the options and the formatter asks without it, which is enough to change which
form ICU returns — swapping them re-renders fi and fa weekdays. So this memoizes
the formatter's own `extract()` call instead, keyed by the field the answer
depends on: the month for a month, the weekday for a weekday, the hour for a day
period. Same options and same call, so the string cannot change.

The memo hangs off the `Locale`, and `toFormat` builds a fresh one per call
through `redefaultToEN`. On its own this therefore memoizes nothing across calls;
F is what makes those the same object. The two are independently correct and only
together fast.

Three boundaries, none of them visible from the code alone:

- Month and era names are only a function of `dt.month` and `dt.year` when the
  resolved calendar is Gregorian. `fa` resolves to the persian calendar with no
  `outputCalendar` named, and a slot keyed by the Gregorian month returns a
  neighbouring Persian one. Those two consult the resolved calendar first and
  fall back to `extract()` when it is not Gregorian, which keeps `fa` correct and
  still lets its weekday and day period memoize.
- The era slot splits on `year <= 0`, not `year < 0`. Luxon's years are proleptic,
  so year 0 is 1 BC and shares a slot with the negative ones. Off by one there is
  invisible until locales are interned, at which point a BC date formatted after
  an AD one in the same `Locale` renders as AD.
- Day periods are keyed by hour across 24 slots rather than by `hour < 12` across
  two. No locale on the ICU this was written against renders more than AM/PM
  under h12, so the extra slots buy nothing measurable today. They are there
  because the opts name only the hour, which makes the hour the whole of what the
  answer can depend on; two slots would import `Locale#meridiems`' assumption
  that a locale has exactly two day periods, which its own comment calls
  "probably wrong".

**One pre-existing inconsistency is left alone.** `toFormat("LLLL")` in `ja`
renders `4` where `Info.months` and `toLocaleString` both render `4月`, because
`Locale#months` carries a `ja` workaround the formatter has never had. Memoizing
what the formatter already returns does not change what it returns.
