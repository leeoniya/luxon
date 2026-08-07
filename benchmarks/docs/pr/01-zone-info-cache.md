# A — `parseZoneInfo`: reuse its DTF and scan `format()` for the name

`src/impl/locale.js` · `src/impl/util.js`

`parseZoneInfo` constructs an `Intl.DateTimeFormat` per call. It depends only on
`(locale, offsetFormat, timeZone)`, which is exactly what `getCachedDTF` keys on
and what `Locale.resetCache()` already clears, so it can use that instead.

The same call then pays two more costs: `formatToParts()` allocates a part object
per field — the formatter asks for six — and `.find()` walks them while running
`toLowerCase()` per part to pull out one string. The cached formatter is instead
given only the name plus an h23 2-digit hour, and the name is read from plain
`format()`. That is B's scanner technique applied to the other Intl lookup.

**Field layout is measured, not assumed**, with a stricter check than B because
a name is variable-width. Three probes must agree on where the name sits: two
either side of a DST boundary, and one that would render a one-digit hour if the
locale ignored the 2-digit request. Any disagreement, or a locale whose
`format()` output is not simply its parts joined, returns null and takes the
cached `formatToParts()` fallback. The name may sit anywhere in the formatted
string; only agreement across the probes is required.
