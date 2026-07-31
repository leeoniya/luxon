// Runs benchmarks/upstream.ts under node and bun and diffs the two.
//
// Worth doing because the two engines do not agree about the small patches. Most
// of them trade an allocation or a dispatch for slightly more code, and whether
// that pays depends on the engine's escape analysis and inline caches rather
// than on anything in luxon. The large wins (A, C) hold everywhere; the rest need
// checking on both before being argued for upstream. V8 is the engine that
// matters most for luxon's users, but a patch that only helps V8 is a weaker
// pitch than one that helps both, and one that hurts JavaScriptCore is weaker
// still.
//
// The two runs are sequential, never concurrent — they would be timing each
// other's workload otherwise. Budget ~35 seconds of timing under each, plus that
// run's cooldown — which is most of the wall clock at the default five seconds a
// row, and which --cooldown is forwarded for. Neither run is given --verify:
// this compares timings across engines, and the parity scan is
// engine-independent.
//
// Run: node cross-engine.ts
//      node cross-engine.ts --cooldown 0   (fast, for iterating)

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { printTable } from "./lib/print-table.ts";

interface Run {
  runtime: string;
  icu: string | null;
  /** the ladder's row order, as upstream printed it */
  builds: string[];
  ms: Record<string, Record<string, number>>;
}

const BENCH = new URL("upstream.ts", import.meta.url).pathname;

// Forwarded rather than re-read, so the two spawned runs cool the same way this
// process was asked to. Both engines have to be measured under the same regime
// for the diff between them to mean anything.
const at = process.argv.indexOf("--cooldown");
const FORWARD = at < 0 ? [] : ["--cooldown", process.argv[at + 1]!];

/** returns an error message, or null if the run produced results */
function run(exe: string): string | null {
  const started = Date.now();

  process.stdout.write(`running ${exe}... `);

  const proc = spawnSync(exe, [BENCH, ...FORWARD], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  if (proc.error !== undefined) {
    console.log("not available");

    return `${exe} could not be started (${proc.error.message})`;
  }

  if (proc.status !== 0) {
    console.log("failed");

    const output = (proc.stderr || proc.stdout || "").trim().split("\n").slice(-8).join("\n");

    return `${exe} exited ${proc.status}:\n${output}`;
  }

  console.log(`${((Date.now() - started) / 1000).toFixed(0)}s`);

  return null;
}

const failures = ["node", "bun"].map(run).filter((e): e is string => e !== null);

async function load(tag: string): Promise<Run | null> {
  try {
    return JSON.parse(await readFile(new URL(`.tmp/upstream-${tag}.json`, import.meta.url), "utf8")) as Run;
  } catch {
    return null;
  }
}

const v8 = await load("node");
const jsc = await load("bun");

if (v8 === null || jsc === null) {
  console.error(`\nneed both runs to compare.\n${failures.join("\n") || "missing results file"}`);
  process.exit(1);
}

console.log(`\nV8:  ${v8.runtime}, ICU ${v8.icu ?? "?"}`);
console.log(`JSC: ${jsc.runtime}, ICU ${jsc.icu ?? "?"}`);

// A per-patch table used to sit here: what each patch on its own saved against
// the unpatched easy-tz zone, per engine, with a verdict column. It is gone with
// the builds behind it. Each of those was a row of its own in upstream's format
// table — measured, cooled, and never printed there — to rank patches that the
// ladder below already ranks one at a time. Half of them had also stopped being
// read: the ids here were written before the patches were re-lettered and had
// been silently matching nothing since.
//
// Taken from the run rather than named here or pattern-matched out of the
// results. Naming them here is what went stale last time; matching them by
// prefix would have gone stale the moment a rung was called something else. The
// run knows what it printed, so it says so.
//
// moment is the denominator of every ratio, so it is the one row with no row of
// its own.
const ROWS = v8.builds.filter((id) => id !== "moment");

const disagree = v8.builds.join("|") !== jsc.builds.join("|");

if (disagree) {
  console.error(`\nthe two runs measured different builds, so they cannot be compared row by row:`);
  console.error(`  node: ${v8.builds.join(", ")}`);
  console.error(`  bun:  ${jsc.builds.join(", ")}`);
  process.exit(1);
}

console.log("\nratios vs moment-timezone, per engine\n");

printTable(
  ["build", "V8 numeric", "JSC numeric", "V8 abbr", "JSC abbr"],
  ROWS.map((path) => {
    const ratio = (engine: Run, fmt: string) => `${(engine.ms[fmt]![path]! / engine.ms[fmt]!["moment"]!).toFixed(2)}x`;

    return [path, ratio(v8, "numeric"), ratio(jsc, "numeric"), ratio(v8, "abbr"), ratio(jsc, "abbr")];
  })
);

console.log(`\nwhat this means: benchmarks/docs/cross-engine.md`);
