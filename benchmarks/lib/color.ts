// Shades a timing by how it compares to the baseline in its own table, so a
// table of several hundred numbers can be read at a glance before it is read at
// a number.
//
// The encoding: the baseline cell keeps the terminal's own colour, cells faster
// than it go green, cells slower go red, and the further either way the more
// saturated. That makes the baseline a visible seam down the table rather than
// just another row of digits, which is the comparison every one of these tables
// is actually for.
//
// Nothing here changes what is printed when the output is not a terminal, so
// piping to a file or into another process gets the same plain text it always
// did. That matters beyond tidiness: benchmarks/cross-engine.ts spawns these
// benches and reads what they write.

/**
 * Ratios span a very wide range here — a patched build can be a fifth of
 * moment's time and stock luxon twenty times it — so the scale is logarithmic.
 * On a linear one everything faster than the baseline would crowd into the
 * bottom of the range and be one indistinguishable shade.
 */
const STEPS = [0.15, 0.5, 1, 2];

/**
 * Below this the cell is left alone. Roughly a tenth, which is the neighbourhood
 * of these benches' own noise floors — colouring a difference smaller than the
 * table can resolve would be inventing a result. The floors are per column and
 * measured, and this is neither, so it is deliberately the looser of the two:
 * a cell that clears this can still be inside its column's floor, and the floors
 * printed under each table remain the thing to read a margin against.
 */
const DEAD = STEPS[0]!;

// Two ramps built the same way, so neither side reads as louder than the other:
// one channel held at 4 and the other two walked 3-2-1-0 towards it. Mid
// saturation on purpose — the palest shades of the 256-colour cube vanish on a
// light terminal and the most vivid ones are hard to read on a dark one.
const FASTER = [151, 114, 77, 40];
const SLOWER = [181, 174, 167, 160];

/**
 * Whether to emit colour at all. NO_COLOR and FORCE_COLOR are the de-facto
 * standard pair (no-color.org); the TTY check is what keeps redirected output
 * clean without anyone having to remember a flag.
 *
 * FORCE_COLOR is read before NO_COLOR because that is the precedence node itself
 * applies, and a bench disagreeing with its own runtime about which of the two
 * wins is a good way to spend an afternoon. An explicit ask beats a blanket
 * preference either way.
 */
export const colorEnabled: boolean = (() => {
  if (process.argv.includes("--no-color")) return false;

  const env = process.env;
  const forced = env["FORCE_COLOR"];

  if (forced !== undefined && forced !== "0") return true;
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  if (env["TERM"] === "dumb") return false;

  return process.stdout.isTTY === true;
})();

/**
 * `text` shaded by how `value` compares to `anchor`, both in the same units.
 *
 * A missing or nonsensical anchor leaves the text alone rather than guessing,
 * which is what a cell with no baseline to compare against should look like.
 */
export function shade(text: string, value: number, anchor: number | undefined): string {
  if (!colorEnabled || anchor === undefined || !(anchor > 0) || !(value > 0)) return text;

  const d = Math.log2(value / anchor);
  const magnitude = Math.abs(d);

  if (magnitude < DEAD) return text;

  let step = 0;

  while (step < STEPS.length - 1 && magnitude >= STEPS[step + 1]!) step++;

  return `\u001b[38;5;${(d < 0 ? FASTER : SLOWER)[step]!}m${text}\u001b[0m`;
}

/** Printable width, i.e. ignoring the escapes `shade` may have wrapped a cell in. */
export function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

/**
 * One line naming what the colours mean, for the foot of a table that uses them.
 * Empty when nothing was coloured, so a redirected run does not explain an
 * encoding it did not use.
 *
 * `fallback` is for tables whose baseline row cannot answer every column: naming
 * it matters, because a reader with no way to tell which baseline a cell was
 * shaded against cannot read the colour at all. It goes in its own sentence
 * rather than as a clause on the first, which put it between "green faster
 * than" and "red slower".
 */
export function colorLegend(baseline: string, fallback?: string): string {
  if (!colorEnabled) return "";

  const dead = Math.round((2 ** DEAD - 1) * 100);

  return (
    `colour: green faster than the baseline, red slower, both by log scale; within ${dead}% left plain.\n` +
    `baseline: ${baseline}${fallback === undefined ? "" : `, and ${fallback}`}.`
  );
}
