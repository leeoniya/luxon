import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { patchedEntry, patchKeys, patchLetter } from "./lib/patches.ts";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const require = createRequire(new URL("package.json", root));
const entry = fileURLToPath(await patchedEntry(patchKeys));
const patchedSrc = dirname(entry);
const patchedSrcRelative = relative(rootPath, patchedSrc).split(sep).join("/");
const letters = patchKeys.map((key) => patchLetter.get(key)).join("");

let jest: string;
let babelJest: string;

try {
  jest = require.resolve("jest/bin/jest");
  babelJest = require.resolve("babel-jest");
} catch {
  throw new Error("the root Jest dependencies are not installed; restore them before running test:patched");
}

const config = {
  rootDir: rootPath,
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  coverageDirectory: "<rootDir>/build/coverage-patched",
  collectCoverageFrom: [`${patchedSrcRelative}/**/*.js`, `!${patchedSrcRelative}/zone.js`],
  transform: {
    "^.+\\.js$": babelJest,
  },
  setupFilesAfterEnv: ["<rootDir>/test/setupTests.js"],
  moduleNameMapper: {
    "^(?:\\.\\./)+src/(.*)$": join(patchedSrc, "$1"),
  },
};

console.log(`running the native Jest suite against fully patched Luxon (${letters})`);

const result = spawnSync(process.execPath, [jest, "--config", JSON.stringify(config), ...process.argv.slice(2)], {
  cwd: rootPath,
  env: {
    ...process.env,
    TZ: "America/New_York",
    NODE_ICU_DATA: fileURLToPath(new URL("node_modules/full-icu", root)),
    LANG: "en_US.utf8",
  },
  stdio: "inherit",
});

if (result.error !== undefined) throw result.error;
if (result.signal !== null) throw new Error(`Jest exited on ${result.signal}`);

process.exitCode = result.status ?? 1;
