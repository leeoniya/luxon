import type { MutationSet } from "../lib/mutations.ts";

/**
 * A is two lines, and neither is arithmetic — it swaps a constructor for the
 * lookup that already existed. What can go wrong is passing the wrong thing to
 * that lookup, and the cache key being wider or narrower than the answer.
 *
 * D rewrites parseZoneInfo to scan dtf.format(), but its rejection path still
 * reaches A. The first fixture isolates A's value and key; the second forces
 * D to reject its scanner under E and proves that fallback remains cached.
 */
const set: MutationSet = {
  patch: "01-zone-info-cache.patch",
  tests: ["test/zone-info-fallback-fixtures.test.ts", "test/zone-info-cache-fixtures.test.ts"],
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
    {
      name: "reconstructs the fallback formatter under D and E",
      find: "+  const parsed = getCachedDTF(locale, modified)",
      replace: "+  const parsed = new Intl.DateTimeFormat(locale, modified)",
    },
  ],
};

export default set;
