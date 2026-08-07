import type { MutationSet } from "../lib/mutations.ts";

const nl = (...parts: string[]) => parts.join("\n");

/**
 * A reuses the existing formatter cache, then reads the zone name out of a
 * measured position in format(). The cache can be keyed incorrectly; the
 * scanner can measure or reuse its position incorrectly; and every unfamiliar
 * layout must still reach the cached formatToParts fallback.
 */
const set: MutationSet = {
  patch: "01-zone-info-cache.patch",
  tests: [
    "test/zone-info-fallback-fixtures.test.ts",
    "test/zone-info-cache-fixtures.test.ts",
    "test/zone-name-fixtures.test.ts",
    "test/zone-name-patches.test.ts",
  ],
  mutations: [
    // ---- the cached fallback ----
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
      name: "reconstructs the fallback formatter under A and D",
      find: "+  const parsed = getCachedDTF(locale, modified)",
      replace: "+  const parsed = new Intl.DateTimeFormat(locale, modified)",
    },

    // ---- what the scanner is built from ----
    {
      name: "lets the hour render at its natural width",
      find: '+  const opts = { timeZoneName: offsetFormat, hourCycle: "h23", hour: "2-digit" };',
      replace: '+  const opts = { timeZoneName: offsetFormat, hourCycle: "h23" };',
    },
    {
      name: "drops the probe that would render a one-digit hour",
      find: "+const NAME_PROBES = [Date.UTC(2024, 0, 15, 3), Date.UTC(2024, 6, 15, 23), Date.UTC(2024, 10, 3, 5)];",
      replace: "+const NAME_PROBES = [Date.UTC(2024, 6, 15, 23)];",
    },
    {
      name: "probes only one side of a DST boundary",
      find: "+const NAME_PROBES = [Date.UTC(2024, 0, 15, 3), Date.UTC(2024, 6, 15, 23), Date.UTC(2024, 10, 3, 5)];",
      replace: "+const NAME_PROBES = [Date.UTC(2024, 0, 15, 3), Date.UTC(2024, 10, 3, 5)];",
    },

    // ---- the checks that send an unfamiliar layout to the fallback ----
    {
      name: "accepts a format() that is not its parts joined",
      find: "+    if (at < 0 || dtf.format(probe) !== s) return null;",
      replace: "+    if (at < 0) return null;",
    },
    {
      name: "accepts probes whose name sits in different places",
      find: nl(
        "+    } else if (at !== pre || s.length - at - len !== suf) {",
        "+      // the text around the name moves, so its position cannot be reused",
        "+      return null;"
      ),
      replace: nl(
        "+    } else if (false) {",
        "+      // the text around the name moves, so its position cannot be reused",
        "+      return null;"
      ),
    },
    {
      name: "measures the trailing text but not the leading",
      find: "+      suf = s.length - at - len;",
      replace: "+      suf = 0;",
    },

    // ---- reading the name back out ----
    {
      name: "reads to the end of the string instead of the name",
      find: "+  return s.slice(scan.pre, s.length - scan.suf);",
      replace: "+  return s.slice(scan.pre);",
    },
    {
      name: "reads from the start of the string",
      find: "+  return s.slice(scan.pre, s.length - scan.suf);",
      replace: "+  return s.slice(0, s.length - scan.suf);",
    },

    // ---- the scanner cache ----
    {
      name: "shares one scanner across zones",
      find: '+  const key = locale + "|" + offsetFormat + "|" + timeZone;',
      replace: '+  const key = locale + "|" + offsetFormat;',
    },
    {
      name: "shares one scanner across name styles",
      find: '+  const key = locale + "|" + offsetFormat + "|" + timeZone;',
      replace: '+  const key = locale + "|" + timeZone;',
    },
    {
      name: "shares one scanner across locales",
      find: '+  const key = locale + "|" + offsetFormat + "|" + timeZone;',
      replace: '+  const key = offsetFormat + "|" + timeZone;',
    },
    {
      name: "keeps its scanners across a cache reset",
      find: "+    resetZoneNameCache();",
      replace: "",
    },
  ],
};

export default set;
