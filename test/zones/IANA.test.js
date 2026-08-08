/* global afterEach test expect */
/* global describe */
import { FixedOffsetZone, IANAZone, Settings } from "../../src/luxon";

const NativeDateTimeFormat = Intl.DateTimeFormat;

function intlOffset(zoneName, ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.valueOf())) return NaN;

  const parts = new NativeDateTimeFormat("en-US", {
    hour12: false,
    timeZone: zoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    era: "short",
  }).formatToParts(date);
  const filled = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  let year = parseInt(filled.year, 10);
  const month = parseInt(filled.month, 10);
  const day = parseInt(filled.day, 10);
  const hour = parseInt(filled.hour, 10);
  const minute = parseInt(filled.minute, 10);
  const second = parseInt(filled.second, 10);

  if (filled.era === "BC") year = -Math.abs(year) + 1;

  let localTS = Date.UTC(year, month - 1, day, hour === 24 ? 0 : hour, minute, second);
  if (year >= 0 && year < 100) {
    const localDate = new Date(localTS);
    localDate.setUTCFullYear(year, month - 1, day);
    localTS = localDate.valueOf();
  }

  let wholeSecondTS = date.valueOf();
  const remainder = wholeSecondTS % 1000;
  wholeSecondTS -= remainder >= 0 ? remainder : 1000 + remainder;
  return (localTS - wholeSecondTS) / 60000;
}

function intlOffsetName(zoneName, ts, format, locale) {
  const part = new NativeDateTimeFormat(locale, {
    timeZoneName: format,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zoneName,
  })
    .formatToParts(new Date(ts))
    .find(({ type }) => type.toLowerCase() === "timezonename");

  return part ? part.value : null;
}

function mockDateTimeFormat(makeFormatter) {
  Intl.DateTimeFormat = function (...args) {
    const formatter = new NativeDateTimeFormat(...args);
    return makeFormatter(formatter, args[1] || {});
  };
}

function replaceMethod(object, name, value) {
  Object.defineProperty(object, name, { configurable: true, value });
}

afterEach(() => {
  Intl.DateTimeFormat = NativeDateTimeFormat;
  Settings.resetCaches();
});

test("IANAZone.create returns a singleton per zone name", () => {
  expect(IANAZone.create("UTC")).toBe(IANAZone.create("UTC"));
  expect(IANAZone.create("America/New_York")).toBe(IANAZone.create("America/New_York"));

  expect(IANAZone.create("UTC")).not.toBe(IANAZone.create("America/New_York"));

  // hold true even for invalid zone names
  expect(IANAZone.create("blorp")).toBe(IANAZone.create("blorp"));
});

test("IANAZone.create should return IANAZone instance", () => {
  const result = IANAZone.create("America/Cancun");
  expect(result).toBeInstanceOf(IANAZone);
});

test("IANAZone.isValidSpecifier", () => {
  expect(IANAZone.isValidSpecifier("America/New_York")).toBe(true);
  // this used to return true but now returns false, because we just defer to isValidZone
  expect(IANAZone.isValidSpecifier("Fantasia/Castle")).toBe(false);
  expect(IANAZone.isValidSpecifier("Sport~~blorp")).toBe(false);
  expect(IANAZone.isValidSpecifier("Etc/GMT+8")).toBe(true);
  expect(IANAZone.isValidSpecifier("Etc/GMT-8")).toBe(true);
  expect(IANAZone.isValidSpecifier("Etc/GMT-0")).toBe(true);
  expect(IANAZone.isValidSpecifier("Etc/GMT-1")).toBe(true);
  expect(IANAZone.isValidSpecifier(null)).toBe(false);
});

test("IANAZone.isValidZone", () => {
  expect(IANAZone.isValidZone("America/New_York")).toBe(true);
  expect(IANAZone.isValidZone("Fantasia/Castle")).toBe(false);
  expect(IANAZone.isValidZone("Sport~~blorp")).toBe(false);
  expect(IANAZone.isValidZone("")).toBe(false);
  expect(IANAZone.isValidZone(undefined)).toBe(false);
  expect(IANAZone.isValidZone(null)).toBe(false);
  expect(IANAZone.isValidZone(4)).toBe(false);
});

