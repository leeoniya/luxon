# D — `parseZoneInfo`: read the name out of `format()`

`src/impl/locale.js` · `src/impl/util.js`
**Requires A**, whose `parseZoneInfo` it anchors on.

Two costs in one expression. `formatToParts()` allocates a part object per field
— the formatter asks for six — and `.find()` then walks them running
`toLowerCase()` per part, to pull out one string. And the formatter it walks is
asking ICU to render a full date and time when the caller wants none of it.

Replaced with a formatter carrying the name and nothing else but an h23 2-digit
hour, read with plain `format()`. That leaves the name at a fixed position in a
fixed-width string, which is B's trick applied to the other Intl call.

**Field layout is measured, not assumed**, the same as in B, but with a stricter
check because a name is variable-width. Three probes have to agree on where the
name sits: two either side of a DST boundary, and one that would render a
one-digit hour if the locale ignored the 2-digit request. Any disagreement, or a
locale whose `format()` output is not simply its parts joined, returns null and
takes the stock path. The name may appear anywhere in the formatted string; only
agreement across the probes is required.
