# format.ts — closing the gap from outside luxon

> `node format.ts` (or `bun format.ts`), `--verify` for the agreement sections.
> Timing methodology is in [methodology.md](methodology.md).

Can a consumer close the moment-timezone gap from *outside* luxon, by binding a
faster `Zone` implementation? [`upstream`](upstream.md) asks the complementary
question: what can be removed from inside.

Three paths per zone and format — moment-timezone, stock luxon, and luxon with
[easy-tz](https://github.com/leeoniya/easy-tz) bound as its zone — timed across a
spread of IANA zones on both a numeric pattern and one containing a zone
abbreviation.

## The two formats

The split between them runs through everything here and in `upstream`. A numeric
pattern only ever asks luxon for an offset. A pattern with a zone name in it asks
for both an offset and a name, and the name lookup is by far the more expensive of
the two in stock luxon. A change that helps one and not the other is telling you
which of the two Intl calls it removed.

Two and not four, though `upstream`'s ladder now has two more. Those vary the
pattern shape and locale, which are the axes this bench holds fixed: here the
pattern is the instrument and the zone is the subject, so shapes that reach the
same two zone calls in the same way would cost a table, a correctness sweep and
an Intl-counting subprocess per cell to re-answer a question already on the page.
`zoneFormatKeys` in [`lib/format-paths.ts`](../lib/format-paths.ts) is where that
choice is written down, and each bench names the set it wants rather than
inheriting every pattern anyone has defined.

## Intl traffic

The counts behind every timing, and the one part of this report that does not move
with the host or the engine. Each cell runs in a **fresh subprocess** — see
[`lib/intl-probe.ts`](../lib/intl-probe.ts) for why it has to.

Far fewer values than the timing sections use: these are counts, not timings, and
each path constructs a fixed number per value, so the ratio is settled after a few
hundred. At the timing sections' volume it would be the stock abbreviated cells
formatting expensive values purely to divide by a larger denominator.

The finding survives the table, and it is why A leads the ladder in `upstream`:
stock luxon constructs a formatter **per value formatted**; every patched build
from A onward constructs three for the whole run; moment-timezone constructs none.

## Agreement (`--verify`)

Speed only counts if the output matches, so the timings are only a result if these
sections pass. They are opt-in because the answer only changes when luxon's `src`,
moment's bundled tzdata, or the host ICU does.

**Output agreement** compares the three paths pairwise across two full years at
hourly resolution, which steps over every DST transition in the window. Every
count is a count of disagreeing hours, though the scan reaches it by *run* rather
than by formatting all of them: whether two paths agree at an instant is decided
by their offset and their abbreviation and nothing else — the date-time tokens are
the same arithmetic on (instant + offset) in all three — so across any stretch
where no path changes either, the verdict is constant, and one sample plus the
stretch's length stands in for formatting every hour of it.

**Cross-zone fidelity** widens that to every zone the host knows, monthly, over
three years.

### Known differences

The two libraries carry different tzdata vintages, and it shows up here.
moment-timezone bundles its own snapshot; luxon, and transitively easy-tz's baked
tables, inherit whatever the host ICU has. Where the numeric rows differ it is
generally a **vintage zone** — moment has a rule change the host ICU does not, and
stock luxon is off there too, so it is a data-freshness difference rather than an
easy-tz one. The bench names those zones under the table.

A few **irregular zones** are excluded: their Ramadan-driven transition dates are
only approximated by easy-tz's baked step table, so they keep luxon's exact Intl
lookup. The bench names those too.

In the system-zone row, moment's `z` renders as an empty string, because moment in
local mode has no zone attached. The two `!=moment` abbreviation counts on that row
are therefore vacuous. That is detected rather than asserted, since it is a moment
behavior that could change.

## Removed

A column-density sweep used to live here: the same zone timed at 1 minute, 15
minutes, 1 hour and 1 day between adjacent values, to catch a lookup cache keyed on
anything coarser than the exact instant. moment binary-searches a packed table and
easy-tz evaluates rules, so either could in principle care how far apart the values
are. All four steps came out identical within noise on every path, and eight rows
re-establishing that on every run is eight rows too many. Restore it if either
implementation's lookup gains a bucketed cache.
