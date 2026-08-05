import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { patchedEntry, patchKeys, patchLetter } from "./lib/patches.ts";

const output = new URL("../dist/luxon-plaid.mjs", import.meta.url);
const outputPath = fileURLToPath(output);
const entryPath = fileURLToPath(await patchedEntry(patchKeys));
const bun = process.versions["bun"] === undefined ? "bun" : process.execPath;

await mkdir(dirname(outputPath), { recursive: true });
await promisify(execFile)(
  bun,
  [
    "build",
    entryPath,
    "--target=browser",
    "--format=esm",
    "--sourcemap=none",
    "--reject-unresolved",
    `--outfile=${outputPath}`,
  ],
  { maxBuffer: 1 << 24 }
);

const letters = patchKeys.map((key) => patchLetter.get(key)).join("");
const bytes = (await stat(output)).size.toLocaleString("en-US");

console.log(`built dist/luxon-plaid.mjs with patches ${letters} (${bytes} bytes)`);
