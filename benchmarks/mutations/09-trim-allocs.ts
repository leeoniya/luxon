import type { MutationSet } from "../lib/mutations.ts";

/**
 * I is three unrelated allocations, and only one of them has arithmetic in it.
 * `clone` fails by forgetting a field, which is the same failure eleven times
 * over; `endOf` fails by handing plus() the wrong object; `as` fails the way any
 * hand-rolled sum fails -- the matrix indexed the wrong way round, a bound off by
 * one, or a float subtlety copied out of shiftTo and then simplified away.
 */
const set: MutationSet = {
  patch: "09-trim-allocs.patch",
  tests: ["test/trim-allocs-fixtures.test.ts"],
  mutations: [
    // ---- clone, one per field ----
    {
      name: "clone ignores a new timestamp",
      find: "+    ts: alts.ts === undefined ? current.ts : alts.ts,",
      replace: "+    ts: current.ts,",
    },
    {
      name: "clone ignores a new zone",
      find: "+    zone: alts.zone === undefined ? current.zone : alts.zone,",
      replace: "+    zone: current.zone,",
    },
    {
      name: "clone ignores a new locale",
      find: "+    loc: alts.loc === undefined ? current.loc : alts.loc,",
      replace: "+    loc: current.loc,",
    },
    {
      name: "clone drops the invalid reason",
      find: "+    invalid: current.invalid,",
      replace: "+    invalid: undefined,",
    },
    {
      name: "clone forgets the instant was in a hole",
      find: "+    wasHole: alts.wasHole === undefined ? current.wasHole : alts.wasHole,",
      replace: "+    wasHole: current.wasHole,",
    },
    {
      name: "clone stops telling the constructor where it came from",
      find: "+    old: current,",
      replace: "+    old: undefined,",
    },
    {
      name: "clone reads the alternatives the wrong way round",
      find: "+    ts: alts.ts === undefined ? current.ts : alts.ts,",
      replace: "+    ts: current.ts === undefined ? alts.ts : current.ts,",
    },
    // ---- endOf ----
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
      name: "endOf hands every unit the same object",
      find: "+  let one = oneOfCache[unit];",
      replace: '+  let one = oneOfCache["day"];',
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
  ],
};

export default set;
