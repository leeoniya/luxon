import type { MutationSet } from "../lib/mutations.ts";

/**
 * I is a table of lower bounds and one guard. A bound that is too low buys less
 * and is never wrong; a bound that is too high skips a unit whose answer was
 * one, and the caller is told days when the answer was a week. So most of these
 * raise a floor, and each is the floor a naive reading of tzdata would have
 * produced -- the seven-day week, the ninety-day quarter, the twenty-two-hour
 * day. One of them is not hypothetical: the weeks floor really was 6.9 days.
 */
const set: MutationSet = {
  patch: "09-relative-skip.patch",
  tests: ["test/relative-skip-fixtures.test.ts"],
  mutations: [
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
