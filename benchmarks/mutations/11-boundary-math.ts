import type { MutationSet } from "../lib/mutations.ts";

/**
 * K is calendar arithmetic, and it fails the way calendar arithmetic fails: an
 * anchor off by one, a remainder that keeps its sign, a rule (century years,
 * the March-first year shift) quietly dropped. The endOf fold adds the other
 * family — reporting the boundary instead of the millisecond before it, or
 * keeping a field (offset, wasHole) the subtraction was supposed to refresh.
 * The catalog also covers the year/quarter/month boundary switch K rewrote,
 * which I's catalog never mutated.
 */
const set: MutationSet = {
  patch: "11-boundary-math.patch",
  tests: ["test/boundary-math-fixtures.test.ts"],
  mutations: [
    // ---- dayOfWeek and daysFromCivil ----
    {
      name: "every weekday shifts by one",
      find: "+  const js = (((daysFromCivil(year, month, day) + 4) % 7) + 7) % 7;",
      replace: "+  const js = (((daysFromCivil(year, month, day) + 3) % 7) + 7) % 7;",
    },
    {
      name: "weekdays before the epoch keep their negative remainder",
      find: "+  const js = (((daysFromCivil(year, month, day) + 4) % 7) + 7) % 7;",
      replace: "+  const js = (daysFromCivil(year, month, day) + 4) % 7;",
    },
    {
      name: "the march-first year shift is lost",
      find: "+  y -= m <= 2 ? 1 : 0;",
      replace: "+  y -= 0;",
    },
    {
      name: "ancient eras round toward zero",
      find: "+  const era = Math.floor(y / 400);",
      replace: "+  const era = Math.trunc(y / 400);",
    },
    {
      name: "century years count as leap",
      find: "+  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy + d - 1;",
      replace: "+  const doe = yoe * 365 + Math.floor(yoe / 4) + doy + d - 1;",
    },
    // ---- startOf("week") ----
    {
      name: "startOf week lands on Sunday",
      find: "+        o.day = c.day - (dayOfWeek(c.year, c.month, c.day) - 1);",
      replace: "+        o.day = c.day - dayOfWeek(c.year, c.month, c.day);",
    },
    // ---- the endOf boundaries ----
    {
      name: "endOf week stops a day short",
      find: "+          day = c.day + 8 - dayOfWeek(c.year, c.month, c.day);",
      replace: "+          day = c.day + 7 - dayOfWeek(c.year, c.month, c.day);",
    },
    {
      name: "endOf day reaches into tomorrow",
      find: "+          day = c.day + 1;",
      replace: "+          day = c.day + 2;",
    },
    {
      name: "the quarter boundary lands mid-quarter",
      find: "+          const next = Math.floor((c.month - 1) / 3) * 3 + 4;",
      replace: "+          const next = Math.floor((c.month - 1) / 3) * 3 + 3;",
    },
    {
      name: "december wraps without carrying the year",
      find: "+          if (c.month === 12) {",
      replace: "+          if (false) {",
      survives:
        "the uncarried boundary is { year, month: 13 }, and Date.UTC inside " +
        "objToLocalTS carries a thirteenth month into January itself -- the " +
        "explicit carry answers identically and exists for the reader (and " +
        "because the week and day cases need the locals anyway). The same " +
        "argument covers the two-digit-year repair: setUTCFullYear(year, 12, 1) " +
        "rolls the same way.",
    },
    {
      name: "sub-day units join the fused route",
      find: "+    if (year !== undefined) {",
      replace: "+    if (true) {",
    },
    {
      name: "options objects are forgotten before routing",
      find: "+    let year, month, day;",
      replace: "+    let year, month, day; opts = undefined;",
    },
    // ---- the folded minus(1) ----
    {
      name: "the boundary is the answer, not the millisecond before it",
      find: "+      return clone(this, { ts: boundaryTS - 1, wasHole: false });",
      replace: "+      return clone(this, { ts: boundaryTS, wasHole: false });",
    },
    {
      name: "the folded minus claims the receiver's hole",
      find: "+      return clone(this, { ts: boundaryTS - 1, wasHole: false });",
      replace: "+      return clone(this, { ts: boundaryTS - 1, wasHole: this.wasHole });",
    },
    {
      name: "the boundary is placed with a UTC guess",
      find: "+        this.o,",
      replace: "+        0,",
    },
  ],
};

export default set;
