import type { MutationSet } from "../lib/mutations.ts";

/**
 * J is three unrelated allocations, and only one of them has arithmetic in it.
 * `clone` fails by forgetting a field, which is the same failure eleven times
 * over; `endOf` fails by handing plus() the wrong object; `as` fails the way any
 * hand-rolled sum fails -- the matrix indexed the wrong way round, a bound off by
 * one, or a float subtlety copied out of shiftTo and then simplified away.
 */
const set: MutationSet = {
  patch: "10-trim-allocs.patch",
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
      find: "+    oneOfCache.set(unit, (one = { [unit]: 1 }));",
      replace: '+    oneOfCache.set(unit, (one = { ["day"]: 1 }));',
    },
    {
      name: "endOf steps by two of the unit",
      find: "+    oneOfCache.set(unit, (one = { [unit]: 1 }));",
      replace: "+    oneOfCache.set(unit, (one = { [unit]: 2 }));",
    },
    {
      name: "endOf hands every unit the same object",
      find: "+  let one = oneOfCache.get(unit);",
      replace: '+  let one = oneOfCache.get("day");',
    },
    {
      name: "keeps the one-unit objects in an object rather than a Map",
      find: "+const oneOfCache = new Map();",
      replace: "+const oneOfCache = { get: (k) => oneOfBag[k], set: (k, v) => (oneOfBag[k] = v) };\n+const oneOfBag = {};",
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
      name: "adds a remainder of zero anyway",
      find: "+    if (rest !== 0) out += rest;",
      replace: "+    out += rest;",
      survives:
        "adding a floating-point zero is the identity for every value that can " +
        "reach it. The one case where it would not be is a negative zero, and " +
        "`own` is initialised to 0 and only added to, so a -0 input is already " +
        "0 by the time it gets here. Copied from shiftTo, which has the same " +
        "guard for the same non-reason.",
    },
    {
      name: "drops the coercion that turns a NaN sum into zero",
      find: "+    return out || 0;",
      replace: "+    return out;",
      survives:
        "nothing falsy but 0 can get here. asNumber requires Number.isFinite and " +
        "every way of putting a value on a Duration goes through it -- fromObject, " +
        "set, mapUnits -- so NaN and the infinities are refused at the door, and " +
        "an invalid Duration returns NaN before this line. A -0 cannot survive " +
        "either, since `own` starts at 0. It is here because get() reads through " +
        "the unit getter, which ends in `|| 0`, and this is meant to answer what " +
        "get() answers.",
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
      name: "takes the fast path for a unit it could not place",
      find: "+    if (at < 0) return this.shiftTo(unit).get(unit);",
      replace: "+    if (at < -1) return this.shiftTo(unit).get(unit);",
      survives:
        "the only units that reach it are the ones normalizeUnit lets through " +
        "without answering -- `__proto__` and `constructor` -- and the fast path " +
        "then indexes the matrix with the same non-unit that shiftTo would, so " +
        "both throw the same TypeError. Every unit luxon actually accepts is in " +
        "orderedUnits, so the guard never fires for a real call and there is no " +
        "input that tells the two apart.",
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
