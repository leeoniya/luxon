# A — `parseZoneInfo`: use the DTF cache luxon already has

`src/impl/locale.js` · `src/impl/util.js`

`parseZoneInfo` constructs an `Intl.DateTimeFormat` per call. It depends only on
`(locale, offsetFormat, timeZone)`, which is exactly what `getCachedDTF` keys on
and what `Locale.resetCache()` already clears, so it can use that instead.
