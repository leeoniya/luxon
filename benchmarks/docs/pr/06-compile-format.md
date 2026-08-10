# F — compile formats, and the fast paths along a numeric token's route

`src/datetime.js` · `src/impl/formatter.js` · `src/impl/util.js`

One patch in two layers. The structural layer compiles a format string to a
program once instead of interpreting it per value; the leaf layer is the set of
fast paths a numeric token still crosses on its way into that program's
output.

## The leaf layer

Rendering `yyyy-MM-dd HH:mm:ss` walks all of these per value:

| file | function | change |
| --- | --- | --- |
| `formatter.js` | `num` | the only caller that reaches the tail of this is `DateTime#toFormat`, whose `Formatter` carries no options at all — a duration token always arrives with a `signDisplay` and `toISO`'s formatter sets `forceSimple`, so both return earlier. With no options and a `latn` numbering system, `PolyNumberFormatter` reduces to `padStart(roundTo(n, 3), p)`, and is built per token only to be thrown away |
| `formatter.js` | `parseFormat` | splitting a format string into tokens is pure and the same few strings recur, so the split is cached rather than redone — it now runs at most once per pattern, when the compiler asks |
| `util.js` | `roundTo` | every rounding mode is the identity on an integer once `digits` is non-negative, and an integer is what every numeric token arrives as |
| `util.js` | `padStart` | month, day, hour, minute and second all pad to two digits, so a `"00".."99"` table covers it without building either string |
| `datetime.js` | `tsToObj` | integer civil math in place of a wrapper `Date` and seven getter calls |

**Where the civil math comes from.** `tsToObj` uses B's shared
`civilFromDays()` helper, Howard Hinnant's proleptic-Gregorian inverse
conversion. It writes year, month and day into the same result object that holds
the time fields, retaining one result allocation. This is the one change here
that is off the formatter and is used by every `DateTime` that reads a calendar
field.

**TimeClip is now written out, because `new Date(ts)` used to run it.** Dropping
the constructor dropped the truncation toward zero and the `±MAX_DATE` range
check with it. Fractional milliseconds must truncate toward zero rather than
floor, including for negative values. Values outside `±MAX_DATE` must remain
invalid; calendar overflow reaches `Date.UTC`, but millisecond addition otherwise
has no range check.

`tsToObj` remains bit-identical to `Date#getUTC*()` at the range ends, at each
sign of zero, either side of the epoch, and for fractional inputs.

## Compiling

Per formatted value, `formatDateTimeFromString` built eight closures over `dt`,
walked the token list calling a ~70-case string switch per token, and
re-allocated the Intl options object literals inside whichever branches it took.
None of that depends on the value.

Resolving each token to a handler once per pattern turns formatting into a walk
over a prebuilt array. The representation is alternating literal and handler
runs — `lits[0] + fns[0]() + lits[1] + … + lits[n]` — so literal text is
concatenated rather than dispatched, and adjacent literals collapse at compile
time. The two locale-derived flags stay per call, passed as arguments rather than
baked into the program, which is what lets the cache key on the format string
alone.

Punctuation and unknown tokens fold into the literal runs at compile time,
which is what the interpreter's default branch effectively did per value.

### Duration formats

`Duration#toFormat` had the same per-call shape at a smaller scale: it parsed the
pattern, rebuilt three closures and four temporary arrays, then shifted the
duration into the discovered fields. The compiled form caches only the fields,
widths and literal runs; shifting, sign mode, flooring and number formatting
remain per-value. After `shiftTo` fills those already-canonical fields, the
compiled loop reads `Duration#values` directly instead of normalizing each field
again through `Duration#get`.

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
E is what makes those the same object. The two are independently correct and only
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
