// A strict unified-diff applier, for the patch files in benchmarks/patches.
//
// Not `git apply`, and deliberately not a fuzzy one either. Hunks are located by
// searching for their context, not by trusting their line numbers, because the
// patches are independently selectable: a run may apply D and L but not the ten
// between them, and every patch ahead of one in the same file has already moved
// its lines. What is kept from `git apply` is the strictness — a hunk whose
// context does not appear EXACTLY once fails the run rather than landing
// somewhere plausible. That is the property the whole harness rests on, since a
// patch that silently applied to the wrong place, or not at all, would be
// measured as a result.

export interface FileDiff {
  path: string;
  hunks: Hunk[];
}

interface Hunk {
  /** context + removed lines, i.e. what the file must look like now */
  before: string[];
  /** context + added lines, i.e. what it should look like after */
  after: string[];
  /** the @@ header, for error messages */
  at: string;
}

/**
 * Everything before the first `diff --git`/`---` is prose, which is where each
 * patch file explains itself. Skipped here, parsed for metadata in patches.ts.
 */
export function parseDiff(text: string): FileDiff[] {
  // the file's own trailing newline is not a line of the last hunk
  const lines = text.replace(/\n$/, '').split('\n');
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const path = lines[i + 1]!.slice(4).replace(/^b\//, '');
      files.push((file = { path, hunks: [] }));
      hunk = null;
      i++;
      continue;
    }

    if (file === null) continue;

    if (line.startsWith('@@')) {
      file.hunks.push((hunk = { before: [], after: [], at: line }));
      continue;
    }

    if (hunk === null) continue;

    // luxon's sources all end in a newline, so this marker should never appear;
    // if it ever does, silently dropping it would corrupt the file
    if (line.startsWith('\\')) {
      throw new Error(`unsupported "${line.trim()}" in ${file.path}`);
    }

    const body = line.slice(1);

    if (line.startsWith(' ')) {
      hunk.before.push(body);
      hunk.after.push(body);
    } else if (line.startsWith('-')) {
      hunk.before.push(body);
    } else if (line.startsWith('+')) {
      hunk.after.push(body);
    } else if (line === '') {
      // An empty context line is a single space, which anything that trims
      // trailing whitespace will eat. .editorconfig exempts *.patch for exactly
      // that reason, but tolerate it here rather than fail a run over an editor
      // setting — an empty line means the same thing either way.
      hunk.before.push('');
      hunk.after.push('');
    } else {
      // "diff --git", "index", "new file mode", or trailing prose
      hunk = null;
      if (!line.startsWith('diff --git')) file = null;
    }
  }

  return files;
}

function indexOfBlock(haystack: string[], needle: string[], from: number): number[] {
  const hits: number[] = [];

  outer: for (let i = from; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    hits.push(i);
  }

  return hits;
}

/**
 * Applies one file's hunks. Each hunk is searched for from the end of the
 * previous one, so hunks stay in the order the diff lists them (which is file
 * order) and a repeated fragment further down can't capture an earlier hunk.
 */
export function applyFileDiff(source: string, diff: FileDiff, label: string): string {
  const lines = source.split('\n');
  let cursor = 0;

  for (const [n, hunk] of diff.hunks.entries()) {
    const hits = indexOfBlock(lines, hunk.before, cursor);

    if (hits.length !== 1) {
      throw new Error(
        `${label}: hunk ${n + 1}/${diff.hunks.length} of ${diff.path} matched ${hits.length} times, expected 1.\n` +
          `  ${hunk.at}\n` +
          `  luxon's source moved, or a patch applied before this one disturbed it — ` +
          `update benchmarks/patches/.\n` +
          `  looking for:\n` +
          hunk.before
            .slice(0, 6)
            .map((l) => `    | ${l}`)
            .join('\n')
      );
    }

    const at = hits[0]!;
    lines.splice(at, hunk.before.length, ...hunk.after);
    cursor = at + hunk.after.length;
  }

  return lines.join('\n');
}
