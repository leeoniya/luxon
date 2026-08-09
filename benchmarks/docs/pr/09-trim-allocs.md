# I — short-lived objects on the arithmetic path

`src/datetime.js` · `src/duration.js` · `src/impl/diff.js`

| file | function | was |
| --- | --- | --- |
| `datetime.js` | `clone` | `{ ...current, ...alts, old: current }` — a second object merged out of the seven fields being carried over |
| `duration.js` | `as` | `shiftTo(unit).get(unit)`: a whole `Duration` constructed, normalized and cloned again on the way out of `shiftTo`, so one number can be read off it |
| `datetime.js` | `endOf` | `{ [unit]: 1 }` per call. A computed key makes a dictionary-mode object, which `normalizeObject` then walks. There are nine of them and they never change |
| `datetime.js` | `endOf` calendar units | `plus().startOf().minus()`: three `DateTime`s to reach the next year, quarter or month boundary and step back |
| `impl/diff.js` | `diff` | two lower-order `Duration`s plus a final `Duration#plus` and clone, even when there is only one lower-order unit |

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
One thing is copied out of it rather than simplified away — the
trunc-and-remainder split: `shiftTo` takes the integer part of the running total
and carries `(own * 1000 - whole * 1000) / 1000` as the remainder, then adds it
back, which is not the identity in floating point and *is* the number callers
have been getting — `Duration.fromObject({ hours: 40.599848099943756 })` differs
in the last bit between the two. The `|| 0` that the unit getter ends in is
*not* copied, and that is a deliberate divergence: nothing a `Duration` built
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
function. Year, quarter and month take a larger shared shortcut: each sets the
first civil millisecond of its next month boundary directly and keeps the
existing `minus(1)`, removing one `DateTime`. One transition case moves: the
boundary is now placed with the receiver's own offset rather than one read a
month ahead, which changes the answer only in zones that fall back across local
midnight — where the old chain ended a month an hour inside the next one, and
this route ends it on the receiver's side. K widens the same route to day and
week, and its document carries the argument and the scan
([11-boundary-math.md](11-boundary-math.md)). Week is excluded here because its
boundary may be locale-based.

**`diff` has a cheap common case after the calendar walk.** When its unit list
contains one lower-order unit, `Duration#fromMillis(...).as(unit)` answers the
same number as `shiftTo(unit).get(unit)`. It can be written into the higher-order
result before constructing the return value, avoiding the final
`Duration#plus`, its nine-unit walk and its clone. Multiple lower-order units
keep the general path.
