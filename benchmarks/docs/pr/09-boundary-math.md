# I — read-once objects dropped, and calendar boundaries as civil math

`src/datetime.js` · `src/duration.js` · `src/impl/conversions.js` · `src/impl/diff.js`

Two halves: objects built to be read once are dropped, and the
`startOf`/`endOf` boundary work becomes integer math.

| file | function | was |
| --- | --- | --- |
| `datetime.js` | `clone` | `{ ...current, ...alts, old: current }` — a second object merged out of the seven fields being carried over |
| `duration.js` | `as` | `shiftTo(unit).get(unit)`: a whole `Duration` constructed, normalized and cloned again on the way out of `shiftTo`, so one number can be read off it |
| `datetime.js` | `endOf` | `{ [unit]: 1 }` per call. A computed key makes a dictionary-mode object, which `normalizeObject` then walks. There are nine of them and they never change |
| `datetime.js` | `endOf` calendar units | `plus().startOf().minus(1)`: three `DateTime`s to reach the next year, quarter, month, week or day boundary and step back |
| `impl/diff.js` | `diff` | two lower-order `Duration`s plus a final `Duration#plus` and clone, even when there is only one lower-order unit |
| `impl/conversions.js` | `dayOfWeek` | `new Date(Date.UTC(...))` and `getUTCDay()`, plus a re-set for years 0–99 — an allocation per call, and the week conversions make up to four of them per operation |
| `datetime.js` | `startOf("week")` | `set({ weekday: 1 })`: the week round trip, `gregorianToWeek` to name this week and `weekToGregorian` to find its Monday, to land `weekday - 1` days back of the receiver |

**`clone` is the one that matters, and not only for the allocation.** The second
object takes its shape from `alts`, which is a different set of keys at each of
the six call sites — `{ts}`, `{ts, zone, wasHole}`, `{loc}`, `{ts, o, wasHole}`,
and `adjustTime`'s `{ts, o}` — so the config the `DateTime` constructor reads is
a different shape on every path into it and its field reads never settle. Naming
the fields gives every call site one shape.

Two of the seven are not named, because the constructor cannot read them here. It
never reads `config.c` at all, and it reads `config.o` only when `config.old` is
unset, which `clone` never leaves unset. Both still reach it on `old`, which is
where it looks for them when the instant and zone have not moved.

**`as` is the fiddly one**, because `shiftTo` is not the plain sum it reduces to.
For one target unit it first takes whole target units from every lower field,
snaps the resulting total with `snapFloatingPoint`, and only then adds each
lower-field remainder in the original value-key order. The direct path copies
that operation order and snapping rather than simplifying them away, preserving
the fixes for near-integers and direct lower-to-higher conversion in
`Duration#shiftTo`. The `|| 0` that the unit getter ends in is *not* copied,
and that is a deliberate divergence: nothing a `Duration` built
through `fromObject` can hold reaches it, since `asNumber` refuses everything
but a finite number — but `Duration#plus` writes sums directly, so an
`Infinity` field (or a conversion that overflows) produced a `NaN` sum that the
getter silently turned into `0`. The rewritten `as` answers `NaN` for those; an
infinite duration is not 0 minutes long.

**Two quirks corrected rather than preserved.** Stock's `as("__proto__")` did
not throw `InvalidUnitError`: `Duration.normalizeUnit` looked its argument up
in an object literal, where `"__proto__"` finds `Object.prototype` and
`"constructor"` finds a function, both truthy enough to pass the check meant to
reject them; `shiftTo` then indexed the conversion matrix with it and threw a
`TypeError`. Here, any unit `normalizeUnit` answers that is not one of the nine
ordered units throws `InvalidUnitError` — and with patch G's null-prototype
tables applied, `normalizeUnit` itself already throws it, so the branch is
belt-and-braces on the full ladder.

`endOf`'s memo is a null-prototype bag rather than a literal for the same
reason from the other direction: the key is whatever string the caller passed,
and `oneOf["constructor"]` on a literal would find `Object` off its own
prototype — before the cache was ever written to — and hand `plus()` a
function.

