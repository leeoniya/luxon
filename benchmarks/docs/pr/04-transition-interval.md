# D — cache the interval an offset and a name are known not to change over

`src/impl/util.js` · `src/zones/IANAZone.js`
**Requires A and B**, whose scanners it anchors on.

An offset or a name only changes at a transition, so a value inside a span
already proven transition-free needs no Intl call at all. That is one idea and it
applies to both lookups, so it is one memo in `impl/util.js` used twice:
`IANAZone#offset` and `parseZoneInfo` each hand it their own lookup.

**The interval is exact, not a heuristic.** Probes are 2 days apart, and
departing and returning inside a probe pair is the only way two agreeing probes
could be wrong. The shortest window in which any zone's offset changes and
returns to where it started is 6.96 days (America/Boa_Vista, Oct 2000), measured
over all 68,214 transitions the runtime's own ICU reports.

Sharing one cache between the two lookups means the bound has to hold for the
stricter of them, because a name can move while the offset stays put —
America/Cambridge_Bay did exactly that during Nunavut's 2000 zone changes. It
does hold, and it is the same number: the combined CLDR-name-plus-offset bound is
also 6.96 days, so the 2-day spacing keeps its ~3.5x margin either way. The tool
that checks the bound reads the runtime's ICU rather than bundled tzdata. A
future interval below four days would otherwise permit a stale name or offset.

**Two spans per zone, each anchored around the instant that missed** rather than
one span extended in the direction of the last miss. Placing a local time asks
the zone about a seed instant and twice around the target; one span is therefore
evicted before it can widen. Two spans retain the seed and target working sets.
Each widens according to prior hits, so sequential reads approach the cap while
scattered reads stay near the one-probe floor.

**Invalidation.** `IANAZone` keeps a map keyed by zone, cleared by its existing
`resetCache()`. The name side hangs its interval off the scanner A already caches
per locale and style, so `Locale.resetCache()` drops it with the scanner and no
new hook is needed.

**One divergence from stock, and stock is the strange one.** Asked for a generic
name, ICU answers America/Cambridge_Bay with `MT` everywhere except the single
repeated hour of a fall-back transition, where it returns `MT (Cambridge Bay)` —
an instant-dependent answer for a name whose whole point is not to depend on the
instant. A span brackets that hour and serves the neighbouring answer. Offsets
remain identical, as do `short` and `long`, the only styles luxon's tokens use.