test("IANAZone.type returns a static string", () => {
  expect(new IANAZone("America/Santiago").type).toBe("iana");
  expect(new IANAZone("America/Blorp").type).toBe("iana");
});

test("IANAZone.name returns the zone name passed to the constructor", () => {
  expect(new IANAZone("America/Santiago").name).toBe("America/Santiago");
  expect(new IANAZone("America/Blorp").name).toBe("America/Blorp");
  expect(new IANAZone("foo").name).toBe("foo");
});

test("IANAZone is not universal", () => {
  expect(new IANAZone("America/Santiago").isUniversal).toBe(false);
});

test("IANAZone.offsetName with a long format", () => {
  const zone = new IANAZone("America/Santiago");
  const offsetName = zone.offsetName(1552089600, { format: "long", locale: "en-US" });
  expect(offsetName).toBe("Chile Summer Time");
});

test("IANAZone.offsetName with a short format", () => {
  const zone = new IANAZone("America/Santiago");
  const offsetName = zone.offsetName(1552089600, { format: "short", locale: "en-US" });
  expect(offsetName).toBe("GMT-3");
});

test("IANAZone.formatOffset with a short format", () => {
  const zone = new IANAZone("America/Santiago");
  const offsetName = zone.formatOffset(1552089600, "short");
  expect(offsetName).toBe("-03:00");
});

test("IANAZone.formatOffset with a narrow format", () => {
  const zone = new IANAZone("America/Santiago");
  const offsetName = zone.formatOffset(1552089600, "narrow");
  expect(offsetName).toBe("-3");
});

test("IANAZone.formatOffset with a techie format", () => {
  const zone = new IANAZone("America/Santiago");
  const offsetName = zone.formatOffset(1552089600, "techie");
  expect(offsetName).toBe("-0300");
});

test("IANAZone.formatOffset throws for an invalid format", () => {
  const zone = new IANAZone("America/Santiago");
  expect(() => zone.formatOffset(1552089600, "blorp")).toThrow();
});

test("IANAZone.offset treats a formatted local hour of 24 as midnight", () => {
  const ts = Date.UTC(2024, 0, 15, 5);

  mockDateTimeFormat((formatter, opts) => {
    if (opts.era !== "short") return formatter;

    const realParts = formatter.formatToParts.bind(formatter);
    const parts = (date) =>
      realParts(date).map((part) => (part.type === "hour" ? { ...part, value: "24" } : part));
    replaceMethod(formatter, "formatToParts", parts);
    replaceMethod(formatter, "format", (date) =>
      parts(date)
        .map(({ value }) => value)
        .join("")
    );
    return formatter;
  });
  IANAZone.resetCache();

  expect(IANAZone.create("America/New_York").offset(ts)).toBe(-300);
});

test("IANAZone.offset returns NaN beyond the JavaScript Date range", () => {
  const zone = IANAZone.create("America/New_York");

  expect(zone.offset(8.64e15 + 1)).toBeNaN();
  expect(zone.offset(-8.64e15 - 1)).toBeNaN();
});

test("IANAZone.offset handles reordered Intl parts safely", () => {
  const instants = [Date.UTC(2024, 0, 15, 3), -62587360024261];
  const expected = instants.map((ts) => IANAZone.create("America/New_York").offset(ts));

  mockDateTimeFormat((formatter, opts) => {
    if (opts.era !== "short") return formatter;

    const realParts = formatter.formatToParts.bind(formatter);
    const bentParts = (date) => {
      const parts = realParts(date);
      const month = parts.findIndex(({ type }) => type === "month");
      const day = parts.findIndex(({ type }) => type === "day");
      [parts[month], parts[day]] = [parts[day], parts[month]];
      return parts;
    };
    replaceMethod(formatter, "formatToParts", bentParts);
    replaceMethod(formatter, "format", (date) =>
      bentParts(date)
        .map(({ value }) => value)
        .join("")
    );
    return formatter;
  });
  IANAZone.resetCache();

  const zone = IANAZone.create("America/New_York");
  instants.forEach((ts, index) => expect(zone.offset(ts)).toBe(expected[index]));
  expect(zone.offset(8.64e15 + 1)).toBeNaN();
});

