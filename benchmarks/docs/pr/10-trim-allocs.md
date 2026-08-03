# J — three objects that exist only to be read once

`src/datetime.js` · `src/duration.js`

| file | function | was |
| --- | --- | --- |
| `datetime.js` | `clone` | `{ ...current, ...alts, old: current }` — a second object merged out of the seven fields being carried over |
| `duration.js` | `as` | `shiftTo(unit).get(unit)`: a whole `Duration` constructed, normalized and cloned again on the way out of `shiftTo`, so one number can be read off it |
| `datetime.js` | `endOf` | `{ [unit]: 1 }` per call. A computed key makes a dictionary-mode object, which `normalizeObject` then walks. There are nine of them and they never change |

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
Two things are copied out of it rather than simplified away. The
trunc-and-remainder split: `shiftTo` takes the integer part of the running total
and carries `(own * 1000 - whole * 1000) / 1000` as the remainder, then adds it
back, which is not the identity in floating point and *is* the number callers
have been getting — `Duration.fromObject({ hours: 40.599848099943756 })` differs
in the last bit between the two. And the `|| 0` that the unit getter ends in, so
that this answers what `get()` answers; nothing a valid `Duration` can hold
reaches it, since `asNumber` refuses everything but a finite number.

**One quirk found rather than reasoned about, and left intact.** `as("__proto__")`
does not throw `InvalidUnitError`. `Duration.normalizeUnit` looks its argument up
in an object literal, where `"__proto__"` finds `Object.prototype` and
`"constructor"` finds a function, both truthy enough to pass the check meant to
reject them; `shiftTo` then indexes the conversion matrix with it and throws a
`TypeError` instead. The sum here has no such fixed point, so anything
`normalizeUnit` answers that is not one of the nine ordered units falls back to
`shiftTo` and throws the same way. Correcting `normalizeUnit` is the better fix
and a different patch.

`endOf`'s memo needs a `Map` and not an object for the same reason from the other
direction: the key is whatever string the caller passed, and `oneOf["__proto__"]`
on a plain object finds `Object.prototype`, which is truthy and would be handed to
`plus()` in place of the `{ __proto__: 1 }` that was asked for, changing the
answer.

The fixtures check `as` against the `shiftTo(unit).get(unit)` it replaced, which
is still in the tree as its fallback, and `endOf` against the
`plus({ [unit]: 1 }).startOf(unit).minus(1)` it replaced, with `Object.is` so that
a negative zero has to agree too. `clone` has no expression left to compare
against and is checked through the methods that call it, including a count of
what the zone is asked — dropping `old` changes no answer and only costs the
constructor the calendar and offset it was handed.
