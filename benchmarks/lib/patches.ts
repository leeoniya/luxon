// Loads the candidate upstream patches in benchmarks/patches and builds the
// luxon variants the benchmarks measure.
//
// A patch is a plain unified diff against src/, with a metadata header and the
// reasoning for it above the diff. They are files rather than string literals in
// a script so that they read as diffs — syntax-highlighted in a browser, usable
// with `git apply`, and filable upstream as they stand.
//
// A build is src/ copied to .tmp/builds/<id>/ with some subset of those diffs
// applied, imported straight from disk. No bundler and no build step: src/ is
// already ESM with fully-specified relative imports, so node and bun can both
// load it as it sits. Each distinct subset gets its own directory and therefore
// its own module instance, so one variant's internal caches can never warm
// another's.
//
// Every patch here is pure memoization or a provable short-circuit: no API
// changes, no behavior changes. benchmarks/upstream.ts verifies that by diffing
// output against stock, and benchmarks/suite.ts checks 29 more API paths by
// comparing each case's result across builds.

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { applyFileDiff, parseDiff, type FileDiff } from "./diff.ts";
import type { LuxonModule } from "./luxon-types.ts";

export type { LuxonModule };

/**
 * Not a union type: the set lives in benchmarks/patches, and a union here would
 * be a second copy of it that could disagree. `patchKey()` below is how a
 * literal in a bench gets checked against what is actually on disk.
 */
export type PatchKey = string;

export interface Patch {
  key: PatchKey;
  /** A-H, its position in apply order; what the report tables label it */
  letter: string;
  /** one-line summary for report tables */
  what: string;
  /** patches whose text this one's diff is written against */
  needs: PatchKey[];
  /** the reasoning, as it appears above the diff in the patch file */
  prose: string;
  file: string;
  diffs: FileDiff[];
}

const SRC = new URL("../../src/", import.meta.url);
const PATCH_DIR = new URL("../patches/", import.meta.url);
// under benchmarks/ rather than the repo root so that node, bun and `bun build`
// all resolve benchmarks/node_modules from a generated entry — the rows that
// size what a build ships import moment-timezone from one
const OUT_DIR = new URL("../.tmp/builds/", import.meta.url);

// ---- reading the patch files ----------------------------------------------

function parseHeader(text: string, file: string) {
  const head = text.split(/^diff --git |^--- /m)[0] ?? "";
  const field = (name: string) => {
    const m = new RegExp(`^${name}: (.*)$`, "m").exec(head);
    if (m === null) throw new Error(`${file}: missing "${name}:" header`);
    return m[1]!.trim();
  };

  const requires = field("Requires");

  return {
    key: field("Patch"),
    letter: field("Letter"),
    what: field("Summary"),
    // "B (offsetScan), E (zoneNameScan)" -> the keys in the parens
    needs: requires === "none" ? [] : [...requires.matchAll(/\((\w+)\)/g)].map((m) => m[1]!),
    prose: head.slice(head.indexOf("Summary:")).split("\n").slice(2).join("\n").trim(),
  };
}

async function readPatches(): Promise<Patch[]> {
  // numeric filename prefixes ARE the apply order, and several patches are only
  // meaningful in it (D's diff is written against A's output, E's against B's and D's)
  const names = (await readdir(PATCH_DIR)).filter((n) => n.endsWith(".patch")).sort();

  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(new URL(name, PATCH_DIR), "utf8");
      const diffs = parseDiff(text);

      if (diffs.length === 0) throw new Error(`${name}: no diff found`);

      return { ...parseHeader(text, name), file: name, diffs };
    })
  );
}

const PATCHES = await readPatches();

const byKey = new Map(PATCHES.map((p) => [p.key, p]));

/** Every patch, in apply order — which is also the order the reports letter them in. */
export const patchKeys: readonly PatchKey[] = PATCHES.map((p) => p.key);

export const patchLetter = new Map(PATCHES.map((p) => [p.key, p.letter]));
export const patchWhat = new Map(PATCHES.map((p) => [p.key, p.what]));
export const patchProse = new Map(PATCHES.map((p) => [p.key, p.prose]));

/**
 * Patches that have to be applied before this one, because its diff is written
 * against text they introduce. D needs A, and E needs B and D — so those are
 * only ever measurable together.
 */
export const patchNeeds = new Map(PATCHES.map((p) => [p.key, p.needs]));

for (const p of PATCHES) {
  for (const n of p.needs) {
    if (!byKey.has(n)) throw new Error(`${p.file}: requires unknown patch "${n}"`);
  }
}

if (new Set(PATCHES.map((p) => p.letter)).size !== PATCHES.length) {
  throw new Error("two patches in benchmarks/patches claim the same letter");
}

/** A patch key, checked against what is on disk — for literals in bench scripts. */
export function patchKey(name: string): PatchKey {
  if (!byKey.has(name)) {
    throw new Error(`no patch named "${name}" in benchmarks/patches (have: ${patchKeys.join(", ")})`);
  }

  return name;
}

/** The given patches plus everything they require, in apply order. */
export function withNeeds(keys: readonly PatchKey[]): PatchKey[] {
  const want = new Set<PatchKey>();

  const add = (k: PatchKey) => {
    if (want.has(k)) return;
    for (const n of byKey.get(patchKey(k))!.needs) add(n);
    want.add(k);
  };

  for (const k of keys) add(k);

  return patchKeys.filter((k) => want.has(k));
}

