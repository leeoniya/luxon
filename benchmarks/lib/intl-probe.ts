// One cell of benchmarks/format.ts's Intl-traffic table, as its own process.
//
// Its own process because the counters in ./intl-count.ts are process-wide and
// permanent, and because the numbers being counted are per-process state:
// luxon's module-level formatter cache and moment-timezone's load-time work
// would both leak from one cell into the next and report the second cell as
// free. A fresh process per cell is the only arrangement in which "formatters
// constructed while setting up a column" means what it says.
//
// Usage: <engine> intl-probe.ts <variant> <zone> <fmt> <n> <base> <step>
// Prints one JSON object on stdout.

import { getTimeZoneAt } from "./easy-tz.ts";
import { installIntlCounter, installIntlPartsCounter, intlConstructCount, intlPartsCount } from "./intl-count.ts";
import { timeLoop } from "./kernel.ts";

// Before anything that formats. The easy-tz tables are forced first and
// separately: bringing them up builds a formatter or two of its own, and those
// belong to neither column — this process exists to count what the variant under
// test does.
getTimeZoneAt("UTC", 0);

installIntlCounter();
installIntlPartsCounter();

const [variant, zone, fmt, n, base, step] = process.argv.slice(2);

const { makeFormatter } = await import("./format-paths.ts");

const beforeSetup = intlConstructCount();
const format = makeFormatter(variant as never, zone!, fmt as never);
const setup = intlConstructCount() - beforeSetup;

const beforeLoop = intlConstructCount();
const beforeParts = intlPartsCount();
const values = Number(n);

const { checksum } = timeLoop((ts) => format(ts).length, Number(base), Number(step), values);

if (checksum < 0) {
  throw new Error("unreachable");
}

console.log(
  JSON.stringify({
    setup,
    perValueConstructs: (intlConstructCount() - beforeLoop) / values,
    perValueParts: (intlPartsCount() - beforeParts) / values,
  })
);
