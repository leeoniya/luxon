import type { MutationSet } from "../lib/mutations.ts";

const nl = (...parts: string[]) => parts.join("\n");

/**
 * E hands the same Locale back to two callers who asked for the same thing, and
 * then hangs three memos off it. So the failures are aliasing — two callers who
 * did not ask for the same thing sharing an object — and staleness, where the
 * settings that decided what a Locale is have moved and the object has not.
 */
const set: MutationSet = {
  patch: "05-locale-intern.patch",
  tests: ["test/locale-intern-fixtures.test.ts", "test/locale-intern-patch.test.ts"],
  mutations: [
    // ---- who is allowed to share ----
    {
      name: "interns locales that carry a numbering system",
      find: '+      numberingSystem || weekSettings || (outputCalendar && outputCalendar !== "gregory")',
      replace: '+      weekSettings || (outputCalendar && outputCalendar !== "gregory")',
    },
    {
      name: "interns locales that carry week settings",
      find: '+      numberingSystem || weekSettings || (outputCalendar && outputCalendar !== "gregory")',
      replace: '+      numberingSystem || (outputCalendar && outputCalendar !== "gregory")',
    },
    {
      name: "interns every output calendar, not just gregory",
      find: '+      numberingSystem || weekSettings || (outputCalendar && outputCalendar !== "gregory")',
      replace: "+      numberingSystem || weekSettings",
    },
    {
      name: "keeps gregory and no-calendar locales in one map",
      find: nl("+        : outputCalendar", "+          ? gregoryLocaleCache", "+          : localeCache;"),
      replace: nl("+        : outputCalendar", "+          ? localeCache", "+          : localeCache;"),
    },
    {
      name: "lets a defaultToEN locale share with one that is not",
      find: '+    const cacheKey = cache === null ? null : defaultToEN ? "!" + (locale || "") : locale || "";',
      replace: "+    const cacheKey = cache === null ? null : locale || \"\";",
    },
    {
      name: "lets the intern grow without a ceiling",
      find: "+    if (cache !== null && cache.size < LOCALE_CACHE_MAX) {",
      replace: "+    if (cache !== null) {",
    },

    // ---- staleness ----
    {
      name: "misses a change of default locale",
      find: "+    localeGenSnapshot[0] !== Settings.defaultLocale ||\n",
      replace: "",
    },
    {
      name: "misses a change of default numbering system",
      find: "+    localeGenSnapshot[1] !== Settings.defaultNumberingSystem ||\n",
      replace: "",
    },
    {
      name: "misses a change of default output calendar",
      find: "+    localeGenSnapshot[2] !== Settings.defaultOutputCalendar ||\n",
      replace: "",
    },
    {
      name: "misses a change of default week settings",
      find: "+    localeGenSnapshot[3] !== Settings.defaultWeekSettings",
      replace: "+    false",
    },
    // the two blocks below are byte-identical, so both carry the context line
    // above them to say which one is meant
    {
      name: "keeps its interned locales across a cache reset",
      find: nl(
        "     sysLocaleCache = null;",
        "+    localeCache.clear();",
        "+    gregoryLocaleCache.clear();",
        "+    localeGen++;"
      ),
      replace: "     sysLocaleCache = null;",
    },
    {
      name: "empties the intern on reset but leaves the memos hanging off it",
      find: nl(
        "     sysLocaleCache = null;",
        "+    localeCache.clear();",
        "+    gregoryLocaleCache.clear();",
        "+    localeGen++;"
      ),
      replace: nl("     sysLocaleCache = null;", "+    localeCache.clear();", "+    gregoryLocaleCache.clear();"),
    },

    // ---- the redefaultToEN memo ----
    {
      name: "serves the no-alts memo to a caller that passed alts",
      find: "+    if (Object.getOwnPropertyNames(alts).length === 0) {",
      replace: "+    if (true) {",
    },
    {
      name: "never rebuilds the redefaulted locale",
      find: "+      if (this.redefaultedToENGen !== gen) {",
      replace: "+      if (this.redefaultedToEN === undefined) {",
    },

    // ---- the toHuman memos ----
    {
      name: "serves the memoized formatters to a caller that passed options",
      find: "+    const memo = Object.keys(opts).length === 0 ? this.loc.humanFormatters() : null;",
      replace: "+    const memo = this.loc.humanFormatters();",
    },
    {
      name: "never rebuilds the memoized formatters",
      find: "+    if (this.humanGen !== gen) {",
      replace: "+    if (this.humanNum === undefined) {",
    },
    {
      name: "keys the number formatter memo on nothing",
      find: nl("+    let nf = this.humanNum.get(unit);", ""),
      replace: nl('+    let nf = this.humanNum.get("k");', ""),
    },
    {
      name: "stores every unit's number formatter under one key",
      find: "+      this.humanNum.set(unit, nf);",
      replace: '+      this.humanNum.set("k", nf);',
    },
    {
      name: "asks for the plural unit the caller named",
      find: '+      nf = this.numberFormatter({ style: "unit", unitDisplay: "long", unit: unit.slice(0, -1) });',
      replace: '+      nf = this.numberFormatter({ style: "unit", unitDisplay: "long", unit });',
    },
    {
      name: "joins the parts with a different list style",
      find: '+      this.humanList = this.listFormatter({ type: "conjunction", style: "narrow" });',
      replace: '+      this.humanList = this.listFormatter({ type: "conjunction", style: "long" });',
    },
  ],
};

export default set;
