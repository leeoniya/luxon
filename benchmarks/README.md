# benchmarks

Luxon's own benchmark suite, plus a harness for seven candidate upstream
patches to `src/`.

The patches came out of profiling luxon against moment-timezone on a formatting
workload: a column of timestamps rendered in a named IANA zone, which is what a
dashboard or a data table produces thousands of at a time. Stock luxon runs that
at ~3x moment-timezone with a plain `yyyy-MM-dd HH:mm:ss`, and ~26x once the
pattern includes a zone abbreviation. All seven are pure memoization or
provable short-circuits: no API changes, no output changes.

Nothing here modifies `src/`. Each patch is a unified diff in
[`patches/`](patches), and a build is a copy of `src/` with some subset of them
applied, written to `.tmp/builds/<set>/` and imported from there.

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
| `npm run suite` | those same 29 cases across stock and three patched builds |
| `npm run format` | can a consumer close the moment-timezone gap from *outside* luxon? |
| `npm run upstream` | what can be removed from *inside* it, patch by patch |
| `npm run cross-engine` | which patches pay off on both V8 and JavaScriptCore |
| `npm test` | the offset and zone-name patches against stock, exhaustively |
| `npm run check` | `tsc`, type-check only |

Every bench also runs under bun (`bun format.ts`), which is the point of
`cross-engine`: the two engines do not agree about the smaller patches.

`format` and `upstream` take `--verify`, which adds their output-comparison
sections. Off by default because the answer only moves when luxon's `src`,
moment's bundled tzdata, or the host ICU does — but the timings are only a
result if the outputs match, so run it before quoting any of them.
`npm run verify` runs both.

`upstream` prints three tables and any combination can be run alone, which is
the loop for iterating on a patch: `--patches` (~1s), `--format` (~18s), and
`--parse` (~9s). It also takes `--footprint` for rss and Intl-formatter counts,
one subprocess per row.

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
patches/                         the seven diffs
test/                            parity tests for the four zone patches
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
