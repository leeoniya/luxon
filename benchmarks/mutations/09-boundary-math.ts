import type { MutationSet } from "../lib/mutations.ts";

/**
 * I is allocations dropped plus calendar arithmetic, and each half fails its
 * own way. `clone` fails by forgetting a field, which is the same failure once
 * per field; `endOf` fails by handing plus() the wrong object, by an anchor off
 * by one, or by reporting the boundary instead of the millisecond before it;
 * `as` fails the way any hand-rolled sum fails -- the matrix indexed the wrong
 * way round, a bound off by one, or a float subtlety copied out of shiftTo and
 * then simplified away. The weekday math fails the way calendar arithmetic
 * fails: a remainder that keeps its sign, a rule (century years, the
 * March-first year shift) quietly dropped.
 */
const set: MutationSet = {
  patch: "09-boundary-math.patch",
  tests: ["test/trim-allocs-fixtures.test.ts", "test/boundary-math-fixtures.test.ts"],
  mutations: [
    // ---- clone, one per field ----
    {
      name: "clone ignores a new timestamp",
      find: "+    ts: alts.ts == null ? current.ts : alts.ts,",
      replace: "+    ts: current.ts,",
    },
    {
      name: "clone ignores a new zone",
      find: "+    zone: alts.zone == null ? current.zone : alts.zone,",
      replace: "+    zone: current.zone,",
    },
    {
      name: "clone ignores a new locale",
      find: "+    loc: alts.loc == null ? current.loc : alts.loc,",
      replace: "+    loc: current.loc,",
    },
    {
      name: "clone drops the invalid reason",
      find: "+    invalid: current.invalid,",
      replace: "+    invalid: undefined,",
    },
    {
      name: "clone forgets the instant was in a hole",
      find: "+    wasHole: alts.wasHole == null ? current.wasHole : alts.wasHole,",
      replace: "+    wasHole: current.wasHole,",
    },
    {
      name: "clone stops telling the constructor where it came from",
      find: "+    old: current,",
      replace: "+    old: undefined,",
    },
    {
      name: "clone reads the alternatives the wrong way round",
      find: "+    ts: alts.ts == null ? current.ts : alts.ts,",
      replace: "+    ts: current.ts == null ? alts.ts : current.ts,",
    },
    // ---- endOf's one-unit objects ----
    {
      name: "endOf steps by the wrong unit",
      find: "+    one = oneOfCache[unit] = { [unit]: 1 };",
      replace: '+    one = oneOfCache[unit] = { ["day"]: 1 };',
    },
    {
      name: "endOf steps by two of the unit",
      find: "+    one = oneOfCache[unit] = { [unit]: 1 };",
      replace: "+    one = oneOfCache[unit] = { [unit]: 2 };",
    },
    {
      // "hour" rather than a calendar unit: year through day take the fused
      // civil route and never reach oneOf, so their slots stay empty and a
      // misread of one falls through to the fallback, which computes the right
      // object anyway. The sub-day units are what oneOf exists for.
      name: "endOf hands every unit the same object",
      find: "+  let one = oneOfCache[unit];",
      replace: '+  let one = oneOfCache["hour"];',
    },
    {
      name: "keeps the one-unit objects on a bag with Object.prototype behind it",
      find: "+const oneOfCache = Object.create(null);",
      replace: "+const oneOfCache = {};",
    },
    // ---- as(): which way the matrix is read ----
    {
      name: "converts the units above the target as if they were below it",
      find: "+      if (isNumber(vals[higher])) own += matrix[higher][u] * vals[higher];",
      replace: "+      if (isNumber(vals[higher])) own += vals[higher] / matrix[u][higher];",
    },
    {
      name: "converts the units below the target as if they were above it",
      find: "+      if (isNumber(vals[lower]) && vals[lower] !== 0) out += vals[lower] / matrix[u][lower];",
      replace: "+      if (isNumber(vals[lower]) && vals[lower] !== 0) out += matrix[lower][u] * vals[lower];",
    },
    {
      name: "leaves the target unit's own value out of the sum",
      find: "+    if (isNumber(vals[u])) own += vals[u];",
      replace: "+    if (isNumber(vals[u])) own += 0;",
    },
    {
      name: "counts the target unit among the ones above it",
      find: "+    for (let i = 0; i < at; i++) {",
      replace: "+    for (let i = 0; i <= at; i++) {",
    },
    {
      name: "counts the target unit among the ones below it",
      find: "+    for (let i = at + 1; i < orderedUnits.length; i++) {",
      replace: "+    for (let i = at; i < orderedUnits.length; i++) {",
    },
    {
      name: "stops one short of the smallest unit",
      find: "+    for (let i = at + 1; i < orderedUnits.length; i++) {",
      replace: "+    for (let i = at + 1; i < orderedUnits.length - 1; i++) {",
    },
    // ---- as(): the parts copied out of shiftTo ----
    {
      name: "adds the whole and the remainder without shiftTo's rounding",
      find: "+    const rest = (own * 1000 - whole * 1000) / 1000;",
      replace: "+    const rest = own - whole;",
    },
    {
      name: "rounds towards minus infinity rather than towards zero",
      find: "+    const whole = Math.trunc(own);",
      replace: "+    const whole = Math.floor(own);",
    },
    {
      name: "keeps a value the duration does not carry",
      find: "+      if (isNumber(vals[higher])) own += matrix[higher][u] * vals[higher];",
      replace: "+      own += matrix[higher][u] * (vals[higher] || 0);",
      survives:
        "the two differ only where vals[higher] is present but not a number, and " +
        "Duration#fromObject rejects those on the way in -- a non-numeric value " +
        "makes the whole Duration invalid, and an invalid one returns NaN two " +
        "lines above this. isNumber is guarding a state the constructor does not " +
        "produce, and matches how shiftTo's own loop reads the same values.",
    },
    // ---- as(): the way in ----
    {
      name: "reads the unit without normalizing its spelling",
      find: "+    const u = Duration.normalizeUnit(unit);",
      replace: "+    const u = unit;",
    },
    {
      name: "lets a unit it could not place through to the matrix",
      find: "+    if (at < 0) throw new InvalidUnitError(unit);",
      replace: "+    if (at < -1) throw new InvalidUnitError(unit);",
      survives:
        "this patch requires G, whose null-prototype unit table makes " +
        "normalizeUnit throw for anything it cannot place before this line " +
        "runs, so `at` is always a real index. The guard is the documented " +
        "fallback for a tree without G, which withNeeds never builds.",
    },
    {
      name: "answers for an invalid duration instead of refusing",
      find: "+    if (!this.isValid) return NaN;",
      replace: "+    if (false) return NaN;",
    },
    {
      name: "reads a default matrix rather than the one the duration carries",
      find: "+    const matrix = this.matrix;",
      replace: "+    const matrix = casualMatrix;",
    },
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
