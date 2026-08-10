import type { MutationSet } from "../lib/mutations.ts";

const nl = (...parts: string[]) => parts.join("\n");

/**
 * G edits five files and nothing it does is supposed to be visible, so every one
 * of these is a way for it to be wrong quietly. They are grouped the way the
 * patch is: the argument parsing that replaced fromDurationLike, the two guards
 * in adjustTime, the constants, and the three edits outside datetime.js.
 */
const set: MutationSet = {
  patch: "07-arith-direct.patch",
  // The fixtures first, because they are what would ship and they are what has
  // to hold: run with --tests test/arith-direct-fixtures.test.ts to check them
  // alone. They catch everything the sweep does and one thing it does not, so
  // the sweep behind them is now the generator and the wider net, not the guard.
  tests: ["test/arith-direct-fixtures.test.ts", "test/arith-direct-patch.test.ts"],
  mutations: [
    // ---- durationValues: the argument parsing ----
    {
      name: "takes a number argument without checking it",
      find: "+    v.milliseconds = asNumber(durationLike);",
      replace: "+    v.milliseconds = durationLike;",
    },
    {
      name: "reads inherited keys off the argument",
      find: "+      if (!hasOwnProperty(durationLike, u)) continue;\n",
      replace: "",
    },
    {
      name: "no longer skips an undefined field",
      find: "+      if (raw == null) continue;",
      replace: "+      if (raw === null) continue;",
    },
    {
      name: "no longer skips a null field",
      find: "+      if (raw == null) continue;",
      replace: "+      if (raw === undefined) continue;",
      survives:
        "asNumber(null) is 0, and 0 is what an absent unit already reads as, so " +
        "the two are the same answer by a different route. Argued in the diff.",
    },
    {
      name: "checks the value before the unit name",
      find: nl("+      const unit = Duration.normalizeUnit(u);", "+", "+      v[unit] = asNumber(raw);"),
      replace: nl(
        "+      const value = asNumber(raw);",
        "+",
        "+      v[Duration.normalizeUnit(u)] = value;"
      ),
    },
    {
      name: "walks a Duration's own keys instead of its getters",
      find: "+    durationLike.isLuxonDuration !== true",
      replace: "+    true",
    },
    {
      name: "leaves one unit unnegated",
      find: "+    v.milliseconds = -v.milliseconds;\n",
      replace: "",
    },
    {
      name: "drops a field when copying out of a Duration",
      find: "+    v.quarters = dur.quarters;\n",
      replace: "",
    },

    // ---- Duration arithmetic: direct values ----
    {
      name: "Duration plus leaves the addend out",
      find: "+        result[k] = (theirs[k] || 0) + (mine[k] || 0);",
      replace: "+        result[k] = mine[k] || 0;",
    },
    {
      name: "Duration minus adds the addend",
      find: "+        result[k] = (mine[k] || 0) - (theirs[k] || 0);",
      replace: "+        result[k] = (mine[k] || 0) + (theirs[k] || 0);",
    },

    // ---- adjustTime: the whole-value guard ----
    {
      name: "sums fractional days as though they were whole",
      find: "+      Number.isInteger(durDays) &&\n",
      replace: "",
    },
    {
      name: "gets the minute factor wrong",
      find: "durMinutes * 60000",
      replace: "durMinutes * 6000",
    },
    {
      name: "takes the precomputed sum for a fractional duration",
      find: "+    millisToAdd = whole\n",
      replace: "+    millisToAdd = true\n",
    },

    // ---- adjustTime: the calendar-free fast path ----
    {
      name: "takes the fast path with days set",
      find: nl("+    durDays === 0 &&", "+    whole"),
      replace: "+    whole",
    },
    {
      name: "takes the fast path with weeks set",
      find: "+    durWeeks === 0 &&\n",
      replace: "",
    },
    {
      name: "takes the fast path for a fractional duration",
      find: nl("+    whole", "+  ) {"),
      replace: nl("+    true", "+  ) {"),
    },
    {
      name: "lands the fast path one millisecond out",
      find: "+    const only = inst.ts + wholeSum;",
      replace: "+    const only = inst.ts + wholeSum + 1;",
    },
    {
      name: "keeps the receiver's offset across the fast path",
      find: "o: wholeSum === 0 ? oPre : inst.zone.offset(only)",
      replace: "o: oPre",
      survives:
        "clone() always passes `old`, and the constructor ignores the offset it " +
        "is handed whenever `old` is present. Argued in the diff.",
    },
    {
      name: "reports the receiver's wasHole from the fast path",
      find: "wasHole: false };",
      replace: "wasHole: inst.wasHole };",
    },
    {
      name: "drops a field from the civil literal",
      find: "+      hour: ic.hour,\n",
      replace: "",
    },

    // ---- the hoisted constants ----
    {
      name: "loses a unit alias from DateTime's table",
      find: '+  weekyears: "weekYear",\n',
      replace: "",
    },
    {
      name: "loses a unit alias from Duration's table",
      find: '+  quarters: "quarters",\n',
      replace: "",
    },
    {
      name: "builds DateTime's unit table with Object.prototype behind it",
      find: nl("+const normalizedUnits = Object.assign(Object.create(null), {", '+  year: "year",'),
      replace: nl("+const normalizedUnits = Object.assign({}, {", '+  year: "year",'),
    },
    {
      name: "builds Duration's unit table with Object.prototype behind it",
      find: nl("+const normalizedUnits = Object.assign(Object.create(null), {", '+  year: "years",'),
      replace: nl("+const normalizedUnits = Object.assign({}, {", '+  year: "years",'),
    },
    {
      name: "loses a relative-time abbreviation",
      find: '+  years: ["year", "yr."],',
      replace: '+  years: ["year", "year"],',
    },
    {
      name: "forgets that seconds can be 'last'",
      find: '+const lastableUnits = ["hours", "minutes", "seconds"];',
      replace: '+const lastableUnits = ["hours", "minutes"];',
    },
    {
      name: "reuses the system-zone probe without resetting it",
      find: "+    probe.setTime(ts);\n",
      replace: "",
    },

    // ---- DateTime.local overload fast paths ----
    {
      name: "treats a positional year as an options object",
      find: '+    if (arguments.length === 1 && typeof arguments[0] === "object") {',
      replace: "+    if (arguments.length === 1) {",
    },
    {
      name: "takes the options shortcut for non-objects",
      find: '+    if (arguments.length === 1 && typeof arguments[0] === "object") {',
      replace: '+    if (arguments.length === 1 && typeof arguments[0] !== "object") {',
    },

    // ---- dayDiff ----
    {
      name: "subtracts civil days in the wrong direction",
      find: nl(
        "+    daysFromCivil(later.c.year, later.c.month, later.c.day) -",
        "+    daysFromCivil(earlier.c.year, earlier.c.month, earlier.c.day)"
      ),
      replace: nl(
        "+    daysFromCivil(earlier.c.year, earlier.c.month, earlier.c.day) -",
        "+    daysFromCivil(later.c.year, later.c.month, later.c.day)"
      ),
    },
    {
      name: "reads the later civil month one month ahead",
      find: "+    daysFromCivil(later.c.year, later.c.month, later.c.day) -",
      replace: "+    daysFromCivil(later.c.year, later.c.month + 1, later.c.day) -",
    },
    {
      name: "exact millisecond diff is one millisecond long",
      find: "+    return Duration.fromMillis(later - earlier, opts);",
      replace: "+    return Duration.fromMillis(later - earlier + 1, opts);",
    },
    {
      name: "millisecond shortcut takes mixed-unit diffs",
      find: '+  if (units.length === 1 && units[0] === "milliseconds") {',
      replace: '+  if (units[0] === "milliseconds" || units.includes("milliseconds")) {',
    },
  ],
};

export default set;