// ---- building ---------------------------------------------------------------

/** Stable name for a patch set, so its artifacts can be found on disk again. */
export const setId = (keys: readonly PatchKey[]) => (keys.length === 0 ? "stock" : [...keys].sort().join("+"));

const instanceId = (id: string, copy: number) => (copy === 0 ? id : `${id}~${copy}`);

const loaded = new Map<string, Promise<LuxonModule>>();
const written = new Map<string, Promise<URL>>();
const sized = new Map<string, Promise<number>>();

/**
 * A luxon module instance with the given patches applied.
 *
 * `copy` asks for an additional instance of the SAME source, written to its own
 * directory so both engines really load it twice. Nothing here asks for one now:
 * it existed for the control columns, and those are gone — a control was a whole
 * extra column of load spent measuring how much the load was distorting things,
 * and the noise floor is read off the passes each cell already runs instead (see
 * `spread` in kernel.ts).
 *
 * Kept because it is the only way to get the measurement a control was for. One
 * instance timed twice reports ambient noise alone, whereas two instances of
 * identical source also carry whatever a second module costs — separate inline
 * caches, separate code objects, a different place in the heap — which is the
 * part of a build-to-build difference that no patch explains.
 */
export function loadLuxon(keys: readonly PatchKey[], copy = 0): Promise<LuxonModule> {
  const id = instanceId(setId(keys), copy);
  let mod = loaded.get(id);

  if (mod === undefined) {
    loaded.set(
      id,
      (mod = patchedEntry(keys, copy).then((entry) => import(entry.href) as Promise<LuxonModule>))
    );
  }

  return mod;
}

/** The entry point of a patched src tree on disk. Written once per set (and copy) per process. */
export function patchedEntry(keys: readonly PatchKey[], copy = 0): Promise<URL> {
  const id = instanceId(setId(keys), copy);
  let file = written.get(id);

  if (file === undefined) {
    written.set(id, (file = writeBuild(id, keys)));
  }

  return file;
}

async function srcFiles(dir = SRC, prefix = ""): Promise<string[]> {
  const out: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out.push(...(await srcFiles(new URL(rel + "/", SRC), rel + "/")));
    else out.push(rel);
  }

  return out;
}

async function writeBuild(id: string, keys: readonly PatchKey[]): Promise<URL> {
  const tree = new Map<string, string>();

  for (const rel of await srcFiles()) {
    tree.set(`src/${rel}`, await readFile(new URL(rel, SRC), "utf8"));
  }

  for (const key of withNeeds(keys)) {
    const patch = byKey.get(key)!;

    for (const diff of patch.diffs) {
      const before = tree.get(diff.path);

      if (before === undefined) {
        throw new Error(`${patch.file} patches ${diff.path}, which is not in src/`);
      }

      tree.set(diff.path, applyFileDiff(before, diff, `${patch.file} (${patch.letter})`));
    }
  }

  const dir = new URL(`${id}/`, OUT_DIR);

  // `node --test` runs the test files in parallel processes, and they ask for
  // overlapping build ids, so several of them write this same tree at once. A
  // plain writeFile lets one process import a module another is halfway through
  // writing, which surfaces as a SyntaxError about a missing export. Writing
  // beside the target and renaming makes each file appear whole: rename is
  // atomic within a directory, and every writer is producing identical bytes
  // from the same src/ and patch files, so whichever lands last is still right.
  // The rebuild stays unconditional, which is what keeps an edited patch from
  // being read out of a stale build.
  for (const [rel, text] of tree) {
    const out = new URL(rel, dir);
    await mkdir(dirname(out.pathname), { recursive: true });

    const staging = new URL(`${rel}.${process.pid}.tmp`, dir);
    await writeFile(staging, text);
    await rename(staging, out);
  }

  return new URL("src/luxon.js", dir);
}

/**
 * Writes an extra entry alongside the builds, for sizing something that ships
 * more than luxon (see the bytes column in benchmarks/upstream.ts).
 */
export async function writeEntry(name: string, source: string): Promise<URL> {
  await mkdir(OUT_DIR.pathname, { recursive: true });

  const out = new URL(name, OUT_DIR);
  await writeFile(out, source);

  return out;
}

/**
 * Bytes an entry bundles and minifies to, so a patch's cost in shipped size can
 * be weighed against what it buys. Takes an entry rather than a patch set
 * because a row that binds easy-tz ships more than luxon, and what a build ships
 * is the question the column answers.
 *
 * Always bun's minifier, even when this file is running under node: the size is
 * a property of the code, and a benchmark that reported it differently per
 * engine would invite reading engine noise into it. No gzip.
 */
export function minifiedSize(entry: URL): Promise<number> {
  let size = sized.get(entry.pathname);

  if (size === undefined) {
    sized.set(entry.pathname, (size = minify(entry)));
  }

  return size;
}

async function minify(entry: URL): Promise<number> {
  // under node, process.execPath is node; bun runs the same scripts, so it is on
  // PATH either way
  const bun = process.versions["bun"] === undefined ? "bun" : process.execPath;
  const { stdout } = await promisify(execFile)(bun, ["build", entry.pathname, "--minify"], {
    maxBuffer: 1 << 24,
  });

  return Buffer.byteLength(stdout, "utf8");
}