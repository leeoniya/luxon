# G — reach values directly, on the arithmetic path

`src/datetime.js` · `src/duration.js` · `src/impl/diff.js` · `src/impl/english.js` · `src/zones/systemZone.js`

Eleven changes on the routes through DateTime and Duration arithmetic. Nothing
here formats or parses.

The retained direct paths replace this temporary work:

| file | function | was | is |
| --- | --- | --- | --- |
| `datetime.js` | `adjustTime` | `millisToAdd` = `Duration.fromObject({ …nine keys }).as("milliseconds")` | an integer sum |
| `diff.js` | `dayDiff` | four `DateTime`s and a `Duration`, for one subtraction. `utcDayStart(dt)` asked for the UTC midnight of `dt`'s civil date by moving `dt` to UTC keeping local time and then taking `startOf("day")` — two clones, each of which reconstructs | `dt.c` is that civil date already, so `objToLocalTS` on it directly, and one division |
| `datetime.js` | `plus` / `minus` | a `Duration` built per call for `adjustTime` to read nine getters off and drop; `minus` built a second, because `negate()` clones | `durationValues` produces those nine numbers directly |
| `duration.js` | `Duration#plus` / `minus` | normalized known unit names through getters, and `minus` cloned a negated addend before adding | read the two fixed-shape value records directly into one result |
| `diff.js` | exact millisecond diff | the calendar walk and lower-unit shift for a result already represented by endpoint subtraction | return `Duration.fromMillis(later - earlier, opts)` |

## Where the first two could go wrong

`as()` is not the plain sum it looks like, so neither replacement is
unconditional.

**Whole values.** In `adjustTime` the five calendar fields contribute only their
fractional parts, so when all nine fields are integers those terms are exactly
zero and `shiftTo`'s accumulator reduces to the same left-to-right sum. Its
trunc-and-remainder split then round-trips exactly, which it does not do in
general. Anything fractional still takes the old path.

**Range.** Stock's `shiftTo` detour went through thousandths, so a sum past
~1.8e305 overflowed to `NaN` and the milliseconds getter's `|| 0` silently
dropped the whole addition — `plus({ seconds: 1e308 })` added nothing. That was
a bug, and this patch corrects rather than preserves it: an overflowing sum
flows into the timestamp and produces an invalid DateTime. The `whole` flag
only routes fractional fields to the old path; it is not an overflow guard.

**Legacy years.** `utcDayStart` goes through `objToLocalTS` and not `Date.UTC`,
which is the same call with the same arguments except that `objToLocalTS` reverts
the two-digit-year rule. Writing `Date.UTC` there is the obvious way to write it
and it is wrong for every year under 100.

## The offset round trip

The third change to `adjustTime` is a return rather than a rewrite. When the
duration sets no calendar field, the civil object it assembles is `inst.c`
unchanged, so the `objToLocalTS` and `fixOffset` that follow re-derive the
timestamp and offset the instance is already carrying.

What that skips is also where `wasHole` comes from, which is public, so the
question is whether `false` is right for a receiver itself resolved out of a DST
hole. It is, and not by luck: a hole resolution returns a timestamp and offset
whose civil time lands *outside* the hole, so reading `inst.c` back out and
re-resolving cannot reach `fixOffset`'s hole branch either.

`clone()` always passes `old`, so its constructor ignores the supplied offset and
reads `zone.offset(ts)` itself. `adjustTime` nevertheless returns the correct
offset to preserve its own contract.

## The argument change

`durationValues` is what `Duration.fromObject` does to an object, minus the
object it returns. Every input `fromObject` rejects is still rejected, with the
same error and the same message. One place it could quietly diverge is
commented in the diff: `normalizeObject` writes
`normalized[normalizer(u)] = asNumber(v)` and a member expression is evaluated
before the value assigned to it, so an object with both a bad unit and a bad
value reports the *unit* — writing the two calls in reading order would report
the value. `negate()`'s `-0` guard is not carried over: a negated zero only
ever enters a sum, and `x + -0` is `x` for every `x`, so plain negation is
indistinguishable.

The other half is shape rather than allocation: `normalizeObject`'s result has
computed keys and a layout that depends on which units the caller named, so
`adjustTime`'s nine reads saw a different object for `plus({ days: 1 })` than for
`plus({ hours: 1 })`. The record here is one fixed shape whatever the argument
was, which is also why the `Duration` branch copies its nine fields out rather
than handing the `Duration` through.

The same fixed-unit observation applies inside `Duration#plus` and `minus`:
their unit loop already has canonical names, so normalizing each through `get()`
does not add semantics. `minus` writes the subtraction directly instead of
cloning a negated addend and feeding it back through `plus`.

An exact `DateTime#diff(..., "milliseconds")` needs no calendar walk: both
endpoints are already millisecond timestamps. The direct subtraction preserves
direction and options and also serves `Interval#toDuration("milliseconds")`.

## Four constants

Each was being built inside the function that reads it, and is moved to module
scope: `datetime.js` `normalizeUnit` (24 keys), `duration.js` `normalizeUnit`
(18 keys), `english.js` `formatRelativeTime` (an 8-key table and the nine
arrays inside it), and `systemZone.js` `offset` (one `Date` per lookup, now one
reused — JS is single threaded and `getTimezoneOffset` reads it on the next
line, so the instance cannot be observed in between). None captures anything.

The two unit tables also become null-prototype, which is this patch's one
deliberate behavior change. The per-call literals leaked inherited values past
`normalizeUnit`'s truthiness check for unit names that are `Object.prototype`
keys: `endOf("__proto__")` quietly acted like `startOf`, and
`as("__proto__")` threw a `TypeError` out of the conversion matrix. With the
tables null-prototype, those names miss the lookup and throw `InvalidUnitError`
like any other non-unit.
