# G — six fast paths along the route a numeric token takes

`src/datetime.js` · `src/impl/formatter.js` · `src/impl/util.js`

One idea applied six times, in order along a single route: each takes work out of
a step without changing what the step means. Rendering `yyyy-MM-dd HH:mm:ss`
walks all six per value, and none is worth filing alone — two clear the noise
floor on V8 only, one on JavaScriptCore only, one on neither.

| file | function | change |
| --- | --- | --- |
| `formatter.js` | `num` | the only caller that reaches the tail of this is `DateTime#toFormat`, whose `Formatter` carries no options at all — a duration token always arrives with a `signDisplay` and `toISO`'s formatter sets `forceSimple`, so both return earlier. With no options and a `latn` numbering system, `PolyNumberFormatter` reduces to `padStart(roundTo(n, 3), p)`, and is built per token only to be thrown away |
| `formatter.js` | `parseFormat` | splitting a format string into tokens is pure and the same few strings recur, so the split is cached rather than redone per value |
| `formatter.js` | token loop | hoist what does not vary out of the loop, which also keeps the switch monomorphic |
| `util.js` | `roundTo` | every rounding mode is the identity on an integer once `digits` is non-negative, and an integer is what every numeric token arrives as |
| `util.js` | `padStart` | month, day, hour, minute and second all pad to two digits, so a `"00".."99"` table covers it without building either string |
| `datetime.js` | `tsToObj` | integer civil math in place of a wrapper `Date` and seven getter calls |

Two of the six are engine-specific and are the weakest part of this: the token
loop pays off on V8 and gives a little back on JSC, and the `padStart` table is
the reverse. They are in because the other four carry the change, and splitting
by engine would mean filing six patches to land four. If K lands as well, it
subsumes `parseFormat` and the punctuation half of the token loop by
construction.

**Where the civil math comes from.** `tsToObj` uses Howard Hinnant's
`civil_from_days` from [chrono-compatible low-level date
algorithms](https://howardhinnant.github.io/date_algorithms.html), which is exact
for any Gregorian year. This is the one change here that is off the formatter,
and it is under every `DateTime` that reads a calendar field, so it is worth more
review than the other five together.

**TimeClip is now written out, because `new Date(ts)` used to run it.** Dropping
the constructor dropped the truncation toward zero and the `±MAX_DATE` range
check with it, and the verification sweep found both. Without the truncation,
`DateTime.fromSeconds(1.0005).toISO()` rendered `"1970-01-01T00:00:01.0.5Z"` —
malformed, not merely different — and `fromMillis(-0.5)` moved a whole day,
because `Date` rounds toward zero and `Math.floor` does not. Without the range
check, `fromMillis(0).plus({ milliseconds: 9e15 }).toISO()` answered
`"+287168-08-24T16:00:00.000Z"` where luxon says null; calendar-unit overflow is
caught by the `Date.UTC` inside `objToLocalTS`, but milliseconds are added to the
timestamp after that and nothing was checking it. Both are reachable from
ordinary calls and neither is from any benchmark, which is how they survived
until there was something checking the arithmetic rather than the speed.

Both are now fixtures. `tsToObj` is checked against `new Date().getUTC*()`, which
is the platform call it replaced rather than a table of expected values, at the
range ends, at each sign of zero, either side of the epoch, and on the fractional
inputs the truncation is for.
