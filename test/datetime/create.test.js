/* global test expect */

import { DateTime, Settings } from "../../src/luxon";
import Helpers, { supportsMinDaysInFirstWeek } from "../helpers";

const withDefaultLocale = Helpers.withDefaultLocale,
  withDefaultNumberingSystem = Helpers.setUnset("defaultNumberingSystem"),
  withDefaultOutputCalendar = Helpers.setUnset("defaultOutputCalendar"),
  withthrowOnInvalid = Helpers.setUnset("throwOnInvalid"),
  withDefaultZone = Helpers.withDefaultZone,
  withDefaultWeekSettings = Helpers.setUnset("defaultWeekSettings");

//------
// .now()
//------
test("DateTime.now has today's date", () => {
  const date = new Date(),
    now = DateTime.now();
  expect(now.toJSDate().getDate()).toBe(date.getDate());
  // The two instants should be a few milliseconds apart
  expect(Math.abs(now.valueOf() - date.valueOf()) < 1000).toBe(true);
});

test("DateTime.now accepts the default locale", () => {
  withDefaultLocale("fr", () => expect(DateTime.now().locale).toBe("fr"));
});

test("DateTime.now accepts the default numbering system", () => {
  withDefaultNumberingSystem("beng", () => expect(DateTime.now().numberingSystem).toBe("beng"));
});

test("DateTime.now accepts the default output calendar", () => {
  withDefaultOutputCalendar("hebrew", () => expect(DateTime.now().outputCalendar).toBe("hebrew"));
});

test("DateTime.now accepts the default time zone", () => {
  withDefaultZone("Europe/Paris", () => expect(DateTime.now().zoneName).toBe("Europe/Paris"));
});

test("Settings.defaultWeekSettings rejects malformed inputs and restores the prior value", () => {
  const original = Settings.defaultWeekSettings;
  const valid = { firstDay: 1, minimalDays: 4, weekend: [6, 7] };
  const invalidSettings = [
    "not an object",
    {},
    { ...valid, firstDay: 0 },
    { ...valid, firstDay: 1.5 },
    { ...valid, minimalDays: 8 },
    { ...valid, minimalDays: 1.5 },
    { ...valid, weekend: 6 },
    { ...valid, weekend: [0, 7] },
    { ...valid, weekend: [6, 7.5] },
  ];

  try {
    Settings.defaultWeekSettings = valid;
    for (const input of invalidSettings) {
      expect(() => {
        Settings.defaultWeekSettings = input;
      }).toThrow();
      expect(Settings.defaultWeekSettings).toEqual(valid);
    }
  } finally {
    Settings.defaultWeekSettings = original;
  }

  expect(Settings.defaultWeekSettings).toEqual(original);
});

//------
// .local()
//------
test("DateTime.local() has today's date", () => {
  const date = new Date(),
    now = DateTime.local();
  expect(now.toJSDate().getDate()).toBe(date.getDate());
  // The two instants should be a few milliseconds apart
  expect(Math.abs(now.valueOf() - date.valueOf()) < 1000).toBe(true);
});

test("DateTime.local(2017) is the beginning of the year", () => {
  const dt = DateTime.local(2017);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(1);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.local(2017, 6) is the beginning of the month", () => {
  const dt = DateTime.local(2017, 6);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(1);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.local(2017, 6, 12) is the beginning of 6/12", () => {
  const dt = DateTime.local(2017, 6, 12);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.local(2017, 6, 12, 5) is the beginning of the hour", () => {
  const dt = DateTime.local(2017, 6, 12, 5);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(5);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.local(2017, 6, 12, 5, 25) is the beginning of the minute", () => {
  const dt = DateTime.local(2017, 6, 12, 5, 25);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(5);
  expect(dt.minute).toBe(25);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.local(2017, 6, 12, 5, 25, 16) is the beginning of the second", () => {
  const dt = DateTime.local(2017, 6, 12, 5, 25, 16);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(5);
  expect(dt.minute).toBe(25);
  expect(dt.second).toBe(16);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.local(2017, 6, 12, 5, 25, 16, 255) is right down to the millisecond", () => {
  const dt = DateTime.local(2017, 6, 12, 5, 25, 16, 255);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(5);
  expect(dt.minute).toBe(25);
  expect(dt.second).toBe(16);
  expect(dt.millisecond).toBe(255);
});

test("DateTime.local accepts the default locale", () => {
  withDefaultLocale("fr", () => expect(DateTime.local().locale).toBe("fr"));
});

test("DateTime.local accepts the default numbering system", () => {
  withDefaultNumberingSystem("beng", () => expect(DateTime.local().numberingSystem).toBe("beng"));
});

test("DateTime.local accepts the default output calendar", () => {
  withDefaultOutputCalendar("hebrew", () => expect(DateTime.local().outputCalendar).toBe("hebrew"));
});

test("DateTime.local does not accept non-integer values", () => {
  const dt = DateTime.local(2017, 6.7, 12);
  expect(dt.isValid).toBe(false);
});

test("DateTime.local accepts the default time zone", () => {
  withDefaultZone("Europe/Paris", () => expect(DateTime.local().zoneName).toBe("Europe/Paris"));
});

test("DateTime.local accepts an options hash in any position", () => {
  const options = {
    zone: "Europe/Paris",
    numberingSystem: "beng",
    outputCalendar: "islamic",
    locale: "fr",
  };
  const args = [
    DateTime.local(options),
    DateTime.local(2017, options),
    DateTime.local(2017, 6, options),
    DateTime.local(2017, 6, 12, options),
    DateTime.local(2017, 6, 12, options),
    DateTime.local(2017, 6, 12, 5, options),
    DateTime.local(2017, 6, 12, 5, 25, options),
    DateTime.local(2017, 6, 12, 5, 25, 16, options),
    DateTime.local(2017, 6, 12, 5, 25, 16, 255, options),
  ];

  for (const i in args) {
    const dt = args[i];
    expect(dt.zoneName).toBe("Europe/Paris");
    expect(dt.numberingSystem).toBe("beng");
    expect(dt.outputCalendar).toBe("islamic");
    expect(dt.locale).toBe("fr");
  }
});

