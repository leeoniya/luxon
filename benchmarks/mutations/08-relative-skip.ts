import type { MutationSet } from "../lib/mutations.ts";

/**
 * H combines lower bounds for elapsed relative time with scalar civil counts
 * for equal-zone relative-calendar calls. The first group exercises the
 * built-in/equal-zone guard and each formula. The rest raise floors to values a
 * naive reading of tzdata might suggest -- the seven-day week, the ninety-day
 * quarter, the twenty-two-hour day -- and verify the padding shortcut.
 */
const set: MutationSet = {
  patch: "08-relative-skip.patch",
  tests: ["test/relative-skip-fixtures.test.ts"],
  mutations: [
    // ---- equal-zone calendary scalars ----
    {
      name: "lets custom zone semantics into the civil shortcut",
      find: '+          (zoneType === "iana" || zoneType === "fixed" || zoneType === "system") &&',
      replace: "+          true &&",
    },
    {
      name: "takes the civil shortcut across differing zones",
      find: "+          start.zone.equals(end.zone)",
      replace: "+          !start.zone.equals(end.zone)",
    },
    {
      name: "counts one extra civil year",
      find: "+              return ec.year - sc.year;",
      replace: "+              return ec.year - sc.year + 1;",
    },
    {
      name: "forgets whole years in the civil month count",
      find: "+              return (ec.year - sc.year) * 12 + ec.month - sc.month;",
      replace: "+              return ec.month - sc.month;",
    },
    {
      name: "subtracts civil days in the wrong direction",
      find:
        "+                daysFromCivil(ec.year, ec.month, ec.day) -\n" +
        "+                daysFromCivil(sc.year, sc.month, sc.day)",
      replace:
        "+                daysFromCivil(sc.year, sc.month, sc.day) -\n" +
        "+                daysFromCivil(ec.year, ec.month, ec.day)",
    },

    // ---- floors raised to what tzdata looks like from a distance ----
    {
      name: "assumes a week is never shorter than seven days",
      find: "+  weeks: 7 * 86400000 - 26 * 3600000,",
      replace: "+  weeks: 7 * 86400000,",
    },
    {
      name: "assumes a week only ever loses an hour to a spring forward",
      find: "+  weeks: 7 * 86400000 - 26 * 3600000,",
      replace: "+  weeks: 6.9 * 86400000,",
    },
    {
      name: "assumes a quarter is never shorter than ninety days",
      find: "+  quarters: 89 * 86400000 - 26 * 3600000,",
      replace: "+  quarters: 90 * 86400000,",
    },
    {
      name: "counts a quarter from the longest February rather than the shortest",
      find: "+  quarters: 89 * 86400000 - 26 * 3600000,",
      replace: "+  quarters: 90 * 86400000 - 26 * 3600000,",
    },
    {
      name: "assumes a month is never shorter than February",
      find: "+  months: 28 * 86400000 - 26 * 3600000,",
      replace: "+  months: 28 * 86400000,",
    },
    {
      name: "assumes a year is never shorter than 365 days",
      find: "+  years: 365 * 86400000 - 26 * 3600000,",
      replace: "+  years: 365 * 86400000,",
    },
    {
      name: "gives a day a floor, as if a local day were always near 24 hours",
      find: "+  weeks: 7 * 86400000 - 26 * 3600000,",
      replace: "+  weeks: 7 * 86400000 - 26 * 3600000,\n+  days: 22 * 3600000,",
    },
    // ---- the three exact ones, where the floor is the answer ----
    {
      name: "puts the hours floor an hour late",
      find: "+  hours: 3600000,",
      replace: "+  hours: 2 * 3600000,",
    },
    {
      name: "puts the minutes floor a minute late",
      find: "+  minutes: 60000,",
      replace: "+  minutes: 120000,",
    },
    {
      name: "puts the seconds floor half a second late",
      find: "+  seconds: 1000,",
      replace: "+  seconds: 1500,",
    },
    // ---- the comparison ----
    {
      name: "skips a span that exactly reaches its floor",
      find: "+    if (spread >= 0 && spread < relativeFloor[unit]) continue;",
      replace: "+    if (spread >= 0 && spread <= relativeFloor[unit]) continue;",
    },
    {
      name: "gives up on the remaining units instead of skipping one",
      find: "+    if (spread >= 0 && spread < relativeFloor[unit]) continue;",
      replace: "+    if (spread >= 0 && spread < relativeFloor[unit]) break;",
    },
    {
      name: "measures the span in one direction only",
      find: "+  const spread = opts.calendary ? -1 : Math.abs(end.ts - start.ts);",
      replace: "+  const spread = opts.calendary ? -1 : end.ts - start.ts;",
    },
    {
      name: "lets the skip loose on the calendary path",
      find: "+  const spread = opts.calendary ? -1 : Math.abs(end.ts - start.ts);",
      replace: "+  const spread = Math.abs(end.ts - start.ts);",
    },
    {
      name: "forgets that -1 was meant to mean no",
      find: "+    if (spread >= 0 && spread < relativeFloor[unit]) continue;",
      replace: "+    if (spread < relativeFloor[unit]) continue;",
    },
    // ---- the padding shortcut ----
    {
      name: "drops the padding it was asked to apply",
      find: "+    return diffRelative(base, padding === 0 ? this : this.plus(padding), {",
      replace: "+    return diffRelative(base, padding !== 0 ? this : this.plus(padding), {",
    },
    {
      name: "keeps the shortcut whichever way the padding points",
      find: "+    return diffRelative(base, padding === 0 ? this : this.plus(padding), {",
      replace: "+    return diffRelative(base, padding >= 0 ? this : this.plus(padding), {",
    },
  ],
};

export default set;