describe("IANAZone.offset public behavior contracts", () => {
  const zones = [
    "America/New_York",
    "Europe/Dublin",
    "Australia/Lord_Howe",
    "Pacific/Chatham",
    "Asia/Kolkata",
    "Pacific/Kiritimati",
    "UTC",
  ];
  const instants = [
    0,
    1767225600000,
    1769922000000,
    -94069002240,
    -149990079995,
    -1538845061110,
    -62587360024261,
    8.64e15 + 1,
    -8.64e15 - 1,
    1710053999999,
    -1,
    -999,
    -1000,
    -1001,
    1.5,
    -1.5,
  ];

  test("matches Intl across calendar, range, and sub-second partitions", () => {
    for (const zoneName of zones) {
      const zone = IANAZone.create(zoneName);
      for (const ts of instants) {
        const expected = intlOffset(zoneName, ts);
        const actual = zone.offset(ts);
        expect(Object.is(actual, expected) || actual === expected).toBe(true);
      }
    }
  });

  test("preserves historical non-hour transitions at the exact boundary", () => {
    const cases = [
      ["America/New_York", Date.UTC(1883, 10, 18, 17), -(4 * 60 + 56 + 2 / 60), -5 * 60],
      ["Africa/Monrovia", Date.UTC(1919, 2, 1, 0, 43, 8), -(43 + 8 / 60), -44.5],
      ["Africa/Monrovia", Date.UTC(1972, 0, 7, 0, 44, 30), -44.5, 0],
      ["Asia/Kathmandu", Date.UTC(1985, 11, 31, 18, 30), 5.5 * 60, 5.75 * 60],
      ["Pacific/Apia", Date.UTC(2011, 11, 30, 10), -10 * 60, 14 * 60],
    ];

    for (const [zoneName, transition, before, after] of cases) {
      const zone = IANAZone.create(zoneName);
      expect(zone.offset(transition - 1)).toBe(before);
      expect(zone.offset(transition)).toBe(after);
      expect(zone.offset(transition - 1)).toBe(before);
      expect(zone.offset(transition)).toBe(after);
    }
  });

  test("stays correct across forward, backward, and interleaved access", () => {
    const transitionPoints = [
      Date.UTC(2024, 2, 10, 6, 59, 59, 999),
      Date.UTC(2024, 2, 10, 7),
      Date.UTC(2024, 10, 3, 5, 59, 59, 999),
      Date.UTC(2024, 10, 3, 6),
    ];
    const now = Date.UTC(2026, 0, 15);
    const orders = [
      transitionPoints,
      [...transitionPoints].reverse(),
      transitionPoints.flatMap((ts) => [now, ts]),
    ];

    for (const order of orders) {
      IANAZone.resetCache();
      const zone = IANAZone.create("America/New_York");
      for (const ts of order) {
        expect(zone.offset(ts)).toBe(intlOffset("America/New_York", ts));
      }
    }
  });

  test("matches Intl on both sides of every New York transition in a decade", () => {
    IANAZone.resetCache();
    const zoneName = "America/New_York";
    const zone = IANAZone.create(zoneName);
    const firstSunday = (year, month) => {
      const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
      return 1 + ((7 - firstWeekday) % 7);
    };

    for (let year = 2015; year < 2025; year++) {
      const spring = Date.UTC(year, 2, firstSunday(year, 2) + 7, 7);
      const fall = Date.UTC(year, 10, firstSunday(year, 10), 6);

      for (const transition of [spring, fall]) {
        expect(intlOffset(zoneName, transition - 1)).not.toBe(intlOffset(zoneName, transition));
        for (const ts of [
          transition - 3_600_000,
          transition - 1,
          transition,
          transition + 1,
          transition + 3_600_000,
        ]) {
          expect(zone.offset(ts)).toBe(intlOffset(zoneName, ts));
        }
      }
    }
  });

  test("does not step over a transition after warming on quiet dates", () => {
    IANAZone.resetCache();
    const zoneName = "America/New_York";
    const zone = IANAZone.create(zoneName);

    for (let ts = Date.UTC(2024, 0, 1); ts < Date.UTC(2024, 2, 1); ts += 6 * 3_600_000) {
      expect(zone.offset(ts)).toBe(intlOffset(zoneName, ts));
    }

    const transition = Date.UTC(2024, 2, 10, 7);
    for (const ts of [
      transition - 86_400_000,
      transition - 3_600_000,
      transition - 1,
      transition,
      transition + 1,
      transition + 3_600_000,
      transition + 86_400_000,
    ]) {
      expect(zone.offset(ts)).toBe(intlOffset(zoneName, ts));
    }
  });

  test("keeps alternating zones independent at the same instants", () => {
    const zoneNames = ["America/New_York", "Australia/Lord_Howe"];
    const zonesByName = zoneNames.map((name) => IANAZone.create(name));

    for (let i = 0; i < 48; i++) {
      const ts = Date.UTC(2026, 0, 1) + i * 3_600_000;
      zonesByName.forEach((zone, index) => {
        expect(zone.offset(ts)).toBe(intlOffset(zoneNames[index], ts));
      });
    }
  });

  test("handles Boa Vista's quick offset change and return", () => {
    const zoneName = "America/Boa_Vista";
    const firstTransition = Date.UTC(2000, 9, 8, 4);
    const secondTransition = Date.UTC(2000, 9, 15, 3);
    const points = [
      firstTransition - 1,
      firstTransition,
      Date.UTC(2000, 9, 11, 12),
      secondTransition - 1,
      secondTransition,
    ];
    const expected = points.map((ts) => intlOffset(zoneName, ts));

    expect(expected[0]).toBe(expected[4]);
    expect(expected[1]).not.toBe(expected[0]);
    expect(expected[1]).toBe(expected[3]);

    for (const order of [points, [...points].reverse()]) {
      IANAZone.resetCache();
      const zone = IANAZone.create(zoneName);
      for (const ts of order) {
        expect(zone.offset(ts)).toBe(intlOffset(zoneName, ts));
      }
    }
  });

  test("traverses Casablanca's dense Ramadan transition schedule", () => {
    const zoneName = "Africa/Casablanca";
    const transitions = [
      Date.UTC(2022, 2, 27, 2),
      Date.UTC(2022, 4, 8, 2),
      Date.UTC(2023, 2, 19, 2),
      Date.UTC(2023, 3, 23, 2),
      Date.UTC(2024, 2, 10, 2),
      Date.UTC(2024, 3, 14, 2),
    ];
    const points = transitions.flatMap((ts) => [ts - 1, ts]);
    const orders = [
      points,
      [...points].reverse(),
      points.filter((_, index) => index % 2 === 0).concat(points.filter((_, index) => index % 2)),
    ];

    for (const transition of transitions) {
      expect(intlOffset(zoneName, transition - 1)).not.toBe(intlOffset(zoneName, transition));
    }

    for (const order of orders) {
      IANAZone.resetCache();
      const zone = IANAZone.create(zoneName);
      for (const ts of order) {
        expect(zone.offset(ts)).toBe(intlOffset(zoneName, ts));
      }
    }
  });

  test("gets the epoch offset on the first read after a cache reset", () => {
    for (const zoneName of ["Asia/Kolkata", "America/New_York", "Pacific/Kiritimati"]) {
      IANAZone.resetCache();
      expect(IANAZone.create(zoneName).offset(0)).toBe(intlOffset(zoneName, 0));
    }
  });
});

