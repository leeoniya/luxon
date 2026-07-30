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
 * Which of benchmarks/upstream.ts's four tables to run, named after what each
 * answers: `patches` is the candidate list and what each costs in bytes, `format`
 * is writing a date (and the findings that rank the patches), `parse` is reading
 * one, and `default` is what the ladder is worth with no zone named at all.
 * Naming any runs only those; naming none runs all four.
 *
 * They cost several seconds each and answer different questions, so iterating on
 * one — adding a patch and re-ranking it, say — should not pay for the others.
 * The findings belong to `format`, since they rank patches by what they save on a
 * formatting path; the paragraph about reading dates appears only when `parse`
 * ran too, rather than quoting numbers this run did not measure.
 */
const TABLES = ["patches", "format", "parse", "default"] as const;

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
