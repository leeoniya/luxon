import { Bench } from "tinybench";

// Shared runner for luxon's own benchmark suites, which used to be built on
// benchmark.js. tinybench replaces it: benchmark.js is unmaintained, pulls in
// lodash, and needs a `Function`-constructor compile step per case that modern
// runtimes and CSP-constrained environments increasingly object to.
//
// The reporting line is kept in benchmark.js's shape on purpose — these numbers
// get pasted into issues and compared against older runs, and a familiar line is
// worth more than a prettier one.

// benchmark.js sized each cycle adaptively and stopped at 5s per case, which put
// a full run of datetime.js past a minute. These are the same trade made
// explicitly: enough samples for the rme to settle, in a fraction of the time.
const DEFAULTS = { iterations: 16, time: 500, warmupIterations: 8, warmupTime: 100 };

/**
 * @param {string} name
 * @param {(bench: Bench) => void} define adds the cases, as `.add(name, fn)`
 */
export async function runSuite(name, define) {
  const bench = new Bench({ name, ...DEFAULTS });

  define(bench);

  await bench.run();

  report(bench);
}

function report(bench) {
  const failed = bench.tasks.filter((t) => t.result?.state === "errored");

  if (failed.length > 0) {
    throw failed[0].result.error;
  }

  for (const task of bench.tasks) {
    const { throughput, latency } = task.result;

    console.log(
      `${task.name} x ${Math.round(throughput.mean).toLocaleString("en-US")} ops/sec ` +
        `±${throughput.rme.toFixed(2)}% (${latency.samplesCount} samples)`
    );
  }

  const best = Math.max(...bench.tasks.map((t) => t.result.throughput.mean));
  const fastest = bench.tasks.filter((t) => t.result.throughput.mean === best).map((t) => t.name);

  console.log(`Fastest is ${fastest.join(", ")}\n`);
}
