// printTable's streaming sibling: prints the header immediately and then one row
// at a time, for tables whose rows take seconds each to measure.
//
// Why it exists: with a cooldown between rows a full table takes minutes, and a
// table that appears all at once at the end is a table nobody watches. Streaming
// also means a run interrupted halfway has still reported every row it finished,
// which is what makes a long bench usable at all.
//
// The cost is that column widths cannot be measured from the data, since the data
// does not exist yet. They come from the headers instead, widened by a caller's
// hint where a column is known to hold values longer than its own name. A cell
// that overflows its column is printed in full rather than truncated — it pushes
// that one row out of alignment, and a wrong number is worse than a ragged line.
//
// Overflow is reported to stderr the first time it happens, once per table. A
// right-aligned column narrower than its contents does not right-align: padStart
// on a string already past the width is a no-op, so the column silently stops
// being a column. That is easy to miss in a long table and easy to fix once
// seen, which is exactly the case for a warning rather than a throw — these run
// for minutes and should not die on a cosmetic problem at row 20.
//
// Cells arrive already shaded (see lib/color.ts), so widths are counted with the
// escapes discounted and the padding is done by hand. padStart and padEnd count
// the escapes, which would pull every coloured column several characters out of
// true — and only when the output is a terminal, i.e. never in a redirected run
// anyone might diff.

import { visibleWidth } from "./color.ts";

export interface StreamTableOpts {
  /** title spanning the full table width */
  title?: string;
  /** columns to left-align, beyond column 0 which always is */
  leftCols?: readonly number[];
  /** per-column minimum width, by index, for columns whose values outgrow their header */
  minWidths?: Readonly<Record<number, number>>;
  /** centered headings spanning adjacent columns, indexed across the full table */
  groups?: readonly { label: string; start: number; span: number }[];
}

export interface StreamTable {
  /** print one row */
  row: (cells: string[]) => void;
  /** a horizontal rule between groups of rows, matching printTable's null row */
  rule: () => void;
}

/** Prints the header and returns the handle rows are fed to. */
export function streamTable(headers: string[], opts: StreamTableOpts = {}): StreamTable {
  const min = opts.minWidths ?? {};
  const widths = headers.map((h, i) => Math.max(h.length, min[i] ?? 0));
  const leftCols = new Set(opts.leftCols ?? []);
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  let warned = false;

  const line = (cells: string[]) =>
    cells
      .map((v, i) => {
        const width = widths[i]!;
        const shown = visibleWidth(v);

        if (shown > width && !warned) {
          warned = true;
          console.error(
            `note: "${v}" is wider than the ${width}-wide "${headers[i]}" column, so that column is no longer aligned` +
              ` — raise its minWidth`
          );
        }

        const gap = " ".repeat(Math.max(0, width - shown));

        return i === 0 || leftCols.has(i) ? v + gap : gap + v;
      })
      .join("  ")
      .trimEnd();

  if (opts.title !== undefined) {
    const title = `${"-".repeat(5)} ${opts.title} `;
    console.log(title + "-".repeat(Math.max(0, separator.length - title.length)));
  }

  if (opts.groups !== undefined && opts.groups.length > 0) {
    const groups = new Map(opts.groups.map((group) => [group.start, group]));
    const cells: string[] = [];

    for (let i = 0; i < widths.length; ) {
      const group = groups.get(i);

      if (group === undefined) {
        cells.push(" ".repeat(widths[i]!));
        i++;
        continue;
      }

      const width = widths.slice(i, i + group.span).reduce((sum, w) => sum + w, 2 * (group.span - 1));
      const title = ` ${group.label} `;
      const left = Math.max(0, Math.floor((width - title.length) / 2));
      cells.push("-".repeat(left) + title + "-".repeat(Math.max(0, width - left - title.length)));
      i += group.span;
    }

    console.log(cells.join("  ").trimEnd());
  }

  console.log(line(headers));
  console.log(separator);

  return {
    row: (cells) => console.log(line(cells)),
    rule: () => console.log(separator),
  };
}
