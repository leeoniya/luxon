# H — reach the number directly, on the arithmetic path

`src/datetime.js` · `src/duration.js` · `src/impl/diff.js` · `src/impl/english.js` · `src/zones/systemZone.js`

Eight changes on the route every `plus`, `minus`, `startOf`, `endOf`, `set`,
`hasSame`, `diff` and `Interval` method takes. Nothing here formats or parses.

Three whole objects are built, converted and dropped to reach a number plain
arithmetic already has:

| file | function | was | is |
| --- | --- | --- | --- |
| `datetime.js` | `adjustTime` | `millisToAdd` = `Duration.fromObject({ …nine keys }).as("milliseconds")` | an integer sum |
| `diff.js` | `dayDiff` | four `DateTime`s and a `Duration`, for one subtraction. `utcDayStart(dt)` asked for the UTC midnight of `dt`'s civil date by moving `dt` to UTC keeping local time and then taking `startOf("day")` — two clones, each of which reconstructs | `dt.c` is that civil date already, so `objToLocalTS` on it directly, and one division |
| `datetime.js` | `plus` / `minus` | a `Duration` built per call for `adjustTime` to read nine getters off and drop; `minus` built a second, because `negate()` clones | `durationValues` produces those nine numbers directly |

## Where the first two could go wrong

`as()` is not the plain sum it looks like, so neither replacement is
unconditional. All three notes below are also comments in the diff.

**Whole values.** In `adjustTime` the five calendar fields contribute only their
fractional parts, so when all nine fields are integers those terms are exactly
zero and `shiftTo`'s accumulator reduces to the same left-to-right sum. Its
trunc-and-remainder split then round-trips exactly, which it does not do in
general. Anything fractional still takes the old path.

**Range.** When the sum leaves the finite range `shiftTo`'s remainder goes `NaN`,
and the milliseconds getter's `|| 0` turns that into zero — so
`plus({ seconds: 1e308 })` adds nothing rather than going invalid. That looks
like a bug and correcting it is a separate argument, so the guard preserves it.
Finding this took 1,200 parity failures.

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
re-resolving cannot reach `fixOffset`'s hole branch either. The sweep compares
`wasHole` alongside the instant, and separately over receivers constructed into
holes in four zones including Lord Howe's half-hour DST.

A mutation returning the receiver's offset from that early return survives every
test, which is not a gap: `clone()` always passes `old`, and the constructor
ignores the offset it is handed whenever `old` is present and reads
`zone.offset(ts)` itself. `adjustTime`'s offset is dead on every path that
reaches it, and is left correct because that is the function's contract rather
than its caller's current shape.

## The argument change

`durationValues` is what `Duration.fromObject` does to an object, minus the
object it returns. Every input `fromObject` rejects is still rejected, with the
same error and the same message. Two places it could quietly diverge, both
commented in the diff: `normalizeObject` writes
`normalized[normalizer(u)] = asNumber(v)` and a member expression is evaluated
before the value assigned to it, so an object with both a bad unit and a bad
value reports the *unit* — writing the two calls in reading order would report
the value. And `negate()` guards its zeros, because `-0` is falsy and the getters
`minus` read through turned a negated zero back into zero.

The other half is shape rather than allocation: `normalizeObject`'s result has
computed keys and a layout that depends on which units the caller named, so
`adjustTime`'s nine reads saw a different object for `plus({ days: 1 })` than for
`plus({ hours: 1 })`. The record here is one fixed shape whatever the argument
was, which is also why the `Duration` branch copies its nine fields out rather
than handing the `Duration` through.

## Four constants

Each was being built inside the function that reads it, and is moved to module
scope unchanged: `datetime.js` `normalizeUnit` (24 keys), `duration.js`
`normalizeUnit` (18 keys), `english.js` `formatRelativeTime` (an 8-key table and
the nine arrays inside it), and `systemZone.js` `offset` (one `Date` per lookup,
now one reused — JS is single threaded and `getTimezoneOffset` reads it on the
next line, so the instance cannot be observed in between). None captures
anything, so each is a move rather than a rewrite. They are here rather than in a
patch of their own because this is the path that reads them.

## Verification

`durationValues` is checked against the `Duration.fromObject` it inlines, which is
still in the tree, so the argument fixtures assert agreement rather than a table
of expected values: singular against plural spellings and both in one object,
inherited against own properties, non-enumerable and symbol keys, getters, the
values `asNumber` coerces against the ones it rejects, a bad unit beside a bad
value, and each of the nine units through a `Duration` argument, since that
branch copies field by field and a unit left behind would show up nowhere else.
The fast path is checked for the instant *and* `wasHole`, including over
receivers constructed into holes in zones with half-hour DST. The hoisted tables
are checked through the strings they render and the shared `Date` through a
zone-change under a mocked clock.

One warning for anyone repeating the mutation runs: `Interval#splitBy` loops
until `plus` carries its cursor past the end and guards only the `Duration` it
was handed, so a mutation that stops `plus` advancing does not fail — it appends
until the machine is out of memory. Cap wall time and heap per run.
