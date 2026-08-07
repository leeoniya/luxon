/**
 * The two zone lookups as they stood before A, B and D, rewritten here so the
 * fixtures for those patches have something to check against that is not a
 * recorded value. Both go straight to Intl, so a tzdata or CLDR update moves the
 * expectation and the answer together and cannot turn a fixture red on its own.
 *
 * Deliberately not imported from a build: a patched module is the thing under
 * test, and a stock one would have to be built and kept around to be read from.
 */

/** IANAZone#offset before B */
export function stockOffset(name: string, ts: number): number {
  const date = new Date(ts);

  if (isNaN(+date)) return NaN;

  const dtf = new Intl.DateTimeFormat("en-US", {
    hour12: false,
    timeZone: name,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    era: "short",
  });

  const filled: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(date)) filled[type] = value;

  let year = parseInt(filled["year"]!, 10);
  const month = parseInt(filled["month"]!, 10);
  const day = parseInt(filled["day"]!, 10);
  const hour = parseInt(filled["hour"]!, 10);
  const minute = parseInt(filled["minute"]!, 10);
  const second = parseInt(filled["second"]!, 10);

  if (filled["era"] === "BC") year = -Math.abs(year) + 1;

  // objToLocalTS, including the fixup that keeps years 0-99 out of the 1900s
  let asUTC = Date.UTC(year, month - 1, day, hour === 24 ? 0 : hour, minute, second, 0);

  if (year < 100 && year >= 0) {
    const d = new Date(asUTC);
    d.setUTCFullYear(year, month - 1, day);
    asUTC = +d;
  }

  let asTS = +date;
  const over = asTS % 1000;
  asTS -= over >= 0 ? over : 1000 + over;

  return (asUTC - asTS) / 60000;
}

export type NameStyle = "short" | "long" | "shortOffset" | "longOffset" | "shortGeneric" | "longGeneric";

/** parseZoneInfo before A */
export function stockName(ts: number, format: NameStyle, locale: string, timeZone: string): string | null {
  const parsed = new Intl.DateTimeFormat(locale, {
    timeZoneName: format,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  })
    .formatToParts(new Date(ts))
    .find((m) => m.type.toLowerCase() === "timezonename");

  return parsed ? parsed.value : null;
}
