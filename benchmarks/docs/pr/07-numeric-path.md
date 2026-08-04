# G — six fast paths along the route a numeric token takes

`src/datetime.js` · `src/impl/formatter.js` · `src/impl/util.js`

Rendering `yyyy-MM-dd HH:mm:ss` walks all six changes per value:

| file | function | change |
| --- | --- | --- |
| `formatter.js` | `num` | the only caller that reaches the tail of this is `DateTime#toFormat`, whose `Formatter` carries no options at all — a duration token always arrives with a `signDisplay` and `toISO`'s formatter sets `forceSimple`, so both return earlier. With no options and a `latn` numbering system, `PolyNumberFormatter` reduces to `padStart(roundTo(n, 3), p)`, and is built per token only to be thrown away |
| `formatter.js` | `parseFormat` | splitting a format string into tokens is pure and the same few strings recur, so the split is cached rather than redone per value |
| `formatter.js` | token loop | hoist what does not vary out of the loop, which also keeps the switch monomorphic |
| `util.js` | `roundTo` | every rounding mode is the identity on an integer once `digits` is non-negative, and an integer is what every numeric token arrives as |
| `util.js` | `padStart` | month, day, hour, minute and second all pad to two digits, so a `"00".."99"` table covers it without building either string |
| `datetime.js` | `tsToObj` | integer civil math in place of a wrapper `Date` and seven getter calls |

**Where the civil math comes from.** `tsToObj` uses Howard Hinnant's
`civil_from_days` from [chrono-compatible low-level date
algorithms](https://howardhinnant.github.io/date_algorithms.html), which is exact
for any Gregorian year. This is the one change here that is off the formatter
and is used by every `DateTime` that reads a calendar field.

**TimeClip is now written out, because `new Date(ts)` used to run it.** Dropping
the constructor dropped the truncation toward zero and the `±MAX_DATE` range
check with it. Fractional milliseconds must truncate toward zero rather than
floor, including for negative values. Values outside `±MAX_DATE` must remain
invalid; calendar overflow reaches `Date.UTC`, but millisecond addition otherwise
has no range check.

`tsToObj` remains bit-identical to `Date#getUTC*()` at the range ends, at each
sign of zero, either side of the epoch, and for fractional inputs.
