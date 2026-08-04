# B — `IANAZone#offset`: decode `format()` instead of `formatToParts()`

`src/zones/IANAZone.js`

`offset()` currently costs a `formatToParts` (seven `{type, value}` objects), six
`parseInt` calls on the strings it returns, a wrapper `Date`, and a second `Date`
inside `objToLocalTS`. `dtf.format()` hands back the same six numbers in one
string. Reading them with `charCodeAt` and converting with integer arithmetic
gives a bit-identical answer and allocates nothing but that string.

**Where the civil math comes from.** The date-to-days step is Howard Hinnant's
`days_from_civil` from [chrono-compatible low-level date
algorithms](https://howardhinnant.github.io/date_algorithms.html), unmodified. It
is proleptic Gregorian and exact over the whole range luxon accepts, which is why
it can replace `Date.UTC` rather than approximate it.

**Field layout is measured, not assumed.** The position of each field in the
formatted string is read once per zone from `formatToParts` at construction. Any
zone that does not come back in the expected order keeps the original path, so an
ICU that lays fields out differently degrades to stock instead of decoding them
into the wrong slots.

The scanner preserves offsets across transitions, sub-hour offsets and negative
years. Unexpected field layouts use the original `formatToParts()` path.
