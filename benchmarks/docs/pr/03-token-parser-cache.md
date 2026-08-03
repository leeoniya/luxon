# C — `fromFormat`: reuse the parser it builds

`src/impl/tokenParser.js` · `src/settings.js`

`explainFromTokens` constructs a `TokenParser` per call — tokenize the format,
expand macros, build a unit per token, concatenate the units' sources, compile a
`RegExp` — matches one string against it, and drops it. Memoized per format
instead.

Reuse is not a property this claims: `DateTime.buildFormatParser` hands a
`TokenParser` out and `fromFormatParser` takes one back, an API whose only
purpose is to let a caller hoist exactly this out of a loop. This does it for the
callers who did not, which is `fromFormat` and everything routed through it.

**Cache key.** The format string plus `locale`, `numberingSystem` and
`outputCalendar`. Those three are what `Locale#equals` compares, and they are
also the whole of what a parser reads from a `Locale`: text tokens resolve
through `loc.eras`, `loc.months`, `loc.weekdays` and `loc.meridiems`, each a
function of those three and nothing else. `weekSettings` never reaches this file.
The composite is `JSON.stringify`d, which is the shape luxon's DTF, number,
relative and resolved-options caches already use, and is unambiguous in a way a
joined string would not be — a format string may contain any character.

Cleared from `Settings.resetCaches()`, beside the `resetDigitRegexCache()` call
already there. `Locale.resetCache()` would arguably read better, since what a
stale parser holds is locale-derived text, but `Settings.resetCaches()` calls it
anyway and this cache lives in `impl/` like the other one there.
