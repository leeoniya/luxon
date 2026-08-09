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

**Three spans per zone, each anchored around the instant that missed** rather
than one span extended in the direction of the last miss. Placing a local time
asks the zone about a seed instant and twice around the target; one span is
therefore evicted before it can widen, and two retain the seed and target
working sets. The third is for the other common caller: an operation that
builds a DateTime and then diffs it across a transition — `toRelative` against
a base beyond a DST jump is the archetype — touches the construction's interval
plus one on each side of the transition, and three regions through two slots is
a miss on every lookup. Each span widens according to prior hits, so sequential
reads approach the cap while scattered reads stay near the one-probe floor.

**The pattern is established practice, one layer down.** V8's own `DateCache`
(`src/date/date.h`) serves `Date`'s local-time conversions from an array of
segments "where the time zone offset does not change", replaced by LRU and
extended as adjacent queries agree — and guards them with a 19-day bound whose
comment cites Egypt suspending DST for Ramadan in 2010, the same argument shape
as the 6.96-day bound above. Joda-Time's `CachedDateTimeZone` does it for
arbitrary zones on the JVM, caching offsets and name keys over transition-free
stretches. Both enjoy an oracle this patch does not: V8 asks the OS for the
offset at an instant and Joda's `DateTimeZone` enumerates `nextTransition`
directly, where Intl only answers point queries — which is what the probe loop
substitutes for. V8 affords 32 segments for the one system zone every `Date`
shares; this cache is per zone and each fill costs ICU calls, so it carries
three, the measured working set.

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
