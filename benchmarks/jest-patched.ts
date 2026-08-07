import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { patchedEntry, patchKeys, patchLetter } from "./lib/patches.ts";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const require = createRequire(new URL("package.json", root));
const entry = fileURLToPath(await patchedEntry(patchKeys));
const patchedSrc = dirname(entry);
const patchedSrcRelative = relative(rootPath, patchedSrc).split(sep).join("/");
const letters = patchKeys.map((key) => patchLetter.get(key)).join("");
const jestScript = fileURLToPath(new URL("../scripts/jest", import.meta.url));

let babelJest: string;

try {
  require.resolve("jest/bin/jest");
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

const result = spawnSync("sh", [jestScript, "--config", JSON.stringify(config), ...process.argv.slice(2)], {
  cwd: rootPath,
  env: {
    ...process.env,
    PATH: `${join(rootPath, "node_modules/.bin")}${delimiter}${process.env["PATH"] ?? ""}`,
  },
  stdio: "inherit",
});

if (result.error !== undefined) throw result.error;
if (result.signal !== null) throw new Error(`Jest exited on ${result.signal}`);

process.exitCode = result.status ?? 1;
