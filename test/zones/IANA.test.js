/* global afterEach test expect */
import { FixedOffsetZone, IANAZone, Settings } from "../../src/luxon";

const NativeDateTimeFormat = Intl.DateTimeFormat;

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

test.each(["missing name", "moving layout", "format mismatch"])(
  "IANAZone.offsetName falls back when scanner input has a %s",
  (failure) => {
    const zoneName = "America/New_York";
    const locale = "en-US";
    const instants = [Date.UTC(2024, 0, 15, 3), Date.UTC(2024, 6, 15, 23)];
    const expected = instants.map((ts) =>
      IANAZone.create(zoneName).offsetName(ts, { format: "short", locale })
    );

    Settings.resetCaches();
    mockDateTimeFormat((formatter, opts) => {
      if (opts.timeZoneName !== "short" || opts.year !== undefined) return formatter;

      const realParts = formatter.formatToParts.bind(formatter);
      const bend = (date) => {
        const parts = realParts(date);
        if (failure === "missing name") {
          return parts.filter(({ type }) => type.toLowerCase() !== "timezonename");
        }
        if (failure === "moving layout" && Number(date) === instants[0]) {
          return parts.flatMap((part) =>
            part.type.toLowerCase() === "timezonename"
              ? [{ type: "literal", value: "~" }, part]
              : [part]
          );
        }
        return parts;
      };

      replaceMethod(formatter, "formatToParts", bend);
      if (failure === "format mismatch") {
        const realFormat = formatter.format.bind(formatter);
        replaceMethod(formatter, "format", (date) => `~${realFormat(date)}`);
      } else {
        replaceMethod(formatter, "format", (date) =>
          bend(date)
            .map(({ value }) => value)
            .join("")
        );
      }
      return formatter;
    });

    const zone = IANAZone.create(zoneName);
    instants.forEach((ts, index) => {
      expect(zone.offsetName(ts, { format: "short", locale })).toBe(expected[index]);
    });
  }
);

test("IANAZone.offsetName returns null when Intl omits the zone name", () => {
  mockDateTimeFormat((formatter, opts) => {
    if (opts.timeZoneName === undefined) return formatter;

    const realParts = formatter.formatToParts.bind(formatter);
    const parts = (date) =>
      realParts(date).filter(({ type }) => type.toLowerCase() !== "timezonename");
    replaceMethod(formatter, "formatToParts", parts);
    replaceMethod(formatter, "format", (date) =>
      parts(date)
        .map(({ value }) => value)
        .join("")
    );
    return formatter;
  });
  Settings.resetCaches();

  expect(
    IANAZone.create("America/New_York").offsetName(Date.UTC(2024, 0, 15, 3), {
      format: "short",
      locale: "en-US",
    })
  ).toBeNull();
});

test("IANAZone.offsetName scanner is reused and reset through public caches", () => {
  const zoneName = "America/New_York";
  const locale = "en-US";
  const ts = Date.UTC(2024, 0, 15, 3);
  let narrowConstructions = 0;
  let fullConstructions = 0;

  mockDateTimeFormat((formatter, opts) => {
    if (opts.timeZoneName === "short") {
      if (opts.year === undefined) narrowConstructions++;
      else fullConstructions++;
    }
    return formatter;
  });
  Settings.resetCaches();

  const read = () => IANAZone.create(zoneName).offsetName(ts, { format: "short", locale });
  const first = read();
  expect(read()).toBe(first);

  if (narrowConstructions > 0) {
    // The patched public path builds one scanner and reuses it for the second read.
    expect(narrowConstructions).toBe(1);
    expect(fullConstructions).toBe(0);
    Settings.resetCaches();
    expect(read()).toBe(first);
    expect(narrowConstructions).toBe(2);
  } else {
    // Stock Luxon has no scanner; retain a meaningful assertion for ordinary Jest.
    expect(fullConstructions).toBe(2);
    Settings.resetCaches();
    expect(read()).toBe(first);
    expect(fullConstructions).toBe(3);
  }
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

test("IANAZone.offset returns NaN for malformed scanner output", () => {
  mockDateTimeFormat((formatter, opts) => {
    if (opts.era !== "short") return formatter;

    const realParts = formatter.formatToParts.bind(formatter);
    replaceMethod(formatter, "formatToParts", (date) =>
      realParts(date).map((part) =>
        ["year", "month", "day", "hour", "minute", "second"].includes(part.type)
          ? { ...part, value: "x" }
          : part
      )
    );
    replaceMethod(formatter, "format", () => "malformed");
    return formatter;
  });
  IANAZone.resetCache();

  expect(IANAZone.create("America/New_York").offset(Date.UTC(2024, 0, 15, 5))).toBeNaN();
});

test("IANAZone.offset rejects a decoded date beyond the JavaScript Date range", () => {
  mockDateTimeFormat((formatter, opts) => {
    if (opts.era !== "short") return formatter;

    const realParts = formatter.formatToParts.bind(formatter);
    replaceMethod(formatter, "formatToParts", (date) =>
      realParts(date).map((part) =>
        part.type === "year" ? { ...part, value: "99999999" } : part
      )
    );
    replaceMethod(formatter, "format", () => "01/15/99999999, 12:00:00");
    return formatter;
  });
  IANAZone.resetCache();

  expect(IANAZone.create("America/New_York").offset(Date.UTC(2024, 0, 15, 5))).toBeNaN();
});

test("IANAZone.offset returns NaN beyond the JavaScript Date range", () => {
  const zone = IANAZone.create("America/New_York");

  expect(zone.offset(8.64e15 + 1)).toBeNaN();
  expect(zone.offset(-8.64e15 - 1)).toBeNaN();
});

test("IANAZone.offset falls back safely for an unsupported scanner layout", () => {
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
