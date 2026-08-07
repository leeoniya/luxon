import type { MutationSet } from "../lib/mutations.ts";

/**
 * F is six unrelated shortcuts that happen to share a route. Two of them replace
 * a library call with arithmetic — the civil math and the TimeClip it now has to
 * do itself — and those are where the interesting failures are: right in the
 * middle of the range and wrong at its edges, or right for positive timestamps
 * and wrong before 1970. The other four are guards, and a guard is wrong when it
 * admits something it should not.
 */
const set: MutationSet = {
  patch: "06-numeric-path.patch",
  tests: ["test/numeric-path-fixtures.test.ts", "test/numeric-path-patch.test.ts"],
  mutations: [
    // ---- the TimeClip that new Date() used to do ----
    {
      name: "keeps the fraction of a fractional timestamp",
      find: "+  ts = Math.abs(clipped) > MAX_DATE ? NaN : Math.trunc(clipped);",
      replace: "+  ts = Math.abs(clipped) > MAX_DATE ? NaN : clipped;",
    },
    {
      name: "reads fields off a timestamp past the end of time",
      find: "+  ts = Math.abs(clipped) > MAX_DATE ? NaN : Math.trunc(clipped);",
      replace: "+  ts = Math.trunc(clipped);",
    },
    {
      name: "rounds a fractional timestamp instead of truncating it",
      find: "+  ts = Math.abs(clipped) > MAX_DATE ? NaN : Math.trunc(clipped);",
      replace: "+  ts = Math.abs(clipped) > MAX_DATE ? NaN : Math.round(clipped);",
    },

    // ---- civil_from_days ----
    {
      name: "truncates the day count, so it is a day out before 1970",
      find: "+  const days = Math.floor(ts / 86400000);",
      replace: "+  const days = Math.trunc(ts / 86400000);",
    },
    {
      name: "gets the shift onto the era calendar wrong",
      find: "+  const z = days + 719468;",
      replace: "+  const z = days + 719469;",
    },
    {
      name: "truncates the era, so it is wrong before 1600",
      find: "+  const era = Math.floor(z / 146097);",
      replace: "+  const era = Math.trunc(z / 146097);",
    },
    {
      name: "drops the 400-year rule from the year-of-era",
      find: "+    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365",
      replace: "+    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524)) / 365",
    },
    {
      name: "drops the century rule from the year-of-era",
      find: "+    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365",
      replace: "+    (doe - Math.floor(doe / 1460) - Math.floor(doe / 146096)) / 365",
    },
    {
      name: "drops the leap rule from the day-of-year",
      find: "+  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));",
      replace: "+  const doy = doe - (365 * yoe + Math.floor(yoe / 4));",
    },
    {
      name: "gets the month-length series wrong",
      find: "+  const mp = Math.floor((5 * doy + 2) / 153);",
      replace: "+  const mp = Math.floor((5 * doy + 3) / 153);",
    },
    {
      name: "puts the March-based month boundary in the wrong place",
      find: "+  const month = mp < 10 ? mp + 3 : mp - 9;",
      replace: "+  const month = mp < 9 ? mp + 3 : mp - 9;",
    },
    {
      name: "carries the year over at the wrong month",
      find: "+    year: yoe + era * 400 + (month <= 2 ? 1 : 0),",
      replace: "+    year: yoe + era * 400 + (month < 2 ? 1 : 0),",
    },
    {
      name: "counts days from zero rather than one",
      find: "+    day: doy - Math.floor((153 * mp + 2) / 5) + 1,",
      replace: "+    day: doy - Math.floor((153 * mp + 2) / 5),",
    },
    {
      name: "truncates the hour, so it is wrong before 1970",
      find: "+    hour: Math.floor(msOfDay / 3600000),",
      replace: "+    hour: Math.trunc(msOfDay / 3600000),",
      survives:
        "msOfDay is ts minus a floored multiple of a day, so it is a " +
        "non-negative integer smaller than a day for every ts, including " +
        "negative ones. Flooring and truncating agree on all of them.",
    },
    {
      name: "forgets to wrap the minute into the hour",
      find: "+    minute: Math.floor(msOfDay / 60000) % 60,",
      replace: "+    minute: Math.floor(msOfDay / 60000),",
    },
    {
      name: "reads the millisecond as the second",
      find: "+    second: Math.floor(msOfDay / 1000) % 60,",
      replace: "+    second: Math.floor(msOfDay / 1000) % 1000,",
    },

    // ---- the verbatim token flag ----
    {
      name: "treats a token with letters in it as punctuation",
      find: "+      if (!token.literal && !/[A-Za-z]/.test(token.val)) {",
      replace: "+      if (!token.literal) {",
    },
    {
      name: "stops passing punctuation through untouched",
      find: "+    if (token.literal || token.verbatim) {",
      replace: "+    if (token.literal) {",
    },

    // ---- the parseFormat cache ----
    {
      name: "lets the format cache grow without a ceiling",
      find: "+      if (parseFormatCache.size < PARSE_FORMAT_CACHE_MAX) {",
      replace: "+      if (true) {",
      survives:
        "a bound on memory, which no output reveals. Nothing reaches the map " +
        "to count it either, so this can only be read in the diff.",
    },

    // ---- the padStart-direct numeric path ----
    {
      name: "takes the direct path for a locale that does not render latn digits",
      find: "+        this.simpleNumsCached = this.loc.fastNumbers && Object.keys(this.opts).length === 0;",
      replace: "+        this.simpleNumsCached = Object.keys(this.opts).length === 0;",
    },
    {
      name: "takes the direct path for a formatter that carries options",
      find: "+        this.simpleNumsCached = this.loc.fastNumbers && Object.keys(this.opts).length === 0;",
      replace: "+        this.simpleNumsCached = this.loc.fastNumbers;",
      survives:
        "no caller reaches this line with options on the Formatter: a duration " +
        "token carries a signDisplay and toISO's formatter carries forceSimple, " +
        "and both return above. The check is what lets the line below assume an " +
        "empty options object rather than re-deriving it, so it earns its place " +
        "by being the reason the reduction is sound, not by turning anything " +
        "away today.",
    },
    {
      name: "takes the direct path when a sign was asked for",
      survives:
        "redundant with the emptiness check below it, which is the only reason " +
        "this survives: signDisplay is only ever passed by " +
        "formatDurationFromString, and Duration#toFormat always builds its " +
        "Formatter with a floor option, so an empty opts object and a " +
        "signDisplay never co-occur. Kept anyway because it is a precondition " +
        "on this function's own parameter -- padStart cannot render a sign, " +
        "whatever the options happen to hold -- where the reads it replaced " +
        "were assumptions about options this path never receives.",
      find: "+    if (signDisplay === undefined) {",
      replace: "+    if (true) {",
    },

    // ---- padStart's table ----
    {
      name: "builds the two-digit table without its leading zeroes",
      find: '+const PAD_TO_2 = Array.from({ length: 100 }, (_, i) => (i < 10 ? "0" : "") + i);',
      replace: "+const PAD_TO_2 = Array.from({ length: 100 }, (_, i) => \"\" + i);",
    },
    {
      name: "reads the two-digit table for a negative number",
      find: "+  if (n === 2 && Number.isInteger(input) && input >= 0 && input < 100) {",
      replace: "+  if (n === 2 && Number.isInteger(input) && input < 100) {",
      survives:
        "nothing asks padStart for two-wide padding of a negative number. The " +
        "ISO writer emits the sign itself and passes the magnitude; every " +
        "other two-wide call is a calendar field. A guard on an argument that " +
        "does not arrive.",
    },
    {
      name: "reads the two-digit table for a fractional number",
      find: "+  if (n === 2 && Number.isInteger(input) && input >= 0 && input < 100) {",
      replace: "+  if (n === 2 && input >= 0 && input < 100) {",
      survives:
        "a fraction reaches padStart only through PolyNumberFormatter's " +
        "simple branch, and that branch is skipped whenever a signDisplay is " +
        "in the options — which Duration#toFormat always sets. Calendar " +
        "fields are integers.",
    },
    {
      name: "reads the two-digit table however wide the padding asked for",
      find: "+  if (n === 2 && Number.isInteger(input) && input >= 0 && input < 100) {",
      replace: "+  if (Number.isInteger(input) && input >= 0 && input < 100) {",
    },

    // ---- roundTo's identity ----
    {
      name: "treats rounding to a negative number of digits as the identity",
      find: "+  if (digits >= 0 && Number.isInteger(number)) {",
      replace: "+  if (Number.isInteger(number)) {",
      survives:
        "roundTo is called with 0, 2 and 3 and nothing else, so the digits >= " +
        "0 half of the guard never decides anything.",
    },
    {
      name: "treats rounding a fractional number as the identity",
      find: "+  if (digits >= 0 && Number.isInteger(number)) {",
      replace: "+  if (digits >= 0) {",
    },
  ],
};

export default set;
