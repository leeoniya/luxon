# K — calendar boundaries as civil math

`src/datetime.js` · `src/impl/conversions.js` · `src/impl/util.js`

| file | function | was |
| --- | --- | --- |
| `impl/conversions.js` | `dayOfWeek` | `new Date(Date.UTC(...))` and `getUTCDay()`, plus a re-set for years 0–99 — an allocation per call, and the week conversions make up to four of them per operation |
| `datetime.js` | `startOf("week")` | `set({ weekday: 1 })`: the week round trip, `gregorianToWeek` to name this week and `weekToGregorian` to find its Monday, to land `weekday - 1` days back of the receiver |
| `datetime.js` | `endOf` day and week | `plus().startOf().minus(1)` — three `DateTime`s to reach the next boundary and step back, the pair I's fused route left out |
| `datetime.js` | `endOf` year, quarter, month | I's `set({...}).minus(1)` — two `DateTime`s, one of them built to be subtracted from |

**The weekday is seven lines of integer math.** Howard Hinnant's
`days_from_civil` — the same routine B keeps privately in `IANAZone.js`, and the
inverse of the `civil_from_days` F put under `tsToObj` — gives days since the
epoch; day zero was a Thursday, and a floored modulo turns the count into an ISO
weekday for dates on either side of 1970. That replaces a `Date` allocation per
call in a function the week conversions call up to four times per operation, and
it is why `startOf("week")` halves even before its route shortens: `set` with a
`weekday` in it pays the round trip below, and the round trip's cost was mostly
these four reads.

**`startOf("week")` stops asking what week it is.** The Monday of the receiver's
week is `weekday - 1` days back, whatever its week number is, so the ISO
round trip through `gregorianToWeek`/`weekToGregorian` computed a day count the
long way. The route now writes `day: c.day - (weekday - 1)` and lets `set()`
carry a day of zero or less into the previous month, which `Date.UTC` inside
`objToLocalTS` does exactly — the same borrow `adjustTime`'s day field has
always leaned on. The locale-weeks route is untouched: its start of week is a
locale question, and it stays on the week-data path.

**`endOf` fuses to one construction for every calendar unit.** I fused
`plus().startOf()` into one `set()` for the units whose boundary is a month
edge; day and week join by expressing their boundary as a day count — `day + 1`,
and `day + 8 - weekday` for the Monday after this week's — with the same
`Date.UTC` carry taking day 32 into the next month. The `minus(1)` folds in
behind it: `fixOffset` places the boundary's first millisecond exactly as
`set()` would, and the result is `clone(this, { ts: boundaryTS - 1 })` — the
constructor re-derives the offset for any changed timestamp itself, so the
subtraction needs nothing else. `wasHole` is pinned false for the same reason
`minus(1)` left it false: a pure timestamp shift is never a hole resolution.
Hour and below stay on the chain deliberately — their boundary is a time of
day, and civil-midnight math would answer the wrong side of a fold for them.

Under the full ladder in a named zone, 20k pooled operations: `endOf("day")`
27.4 → 6.1 ms, `endOf("week")` 54.6 → 6.0 ms, `endOf("month")` 20.4 → 5.8 ms,
`startOf("week")` 37.3 → 17.3 ms. In the band table's whole-operation columns
the three `endOf` cells go from behind moment-timezone to ahead of moment core
(46.2/82.8/37.2 → 11.3/10.6/10.5 against core's 20.8/27.0/19.3), and
`hasSame day`, which is `startOf` and `endOf` back to back, follows them across.
The whole patch minifies to 255 bytes.

## Two corrections, argued rather than preserved

**At a midnight fold, `endOf` now ends the period on the receiver's side.** In
a zone that falls back across local midnight — Havana ends DST at 01:00 by
setting clocks to 00:00, so midnight repeats — the chain's `endOf("day")`
answered `00:59:59.999` *of the next day*: `startOf` placed the ambiguous
midnight with the offset of an instant a day ahead, and `minus(1)` stepped back
from the wrong pass through the fold. The fused route places the boundary with
the receiver's own offset, and the day ends at its own `23:59:59.999`. I's
month route already answered this way (its "preserves offset-transition
behavior" claim missed this case; the fixtures now pin it); K extends the same
rule to day and week. A ten-year scan of eight zones — the benchmark zones plus
Havana, Santiago (springs forward at midnight), Amman, Lord Howe and Apia —
finds no other divergence from stock: spring-forward holes resolve identically
because `fixOffset`'s hole branch does not depend on the guess, and no
benchmark zone transitions at midnight at all.

**Leap days before year 100 answer their own weekday.** Stock `dayOfWeek`
repaired `Date.UTC`'s two-digit-year reading by re-setting the year alone, after
`Date.UTC` had already rolled a date that exists in the proleptic year but not
in 19xx — so Feb 29 of years 0, 4, … 96 (leap; 1900 is not) answered March 1's
weekday. The math has no such seam: year 0's calendar is year 2000's (the
400-year cycle is exactly 20871 weeks), and `DateTime.utc(0, 2, 29).weekday` is
now 2, as 2000-02-29 was a Tuesday. `objToLocalTS` already carries the correct
version of this repair for the timestamp itself.

## Invalidation

None. Everything here is stateless arithmetic — no cache, no reset hook, and
nothing keyed by zone or locale.
