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
 * of these benches' own noise floors — colouring smaller differences would make
 * noise look significant.
 */
const DEAD = STEPS[0]!;

// Two ramps built the same way, so neither side reads as louder than the other:
// one channel held at 4 and the other two walked 3-2-1-0 towards it. Mid
// saturation on purpose — the palest shades of the 256-colour cube vanish on a
// light terminal and the most vivid ones are hard to read on a dark one.
const FASTER = [151, 114, 77, 40];
const SLOWER = [181, 174, 167, 160];

function shadeColor(value: number, anchor: number | undefined): number | undefined {
  if (anchor === undefined || !(anchor > 0) || !(value > 0)) return undefined;

  const d = Math.log2(value / anchor);
  const magnitude = Math.abs(d);

  if (magnitude < DEAD) return undefined;

  let step = 0;

  while (step < STEPS.length - 1 && magnitude >= STEPS[step + 1]!) step++;

  return (d < 0 ? FASTER : SLOWER)[step]!;
}

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
export function shade(
  text: string,
  value: number,
  anchor: number | undefined,
  enabled = colorEnabled
): string {
  if (!enabled) return text;

  const color = shadeColor(value, anchor);

  return color === undefined ? text : `\u001b[38;5;${color}m${text}\u001b[0m`;
}

/**
 * Underlines a patch rung when it differs significantly from the rung above it
 * but remains in the same baseline-relative colour bucket.
 *
 * `relativeFloor` is the measured within-cell spread (0.1 means 10%). It can
 * widen, but never narrow, the default 10% deadband so noise does not acquire a
 * mark merely because two independently noisy rows happened to separate.
 *
 * `text` may already carry one of `shade`'s colour escapes. In that case the
 * underline joins the same SGR sequence.
 */
export function underlineSignificantStep(
  text: string,
  value: number,
  previous: number | undefined,
  anchor: number | undefined,
  relativeFloor: number,
  enabled = colorEnabled
): string {
  if (!enabled || previous === undefined || !(previous > 0) || !(value > 0)) return text;

  const measuredDead =
    Number.isFinite(relativeFloor) && relativeFloor > 0 ? Math.log2(1 + relativeFloor) : 0;
  const change = Math.log2(value / previous);
  const magnitude = Math.abs(change);

  // Crossing a rendered digit boundary is already conspicuous and an underline
  // would make the columns jump horizontally. Timings are printed to one
  // decimal place throughout the ladder.
  if (stripColor(text).length !== previous.toFixed(1).length) return text;
  // Tiny absolute movements in otherwise cheap cells are dominated by thermal
  // variation even when their ratio looks large.
  if (Math.abs(value - previous) <= 1.5) return text;
  if (magnitude < Math.max(Math.log2(1.1), measuredDead)) return text;
  if (shadeColor(value, anchor) !== shadeColor(previous, anchor)) return text;

  if (text.startsWith("\u001b[38;5;")) return text.replace("\u001b[38;5;", "\u001b[4;38;5;");

  return `\u001b[4m${text}\u001b[0m`;
}

/** Removes terminal styling for redirected output and width measurement. */
export function stripColor(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Printable width, i.e. ignoring the escapes `shade` may have wrapped a cell in. */
export function visibleWidth(text: string): number {
  return stripColor(text).length;
}
