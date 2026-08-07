# benchmarks

Luxon's own benchmark suite, plus a harness for eleven candidate upstream
patches to `src/`.

The patches came out of profiling luxon against moment-timezone on a formatting
workload: a column of timestamps rendered in a named IANA zone, which is what a
dashboard or a data table produces thousands of at a time. Stock luxon runs that
at ~3x moment-timezone with a plain `yyyy-MM-dd HH:mm:ss`, and ~26x once the
pattern includes a zone abbreviation. All eleven are pure memoization or
provable short-circuits: no API changes, no output changes.

Nothing here modifies `src/`. Each patch is a unified diff in
[`patches/`](patches), and a build is a copy of `src/` with some subset of them
applied, written to `.tmp/builds/<set>/` and imported from there.

## The write-ups

The benches print tables. What the tables mean lives in [`docs/`](docs), so that
running one does not bury its numbers in several pages of explanation:

| doc | what is in it |
| --- | --- |
| [`docs/upstream.md`](docs/upstream.md) | the eleven patches one by one, `E`'s tzdata precondition, and the order to file them in |
| [`docs/coverage.md`](docs/coverage.md) | the ladder's public API columns: why each is there, and where luxon still trails moment |
| [`docs/suite.md`](docs/suite.md) | which patch moves which of luxon's own cases |
| [`docs/format.md`](docs/format.md) | the outside-in question, and the known tzdata differences |
| [`docs/cross-engine.md`](docs/cross-engine.md) | which patches pay off on both V8 and JavaScriptCore |
| [`docs/methodology.md`](docs/methodology.md) | how everything is timed, and how finely to read it |

They describe the *shape* of the results rather than quoting cells out of them,
so they do not go stale against a run. Magnitudes stay in the table that
measured them.

## Setup

```sh
cd benchmarks
npm install     # or: bun install
```

Deps live in this directory rather than the root `package.json` on purpose. The
root install is luxon's own — babel, rollup, jest — and these benches need none
of it; keeping them apart means running a benchmark cannot perturb the toolchain
that builds and tests the library.

