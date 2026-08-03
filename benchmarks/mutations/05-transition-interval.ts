import type { MutationSet } from "../lib/mutations.ts";

const nl = (...parts: string[]) => parts.join("\n");

/**
 * E is the one patch where most of the code is not the answer. A span that is
 * too wide returns a stale value and is a correctness bug; a span that is too
 * narrow, evicted too eagerly, or never allowed to grow is right every time and
 * buys nothing. So roughly half of these are only visible to a count of Intl
 * calls, and that is not a weakness of the tests — it is what the patch is.
 */
const set: MutationSet = {
  patch: "05-transition-interval.patch",
  tests: ["test/transition-interval-fixtures.test.ts", "test/offset-patches.test.ts"],
  mutations: [
    // ---- the span, where being wrong is being wrong ----
    {
      name: "probes far enough apart to step over a transition",
      find: "+const INTERVAL_PROBE_MS = 2 * 86400000;",
      replace: "+const INTERVAL_PROBE_MS = 8 * 86400000;",
    },
    {
      name: "widens the span without checking what is out there",
      find: "+    const p = t + k * INTERVAL_PROBE_MS;\n+    if (!(Math.abs(p) <= INTERVAL_MAX_TS) || lookup(ctx, p) !== val) break;",
      replace: "+    const p = t + k * INTERVAL_PROBE_MS;\n+    if (!(Math.abs(p) <= INTERVAL_MAX_TS)) break;",
    },
    {
      name: "widens backwards without checking what is back there",
      find: "+    const p = t - k * INTERVAL_PROBE_MS;\n+    if (!(Math.abs(p) <= INTERVAL_MAX_TS) || lookup(ctx, p) !== val) break;",
      replace: "+    const p = t - k * INTERVAL_PROBE_MS;\n+    if (!(Math.abs(p) <= INTERVAL_MAX_TS)) break;",
    },
    {
      name: "probes past the end of the representable range",
      find: "+    const p = t + k * INTERVAL_PROBE_MS;\n+    if (!(Math.abs(p) <= INTERVAL_MAX_TS) || lookup(ctx, p) !== val) break;",
      replace: "+    const p = t + k * INTERVAL_PROBE_MS;\n+    if (lookup(ctx, p) !== val) break;",
    },
    {
      name: "counts a value at the far edge as inside the span",
      find: "+  if (t >= st.lo0 && t <= st.hi0) {",
      replace: "+  if (t >= st.lo0 && t <= st.hi0 + INTERVAL_PROBE_MS) {",
    },
    {
      name: "starts life with a span that contains the epoch",
      find: "+    lo0: 1, hi0: 0, val0: null,",
      replace: "+    lo0: 0, hi0: 0, val0: null,",
    },
    {
      name: "keeps its spans across a cache reset",
      find: "+    intervalCache.clear();",
      replace: "",
    },
    {
      name: "gives every zone the same span on the offset side",
      find: "+      return intervalLookup(offsetInterval(this.name), callScan, scan, t);",
      replace: '+      return intervalLookup(offsetInterval(""), callScan, scan, t);',
    },

    // ---- the parts that only a count can see ----
    {
      name: "keeps one span instead of two",
      find: nl(
        "+  if (t >= st.lo1 && t <= st.hi1) {",
        "+    st.hits++;",
        "+    const lo = st.lo0, hi = st.hi0, v = st.val0;",
        "+    st.lo0 = st.lo1; st.hi0 = st.hi1; st.val0 = st.val1;",
        "+    st.lo1 = lo; st.hi1 = hi; st.val1 = v;",
        "+    return st.val0;",
        "+  }"
      ),
      replace: "",
    },
    {
      name: "evicts the span it just used rather than the colder one",
      find: nl(
        "+    const lo = st.lo0, hi = st.hi0, v = st.val0;",
        "+    st.lo0 = st.lo1; st.hi0 = st.hi1; st.val0 = st.val1;",
        "+    st.lo1 = lo; st.hi1 = hi; st.val1 = v;",
        "+    return st.val0;"
      ),
      replace: "+    return st.val1;",
    },
    {
      name: "anchors the span forward only",
      find: nl(
        "+  for (let k = 1; k <= side; k++) {",
        "+    const p = t - k * INTERVAL_PROBE_MS;",
        "+    if (!(Math.abs(p) <= INTERVAL_MAX_TS) || lookup(ctx, p) !== val) break;",
        "+    st.lo0 = p;",
        "+  }"
      ),
      replace: "",
    },
    {
      name: "lets the probe budget fall to nothing",
      find: "+  const side = (st.reach >> 1) + 1;",
      replace: "+  const side = st.reach >> 1;",
    },
    {
      name: "never lets the budget grow past its floor",
      find: "+  st.reach = Math.min(st.hits, INTERVAL_MAX_REACH);",
      replace: "+  st.reach = 0;",
    },
    {
      name: "lets the budget grow without a ceiling",
      find: "+  st.reach = Math.min(st.hits, INTERVAL_MAX_REACH);",
      replace: "+  st.reach = st.hits;",
    },
    {
      name: "counts hits without ever spending them",
      find: "+  st.hits = 0;",
      replace: "",
    },
    {
      name: "gives the name side a fresh span on every call",
      find: "+    return intervalLookup(scan.iv, scanName, scan, ts);",
      replace: "+    return intervalLookup(newInterval(), scanName, scan, ts);",
    },
  ],
};

export default set;
