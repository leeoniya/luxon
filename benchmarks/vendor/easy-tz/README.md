# vendored easy-tz

The `dist/07-baked-rules` build of [easy-tz](https://github.com/leeoniya/easy-tz),
which resolves a zone's UTC offset and DST-correct abbreviation from baked rule
tables instead of asking `Intl`. It is the comparison point for
[`../../format.ts`](../../format.ts) and for the easy-tz rows in
[`../../upstream.ts`](../../upstream.ts).

| file          | what                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `index.mjs`   | the build, copied verbatim. Self-contained — it imports nothing             |
| `index.d.mts` | its `index.d.ts`, renamed (see below); otherwise verbatim                   |
| `meta.json`   | generated, not copied (see below)                                           |

Read through [`../../lib/easy-tz.ts`](../../lib/easy-tz.ts), never directly —
except in `upstream.ts`'s size entries, which import `index.mjs` statically so
that the bundler walks the same module surface a real consumer would.

## why vendored

The alternatives were a `file:` dependency on a checkout or a symlink, and both
are worse here:

- **A `file:` dependency drags in easy-tz's devDependencies** — puppeteer,
  oxlint, and a git tarball. That is a hundred-odd megabytes and a network round
  trip to produce two benchmark rows.
- **The npm tarball would not be enough anyway.** It ships only `dist/`, while
  three of the facts these benches report come from `shared/`, which is neither
  published nor reachable through the package's `exports` map. That is what
  `meta.json` is for.
- **A checkout is not a pinned input.** These benchmarks exist to produce
  numbers that a reader can compare against their own run and that a PR reviewer
  can reproduce. A sibling directory, at whatever commit it was last built from,
  is not something a number can cite. Vendoring makes the measured bytes part of
  this repo's history: `upstream.ts`'s size column is literally sizing the file
  next to this README.

At 42K for the two files it is a cheap thing to pin.

## meta.json

Derived, because it is exactly the part that `dist/` does not carry:

- `tables` — which host's ICU the rule tables were baked from. The report headers
  print it, since a table baked on one ICU and compared against another is the
  explanation for most residual disagreements.
- `yearStart` — the first instant the baked schedule covers. `format.ts` anchors
  its sample window inside the tables' validity range using it, so that a
  disagreement is a formatting finding rather than a staleness one.
- `irregularZones` — the Ramadan-driven zones whose transition dates the baked
  step table only approximates. They must keep using luxon's exact `Intl` lookup,
  and the reports name them rather than just counting them.

The zone list is deliberately *not* here: it is read out of `index.mjs` at
runtime via `getTimeZones()`, which is byte-identical to easy-tz's own
`shared/zones.ts` and cannot drift from the bundle actually being measured.

## refreshing

From a checkout of easy-tz with `dist/` built and committed:

```sh
node vendor/update-easy-tz.ts [path/to/easy-tz]   # defaults to $EASY_TZ, then ../../easy-tz
```

That copies both files, regenerates `meta.json` including the source commit, and
refuses to run against a checkout with uncommitted changes under
`dist/07-baked-rules` — a vendored file whose recorded provenance is wrong is
worse than one with none.

The `.d.ts` → `.d.mts` rename is the only edit made to either file, and the
script does it rather than a human: TypeScript's `nodenext` resolution pairs a
relative `./index.mjs` import with `./index.d.mts` and will not look at
`./index.d.ts`.
