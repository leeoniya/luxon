// Resolving "something changed between these two samples" into exact steps.
//
// The parity checks in benchmarks/format.ts and benchmarks/test/*.test.ts ask the
// same shape of question: over some window of instants, at how many of them do
// two implementations disagree? Answering by evaluating every instant is
// straightforward and slow. Answering by scanning is neither, but it is a lot
// faster, and it is exact for the reason spelled out below.
//
// Ported from easy-tz's tools/step-scan.ts, where the same walk pins zone
// transitions to the sample they happen on.

/**
 * Sampling positions for a fixed stride, always ending on `lastStep` so a change
 * in the final partial window is still bracketed. `stride` is in steps.
 */
export function strideSteps(lastStep: number, stride: number): number[] {
  const out: number[] = [];

  for (let step = stride; step < lastStep; step += stride) {
    out.push(step);
  }

  out.push(lastStep);

  return out;
}

/**
 * Samples `valueAt` at each checkpoint (ascending step indices) and resolves
 * every change between consecutive samples to its exact step, reporting each via
 * `onChange`. `onOpen` receives the value in force at step 0.
 *
 * The outer loop is what makes multi-change windows safe. Each bisection returns
 * the FIRST step differing from `prev`, and the value read AT that step becomes
 * the new `prev` — never the value at the far sample, which may sit beyond
 * further changes. Asia/Chita in 2014 needs this even at a one-day stride: it
 * moves +10 to +08 at 16:00Z and CLDR's metazone boundary follows an hour later,
 * so the signature changes twice inside the hour.
 *
 * What a stride cannot see is a window that changes and RETURNS to the value it
 * opened on. Callers pick a stride against the tightest change-and-return they
 * can be exposed to; for zone data in the modern era that is about seven days,
 * which is why the callers here sample twelve hours apart.
 */
export function scanChanges(
  valueAt: (step: number) => string,
  checkpoints: Iterable<number>,
  onChange: (step: number, from: string, to: string) => void,
  onOpen?: (value: string) => void
): void {
  let prev = valueAt(0);
  let prevStep = 0; // last resolved step; valueAt(prevStep) === prev

  onOpen?.(prev);

  for (const s of checkpoints) {
    if (s <= prevStep) {
      continue; // callers may propose duplicates
    }

    const cur = valueAt(s);

    while (cur !== prev) {
      let lo = prevStep; // valueAt(lo) === prev
      let hi = s; // valueAt(hi) !== prev

      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;

        if (valueAt(mid) === prev) {
          lo = mid;
        } else {
          hi = mid;
        }
      }

      const from = prev;

      prev = hi === s ? cur : valueAt(hi); // `cur` already holds step s
      onChange(hi, from, prev);
      prevStep = hi; // strictly advances, so this terminates
    }

    prevStep = s;
  }
}