describe("IANAZone.offsetName public behavior contracts", () => {
  const styles = [
    "short",
    "long",
    "shortOffset",
    "longOffset",
    "shortGeneric",
    "longGeneric",
  ].filter((timeZoneName) => {
    try {
      new NativeDateTimeFormat("en-US", { timeZoneName });
      return true;
    } catch {
      return false;
    }
  });
  const locales = [
    "en-US",
    "de-DE",
    "zh-CN",
    "fa-IR",
    "ar-EG-u-nu-arab",
    "th-TH-u-ca-buddhist-nu-thai",
  ];
  const zones = ["America/New_York", "Asia/Kathmandu", "Australia/Lord_Howe", "UTC"];
  const instants = [
    Date.UTC(2024, 0, 15, 3),
    Date.UTC(2024, 6, 15, 23),
    Date.UTC(2024, 10, 3, 5),
    Date.UTC(2024, 0, 15, 14),
    Date.UTC(2024, 6, 15, 13),
  ];

  test("matches Intl for every runtime-supported style and varied locale layout", () => {
    for (const zoneName of zones) {
      const zone = IANAZone.create(zoneName);
      for (const locale of locales) {
        for (const format of styles) {
          for (const ts of instants) {
            expect(zone.offsetName(ts, { format, locale })).toBe(
              intlOffsetName(zoneName, ts, format, locale)
            );
          }
        }
      }
    }
  });

  test("stays correct when reads cross transitions in either direction", () => {
    const zoneName = "America/New_York";
    const points = [
      Date.UTC(2024, 2, 10, 6, 59, 59, 999),
      Date.UTC(2024, 2, 10, 7),
      Date.UTC(2024, 10, 3, 5, 59, 59, 999),
      Date.UTC(2024, 10, 3, 6),
    ];

    for (const ordered of [points, [...points].reverse()]) {
      Settings.resetCaches();
      const zone = IANAZone.create(zoneName);
      for (const ts of ordered) {
        for (const [format, locale] of [
          ["short", "en-US"],
          ["long", "de-DE"],
          ["shortGeneric", "en-US"],
        ]) {
          expect(zone.offsetName(ts, { format, locale })).toBe(
            intlOffsetName(zoneName, ts, format, locale)
          );
        }
      }
    }
  });

  test("handles the epoch and representable Date edges", () => {
    const zoneName = "America/New_York";
    const zone = IANAZone.create(zoneName);
    const instants = [0, 8.64e15 - 86_400_000, -8.64e15 + 86_400_000];

    for (const ts of instants) {
      expect(zone.offsetName(ts, { format: "short", locale: "en-US" })).toBe(
        intlOffsetName(zoneName, ts, "short", "en-US")
      );
    }
  });

  // The oracle is structural (name changes across the boundary while the
  // offset holds), not hard-coded CLDR strings, so it survives ICU updates as
  // long as the runtime distinguishes Cambridge Bay's generic name at all.
  test("tracks Cambridge Bay name-only transitions while its offset stays stable", () => {
    const zoneName = "America/Cambridge_Bay";
    const locale = "en-US";
    const format = "shortGeneric";
    const instants = [
      Date.UTC(2000, 9, 29, 5, 59, 59, 999),
      Date.UTC(2000, 9, 29, 6),
      Date.UTC(2000, 9, 29, 6, 59, 59, 999),
      Date.UTC(2000, 9, 29, 7),
    ];
    const expectedNames = instants.map((ts) => intlOffsetName(zoneName, ts, format, locale));
    const expectedOffsets = instants.map((ts) => intlOffset(zoneName, ts));

    expect(expectedNames[0]).not.toBe(expectedNames[1]);
    expect(expectedNames[1]).toBe(expectedNames[2]);
    expect(expectedNames[2]).not.toBe(expectedNames[3]);
    expect(new Set(expectedOffsets).size).toBe(1);

    const zone = IANAZone.create(zoneName);
    instants.forEach((ts, index) => {
      expect(zone.offsetName(ts, { format, locale })).toBe(expectedNames[index]);
      expect(zone.offset(ts)).toBe(expectedOffsets[index]);
    });
  });

  test("keeps alternating zones' offset names independent at transition edges", () => {
    const locale = "en-US";
    const reads = [
      ["America/New_York", Date.UTC(2024, 2, 10, 6, 59, 59, 999)],
      ["Australia/Lord_Howe", Date.UTC(2024, 9, 5, 15, 29, 59, 999)],
      ["America/New_York", Date.UTC(2024, 2, 10, 7)],
      ["Australia/Lord_Howe", Date.UTC(2024, 9, 5, 15, 30)],
      ["Australia/Lord_Howe", Date.UTC(2024, 3, 6, 14, 59, 59, 999)],
      ["America/New_York", Date.UTC(2024, 10, 3, 5, 59, 59, 999)],
      ["Australia/Lord_Howe", Date.UTC(2024, 3, 6, 15)],
      ["America/New_York", Date.UTC(2024, 10, 3, 6)],
    ];

    Settings.resetCaches();
    for (const [zoneName, ts] of reads) {
      const zone = IANAZone.create(zoneName);
      for (const format of ["shortOffset", "longOffset"]) {
        expect(zone.offsetName(ts, { format, locale })).toBe(
          intlOffsetName(zoneName, ts, format, locale)
        );
      }
    }
  });
});

