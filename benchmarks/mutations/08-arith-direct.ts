import type { MutationSet } from "../lib/mutations.ts";

const nl = (...parts: string[]) => parts.join("\n");

/**
 * H edits five files and nothing it does is supposed to be visible, so every one
 * of these is a way for it to be wrong quietly. They are grouped the way the
 * patch is: the argument parsing that replaced fromDurationLike, the two guards
 * in adjustTime, the constants, and the three edits outside datetime.js.
 */
const set: MutationSet = {
  patch: "08-arith-direct.patch",
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
      find: "+      if (raw === undefined || raw === null) continue;",
      replace: "+      if (raw === null) continue;",
    },
    {
      name: "no longer skips a null field",
      find: "+      if (raw === undefined || raw === null) continue;",
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
      name: "negates a zero field into -0",
      find: "+    v.days = v.days === 0 ? 0 : -v.days;",
      replace: "+    v.days = -v.days;",
      survives:
        "a -0 field reaches adjustTime only as a term of a sum or an addend to " +
        "an integer, and x + -0 is x for every x. Argued in the diff.",
    },
    {
      name: "leaves one unit unnegated",
      find: "+    v.milliseconds = v.milliseconds === 0 ? 0 : -v.milliseconds;\n",
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
      name: "keeps the fast sum when the result overflows",
      find: "+    millisToAdd = Number.isFinite(wholeSum * 1000)",
      replace: "+    millisToAdd = !Number.isNaN(wholeSum)",
    },

    // ---- adjustTime: the calendar-free fast path ----
    {
      name: "takes the fast path with days set",
      find: nl("+    durDays === 0 &&", "+    Number.isFinite"),
      replace: "+    Number.isFinite",
    },
    {
      name: "takes the fast path with weeks set",
      find: "+    durWeeks === 0 &&\n",
      replace: "",
    },
    {
      name: "takes the fast path when the sum overflows",
      find: nl("+    Number.isFinite(wholeSum * 1000)", "+  ) {"),
      replace: nl("+    wholeSum === wholeSum", "+  ) {"),
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

    // ---- dayDiff ----
    {
      name: "divides by the wrong number of milliseconds",
      find: "Math.floor(ms / 86400000)",
      replace: "Math.floor(ms / 86400001)",
    },
    {
      name: "uses Date.UTC, losing the 0-99 year fixup",
      find: nl(
        "+const utcDayStart = (dt) =>",
        "+  objToLocalTS({",
        "+    year: dt.c.year,",
        "+    month: dt.c.month,",
        "+    day: dt.c.day,",
        "+    hour: 0,",
        "+    minute: 0,",
        "+    second: 0,",
        "+    millisecond: 0,",
        "+  });"
      ),
      replace: "+const utcDayStart = (dt) => Date.UTC(dt.c.year, dt.c.month - 1, dt.c.day);",
    },
    {
      name: "measures from the civil time rather than its midnight",
      find: "+    hour: 0,",
      replace: "+    hour: dt.c.hour,",
      survives:
        "dayDiff only seeds highOrderDiffs. Keeping the time of day can only " +
        "undershoot, and by at most a day; the two disagree exactly when the " +
        "correct count overshoots `later`, which is the case highOrderDiffs " +
        "backtracks — onto the value this mutation produces directly. Checked " +
        "over 2,880 diffs across three zones, both directions and six unit " +
        "lists. The zeroing stays because it is what startOf('day') did.",
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
