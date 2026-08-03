import type { MutationSet } from "../lib/mutations.ts";

/**
 * A is two lines, and neither is arithmetic — it swaps a constructor for the
 * lookup that already existed. What can go wrong is passing the wrong thing to
 * that lookup, and the cache key being wider or narrower than the answer.
 *
 * Note which build these run against. D rewrites parseZoneInfo to scan
 * dtf.format() and only falls back to the expression A edits, so A's line is
 * unreachable in any build that carries D. The tests below load A on its own for
 * that reason.
 */
const set: MutationSet = {
  patch: "01-zone-info-cache.patch",
  tests: ["test/zone-info-cache-fixtures.test.ts"],
  mutations: [
    {
      name: "looks the formatter up without the zone-name option",
      find: "+  const parsed = getCachedDTF(locale, modified)",
      replace: "+  const parsed = getCachedDTF(locale, intlOpts)",
    },
    {
      name: "ignores the locale it was asked for",
      find: "+  const parsed = getCachedDTF(locale, modified)",
      replace: '+  const parsed = getCachedDTF("en-US", modified)',
    },
  ],
};

export default set;
