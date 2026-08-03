import type { MutationSet } from "../lib/mutations.ts";

/**
 * K is a table and a memo. The table is checked by luxon's own format tests --
 * it is the same sixty cases the interpreter had, and miswiring one is what
 * those already catch -- so the mutations here are about the parts that have no
 * counterpart in the interpreter: what a memo slot is keyed on, whether the
 * calendar those names come out of is the one the key is in, and the seam where
 * the literal runs and the handler runs are put back together.
 */
const set: MutationSet = {
  patch: "11-compile-format.patch",
  tests: ["test/compile-format-fixtures.test.ts"],
  mutations: [
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
      replace: '+    en ? English.weekdayForDateTime(dt, length) : cfMemo(f, dt, opts, "weekday", key, 7, dt.weekday);',
      survives: "as above: still one slot per weekday, one slot wider.",
    },
    {
      // this was the patch as written, and it was wrong: year 0 is the proleptic
      // one and renders as 1 BC, so filing it under AD hands it whatever an AD
      // year put there. Invisible until F interns locales and two DateTimes
      // share a memo, which is why the fixture runs under every patch as well.
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
      find: '+    cfCalendars.set(loc, (ok = new Intl.DateTimeFormat(loc.intl).resolvedOptions().calendar === "gregory"));',
      replace: '+    cfCalendars.set(loc, (ok = !loc.outputCalendar || loc.outputCalendar === "gregory"));',
    },
    {
      name: "skips the calendar check for eras",
      find: '+      : cfGregorian(f.loc)\n+        ? cfMemo(f, dt, opts, "era", key, 2, dt.year <= 0 ? 0 : 1)\n+        : cfExtract(f, dt, opts, "era");',
      replace: '+      : cfMemo(f, dt, opts, "era", key, 2, dt.year <= 0 ? 0 : 1);',
    },
    // ---- the compiled program ----
    {
      name: "drops the literal run that precedes a handler",
      find: "+      lits.push(lit);\n+      lit = \"\";\n+      fns.push(handler);",
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
      find: "+  let s = lits[0];",
      replace: '+  let s = "";',
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