That is the whole setup. [easy-tz](https://github.com/leeoniya/easy-tz), which
two of the benches measure against, is vendored into
[`vendor/easy-tz/`](vendor/easy-tz) rather than installed — 42K of pinned build
output, so the bytes `upstream.ts` reports are bytes in this repo's history
rather than whatever a sibling checkout was last built from. That directory's
[README](vendor/easy-tz/README.md) covers what is there and how to refresh it.

## What to run

| command | what it answers |
| --- | --- |
| `npm run bench` | luxon's own suite (`datetime.js`, `info.js`), one build, ops/sec |
| `npm run suite` | those same 29 cases across stock and the full patched build |
| `npm run format` | can a consumer close the moment-timezone gap from *outside* luxon? |
| `npm run upstream` | what can be removed from *inside* it, patch by patch, across the public API |
| `npm run cross-engine` | whether the ladder ranks the same on V8 and JavaScriptCore |
| `npm test` | the offset and zone-name patches against stock, exhaustively |
| `npm run check` | `tsc`, type-check only |

Every bench also runs under bun (`bun format.ts`), which is the point of
`cross-engine`: the two engines do not agree about the smaller patches.

Every timed bench idles ten seconds between rows so the host is in a comparable
state for each of them, and prints each row as it lands rather than the table at
the end. The times quoted below are the timing alone; add roughly ten seconds a
row for a default run. `--cooldown 0` turns the idling off, which is what to do
when iterating on a patch and comparing a run against itself rather than reading
rows against each other; `--cooldown <ms>` sets it to anything else.

Timings in the tables that have a moment baseline — `upstream`'s ladder and
`format` — are shaded against it on a terminal: moment keeps the
default colour, cells faster than it go green, cells slower go red, and further
either way is more saturated. It is a log scale, since these ratios run from
about a fifth of moment's time to fifty times it, and anything within ~10% is
left plain. Redirected output is never shaded, so piping to a file gets the same
plain text it always did; `--no-color` or `NO_COLOR=1` turns it off on a terminal
too, and `FORCE_COLOR=1` turns it on anywhere.

`--drop <letters>` leaves patches out of every build a run makes — `--drop G`,
`--drop CG`. It answers a question the ladder cannot: a rung measures what a
patch *adds* given everything above it, which is not what removing it would
cost whenever two patches overlap. Run the bench twice, with and without, and
the pair of numbers is the answer. A patch whose diff is written against
another's cannot be dropped alone, and the error says which set to name instead.

`format` and `upstream` take `--verify`, which adds their output-comparison
sections. Off by default because the answer only moves when luxon's `src`,
moment's bundled tzdata, or the host ICU does — but the timings are only a
result if the outputs match, so run it before quoting any of them.
Verification runs default to no cooldown because the timing rows are incidental;
an explicit `--cooldown` restores it when verified timings are wanted.
`npm run verify` runs both.

`upstream` prints three tables and any combination can be run alone, which is
the loop for iterating on a patch: `--patches` (~1s), `--ladder` (~80s), and
`--default` (~13s). It also takes `--footprint` for rss and Intl-formatter
counts, one subprocess per row. `--row <build-id>` limits the ladder to one
named row for focused validation, for example `--ladder --row date-fns`.

`--ladder` is the main event: four tables of the same shape — the same builds in
the same order, a row per build, its shipped bytes at the end. `formatting`,
`parsing`, `other — DateTime`, and `other — Duration, Interval and Info`. The
last two together cover everything that neither writes a string nor reads one.
The heading carries the unit, since none of the 53 columns does, and repeated
API prefixes are lifted into column-group headings. The baseline block is
moment-timezone, date-fns with `@date-fns/tz`, then stock luxon; a patch is
argued from one row against the row above it, and the rows are the same rows
throughout, so the four tables stack into one argument.

They are timed in segments rather than in tables, because a segment is a
calibration: the format-string columns run the full value count, while parsing
and the API calls cost enough per value that their passes are sized by time and
scaled. Each column states its own noise floor underneath, because they differ by
an order of magnitude in cost and so in steadiness. A `--` is a build with no
semantically honest equivalent to run — both moment and date-fns leave some of
Luxon's compiled parser, Duration, Interval, and ambiguous-time APIs blank.

The API columns exist because the patch set outgrew the two questions that found it:
`H` hoists both `normalizeUnit` tables and replaces the `Duration` round trip
inside `adjustTime`, and `I` stops `toRelative` asking for diffs it can already
answer — none of which any formatting or parsing case touches — and
`A` and `E` sit under every zoned operation rather than only the ones that print
something. They were a table of their own (`coverage.ts`) until they moved here.
Every build's answers are checked against every other's before anything is
timed, so a patch that changed an answer fails the bench rather than winning it.

Both of those name a zone, since that is what the patches were written for.
`--default` is the same ladder with no zone named at all, which is what a caller
who never configures one gets: luxon falls back to `SystemZone`, whose offset is
a `getTimezoneOffset` call rather than an Intl one, so stock is already an order
of magnitude cheaper there and the Intl-removing patches have much less to
remove.

## How the patches are applied

A patch file is a real unified diff with a metadata header and the reasoning for
the change above it:

```
Patch: zoneInfoCache
Letter: A
Requires: none
Summary: parseZoneInfo: reuse the existing DTF cache instead of building one per call

<the reasoning>

diff --git a/src/impl/util.js b/src/impl/util.js
...
```

Files rather than string literals in a script, so they read as diffs — syntax
highlighted on GitHub, applicable with `git apply`, and filable upstream as they
stand. [`lib/diff.ts`](lib/diff.ts) applies them, strictly: every context and
removed line must match exactly, or the build fails rather than producing
something subtly different from what the diff describes.

Each distinct subset of patches gets its own directory and therefore its own
module instance, so one variant's internal caches can never warm another's. That
matters more than it sounds — most of these patches *are* caches.

Two patches are written against another's output and cannot be applied alone
(`Requires:` says which); the loader pulls in what they need.

## Layout

```
datetime.js  info.js  index.js   luxon's own suite, on tinybench
suite.ts                         those 29 cases across build columns
format.ts                        moment vs luxon vs luxon+easy-tz
upstream.ts                      the patch ladder: what each is worth
cross-engine.ts                  upstream.ts under node and bun, diffed
patches/                         the eleven diffs
docs/                            what the tables mean
test/                            parity tests for the patches that rewrite logic
lib/                             harness (see each file's header)
```

`lib/` splits along two lines that are worth knowing about. Modules the
footprint subprocesses load ([`build.ts`](lib/build.ts),
[`easy-zone.ts`](lib/easy-zone.ts)) keep their heavy imports inside the branches
that need them, so a row's rss is its own build's and not the harness's. And
[`kernel.ts`](lib/kernel.ts) is deliberately not tinybench: luxon's own suites
measure one build's cases against each other and want an ops/sec with a
confidence interval, whereas these measure the same case across four builds and
want the *difference between them* to mean something, which needs adaptive pass
sizing and interleaving instead.
