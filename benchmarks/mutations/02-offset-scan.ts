import type { MutationSet } from "../lib/mutations.ts";

/**
 * B decodes six numbers out of a formatted string and turns them into an offset
 * with integer arithmetic. Three things can go wrong: the civil-days algorithm,
 * the digit scan that feeds it, and the guards that keep it answering NaN
 * wherever stock luxon did.
 */
const set: MutationSet = {
  patch: "02-offset-scan.patch",
  // The fixtures catch all fifteen in eight seconds; the sweep behind them
  // catches fourteen in two minutes, missing the field-order guard no ICU
  // triggers.
  tests: ["test/offset-scan-fixtures.test.ts", "test/offset-patches.test.ts"],
  mutations: [
    // ---- days_from_civil ----
    {
      name: "shifts the era boundary by a month",
      find: "+  y -= m <= 2 ? 1 : 0;",
      replace: "+  y -= m < 2 ? 1 : 0;",
    },
    {
      name: "truncates the era instead of flooring it, breaking negative years",
      find: "+  const era = Math.floor(y / 400);",
      replace: "+  const era = (y / 400) | 0;",
    },
    {
      name: "drops the century rule from the leap-day count",
      find: "+  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy + d - 1;",
      replace: "+  const doe = yoe * 365 + Math.floor(yoe / 4) + doy + d - 1;",
    },
    {
      name: "gets the epoch shift wrong",
      find: "+  return era * 146097 + doe - 719468;",
      replace: "+  return era * 146097 + doe - 719469;",
    },

    // ---- the digit scan ----
    {
      name: "accepts any field layout the zone comes back with",
      find: '+  if (layout.join() !== "month,day,year,hour,minute,second") return null;',
      replace: "+  if (false) return null;",
    },
    {
      name: "counts the era as a field",
      find: '+    if (part.type !== "era" && typeToPos[part.type] != null) layout.push(part.type);',
      replace: "+    if (typeToPos[part.type] != null) layout.push(part.type);",
    },
    {
      name: "stops noticing BC dates",
      find: "+        if (c === 66) bc = true;",
      replace: "",
    },
    {
      name: "reads a BC year without the proleptic shift",
      find: "+    if (bc) year = 1 - year;",
      replace: "+    if (bc) year = -year;",
    },
    {
      name: "leaves hour 24 as it found it",
      find: "+    if (hour === 24) hour = 0;",
      replace: "",
    },
    {
      name: "answers even when it did not read six fields",
      find: "+    if (run !== 6) return NaN;",
      replace: "",
    },

    // ---- range and sub-second handling ----
    {
      name: "answers for a timestamp outside the Date range",
      find: "+      if (Number.isNaN(t) || Math.abs(t) > 8.64e15) return NaN;",
      replace: "",
    },
    {
      name: "floors sub-second remainders towards zero, not down",
      find: "+    return (asUTC - Math.floor(t / 1000) * 1000) / 60000;",
      replace: "+    return (asUTC - Math.trunc(t / 1000) * 1000) / 60000;",
    },
    {
      name: "takes the fractional part of the timestamp with it",
      find: "+      const t = Math.trunc(ts);",
      replace: "+      const t = ts;",
    },

    // ---- the scanner cache ----
    {
      name: "keeps its scanners across a cache reset",
      find: "+    scanCache.clear();",
      replace: "",
    },
  ],
};

export default set;
