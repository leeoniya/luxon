/**
 * Breaks a patch on purpose, one edit at a time, and reports what its tests do
 * about it.
 *
 * Two things come out of a run. The first is the obvious one: a mutation nothing
 * catches is a hole, unless the catalog says why it cannot be caught. The second
 * is the reason this prints failures rather than counting them — the case that
 * fails first IS the discriminating case, and those are what a fixture set is
 * built from. A sweep of two million comparisons and a fixture of forty are worth
 * the same thing if the forty are the ones that fail here.
 *
 * Run: node mutate.ts                      (every catalog)
 *      node mutate.ts --patch 08-arith-direct
 *      node mutate.ts --only "fast path"   (substring of the mutation name)
 *      node mutate.ts --witness            (print the failing case, not just the verdict)
 *
 * The patch file is edited in place and restored after each run, including on a
 * crash or a Ctrl-C. Nothing else writes there, so a stale mutation left behind
 * would be silent — hence the restore is verified rather than assumed.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { argv, exit } from "node:process";
import type { MutationSet } from "./lib/mutations.ts";

const arg = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const onlyPatch = arg("patch");
const onlyName = arg("only");
const showWitness = argv.includes("--witness");

/**
 * Run something other than the catalog's own tests. This is how a fixture set
 * earns the right to replace a sweep: point the same mutations at the smaller
 * file and it has to kill at least as many.
 */
const overrideTests = arg("tests");

const CATALOG_DIR = new URL("./mutations/", import.meta.url);
const PATCH_DIR = new URL("./patches/", import.meta.url);

// A mutated `plus` that stops advancing turns Interval#splitBy into an append
// loop that only ends when the machine is out of memory, which is how a mutation
// run takes a workstation down rather than reporting a survivor. Both caps are
// here so that shape of failure arrives as a failure.
const HEAP_MB = 512;
const TIMEOUT_MS = 180_000;

interface Verdict {
  name: string;
  caught: boolean;
  expected: string | undefined;
  witness: string[] | null;
}

/**
 * The first failing case, dug out of node's test output.
 *
 * The sweeps all pass an assertion message naming the case — the zone, the
 * instant, the units — so what comes back is a case description and the two
 * values that disagreed, which is everything a fixture needs. Read from the
 * failing-tests section at the end rather than the live log, because that
 * section is ordered and the live one interleaves parallel suites.
 */
function witnessFrom(output: string): string[] | null {
  const at = output.indexOf("failing tests:");
  if (at === -1) return null;

  const tail = output.slice(at);
  const first = (re: RegExp) => re.exec(tail)?.[1]?.trim() ?? null;

  const message = first(/^\s*AssertionError \[ERR_ASSERTION\]: (.+)$/m);
  if (message === null) return null;

  const test = first(/^✖ (.+?) \(\d/m);
  const actual = first(/^\s*actual: (.+?),?$/m);
  const expected = first(/^\s*expected: (.+?),?$/m);

  return [
    test === null ? message : `${test} > ${message}`,
    ...(actual === null || expected === null ? [] : [`expected ${expected}, got ${actual}`]),
  ];
}

function run(tests: string[]): { caught: boolean; output: string } {
  for (const test of tests) {
    const r = spawnSync(
      process.execPath,
      [`--max-old-space-size=${HEAP_MB}`, "--test", test],
      { encoding: "utf8", timeout: TIMEOUT_MS, cwd: new URL(".", import.meta.url).pathname }
    );

    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;

    // a timeout kills the child, which is a catch: the mutation made the tests
    // stop finishing, which is a failure however it is spelled
    if (r.status !== 0 || r.signal !== null) return { caught: true, output };
  }

  return { caught: false, output: "" };
}

async function catalogs(): Promise<MutationSet[]> {
  const names = (await readdir(CATALOG_DIR)).filter((n) => n.endsWith(".ts")).sort();
  const out: MutationSet[] = [];

  for (const name of names) {
    const mod = (await import(new URL(name, CATALOG_DIR).href)) as { default: MutationSet };
    if (onlyPatch === null || mod.default.patch.startsWith(onlyPatch)) out.push(mod.default);
  }

  return out;
}

let holes = 0;
let stale = 0;

for (const set of await catalogs()) {
  if (overrideTests !== null) set.tests = overrideTests.split(",");

  const path = new URL(set.patch, PATCH_DIR).pathname;
  const original = readFileSync(path, "utf8");
  const restore = () => writeFileSync(path, original);

  process.on("exit", restore);
  process.on("SIGINT", () => (restore(), exit(130)));

  const chosen = set.mutations.filter((m) => onlyName === null || m.name.includes(onlyName));

  console.log(`\n${set.patch} — ${chosen.length} mutation(s), caught by ${set.tests.join(", ")}\n`);

  const verdicts: Verdict[] = [];

  for (const m of chosen) {
    const hits = original.split(m.find).length - 1;

    if (hits !== 1) {
      throw new Error(
        `${set.patch}: anchor for "${m.name}" appears ${hits} times, expected 1:\n  ${m.find.split("\n")[0]}`
      );
    }

    writeFileSync(path, original.replace(m.find, m.replace));

    try {
      const { caught, output } = run(set.tests);
      verdicts.push({ name: m.name, caught, expected: m.survives, witness: witnessFrom(output) });
    } finally {
      restore();
    }

    const v = verdicts.at(-1)!;
    const ok = v.caught === (m.survives === undefined);
    const verdict = v.caught ? "caught  " : "SURVIVED";

    console.log(`  ${ok ? " " : "!"} ${verdict}  ${m.name}`);

    if (!v.caught && m.survives === undefined) holes++;
    if (v.caught && m.survives !== undefined) stale++;

    if (showWitness && v.witness !== null) {
      for (const line of v.witness) console.log(`                 ${line}`);
    }
  }

  if (readFileSync(path, "utf8") !== original) {
    throw new Error(`${set.patch} was left mutated`);
  }

  const survivors = verdicts.filter((v) => !v.caught);

  console.log(
    `\n  ${verdicts.length - survivors.length}/${verdicts.length} caught, ` +
      `${survivors.length} survived (${survivors.filter((v) => v.expected !== undefined).length} argued)`
  );
}

if (holes > 0 || stale > 0) {
  console.log(
    `\n${holes} mutation(s) survived with no argument for why, ` +
      `${stale} argued survivor(s) were caught after all.`
  );
  exit(1);
}
