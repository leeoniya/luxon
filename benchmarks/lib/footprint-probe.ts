// One row of benchmarks/upstream.ts's --footprint columns, as its own process.
//
// Both figures are process-wide totals, so two builds sharing a process would
// report the first one's retained caches and constructed formatters against the
// second. The driver is the worst possible place to read them: it holds every
// patched luxon variant, moment-timezone and easy-tz's tables at once. A
// subprocess loads one build and nothing else, which is also why ./build.ts
// keeps its heavy imports inside the branches that need them.
//
// Usage: <engine> footprint-probe.ts <specs-json> <n> <base> <step>
// where specs-json is an array of BuildSpec. Prints one JSON object on stdout.
//
// Under node this needs --expose-gc; the driver passes it.

import { installIntlCounter, intlConstructCount } from "./intl-count.ts";
// erased at runtime, so ./build.ts is still only loaded by the dynamic import
// below — after the counter is installed
import type { BuildSpec } from "./build.ts";

// before the build loads, so the formatters it constructs during setup count too
installIntlCounter();

const { formatterFor } = await import("./build.ts");
const [specsJson, n, base, step] = process.argv.slice(2);

// bun collects through Bun.gc; node needs --expose-gc, which the driver passes.
// Falls back to a no-op rather than failing: an rss read without a collection is
// noisier, not wrong, and losing the Intl counts too would be the worse trade.
const bun = (globalThis as { Bun?: { gc: (force: boolean) => void } }).Bun;
const gc: () => void = bun === undefined ? ((globalThis as { gc?: () => void }).gc ?? (() => {})) : () => bun.gc(true);

gc();

const rss0 = process.memoryUsage().rss;
const specs = JSON.parse(specsJson!) as BuildSpec[];
const values = Number(n);

// summed and reported so neither engine can drop the formatting as dead
let sink = 0;

for (const spec of specs) {
  const format = await formatterFor(spec);

  for (let i = 0; i < values; i++) {
    sink += format(Number(base) + i * Number(step)).length;
  }
}

gc();

console.log(
  JSON.stringify({
    rssMB: (process.memoryUsage().rss - rss0) / 1048576,
    intl: intlConstructCount(),
    sink,
  })
);
