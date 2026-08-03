import type { MutationSet } from "../lib/mutations.ts";

/**
 * C keeps an object luxon already lets callers keep. The risk is entirely in the
 * key: too narrow and one caller gets another's parser, and the four fields it
 * does not name are as much a claim as the four it does.
 */
const set: MutationSet = {
  patch: "03-token-parser-cache.patch",
  tests: ["test/token-parser-fixtures.test.ts", "test/token-parser-patch.test.ts"],
  mutations: [
    {
      name: "keys the parser on the locale but not the format",
      find: "+  const key = JSON.stringify([locale.locale, locale.numberingSystem, locale.outputCalendar, format]);",
      replace: "+  const key = JSON.stringify([locale.locale, locale.numberingSystem, locale.outputCalendar]);",
    },
    {
      name: "keys the parser on the format but not the locale",
      find: "+  const key = JSON.stringify([locale.locale, locale.numberingSystem, locale.outputCalendar, format]);",
      replace: "+  const key = JSON.stringify([locale.numberingSystem, locale.outputCalendar, format]);",
    },
    {
      name: "ignores the numbering system",
      find: "+  const key = JSON.stringify([locale.locale, locale.numberingSystem, locale.outputCalendar, format]);",
      replace: "+  const key = JSON.stringify([locale.locale, locale.outputCalendar, format]);",
    },
    {
      name: "ignores the output calendar",
      find: "+  const key = JSON.stringify([locale.locale, locale.numberingSystem, locale.outputCalendar, format]);",
      replace: "+  const key = JSON.stringify([locale.locale, locale.numberingSystem, format]);",
      survives:
        "outputCalendar picks the calendar a DateTime is displayed in, not the " +
        "names a parser matches: Info.months under islamic returns Muharram, and " +
        "the same locale still parses March. Checked over nine formats — month, " +
        "weekday, era, meridiem, week and ordinal tokens — against five " +
        "calendars, with no difference anywhere. The field stays in the key " +
        "because it is one of the three Locale#equals compares, which costs a " +
        "little cache fragmentation and no correctness.",
    },
    {
      name: "keeps its parsers across a cache reset",
      find: "+    resetTokenParserCache();",
      replace: "",
    },
  ],
};

export default set;