test("IANAZone.equals requires both zones to be iana", () => {
  expect(IANAZone.create("UTC").equals(FixedOffsetZone.utcInstance)).toBe(false);
});

test("IANAZone.equals returns false even if the two share offsets", () => {
  const luxembourg = IANAZone.create("Europe/Luxembourg");
  const rome = IANAZone.create("Europe/Rome");
  expect(luxembourg.equals(rome)).toBe(false);
});

test("IANAZone.isValid returns true for valid zone names", () => {
  expect(new IANAZone("UTC").isValid).toBe(true);
  expect(new IANAZone("America/Santiago").isValid).toBe(true);
  expect(new IANAZone("Europe/Paris").isValid).toBe(true);
});

test("IANAZone.isValid returns false for invalid zone names", () => {
  expect(new IANAZone("").isValid).toBe(false);
  expect(new IANAZone("foo").isValid).toBe(false);
  expect(new IANAZone("CEDT").isValid).toBe(false);
  expect(new IANAZone("GMT+2").isValid).toBe(false);
  expect(new IANAZone("America/Blorp").isValid).toBe(false);
  expect(new IANAZone(null).isValid).toBe(false);
});

test("IANAZone.normalize normalizes the zone name", () => {
  expect(IANAZone.normalizeZone("america/nEw_york")).toBe("America/New_York");
  expect(IANAZone.normalizeZone("AMERICA/NEW_YORK")).toBe("America/New_York");
  expect(IANAZone.normalizeZone("America/New_York")).toBe("America/New_York");
  expect(IANAZone.normalizeZone("europe/paris")).toBe("Europe/Paris");
  expect(IANAZone.normalizeZone("EUROPE/PARIS")).toBe("Europe/Paris");
  expect(IANAZone.normalizeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  expect(IANAZone.normalizeZone("Etc/GMT")).toBe("UTC");
});

test("IANAZone returns canonical zone name regardless of input casing", () => {
  expect(new IANAZone("america/nEw_york").name).toBe("America/New_York");
  expect(new IANAZone("AMERICA/NEW_YORK").name).toBe("America/New_York");
  expect(new IANAZone("America/New_York").name).toBe("America/New_York");
  expect(new IANAZone("europe/paris").name).toBe("Europe/Paris");
  expect(new IANAZone("EUROPE/PARIS").name).toBe("Europe/Paris");
  expect(new IANAZone("Asia/Tokyo").name).toBe("Asia/Tokyo");
});
