# cross-engine.ts — V8 against JavaScriptCore

> `node cross-engine.ts`. Timing methodology is in
> [methodology.md](methodology.md).

Runs [`upstream.ts`](upstream.md) under both node and bun and diffs the two,
because the smaller patches do not rank the same on V8 and JavaScriptCore.

## Why this exists

A patch that removes an `Intl` call is fast everywhere — no engine can be fast at
constructing an ICU formatter. A patch that removes an allocation or a
megamorphic property access is at the mercy of what the engine was already doing
about it. V8 escape-analyzes some of those allocations away and JavaScriptCore
does not, so a change that is worth a few percent on node can be worth
substantially more on bun, and occasionally the ranking inverts outright.

Quoting a single engine's ranking as *the* ranking would be the weakest part of
an upstream pitch, so this file makes the disagreement a table instead.

## Reading the table

Every ladder rung as a ratio against moment-timezone, on the numeric and
abbreviated formats, both engines. A rung whose two engine columns differ is a
rung whose value depends on which engine you believe; one where they agree is one
that does not.

Those two of the ladder's three writing formats, because these are the two that
differ by which `Intl` call they make, and that is the thing an engine change is
most likely to move. The `text` column varies the pattern instead, so it is read
in `upstream` rather than here.

The rungs that reach the zone-name lookup are worth watching per engine in
particular, since they lean on `Intl` behaving the same way in both — and
JavaScriptCore ships a different ICU. The abbreviated columns are where that
shows.

The row list is read off the results rather than re-derived from
[`../patches/`](../patches), so a rung added to the bench appears here without
editing anything, and a row missing from either run is an error rather than a
silently dropped line.

### A per-patch table used to sit above this one

It reported what each patch on its own saved against the unpatched easy-tz zone,
with a verdict column reading `both`, `V8 only`, `JSC only` or `neither` against
each engine's noise floor. It is gone, along with the builds behind it — one per
patch, each a full row of measurement in `upstream`'s ladder that was never
printed there, to rank patches the ladder already ranks one at a time.

Two things it taught are worth keeping even without the table:

- A verdict thresholded against a per-engine floor lets **a patch save the same
  percentage on both engines and still read as engine-specific**. That was
  JavaScriptCore's noisier run failing to resolve a real saving, not the engines
  disagreeing. Any future verdict column here needs the same warning.
- `F` was the patch that kept tripping it. It is aimed at `Info`, which a
  formatting table barely touches, so a formatting-side ranking was the wrong
  place to judge it from. Its case is in the ladder's `other` band — see
  [coverage.md](coverage.md).

## What it found

The large rungs — the structural formatter change and the merged fast paths —
hold on both engines by a wide margin, and neither depends on which engine you
believe.

The reason `G` is one patch and not six is visible here in the negative. While
those six were separate patches with rows of their own, they disagreed across the
engines: some resolved on V8 only, one on JavaScriptCore only, one on neither.
Merged, the result holds on both. Filing them separately would have meant six
patches each of which looks marginal on one engine or the other.