**`diff` has a cheap common case after the calendar walk.** When its unit list
contains one lower-order unit, `Duration#fromMillis(...).as(unit)` answers the
same number as `shiftTo(unit).get(unit)`. It can be written into the higher-order
result before constructing the return value, avoiding the final
`Duration#plus`, its nine-unit walk and its clone. Multiple lower-order units
keep the general path.

## The boundaries

**The weekday is integer math over B's shared civil conversion.**
`daysFromCivil()` gives days since the epoch; day zero was a Thursday, and a
floored modulo turns the count into an ISO weekday for dates on either side of
1970. That replaces a `Date` allocation per call in a function the week
conversions call up to four times per operation, and it is why
`startOf("week")` halves even before its route shortens: `set` with a `weekday`
in it pays the round trip below, and the round trip's cost was mostly these four
reads.

**`startOf("week")` stops asking what week it is.** The Monday of the receiver's
week is `weekday - 1` days back, whatever its week number is, so the ISO
round trip through `gregorianToWeek`/`weekToGregorian` computed a day count the
long way. The route now writes `day: c.day - (weekday - 1)` and lets `set()`
carry a day of zero or less into the previous month, which `Date.UTC` inside
`objToLocalTS` does exactly — the same borrow `adjustTime`'s day field has
always leaned on. The locale-weeks route is untouched: its start of week is a
locale question, and it stays on the week-data path.

**`endOf` fuses to one construction for every calendar unit.** Year, quarter and
month express their boundary as the first civil millisecond of the next month
edge; day and week join by expressing theirs as a day count — `day + 1`, and
`day + 8 - weekday` for the Monday after this week's — with the same `Date.UTC`
carry taking day 32 into the next month. The `minus(1)` folds in behind the
boundary: `fixOffset` places the boundary's first millisecond exactly as
`set()` would, and the result is `clone(this, { ts: boundaryTS - 1 })` — the
constructor re-derives the offset for any changed timestamp itself, so the
subtraction needs nothing else. `wasHole` is pinned false for the same reason
`minus(1)` left it false: a pure timestamp shift is never a hole resolution.
Hour and below stay on the chain deliberately — their boundary is a time of
day, and civil-midnight math would answer the wrong side of a fold for them.
Week is on the fused route only for ISO weeks; a locale-based start of week
stays on the general path.

On the ladder, this is the step between the last two rows: the three `endOf`
columns move from behind moment-timezone to ahead of moment core, and `hasSame
day`, which is `startOf` and `endOf` back to back, follows them across.

## Two corrections, argued rather than preserved

**At a midnight fold, `endOf` now ends the period on the receiver's side.** In
a zone that falls back across local midnight — Havana ends DST at 01:00 by
setting clocks to 00:00, so midnight repeats — the chain's `endOf("day")`
answered `00:59:59.999` *of the next day*: `startOf` placed the ambiguous
midnight with the offset of an instant a day ahead, and `minus(1)` stepped back
from the wrong pass through the fold. The fused route places the boundary with
the receiver's own offset, and the day ends at its own `23:59:59.999` — for
every calendar unit, argued once because they share the route. A ten-year scan
of eight zones — the benchmark zones plus Havana, Santiago (springs forward at
midnight), Amman, Lord Howe and Apia — finds no other divergence from stock:
spring-forward holes resolve identically because `fixOffset`'s hole branch does
not depend on the guess, and no benchmark zone transitions at midnight at all.

**Leap days before year 100 answer their own weekday.** Stock `dayOfWeek`
repaired `Date.UTC`'s two-digit-year reading by re-setting the year alone, after
`Date.UTC` had already rolled a date that exists in the proleptic year but not
in 19xx — so Feb 29 of years 0, 4, … 96 (leap; 1900 is not) answered March 1's
weekday. The math has no such seam: year 0's calendar is year 2000's (the
400-year cycle is exactly 20871 weeks), and `DateTime.utc(0, 2, 29).weekday` is
now 2, as 2000-02-29 was a Tuesday. `objToLocalTS` already carries the correct
version of this repair for the timestamp itself.

## Invalidation

None. The `oneOf` table is nine constants rather than a cache of anything, and
everything else here is stateless arithmetic — no reset hook, and nothing keyed
by zone or locale.
