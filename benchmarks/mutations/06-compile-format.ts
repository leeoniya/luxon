import type { MutationSet } from "../lib/mutations.ts";

/**
 * F is a compiled program plus a handful of unrelated shortcuts sharing its
 * route. Two of the shortcuts replace a library call with arithmetic — the
 * timestamp split and the TimeClip it now has to do itself — and those are where
 * the interesting failures are: wrong at the range edges or right for positive
 * timestamps and wrong before 1970. B owns mutations for the shared civil
 * conversion itself. The rest are guards, and a guard is wrong when it admits
 * something it should not.
 *
 * The compiled half is a table and a memo. The table is checked by luxon's own
 * format tests — miswiring a token is what those already catch — so its
 * mutations are about the parts with no such coverage: what a memo slot is
 * keyed on, whether the calendar those names come out of is the one the key is
 * in, and the seam where the literal runs and the handler runs are put back
 * together.
 */
const set: MutationSet = {
  patch: "06-compile-format.patch",
  tests: [
    "test/numeric-path-fixtures.test.ts",
    "test/compile-format-fixtures.test.ts",
    "test/numeric-path-patch.test.ts",
  ],
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

    // ---- timestamp split and time fields around civil_from_days ----
    {
      name: "truncates the day count, so it is a day out before 1970",
      find: "+  const days = Math.floor(ts / 86400000);",
      replace: "+  const days = Math.trunc(ts / 86400000);",
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
      find: "+    if (signDisplay == null) {",
      replace: "+    if (true) {",
    },

    // ---- padStart's table ----
    {
      name: "builds the two-digit table without its leading zeroes",
      find: '+const PAD_TO_2 = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"));',
      replace: "+const PAD_TO_2 = Array.from({ length: 100 }, (_, i) => String(i));",
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

    // ---- what a memo slot is keyed on ----
    {
      name: "memoizes names against the token rather than the locale",
      find: "+  let per = cfNames.get(f.loc);",
      replace: "+  let per = cfNames.get(cfHandlers);",
    },
    {
      name: "gives the two month contexts one set of slots",
      find: '+  const key = (standalone ? "L" : "M") + length;',
      replace: '+  const key = "M" + length;',
    },
    {
      name: "gives the two weekday contexts one set of slots",
      find: '+  const key = (standalone ? "c" : "E") + length;',
      replace: '+  const key = "E" + length;',
    },
    {
      name: "gives every month width one set of slots",
      find: '+  const key = (standalone ? "L" : "M") + length;',
      replace: '+  const key = standalone ? "L" : "M";',
    },
    {
      name: "gives every weekday width one set of slots",
      find: '+  const key = (standalone ? "c" : "E") + length;',
      replace: '+  const key = standalone ? "c" : "E";',
    },
    {
      name: "gives every era width one set of slots",
      find: '+  const key = "G" + length;',
      replace: '+  const key = "G";',
    },
    // ---- and which slot it lands in ----
    {
      name: "counts months from one where the slots count from zero",
      find: '+        ? cfMemo(f, dt, opts, "month", key, 12, dt.month - 1)',
      replace: '+        ? cfMemo(f, dt, opts, "month", key, 12, dt.month)',
      survives:
        "a slot index only has to be different for every different answer, and " +
        "both are. The array is preallocated at 12 rather than bounded at it, so " +
        "writing to slot 12 lengthens it and costs one slot. Same for the weekday " +
        "index below.",
    },
    {
      name: "counts weekdays from one where the slots count from zero",
      find: '+    en ? English.weekdayForDateTime(dt, length) : cfMemo(f, dt, opts, "weekday", key, 7, dt.weekday - 1);',
      replace:
        '+    en ? English.weekdayForDateTime(dt, length) : cfMemo(f, dt, opts, "weekday", key, 7, dt.weekday);',
      survives: "as above: still one slot per weekday, one slot wider.",
    },
    {
      // year 0 is the proleptic one and renders as 1 BC, so filing it under AD
      // hands it whatever an AD year put there. Invisible until E interns
      // locales and two DateTimes share a memo, which is why the fixture runs
      // under every patch as well.
      name: "files the proleptic year 0 under AD",
      find: '+        ? cfMemo(f, dt, opts, "era", key, 2, dt.year <= 0 ? 0 : 1)',
      replace: '+        ? cfMemo(f, dt, opts, "era", key, 2, dt.year < 0 ? 0 : 1)',
    },
    {
      name: "keys the day period on whether it is the afternoon",
      find: '+    en ? English.meridiemForDateTime(dt) : cfMemo(f, dt, CF_DAYPERIOD, "dayperiod", "a", 24, dt.hour),',
      replace:
        '+    en ? English.meridiemForDateTime(dt) : cfMemo(f, dt, CF_DAYPERIOD, "dayperiod", "a", 2, dt.hour < 12 ? 0 : 1),',
      survives:
        "no locale in this ICU has more than two day periods under these options " +
        "-- checked across zh-CN, ja, ko, vi, th, hi, my and km, all of which " +
        "answer with exactly two -- so nothing can currently tell the two " +
        "keyings apart. That is the reason for keying on the hour rather than the " +
        "reason against it: two slots would bake in an assumption that CLDR " +
        "happens to satisfy today, and Locale#meridiems' own comment calls that " +
        'assumption "probably wrong". The cost of not making it is 22 array slots.',
    },
    {
      name: "asks for one field and stores the answer under another",
      find: '+        ? cfMemo(f, dt, opts, "month", key, 12, dt.month - 1)',
      replace: '+        ? cfMemo(f, dt, opts, "year", key, 12, dt.month - 1)',
    },
    // ---- the calendar the names come out of ----
    {
      name: "assumes every locale renders a gregorian month",
      find: "+function cfGregorian(loc) {",
      replace: "+function cfGregorian(loc) {\n+  return true;",
    },
    {
      name: "asks loc.outputCalendar instead of the calendar Intl resolved",
      find: '+  return getCachedIntResolvedOptions(loc.intl).calendar === "gregory";',
      replace: '+  return !loc.outputCalendar || loc.outputCalendar === "gregory";',
    },
    {
      name: "skips the calendar check for eras",
      find: '+      : cfGregorian(f.loc)\n+        ? cfMemo(f, dt, opts, "era", key, 2, dt.year <= 0 ? 0 : 1)\n+        : cfExtract(f, dt, opts, "era");',
      replace: '+      : cfMemo(f, dt, opts, "era", key, 2, dt.year <= 0 ? 0 : 1);',
    },
    // ---- the compiled program ----
    {
      name: "drops the literal run that precedes a handler",
      find: '+      lits.push(lit);\n+      lit = "";\n+      fns.push(handler);',
      replace: '+      lits.push("");\n+      lit = "";\n+      fns.push(handler);',
    },
    {
      name: "drops the literal run that follows the last handler",
      find: "+  lits.push(lit);\n+\n+  return { lits, fns };",
      replace: '+  lits.push("");\n+\n+  return { lits, fns };',
    },
    {
      name: "swallows an unrecognized token rather than passing it through",
      find: "+    lit += token.val;\n+  }\n+\n+  lits.push(lit);",
      replace: "+  }\n+\n+  lits.push(lit);",
    },
    {
      name: "starts the output after the first literal run",
      find: "+  let s = lits[0];\n+\n+  for (let i = 0; i < fns.length; i++) {",
      replace: '+  let s = "";\n+\n+  for (let i = 0; i < fns.length; i++) {',
    },
    {
      name: "reads the literal runs one behind the handlers",
      find: "+    s += fns[i](f, dt, en, useDTF) + lits[i + 1];",
      replace: "+    s += fns[i](f, dt, en, useDTF) + lits[i];",
    },
    {
      name: "leaves a macro token where it was found",
      find: "+      fns.push((f, dt) => f.formatWithSystemDefault(dt, macroOpts));",
      replace: "+      fns.push(() => macroOpts);",
    },
    // ---- the Duration program ----
    {
      name: "maps Duration seconds to minutes",
      find: '+  s: "seconds",',
      replace: '+  s: "minutes",',
    },
    {
      name: "forgets each Duration token's width",
      find: "+      widths.push(token.val.length);",
      replace: "+      widths.push(1);",
    },
    {
      name: "drops Duration literal runs",
      find: "+    if (field == null) {\n+      lit += token.val;\n     } else {",
      replace: "+    if (field == null) {\n     } else {",
    },
    {
      name: "leaves secondary negative Duration fields negative",
      find: '+    const secondaryNegative = signMode === "negativeLargestOnly" && negative && field !== largest;',
      replace: "+    const secondaryNegative = false;",
    },
    {
      name: "compiles the Duration pattern again on every call",
      find: "+  let program = cfDurationPrograms.get(fmt);",
      replace: "+  let program = undefined;",
    },
    {
      name: "lets the Duration program cache grow without a ceiling",
      find: "+    if (cfDurationPrograms.size < CF_CACHE_MAX) {\n+      cfDurationPrograms.set(fmt, program);\n+    }",
      replace: "+    cfDurationPrograms.set(fmt, program);",
    },
    // ---- the program cache ----
    {
      name: "lets the program cache grow without a ceiling",
      find: "+    if (cfPrograms.size < CF_CACHE_MAX) {\n+      cfPrograms.set(fmt, program);\n+    }",
      replace: "+    cfPrograms.set(fmt, program);",
    },
    {
      name: "compiles the pattern again on every call",
      find: "+  let program = cfPrograms.get(fmt);",
      replace: "+  let program = undefined;",
    },
    {
      name: "keys the compiled program on something other than the pattern",
      find: "+      cfPrograms.set(fmt, program);",
      replace: '+      cfPrograms.set("", program);',
    },
    // ---- what a program is allowed to close over ----
    {
      name: "decides English once for the pattern rather than once per run",
      find: '+  const en = f.loc.listingMode() === "en";',
      replace: "+  const en = false;",
    },
    {
      name: "forgets that a non-gregorian output calendar routes through extract",
      find: '+  const useDTF = f.loc.outputCalendar && f.loc.outputCalendar !== "gregory";',
      replace: "+  const useDTF = false;",
    },
  ],
};

export default set;