test("DateTime.local preserves now, options, and positional overloads", () => {
  const oldNow = Settings.now;
  let zoneReads = 0;
  Settings.now = () => 1710053999123;

  try {
    expect(DateTime.local().valueOf()).toBe(1710053999123);
    const options = {
      get zone() {
        zoneReads++;
        return "UTC+5:45";
      },
      locale: "fr",
      numberingSystem: "latn",
    };
    const configured = DateTime.local(options);

    expect(configured.zoneName).toBe("UTC+5:45");
    expect(configured.locale).toBe("fr");
    expect(configured.numberingSystem).toBe("latn");
    expect(zoneReads).toBeGreaterThan(0);
    expect(DateTime.local({ zone: "not/a-zone" }).isValid).toBe(false);
    const customZone = {
      type: "custom",
      name: "Test/Local",
      isUniversal: true,
      isValid: true,
      offsetName: () => "Local",
      formatOffset: () => "+01:30",
      offset: () => 90,
      equals(other) {
        return other === this;
      },
    };
    expect(DateTime.local({ zone: customZone }).zone).toBe(customZone);
    expect(DateTime.local(2024).toObject()).toEqual({
      year: 2024,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  } finally {
    Settings.now = oldNow;
  }
});

//------
// .utc()
//-------
test("DateTime.utc() is in utc", () => {
  const now = DateTime.utc();
  expect(now.offset).toBe(0);
});

test("DateTime.utc(2017) is the beginning of the year", () => {
  const dt = DateTime.utc(2017);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(1);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.utc(2017, 6) is the beginning of the month", () => {
  const dt = DateTime.utc(2017, 6);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(1);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.utc(2017, 6, 12) is the beginning of 6/12", () => {
  const dt = DateTime.utc(2017, 6, 12);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.utc(2017, 6, 12, 5) is the beginning of the hour", () => {
  const dt = DateTime.utc(2017, 6, 12, 5);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(5);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.utc(2017, 6, 12, 5, 25) is the beginning of the minute", () => {
  const dt = DateTime.utc(2017, 6, 12, 5, 25);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(5);
  expect(dt.minute).toBe(25);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.utc(2017, 6, 12, 5, 25, 16) is the beginning of the second", () => {
  const dt = DateTime.utc(2017, 6, 12, 5, 25, 16);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(5);
  expect(dt.minute).toBe(25);
  expect(dt.second).toBe(16);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.utc(2017, 6, 12, 5, 25, 16, 255) is right down to the millisecond", () => {
  const dt = DateTime.utc(2017, 6, 12, 5, 25, 16, 255);
  expect(dt.year).toBe(2017);
  expect(dt.month).toBe(6);
  expect(dt.day).toBe(12);
  expect(dt.hour).toBe(5);
  expect(dt.minute).toBe(25);
  expect(dt.second).toBe(16);
  expect(dt.millisecond).toBe(255);
});

test("DateTime.utc accepts the default locale", () => {
  withDefaultLocale("fr", () => expect(DateTime.utc().locale).toBe("fr"));
});

test("DateTime.utc accepts an options hash in any position", () => {
  const options = {
    numberingSystem: "beng",
    outputCalendar: "islamic",
    locale: "fr",
  };
  const args = [
    DateTime.utc(options),
    DateTime.utc(2017, options),
    DateTime.utc(2017, 6, options),
    DateTime.utc(2017, 6, 12, options),
    DateTime.utc(2017, 6, 12, options),
    DateTime.utc(2017, 6, 12, 5, options),
    DateTime.utc(2017, 6, 12, 5, 25, options),
    DateTime.utc(2017, 6, 12, 5, 25, 16, options),
    DateTime.utc(2017, 6, 12, 5, 25, 16, 255, options),
  ];

  for (const i in args) {
    const dt = args[i];
    expect(dt.zoneName).toBe("UTC");
    expect(dt.numberingSystem).toBe("beng");
    expect(dt.outputCalendar).toBe("islamic");
    expect(dt.locale).toBe("fr");
  }
});

//------
// .fromJSDate()
//-------
test("DateTime.fromJSDate(date) clones the date", () => {
  const date = new Date(1982, 4, 25),
    dateTime = DateTime.fromJSDate(date),
    oldValue = dateTime.valueOf();

  date.setDate(14);
  expect(dateTime.toJSDate().valueOf()).toBe(oldValue);
});

test("DateTime.fromJSDate(date) accepts a zone option", () => {
  const date = new Date(1982, 4, 25),
    dateTime = DateTime.fromJSDate(date, { zone: "America/Santiago" });

  expect(dateTime.toJSDate().valueOf()).toBe(date.valueOf());
  expect(dateTime.zoneName).toBe("America/Santiago");
});

test("DateTime.fromJSDate(date) returns invalid for invalid values", () => {
  expect(DateTime.fromJSDate("").isValid).toBe(false);
  expect(DateTime.fromJSDate(new Date("")).isValid).toBe(false);
  expect(DateTime.fromJSDate(new Date().valueOf()).isValid).toBe(false);
});

test("DateTime.fromJSDate accepts the default locale", () => {
  withDefaultLocale("fr", () => expect(DateTime.fromJSDate(new Date()).locale).toBe("fr"));
});

test("DateTime.fromJSDate(date) throw errors for invalid values when throwOnInvalid is true", () => {
  withthrowOnInvalid(true, () => {
    expect(() => DateTime.fromJSDate("")).toThrow();
    expect(() => DateTime.fromJSDate(new Date(""))).toThrow();
    expect(() => DateTime.fromJSDate(new Date().valueOf())).toThrow();
    expect(() => DateTime.fromJSDate(new Date(), { zone: "America/Blorp" })).toThrow();
    expect(() => DateTime.fromJSDate("2019-04-16T11:32:32Z")).toThrow();
  });
});

//------
// .fromMillis()
//-------
test("DateTime.fromMillis(ms) has a value of ms", () => {
  const bigValue = 391147200000;
  expect(DateTime.fromMillis(bigValue).valueOf()).toBe(bigValue);

  expect(DateTime.fromMillis(0).valueOf()).toBe(0);
});

test("DateTime.fromMillis(ms) accepts a zone option", () => {
  const value = 391147200000,
    dateTime = DateTime.fromMillis(value, { zone: "America/Santiago" });

  expect(dateTime.valueOf()).toBe(value);
  expect(dateTime.zoneName).toBe("America/Santiago");
});

test("DateTime.fromMillis accepts the default locale", () => {
  withDefaultLocale("fr", () => expect(DateTime.fromMillis(391147200000).locale).toBe("fr"));
});

test("DateTime.fromMillis(ms) throws InvalidArgumentError for non-numeric input", () => {
  expect(() => DateTime.fromMillis("slurp")).toThrow();
});

test("DateTime.fromMillis(ms) does not accept out-of-bounds numbers", () => {
  expect(DateTime.fromMillis(-8.64e15 - 1).isValid).toBe(false);
  expect(DateTime.fromMillis(8.64e15 + 1).isValid).toBe(false);
});

test("DateTime.fromMillis(ms) does not accept non-finite numbers", () => {
  expect(DateTime.fromMillis(Infinity).isValid).toBe(false);
  expect(DateTime.fromMillis(-Infinity).isValid).toBe(false);
  expect(DateTime.fromMillis(NaN).isValid).toBe(false);
});

//------
// .fromSeconds()
//-------
test("DateTime.fromSeconds(seconds) has a value of 1000 * seconds", () => {
  const seconds = 391147200;
  expect(DateTime.fromSeconds(seconds).valueOf()).toBe(1000 * seconds);

  expect(DateTime.fromSeconds(0).valueOf()).toBe(0);
});

test("DateTime.fromSeconds(ms) accepts a zone option", () => {
  const seconds = 391147200,
    dateTime = DateTime.fromSeconds(seconds, { zone: "America/Santiago" });

  expect(dateTime.valueOf()).toBe(1000 * seconds);
  expect(dateTime.zoneName).toBe("America/Santiago");
});

test("DateTime.fromSeconds accepts the default locale", () => {
  withDefaultLocale("fr", () => expect(DateTime.fromSeconds(391147200).locale).toBe("fr"));
});

test("DateTime.fromSeconds(seconds) throws InvalidArgumentError for non-numeric input", () => {
  expect(() => DateTime.fromSeconds("slurp")).toThrow();
});

test("DateTime.fromSeconds(seconds) does not accept out-of-bounds numbers", () => {
  expect(DateTime.fromSeconds(-8.64e12 - 1).isValid).toBe(false);
  expect(DateTime.fromSeconds(8.64e12 + 1).isValid).toBe(false);
});

test("DateTime.fromSeconds(seconds) does not accept non-finite numbers", () => {
  expect(DateTime.fromSeconds(Infinity).isValid).toBe(false);
  expect(DateTime.fromSeconds(-Infinity).isValid).toBe(false);
  expect(DateTime.fromSeconds(NaN).isValid).toBe(false);
});

const stockUTCFields = (ts) => {
  const d = new Date(ts);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
};

const startOfUTCYear = (year) => {
  const d = new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(year, 0, 1);
  return d.valueOf();
};

test.each([
  [
    "positive",
    1.75,
    { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 1 },
  ],
  [
    "negative",
    -1.75,
    { year: 1969, month: 12, day: 31, hour: 23, minute: 59, second: 59, millisecond: 999 },
  ],
])(
  "DateTime.fromMillis preserves a %s fractional instant while truncating its fields",
  (_sign, ms, fields) => {
    const dt = DateTime.fromMillis(ms, { zone: "UTC" });

    expect(dt.valueOf()).toBe(ms);
    expect(dt.toObject()).toEqual(fields);
  }
);

test("DateTime.fromMillis reads proleptic and TimeClip boundary fields like Date", () => {
  const maxDate = 8.64e15;
  const instants = [
    0,
    -1,
    1,
    -86400000,
    -86399999,
    86400000,
    -2208988800000,
    -12212553600000,
    -62135596800000,
    -62167219200000,
    -62198755200000,
    -maxDate,
    maxDate,
    -maxDate + 1,
    maxDate - 1,
    1e15,
    -1e15,
    951782400000,
    4107542400000,
  ];

  for (const ts of instants) {
    const dt = DateTime.fromMillis(ts, { zone: "UTC" });
    expect(dt.isValid).toBe(true);
    expect(dt.toObject()).toEqual(stockUTCFields(ts));
  }
});

test("DateTime.fromMillis preserves dates across Gregorian 4, 100, and 400-year boundaries", () => {
  const years = [
    -400, -100, -4, -1, 0, 1, 4, 99, 100, 400, 1583, 1900, 1969, 1972, 2000, 2024, 2100, 2400,
  ];

  for (const year of years) {
    const start = startOfUTCYear(year);
    const end = startOfUTCYear(year + 1);

    for (let ts = start; ts < end; ts += 86400000) {
      const dt = DateTime.fromMillis(ts, { zone: "UTC" });
      const expected = stockUTCFields(ts);
      expect({ year: dt.year, month: dt.month, day: dt.day }).toEqual({
        year: expected.year,
        month: expected.month,
        day: expected.day,
      });
    }
  }
});

test("DateTime.fromMillis applies zone offsets before reading boundary fields", () => {
  const instants = [0, -1, -62167219200000, -8.64e15 + 1, 8.64e15 - 1, 951782400000];
  const invalid = new Set([
    `America/New_York|${-8.64e15 + 1}`,
    `Asia/Kathmandu|${8.64e15 - 1}`,
    `Pacific/Kiritimati|${-8.64e15 + 1}`,
    `Pacific/Kiritimati|${8.64e15 - 1}`,
  ]);

  for (const zone of ["America/New_York", "Asia/Kathmandu", "Pacific/Kiritimati"]) {
    for (const ts of instants) {
      const dt = DateTime.fromMillis(ts, { zone });
      const shouldBeValid = !invalid.has(`${zone}|${ts}`);
      expect(dt.isValid).toBe(shouldBeValid);
      if (!shouldBeValid) continue;

      const expected = stockUTCFields(ts + dt.offset * 60000);
      expect({
        year: dt.year,
        month: dt.month,
        day: dt.day,
        hour: dt.hour,
        minute: dt.minute,
        second: dt.second,
      }).toEqual({
        year: expected.year,
        month: expected.month,
        day: expected.day,
        hour: expected.hour,
        minute: expected.minute,
        second: expected.second,
      });
    }
  }
});

test("DateTime.fromSeconds keeps fractional instants while truncating displayed fields", () => {
  for (const seconds of [1.0006, -1.0006, 0.9994, -0.9994, 1.5, -1.5]) {
    const dt = DateTime.fromSeconds(seconds, { zone: "UTC" });
    expect(dt.valueOf()).toBe(seconds * 1000);
    expect(dt.toObject()).toEqual(stockUTCFields(Math.trunc(seconds * 1000)));
  }
});

test("DateTime arithmetic enforces the TimeClip boundary", () => {
  expect(DateTime.fromMillis(8.64e15, { zone: "UTC" }).isValid).toBe(true);
  expect(DateTime.fromMillis(8.64e15, { zone: "UTC" }).plus({ milliseconds: 1 }).isValid).toBe(
    false
  );
  expect(DateTime.fromMillis(-8.64e15, { zone: "UTC" }).minus({ milliseconds: 1 }).isValid).toBe(
    false
  );
});

test("DateTime civil conversion round-trips Gregorian edge cases", () => {
  const cases = [
    [-271821, 4, 20],
    [-400, 2, 29],
    [-1, 12, 31],
    [0, 2, 29],
    [1, 3, 1],
    [99, 12, 31],
    [100, 1, 1],
    [1600, 2, 29],
    [1900, 3, 1],
    [1970, 1, 1],
    [1970, 3, 31],
    [2000, 2, 29],
    [275760, 9, 13],
  ];

  for (const [year, month, day] of cases) {
    const dt = DateTime.fromObject({ year, month, day }, { zone: "UTC" });
    expect(dt.isValid).toBe(true);
    expect(DateTime.fromMillis(dt.valueOf(), { zone: "UTC" }).toObject()).toEqual({
      year,
      month,
      day,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  }
});

test("DateTime ISO output pads ordinary and expanded years and fixed offsets", () => {
  const pad = (n, width) => `${n < 0 ? "-" : ""}${String(Math.abs(n)).padStart(width, "0")}`;

  for (const year of [1, 9, 99, 100, 999, 1000, 2024, 9999]) {
    const dt = DateTime.fromObject(
      { year, month: 2, day: 3, hour: 4, minute: 5, second: 6, millisecond: 7 },
      { zone: "UTC" }
    );
    expect(dt.toISO({ suppressMilliseconds: false })).toBe(`${pad(year, 4)}-02-03T04:05:06.007Z`);
  }

  for (const year of [-1, -44, -2024, 10000, 275760]) {
    const dt = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: "UTC" });
    expect(dt.isValid).toBe(true);
    expect(dt.toISO().slice(0, 7)).toBe(`${year < 0 ? "-" : "+"}${pad(Math.abs(year), 6)}`);
  }

  for (const [zone, offset] of [
    ["UTC+5:45", "+05:45"],
    ["UTC-8", "-08:00"],
    ["UTC+14", "+14:00"],
    ["UTC-9:30", "-09:30"],
  ]) {
    expect(DateTime.fromMillis(1710053999000, { zone }).toISO().slice(-6)).toBe(offset);
  }
});

test("DateTime formatting preserves numbering systems, literals, and memoized formats", () => {
  const dt = DateTime.fromMillis(1710053999000, { zone: "UTC" });

  expect(dt.reconfigure({ locale: "en-US" }).toFormat("yyyy-MM-dd")).toBe("2024-03-10");
  expect(dt.reconfigure({ locale: "ar-EG", numberingSystem: "arab" }).toFormat("yyyy")).toBe(
    "٢٠٢٤"
  );
  expect(dt.reconfigure({ locale: "en-US", numberingSystem: "beng" }).toFormat("dd")).toBe("১০");
  expect(dt.reconfigure({ locale: "th-TH", numberingSystem: "thai" }).toFormat("MM")).toBe("๐๓");
  expect(dt.toFormat("yyyy-MM-dd'T'HH:mm:ss")).toBe("2024-03-10T06:59:59");
  expect(dt.toFormat("//--..::")).toBe("//--..::");
  expect(dt.toFormat("(yyyy) [MM] {dd}")).toBe("(2024) [03] {10}");
  expect(dt.toFormat("y!!!")).toBe("2024!!!");
  expect(dt.toFormat("Q")).toBe("Q");

  const formats = [
    ["yyyy", "2024"],
    ["yy", "24"],
    ["MM", "03"],
    ["M", "3"],
    ["MMM", "Mar"],
    ["MMMM", "March"],
    ["dd/MM/yyyy", "10/03/2024"],
    ["yyyy/MM/dd", "2024/03/10"],
    ["HH:mm:ss.SSS", "06:59:59.000"],
    ["'yyyy'", "yyyy"],
  ];
  for (let pass = 0; pass < 2; pass++) {
    for (const [format, expected] of formats) {
      expect(dt.toFormat(format)).toBe(expected);
    }
  }
});

//------
// .fromObject()
//-------
const baseObject = {
  year: 1982,
  month: 5,
  day: 25,
  hour: 9,
  minute: 23,
  second: 54,
  millisecond: 123,
};

test("DateTime.fromObject() sets all the fields", () => {
  const dateTime = DateTime.fromObject(baseObject);

  expect(dateTime.isOffsetFixed).toBe(false);
  expect(dateTime.year).toBe(1982);
  expect(dateTime.month).toBe(5);
  expect(dateTime.day).toBe(25);
  expect(dateTime.hour).toBe(9);
  expect(dateTime.minute).toBe(23);
  expect(dateTime.second).toBe(54);
  expect(dateTime.millisecond).toBe(123);
});

test('DateTime.fromObject() accepts a zone option of "utc"', () => {
  const dateTime = DateTime.fromObject(baseObject, { zone: "utc" });

  expect(dateTime.isOffsetFixed).toBe(true);
  expect(dateTime.year).toBe(1982);
  expect(dateTime.month).toBe(5);
  expect(dateTime.day).toBe(25);
  expect(dateTime.hour).toBe(9);
  expect(dateTime.minute).toBe(23);
  expect(dateTime.second).toBe(54);
  expect(dateTime.millisecond).toBe(123);
});

test('DateTime.fromObject() accepts "utc-8" as the zone option', () => {
  const dateTime = DateTime.fromObject(baseObject, { zone: "utc-8" });

  expect(dateTime.isOffsetFixed).toBe(true);
  expect(dateTime.offset).toBe(-8 * 60);
  expect(dateTime.year).toBe(1982);
  expect(dateTime.month).toBe(5);
  expect(dateTime.day).toBe(25);
  expect(dateTime.hour).toBe(9);
  expect(dateTime.minute).toBe(23);
  expect(dateTime.second).toBe(54);
  expect(dateTime.millisecond).toBe(123);
});

test('DateTime.fromObject() accepts "America/Los_Angeles" as the zone option', () => {
  const dateTime = DateTime.fromObject(baseObject, { zone: "America/Los_Angeles" });

  expect(dateTime.isOffsetFixed).toBe(false);
  expect(dateTime.offset).toBe(-7 * 60);
  expect(dateTime.year).toBe(1982);
  expect(dateTime.month).toBe(5);
  expect(dateTime.day).toBe(25);
  expect(dateTime.hour).toBe(9);
  expect(dateTime.minute).toBe(23);
  expect(dateTime.second).toBe(54);
  expect(dateTime.millisecond).toBe(123);
});

test("DateTime.fromObject() accepts a Zone as the zone option", () => {
  const daylight = DateTime.fromObject(
    { ...baseObject, month: 5 },
    { zone: "America/Los_Angeles" }
  );
  const standard = DateTime.fromObject(
    { ...baseObject, month: 12 },
    { zone: "America/Los_Angeles" }
  );

  expect(daylight.isOffsetFixed).toBe(false);
  expect(daylight.offset).toBe(-7 * 60);
  expect(daylight.year).toBe(1982);
  expect(daylight.month).toBe(5);
  expect(daylight.day).toBe(25);
  expect(daylight.hour).toBe(9);
  expect(daylight.minute).toBe(23);
  expect(daylight.second).toBe(54);
  expect(daylight.millisecond).toBe(123);

  expect(standard.isOffsetFixed).toBe(false);
  expect(standard.offset).toBe(-8 * 60);
  expect(standard.year).toBe(1982);
  expect(standard.month).toBe(12);
  expect(standard.day).toBe(25);
  expect(standard.hour).toBe(9);
  expect(standard.minute).toBe(23);
  expect(standard.second).toBe(54);
  expect(standard.millisecond).toBe(123);
});

test("DateTime.fromObject() rejects invalid zones", () => {
  const dt = DateTime.fromObject({}, { zone: "blorp" });
  expect(dt.isValid).toBe(false);
  expect(dt.invalidReason).toBe("unsupported zone");
});

test("DateTime.fromObject() ignores the case of object keys", () => {
  const dt = DateTime.fromObject({ Year: 2019, MONTH: 4, daYs: 10 });
  expect(dt.isValid).toBe(true);
  expect(dt.year).toBe(2019);
  expect(dt.month).toBe(4);
  expect(dt.day).toBe(10);
});

test("DateTime.fromObject() throws with invalid object key", () => {
  expect(() => DateTime.fromObject({ invalidUnit: 42 })).toThrow();
});

test("DateTime.fromObject() throws with invalid value types", () => {
  expect(() => DateTime.fromObject({ year: "blorp" })).toThrow();
  expect(() => DateTime.fromObject({ year: "" })).toThrow();
  expect(() => DateTime.fromObject({ month: NaN })).toThrow();
  expect(() => DateTime.fromObject({ month: Infinity })).toThrow();
  expect(() => DateTime.fromObject({ month: -Infinity })).toThrow();
  expect(() => DateTime.fromObject({ day: true })).toThrow();
  expect(() => DateTime.fromObject({ day: false })).toThrow();
  expect(() => DateTime.fromObject({ hour: {} })).toThrow();
  expect(() => DateTime.fromObject({ hour: { unit: 42 } })).toThrow();
});

test("DateTime.fromObject() reject invalid values", () => {
  expect(DateTime.fromObject({ ordinal: 5000 }).isValid).toBe(false);
  expect(DateTime.fromObject({ minute: -6 }).isValid).toBe(false);
  expect(DateTime.fromObject({ millisecond: new Date() }).isValid).toBe(false);
});

test.each([
  [
    "week year",
    { weekYear: 2020.5, weekNumber: 1 },
    "you specified 2020.5 (of type number) as a weekYear, which is invalid",
  ],
  [
    "ordinal year",
    { year: 2020.5, ordinal: 1 },
    "you specified 2020.5 (of type number) as a year, which is invalid",
  ],
  [
    "Gregorian year",
    { year: 2020.5, month: 1, day: 1 },
    "you specified 2020.5 (of type number) as a year, which is invalid",
  ],
  [
    "second",
    { year: 2020, month: 1, day: 1, second: 60 },
    "you specified 60 (of type number) as a second, which is invalid",
  ],
])("DateTime.fromObject() reports details for an invalid %s", (_label, input, explanation) => {
  const dt = DateTime.fromObject(input);

  expect(dt.invalidReason).toBe("unit out of range");
  expect(dt.invalidExplanation).toBe(explanation);
});

test("DateTime.fromObject() defaults high-order values to the current date", () => {
  const dateTime = DateTime.fromObject({}),
    now = DateTime.now();

  expect(dateTime.year).toBe(now.year);
  expect(dateTime.month).toBe(now.month);
  expect(dateTime.day).toBe(now.day);
});

test("DateTime.fromObject() defaults lower-order values to their minimums if a high-order value is set", () => {
  const dateTime = DateTime.fromObject({ year: 2017 });
  expect(dateTime.year).toBe(2017);
  expect(dateTime.month).toBe(1);
  expect(dateTime.day).toBe(1);
  expect(dateTime.hour).toBe(0);
  expect(dateTime.minute).toBe(0);
  expect(dateTime.second).toBe(0);
  expect(dateTime.millisecond).toBe(0);
});

test("DateTime.fromObject() w/weeks handles fully specified dates", () => {
  const dt = DateTime.fromObject({
    weekYear: 2016,
    weekNumber: 2,
    weekday: 3,
    hour: 9,
    minute: 23,
    second: 54,
    millisecond: 123,
  });
  expect(dt.weekYear).toBe(2016);
  expect(dt.weekNumber).toBe(2);
  expect(dt.weekday).toBe(3);
  expect(dt.year).toBe(2016);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(13);
});

test("DateTime.fromObject() w/weekYears handles skew with Gregorian years", () => {
  let dt = DateTime.fromObject({ weekYear: 2015, weekNumber: 1, weekday: 3 });
  expect(dt.weekYear).toBe(2015);
  expect(dt.weekNumber).toBe(1);
  expect(dt.weekday).toBe(3);
  expect(dt.year).toBe(2014);
  expect(dt.month).toBe(12);
  expect(dt.day).toBe(31);

  dt = DateTime.fromObject({ weekYear: 2009, weekNumber: 53, weekday: 5 });
  expect(dt.weekYear).toBe(2009);
  expect(dt.weekNumber).toBe(53);
  expect(dt.weekday).toBe(5);
  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(1);
});

test("DateTime.fromObject() w/weeks defaults high-order values to the current date", () => {
  const dt = DateTime.fromObject({ weekday: 2 }),
    now = DateTime.now();

  expect(dt.weekYear).toBe(now.weekYear);
  expect(dt.weekNumber).toBe(now.weekNumber);
  expect(dt.weekday).toBe(2);
});

test("DateTime.fromObject() w/weeks defaults low-order values to their minimums", () => {
  const dt = DateTime.fromObject({ weekYear: 2016 });

  expect(dt.weekYear).toBe(2016);
  expect(dt.weekNumber).toBe(1);
  expect(dt.weekday).toBe(1);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.fromObject() w/locale weeks defaults low-order values to their minimums", () => {
  const dt = DateTime.fromObject({ localWeekYear: 2016 }, { locale: "en-US" });

  expect(dt.localWeekYear).toBe(2016);
  expect(dt.localWeekNumber).toBe(1);
  expect(dt.localWeekday).toBe(1);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime.fromObject() w/locale weeks defaults high-order values to the current date", () => {
  const dt = DateTime.fromObject({ localWeekday: 2 }, { locale: "en-US" }),
    now = DateTime.local({ locale: "en-US" });

  expect(dt.localWeekYear).toBe(now.localWeekYear);
  expect(dt.localWeekNumber).toBe(now.localWeekNumber);
  expect(dt.localWeekday).toBe(2);
});

test("DateTime.fromObject() w/locale weeks handles fully specified dates", () => {
  const dt = DateTime.fromObject(
    {
      localWeekYear: 2022,
      localWeekNumber: 2,
      localWeekday: 3,
      hour: 9,
      minute: 23,
      second: 54,
      millisecond: 123,
    },
    { locale: "en-US" }
  );
  expect(dt.localWeekYear).toBe(2022);
  expect(dt.localWeekNumber).toBe(2);
  expect(dt.localWeekday).toBe(3);
  expect(dt.year).toBe(2022);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(supportsMinDaysInFirstWeek() ? 4 : 11);
});

test("DateTime.fromObject() w/locale weeks handles fully specified dates with custom week settings", () => {
  withDefaultWeekSettings(
    {
      firstDay: 7,
      minimalDays: 1,
      weekend: [6, 7],
    },
    () => {
      const dt = DateTime.fromObject(
        {
          localWeekYear: 2022,
          localWeekNumber: 2,
          localWeekday: 3,
          hour: 9,
          minute: 23,
          second: 54,
          millisecond: 123,
        },
        { locale: "en-US" }
      );
      expect(dt.localWeekYear).toBe(2022);
      expect(dt.localWeekNumber).toBe(2);
      expect(dt.localWeekday).toBe(3);
      expect(dt.year).toBe(2022);
      expect(dt.month).toBe(1);
      expect(dt.day).toBe(4);
    }
  );
});

test("DateTime.fromObject() w/localWeekYears handles skew with Gregorian years", () => {
  let dt = DateTime.fromObject(
    { localWeekYear: 2022, localWeekNumber: 1, localWeekday: 1 },
    { locale: "en-US" }
  );
  expect(dt.localWeekYear).toBe(2022);
  expect(dt.localWeekNumber).toBe(1);
  expect(dt.localWeekday).toBe(1);
  expect(dt.year).toBe(supportsMinDaysInFirstWeek() ? 2021 : 2022);
  expect(dt.month).toBe(supportsMinDaysInFirstWeek() ? 12 : 1);
  expect(dt.day).toBe(supportsMinDaysInFirstWeek() ? 26 : 2);

  dt = DateTime.fromObject(
    { localWeekYear: 2009, localWeekNumber: 53, localWeekday: 5 },
    { locale: "de-DE" }
  );
  expect(dt.localWeekYear).toBe(2009);
  expect(dt.localWeekNumber).toBe(53);
  expect(dt.localWeekday).toBe(5);
  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(1);
});

test("DateTime.fromObject() w/localWeekYears handles skew with Gregorian years and custom week settings", () => {
  withDefaultWeekSettings(
    {
      firstDay: 7,
      minimalDays: 1,
      weekend: [6, 7],
    },
    () => {
      let dt = DateTime.fromObject({ localWeekYear: 2022, localWeekNumber: 1, localWeekday: 1 });
      expect(dt.localWeekYear).toBe(2022);
      expect(dt.localWeekNumber).toBe(1);
      expect(dt.localWeekday).toBe(1);
      expect(dt.year).toBe(2021);
      expect(dt.month).toBe(12);
      expect(dt.day).toBe(26);
    }
  );
});

test("DateTime.fromObject throws when both locale based weeks and ISO-weeks are specified", () => {
  expect(() => DateTime.fromObject({ localWeekYear: 2022, weekNumber: 12 })).toThrow();
  expect(() => DateTime.fromObject({ localWeekYear: 2022, weekday: 2 })).toThrow();
});

test("DateTime.fromObject() w/ordinals handles fully specified dates", () => {
  const dt = DateTime.fromObject({
    year: 2016,
    ordinal: 200,
    hour: 9,
    minute: 23,
    second: 54,
    millisecond: 123,
  });
  expect(dt.year).toBe(2016);
  expect(dt.ordinal).toBe(200);
  expect(dt.month).toBe(7);
  expect(dt.day).toBe(18);
});

test("DateTime.fromObject() w/ordinal defaults to the current year", () => {
  const dt = DateTime.fromObject({ ordinal: 200 }),
    now = DateTime.now();
  expect(dt.year).toBe(now.year);
  expect(dt.ordinal).toBe(200);
});

test("DateTime.fromObject() returns invalid for invalid values", () => {
  expect(DateTime.fromObject({ weekYear: 2017, weekNumber: 54 }).isValid).toBe(false);
  expect(DateTime.fromObject({ weekYear: 2017, weekNumber: 3.6 }).isValid).toBe(false);
  expect(DateTime.fromObject({ weekYear: 2017, weekNumber: 15, weekday: 0 }).isValid).toBe(false);
});

test("DateTime.fromObject accepts the default locale", () => {
  withDefaultLocale("fr", () => expect(DateTime.fromObject({}).locale).toBe("fr"));
});

test("DateTime.fromObject accepts really low year numbers", () => {
  const dt = DateTime.fromObject({ year: 5 });
  expect(dt.year).toBe(5);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(1);
});

test("DateTime.fromObject accepts really low year numbers with IANA zones", () => {
  const dt = DateTime.fromObject({ year: 5 }, { zone: "America/New_York" });
  expect(dt.year).toBe(5);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(1);
});

test("DateTime.fromObject accepts plurals and weird capitalization", () => {
  const dt = DateTime.fromObject({ Year: 2005, months: 12, dAy: 13 });
  expect(dt.year).toBe(2005);
  expect(dt.month).toBe(12);
  expect(dt.day).toBe(13);
});

test("DateTime.fromObject validates weekdays", () => {
  let dt = DateTime.fromObject({ year: 2005, months: 12, day: 13, weekday: 1 });
  expect(dt.isValid).toBe(false);

  dt = DateTime.fromObject({ year: 2005, months: 12, day: 13, weekday: 2 });
  expect(dt.isValid).toBe(true);
});

test("DateTime.fromObject accepts a locale", () => {
  const res = DateTime.fromObject({}, { locale: "be" });
  expect(res.locale).toBe("be");
});

test("DateTime.fromObject accepts a locale with calendar and numbering identifiers", () => {
  const res = DateTime.fromObject({}, { locale: "be-u-ca-coptic-nu-mong" });
  expect(res.locale).toBe("be-u-ca-coptic-nu-mong");
  expect(res.outputCalendar).toBe("coptic");
  expect(res.numberingSystem).toBe("mong");
});

test("DateTime.fromObject accepts a locale string with weird junk in it", () => {
  withDefaultLocale("en-US", () => {
    const res = DateTime.fromObject(
      {},
      {
        locale: "be-u-ca-coptic-ca-islamic",
      }
    );

    expect(res.locale).toBe("be-u-ca-coptic-ca-islamic");

    // "coptic" is right, but some versions of Node 10 give "gregory"
    expect(res.outputCalendar === "gregory" || res.outputCalendar === "coptic").toBe(true);
    expect(res.numberingSystem).toBe("latn");
  });
});

test("DateTime.fromObject falls back from a malformed Unicode calendar extension", () => {
  const res = DateTime.fromObject({}, { locale: "en-US-u-ca-" });

  expect(res.locale).toBe("en-US");
  expect(res.outputCalendar).toBe("gregory");
  expect(res.numberingSystem).toBe("latn");
});

test("DateTime.fromObject overrides the locale string with explicit settings", () => {
  const res = DateTime.fromObject(
    {},
    {
      locale: "be-u-ca-coptic-nu-mong",
      numberingSystem: "thai",
      outputCalendar: "islamic",
    }
  );

  expect(res.locale).toBe("be-u-ca-coptic-nu-mong");
  expect(res.outputCalendar).toBe("islamic");
  expect(res.numberingSystem).toBe("thai");
});

test("DateTime.fromObject handles null as a language tag", () => {
  withDefaultLocale("en-GB", () => {
    const res = DateTime.fromObject(
      {},
      {
        locale: null,
        numberingSystem: "thai",
        outputCalendar: "islamic",
      }
    );

    expect(res.locale).toBe("en-GB");
    expect(res.outputCalendar).toBe("islamic");
    expect(res.numberingSystem).toBe("thai");
  });
});

test("DateTime.fromRFC2822 parses GMT correctly", () => {
  const dt = DateTime.fromRFC2822("25 Nov 2016 13:23:12 GMT", { zone: "UTC" });
  expect(dt.year).toBe(2016);
  expect(dt.month).toBe(11);
  expect(dt.day).toBe(25);
  expect(dt.hour).toBe(13);
  expect(dt.minute).toBe(23);
  expect(dt.second).toBe(12);
  expect(dt.millisecond).toBe(0);
  expect(dt.offset).toBe(0);
});

test("DateTime.fromRFC2822 parses Zulu correctly", () => {
  const dt = DateTime.fromRFC2822("25 Nov 2016 13:23 Z", { zone: "UTC" });
  expect(dt.year).toBe(2016);
  expect(dt.month).toBe(11);
  expect(dt.day).toBe(25);
  expect(dt.hour).toBe(13);
  expect(dt.minute).toBe(23);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
  expect(dt.offset).toBe(0);
});

test("DateTime.fromRFC2822 parses offset correctly", () => {
  const dt = DateTime.fromRFC2822("Fri, 25 Nov 2016 13:23:12 +0600", {
    zone: "UTC",
  });
  expect(dt.year).toBe(2016);
  expect(dt.month).toBe(11);
  expect(dt.day).toBe(25);
  expect(dt.hour).toBe(7);
  expect(dt.minute).toBe(23);
  expect(dt.second).toBe(12);
  expect(dt.millisecond).toBe(0);
  expect(dt.offset).toBe(0);
});

test("DateTime.fromRFC2822 is invalid when weekday is not consistent", () => {
  // Actually a Friday, not a Saturday
  expect(DateTime.fromRFC2822("Sat, 25 Nov 2016 13:23:12 +0600").isValid).toBe(false);
});

test("DateTime.fromHTTP parses rfc1123", () => {
  const dt = DateTime.fromHTTP("Sun, 06 Nov 1994 08:49:37 GMT", {
    zone: "UTC",
  });
  expect(dt.year).toBe(1994);
  expect(dt.month).toBe(11);
  expect(dt.day).toBe(6);
  expect(dt.hour).toBe(8);
  expect(dt.minute).toBe(49);
  expect(dt.second).toBe(37);
  expect(dt.millisecond).toBe(0);
  expect(dt.offset).toBe(0);
});

test("DateTime.fromHTTP parses rfc850", () => {
  const dt = DateTime.fromHTTP("Sunday, 06-Nov-94 08:49:37 GMT", {
    zone: "UTC",
  });
  expect(dt.year).toBe(1994);
  expect(dt.month).toBe(11);
  expect(dt.day).toBe(6);
  expect(dt.hour).toBe(8);
  expect(dt.minute).toBe(49);
  expect(dt.second).toBe(37);
  expect(dt.millisecond).toBe(0);
  expect(dt.offset).toBe(0);
});

test("DateTime.fromHTTP parses ascii", () => {
  const dt = DateTime.fromHTTP("Sun Nov  6 08:49:37 1994", { zone: "UTC" });
  expect(dt.year).toBe(1994);
  expect(dt.month).toBe(11);
  expect(dt.day).toBe(6);
  expect(dt.hour).toBe(8);
  expect(dt.minute).toBe(49);
  expect(dt.second).toBe(37);
  expect(dt.millisecond).toBe(0);
  expect(dt.offset).toBe(0);
});

test("DateTime.fromHTTP is invalid when weekday is not consistent", () => {
  // Actually a Sunday, not a Saturday
  expect(DateTime.fromRFC2822("Sat, 06 Nov 1994 08:49:37 GMT").isValid).toBe(false);
  expect(DateTime.fromRFC2822("Saturday, 06-Nov-94 08:49:37 GMT").isValid).toBe(false);
  expect(DateTime.fromRFC2822("Sat Nov  6 08:49:37 1994").isValid).toBe(false);
});

test("DateTime.fromObject takes a undefined to mean {}", () => {
  const res = DateTime.fromObject();
  expect(res.year).toBe(new Date().getFullYear());
});

test("private language subtags don't break unicode subtags", () => {
  const res = DateTime.fromObject(
    {},
    {
      locale: "be-u-ca-coptic-nu-mong-x-twain",
      numberingSystem: "thai",
      outputCalendar: "islamic",
    }
  );

  expect(res.locale).toBe("be-u-ca-coptic-nu-mong");
  expect(res.outputCalendar).toBe("islamic");
  expect(res.numberingSystem).toBe("thai");
});

test("DateTime.local works even after time zone change", () => {
  // This test catches errors produced when guessOffsetForZone produces wildy wrong guesses
  // This guards against a regression by broken caching in that method
  Settings.resetCaches();
  withDefaultZone("America/Los_Angeles", () => {
    expect(DateTime.local(2024).year).toBe(2024);
  });
  withDefaultZone("America/Chicago", () => {
    const dateTime = DateTime.local(2024, 11, 3, 0, 5, 0);
    expect(dateTime.zoneName).toBe("America/Chicago");
    expect(dateTime.toObject()).toEqual({
      year: 2024,
      month: 11,
      day: 3,
      hour: 0,
      minute: 5,
      second: 0,
      millisecond: 0,
    });
  });
});
