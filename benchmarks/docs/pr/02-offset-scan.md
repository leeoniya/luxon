# B — `IANAZone#offset`: decode `format()` instead of `formatToParts()`

`src/impl/util.js` · `src/zones/IANAZone.js`

`offset()` currently costs a `formatToParts` (seven `{type, value}` objects), six
`parseInt` calls on the strings it returns, a wrapper `Date`, and a second `Date`
inside `objToLocalTS`. `dtf.format()` hands back the same six numbers in one
string. Reading them with `charCodeAt` and converting with integer arithmetic
gives a bit-identical answer and allocates nothing but that string.

**Where the civil math comes from.** `impl/util.js` exports Howard Hinnant's
paired `days_from_civil` and `civil_from_days` from
[chrono-compatible low-level date algorithms](https://howardhinnant.github.io/date_algorithms.html).
They are proleptic Gregorian and exact over the whole range luxon accepts.
The offset scanner uses the forward conversion; DateTime field extraction,
calendar diffs and weekday calculations consume the same implementation through
their dependent patches. The inverse writes into a supplied result object so
those callers do not trade a `Date` allocation for another allocation.
`civilDayDiff` keeps G's and H's repeated subtraction of two civil field
records beside the same conversion.

**Field layout is measured, not assumed.** The position of each field in the
formatted string is read once per zone from `formatToParts` at construction. Any
zone that does not come back in the expected order keeps the original path, so an
ICU that lays fields out differently degrades to stock instead of decoding them
into the wrong slots.

The scanner preserves offsets across transitions, sub-hour offsets and negative
years. Unexpected field layouts use the original `formatToParts()` path.

**One deliberate divergence at the very edges.** Stock decoded through
`Date.UTC`, which overflows to `NaN` when the *local* wall time at exactly
±8.64e15 falls outside the Date range — so stock's answer at each edge depended
on the sign of the zone's offset (New York and Kolkata behaved oppositely). The
integer math has no such trouble, and the scanner answers the true offset at
both edges. Timestamps beyond the range still answer `NaN`, matching the
documented contract.
