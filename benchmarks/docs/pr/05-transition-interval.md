# E — cache the interval an offset and a name are known not to change over

`src/impl/util.js` · `src/zones/IANAZone.js`
**Requires B and D**, whose scanners it anchors on.

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
America/Cambridge_Bay spent the 2000 Nunavut experiment doing exactly that. It
does hold, and it is the same number: the combined CLDR-name-plus-offset bound is
also 6.96 days, so the 2-day spacing keeps its ~3.5x margin either way. The tool
that measures it re-runs against the live ICU rather than a bundled copy of
tzdata, so a future tightening fails loudly instead of quietly serving a stale
name.

**Two spans per zone, each anchored around the instant that missed** rather than
one span extended in whichever direction the last miss travelled. Both of those
choices are about the caller, not the data. Placing a local time asks the zone
about three instants — `fixOffset` cannot turn a local time into an instant
without an offset, or get an offset without an instant, so it seeds at
`Settings.now()` and then probes twice around the target — so a single span is
evicted by the next lookup of the same parse, every parse, and the direction of
the last miss belongs to whichever of the three sites produced it.

That is permanent rather than a warm-up, which is the part worth checking. A span
starts as a single point, since reach only grows after a hit, and a point can
never be hit; with something else evicting it every call, three of the four call
sites can never widen and sit at zero hits forever. The distance between the
instants has nothing to do with it — reading today's dates missed as reliably as
reading dates three years out. Two spans, one for the seed and one for the
target, take both to zero Intl reads.

Two is the structural minimum, and a third span for the case where a transition
falls between the target's own two probes measured as noise. How far a span fans
out is decided by what the previous one paid back, so a sequential reader widens
toward the cap and a scattered one stays near the floor; the floor of one probe
each way cannot be zero, for the same reason the deadlock exists.

**Invalidation.** `IANAZone` keeps a map keyed by zone, cleared by its existing
`resetCache()`. The name side hangs its interval off the scanner D already caches
per locale and style, so `Locale.resetCache()` drops it with the scanner and no
new hook is needed.

**One divergence from stock, and stock is the strange one.** Asked for a generic
name, ICU answers America/Cambridge_Bay with `MT` everywhere except the single
repeated hour of a fall-back transition, where it returns `MT (Cambridge Bay)` —
an instant-dependent answer for a name whose whole point is not to depend on the
instant. A span brackets that hour and serves the neighbouring answer. Over
218,100 comparisons against stock across 16 zones, 5 locales, all 6 styles and 4
access orders, that accounts for every one of the 258 differences. There are none
in the offset, and none in `short` or `long`, which are the only two styles
luxon's own tokens ask for.

**Scope.** This treats a symptom, and the cause is worth someone's time
separately. The seed lookup is the only reason there are three call sites, and
probing the target first would remove it and the need for a second span with it.
But stock declares a hole whenever its two probes disagree, which is sound only
because the seed is already close, so a target-first `fixOffset` needs a third
probe before it may conclude the same. That changes how luxon resolves ambiguous
local times, so it does not belong in a patch that moves no semantics.
