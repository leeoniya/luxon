// The fork's own src/, loaded as a normal module and typed.
//
// This is "stock luxon" for every bench that needs a reference implementation to
// compare a patched build against, and it is deliberately src/ rather than an
// installed luxon package: the point of the fork is to measure what its sources
// do, and a published tarball would be measuring a different tree.
//
// src/ is plain ESM with fully-specified relative imports and its own
// package.json declaring "type": "module", so node and bun can both import it as
// it sits — the same thing benchmarks/datetime.js and info.js have always done.
//
// What it does not carry is type declarations: those live in the separate
// @types/luxon package, which describes the PUBLISHED luxon rather than this
// tree. Asserting one onto the other is the single point where that gap is
// crossed, and it holds for the same reason the benches are worth running at
// all — the patches under test are memoizations and short-circuits, so any
// build here that failed to match the published surface would be a bug in the
// patch rather than in this line.

import type { LuxonModule } from "./luxon-types.ts";

// @ts-ignore -- luxon's sources ship no .d.ts of their own
import * as src from "../../src/luxon.js";

export const stock = src as unknown as LuxonModule;

export const { DateTime, IANAZone, FixedOffsetZone, SystemZone, Info, Settings } = stock;
