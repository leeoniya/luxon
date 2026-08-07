// Command-line flags shared by the patch benchmarks.

/**
 * Whether the benches run their output-comparison sections as well as their
 * timings. Off by default: they cover ~460 zones and every patched formatting
 * path, and the answer does not move unless luxon's src, moment's tzdata, or the
 * host ICU changes. Cheap enough (~4s on top of format.ts's ~13s) that the reason
 * to keep it opt-in is the dev loop's latency rather than the cost itself.
 *
 * Worth running deliberately rather than never. format.ts's agreement tables are
 * what license the speed claims (a fast formatter that prints the wrong
 * abbreviation is not a result), and upstream.ts's parity scan is the only place
 * all seven candidate patches are checked for behavior preservation — the tests in
 * benchmarks/test/ cover just the four zone ones.
 */
export const withVerify: boolean = process.argv.includes("--verify");

/**
 * Which of benchmarks/upstream.ts's three tables to run, named after what each
 * answers: `patches` is the candidate list and what each costs in bytes,
 * `ladder` is what each rung is worth at writing and reading a date, and
 * `default` is what the ladder is worth with no zone named at all. Naming any
 * runs only those; naming none runs all three.
 *
 * They cost several seconds each and answer different questions, so iterating on
 * one — adding a patch and re-ranking it, say — should not pay for the others.
 */
/**
 * Patch letters to leave out of every build this run makes, as in `--drop G`
 * or `--drop CG`. Nothing is dropped by default.
 *
 * For asking what a patch is still worth once the rest of the set is in: the
 * ladder attributes each rung given everything above it, which answers what a
 * patch adds but not what would be lost by removing it, and those are different
 * questions whenever two patches overlap. G and I overlap by construction — I
 * subsumes two of G's formatter fast paths. The ladder can only ask the second
 * question of whichever patch it applies last, which is I, so this is how to ask
 * it of any of the others.
 *
 * A flag rather than deleting the patch file because the comparison worth having
 * is two runs on one host minutes apart, not a run today against a printout from
 * last week. Patches that others are written against cannot be dropped alone;
 * see droppedKeys in lib/patches.ts.
 */
export const droppedLetters: string = (() => {
  const at = process.argv.indexOf("--drop");

  return at === -1 ? "" : (process.argv[at + 1] ?? "").toUpperCase();
})();

const TABLES = ["patches", "ladder", "default"] as const;

export type Table = (typeof TABLES)[number];

const asked = TABLES.filter((t) => process.argv.includes(`--${t}`));

export const tables: ReadonlySet<Table> = new Set(asked.length > 0 ? asked : TABLES);

/** True when every table ran, i.e. the run is a complete report. */
export const allTables: boolean = asked.length === 0 || asked.length === TABLES.length;

/**
 * Whether benchmarks/upstream.ts reports each build's rss and
 * Intl.DateTimeFormat constructions (one subprocess per row, ~2.5s) as columns.
 * Off by default because the two columns earned less than the width they took:
 * the Intl counts collapse to 3 for every rung from A onward, which is one
 * sentence rather than a column, and under V8 the rungs differ in rss by less
 * than re-measuring one of them does, so the column invited conclusions it could
 * not support. Both are still worth asking for when a patch is supposed to change
 * what a build allocates or how many formatters it builds — patch A is the case
 * that showed up loudly (2,002 formatters for 2,000 values, down to 3) and future
 * cache patches are the same shape of claim.
 */
export const withFootprint: boolean = process.argv.includes("--footprint");

/**
 * How long to idle between one timed row and the next, in milliseconds.
 *
 * Every bench here is a few minutes of sustained load on a host that throttles
 * partway through, and the throttling is what a comparison across rows cannot
 * cancel: a row measured late is measured on a hotter machine than a row
 * measured early. Idling between them lets the host come back to a comparable
 * state, so what the rows differ by is the code rather than the order they ran
 * in.
 *
 * This replaces the control rows these tables used to carry, which measured the
 * same problem by adding to it — a control is a whole extra row of load, spent
 * establishing how much the load was distorting things.
 *
 * `--verify` turns it off by default: that run is for correctness, not for
 * comparing timing rows, and idling cannot strengthen its assertions. An
 * explicit `--cooldown` still wins when verified timings are wanted.
 *
 * `--cooldown 0` also turns it off directly, which is what to do when iterating
 * on a patch and comparing a run against itself rather than reading rows against
 * each other.
 */
export const cooldownMs: number = (() => {
  const at = process.argv.indexOf("--cooldown");

  if (at < 0) {
    return withVerify ? 0 : 15_000;
  }

  const given = Number(process.argv[at + 1]);

  if (!Number.isFinite(given) || given < 0) {
    throw new Error(`--cooldown wants a non-negative number of ms, got ${process.argv[at + 1] ?? "nothing"}`);
  }

  return given;
})();
