import DateTime from "../../src/datetime";

const Helpers = require("../helpers");

/* global expect test */

const hasNativeFrenchRTF =
  typeof Intl.RelativeTimeFormat === "function" &&
  Intl.RelativeTimeFormat.supportedLocalesOf("fr").length > 0;
const nativeRTFTest = hasNativeFrenchRTF ? test : test.skip;

//------
// #toRelative()
//-------

test("DateTime#toRelative works down through the units", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14 });
  expect(base.plus({ minutes: 1 }).toRelative({ base })).toBe("in 1 minute");
  expect(base.plus({ minutes: 5 }).toRelative({ base })).toBe("in 5 minutes");
  expect(base.plus({ minutes: 65 }).toRelative({ base })).toBe("in 1 hour");
  expect(base.plus({ minutes: 165 }).toRelative({ base })).toBe("in 2 hours");
  expect(base.plus({ hours: 24 }).toRelative({ base })).toBe("in 1 day");
  expect(base.plus({ days: 3 }).toRelative({ base })).toBe("in 3 days");
  expect(base.plus({ months: 5 }).toRelative({ base })).toBe("in 5 months");
  expect(base.plus({ months: 15 }).toRelative({ base })).toBe("in 1 year");

  expect(base.minus({ minutes: 1 }).toRelative({ base })).toBe("1 minute ago");
  expect(base.minus({ minutes: 5 }).toRelative({ base })).toBe("5 minutes ago");
  expect(base.minus({ minutes: 65 }).toRelative({ base })).toBe("1 hour ago");
  expect(base.minus({ minutes: 165 }).toRelative({ base })).toBe("2 hours ago");
  expect(base.minus({ hours: 24 }).toRelative({ base })).toBe("1 day ago");
  expect(base.minus({ days: 3 }).toRelative({ base })).toBe("3 days ago");
  expect(base.minus({ months: 5 }).toRelative({ base })).toBe("5 months ago");
  expect(base.minus({ months: 15 }).toRelative({ base })).toBe("1 year ago");
});

nativeRTFTest("DateTime relative formatting uses native French day phrases", () => {
  const base = DateTime.fromISO("2020-05-15T12:00:00Z", { setZone: true, locale: "fr" });

  expect(base.plus({ days: 1 }).toRelative({ base, unit: "days" })).toBe("dans 1 jour");
  expect(base.minus({ days: 1 }).toRelative({ base, unit: "days" })).toBe("il y a 1 jour");
  expect(base.plus({ days: 1 }).toRelativeCalendar({ base })).toBe("demain");
  expect(base.minus({ days: 1 }).toRelativeCalendar({ base })).toBe("hier");
});

test("DateTime#toRelative allows padding", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14 });
  expect(base.endOf("day").toRelative({ base, padding: 10 })).toBe("in 1 day");
  expect(base.minus({ days: 1, milliseconds: -1 }).toRelative({ base, padding: 10 })).toBe(
    "1 day ago"
  );
});

test("DateTime#toRelative takes a round argument", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14 });
  expect(base.plus({ months: 15 }).toRelative({ base, round: false })).toBe("in 1.25 years");
  expect(base.minus({ months: 15 }).toRelative({ base, round: false })).toBe("1.25 years ago");
});

test("DateTime#toRelative takes a rounding argument", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14 });
  expect(base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "expand" })).toBe(
    "in 2 hours"
  );
  expect(base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "expand" })).toBe(
    "in 3 hours"
  );
  expect(base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "expand" })).toBe(
    "2 hours ago"
  );
  expect(base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "expand" })).toBe(
    "3 hours ago"
  );

  expect(base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "trunc" })).toBe(
    "in 1 hour"
  );
  expect(base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "trunc" })).toBe(
    "in 2 hours"
  );
  expect(base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "trunc" })).toBe(
    "1 hour ago"
  );
  expect(base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "trunc" })).toBe(
    "2 hours ago"
  );

  expect(base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "round" })).toBe(
    "in 2 hours"
  );
  expect(base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "round" })).toBe(
    "in 2 hours"
  );
  expect(base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "round" })).toBe(
    "2 hours ago"
  );
  expect(base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "round" })).toBe(
    "2 hours ago"
  );

  expect(base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "floor" })).toBe(
    "in 1 hour"
  );
  expect(base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "floor" })).toBe(
    "in 2 hours"
  );
  expect(base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "floor" })).toBe(
    "2 hours ago"
  );
  expect(base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "floor" })).toBe(
    "3 hours ago"
  );

  expect(base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "ceil" })).toBe(
    "in 2 hours"
  );
  expect(base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "ceil" })).toBe(
    "in 3 hours"
  );
  expect(base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, rounding: "ceil" })).toBe(
    "1 hour ago"
  );
  expect(base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, rounding: "ceil" })).toBe(
    "2 hours ago"
  );
});

test("DateTime#toRelative takes a round and a rounding argument", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14 });
  expect(
    base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "expand" })
  ).toBe("in 2 hours");
  expect(
    base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "expand" })
  ).toBe("in 2.01 hours");
  expect(
    base
      .minus({ hours: 2, milliseconds: -1 })
      .toRelative({ base, round: false, rounding: "expand" })
  ).toBe("2 hours ago");
  expect(
    base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "expand" })
  ).toBe("2.01 hours ago");

  expect(
    base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "trunc" })
  ).toBe("in 1.99 hours");
  expect(
    base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "trunc" })
  ).toBe("in 2 hours");
  expect(
    base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "trunc" })
  ).toBe("1.99 hours ago");
  expect(
    base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "trunc" })
  ).toBe("2 hours ago");

  expect(
    base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "round" })
  ).toBe("in 2 hours");
  expect(
    base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "round" })
  ).toBe("in 2 hours");
  expect(
    base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "round" })
  ).toBe("2 hours ago");
  expect(
    base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "round" })
  ).toBe("2 hours ago");

  expect(
    base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "floor" })
  ).toBe("in 1.99 hours");
  expect(
    base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "floor" })
  ).toBe("in 2 hours");
  expect(
    base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "floor" })
  ).toBe("2 hours ago");
  expect(
    base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "floor" })
  ).toBe("2.01 hours ago");

  expect(
    base.plus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "ceil" })
  ).toBe("in 2 hours");
  expect(
    base.plus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "ceil" })
  ).toBe("in 2.01 hours");
  expect(
    base.minus({ hours: 2, milliseconds: -1 }).toRelative({ base, round: false, rounding: "ceil" })
  ).toBe("1.99 hours ago");
  expect(
    base.minus({ hours: 2, milliseconds: 1 }).toRelative({ base, round: false, rounding: "ceil" })
  ).toBe("2 hours ago");
});

test("DateTime#toRelative takes a unit argument", () => {
  const base = DateTime.fromObject({ year: 2018, month: 10, day: 14 }, { zone: "UTC" });
  expect(base.plus({ months: 15 }).toRelative({ base, unit: "months" })).toBe("in 15 months");
  expect(base.minus({ months: 15 }).toRelative({ base, unit: "months" })).toBe("15 months ago");
  expect(base.plus({ months: 3 }).toRelative({ base, unit: "years", round: false })).toBe(
    "in 0.25 years"
  );
  expect(base.minus({ months: 3 }).toRelative({ base, unit: "years", round: false })).toBe(
    "0.25 years ago"
  );
  expect(base.minus({ seconds: 30 }).toRelative({ base, unit: ["days", "hours", "minutes"] })).toBe(
    "0 minutes ago"
  );
  expect(base.minus({ seconds: 1 }).toRelative({ base, unit: "minutes" })).toBe("0 minutes ago");
  expect(base.plus({ seconds: 1 }).toRelative({ base, unit: "minutes" })).toBe("in 0 minutes");
  expect(
    base.plus({ seconds: 30 }).toRelative({
      base,
      unit: ["days", "hours", "minutes"],
    })
  ).toBe("in 0 minutes");
  expect(
    base.plus({ years: 2 }).toRelative({
      base,
      unit: ["days", "hours", "minutes"],
    })
  ).toBe("in 731 days");
});

test("DateTime#toRelative always rounds toward 0", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14 });
  expect(base.endOf("day").toRelative({ base })).toBe("in 23 hours");
  expect(base.minus({ days: 1, milliseconds: -1 }).toRelative({ base })).toBe("23 hours ago");
});

test("DateTime#toRelative uses the absolute time", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14, hour: 23, minute: 59 });
  const end = DateTime.fromObject({ year: 1983, month: 10, day: 15, hour: 0, minute: 3 });
  expect(end.toRelative({ base })).toBe("in 4 minutes");
  expect(base.toRelative({ base: end })).toBe("4 minutes ago");
});

Helpers.withoutRTF("DateTime#toRelative works without RTF", () => {
  const base = DateTime.fromObject({ year: 2019, month: 12, day: 25 });

  expect(base.plus({ months: 1 }).toRelative({ base })).toBe("in 1 month");
  expect(base.plus({ months: 1 }).toRelative({ base, style: "narrow" })).toBe("in 1 mo.");
  expect(base.plus({ months: 1 }).toRelative({ base, unit: "days" })).toBe("in 31 days");
  expect(base.plus({ months: 1 }).toRelative({ base, style: "short", unit: "days" })).toBe(
    "in 31 days"
  );
  expect(base.plus({ months: 1, days: 2 }).toRelative({ base, round: false })).toBe(
    "in 1.06 months"
  );
});

Helpers.withoutRTF("DateTime#toRelative falls back to English", () => {
  const base = DateTime.fromObject({ year: 2019, month: 12, day: 25 });
  expect(base.setLocale("fr").plus({ months: 1 }).toRelative({ base })).toBe("in 1 month");
});

test("DateTime#toRelative returns null when used on an invalid date", () => {
  expect(DateTime.invalid("not valid").toRelative()).toBe(null);
});

//------
// #toRelativeCalendar()
//-------

test("DateTime#toRelativeCalendar uses the calendar", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14, hour: 23, minute: 59 });
  const end = DateTime.fromObject({ year: 1983, month: 10, day: 15, hour: 0, minute: 3 });
  expect(end.toRelativeCalendar({ base })).toBe("tomorrow");
});

Helpers.withNow(
  "DateTime#toRelativeCalendar picks the correct unit with no options",
  DateTime.fromObject({ year: 1983, month: 10, day: 14 }),
  () => {
    const now = DateTime.now();
    expect(now.plus({ days: 1 }).toRelativeCalendar()).toBe("tomorrow");
  }
);

Helpers.withNow(
  "DateTime#toRelativeCalendar picks the correct unit with no options at last day of month",
  DateTime.fromObject({ year: 1983, month: 10, day: 31 }),
  () => {
    const now = DateTime.now();
    expect(now.plus({ days: 1 }).toRelativeCalendar()).toBe("next month");
  }
);

Helpers.withNow(
  "DateTime#toRelativeCalendar picks the correct unit with no options at least day of year",
  DateTime.fromObject({ year: 1983, month: 12, day: 31 }),
  () => {
    const now = DateTime.now();
    expect(now.plus({ days: 1 }).toRelativeCalendar()).toBe("next year");
  }
);

test("DateTime#toRelativeCalendar returns null when used on an invalid date", () => {
  expect(DateTime.invalid("not valid").toRelativeCalendar()).toBe(null);
});

test("DateTime#toRelativeCalendar works down through the units", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14, hour: 12 });
  expect(base.plus({ minutes: 1 }).toRelativeCalendar({ base })).toBe("today");
  expect(base.plus({ minutes: 5 }).toRelativeCalendar({ base })).toBe("today");
  expect(base.plus({ minutes: 65 }).toRelativeCalendar({ base })).toBe("today");
  expect(base.plus({ hours: 13 }).toRelativeCalendar({ base })).toBe("tomorrow");
  expect(base.plus({ days: 3 }).toRelativeCalendar({ base })).toBe("in 3 days");
  expect(base.plus({ months: 1 }).toRelativeCalendar({ base })).toBe("next month");
  expect(base.plus({ months: 5 }).toRelativeCalendar({ base })).toBe("next year");
  expect(base.plus({ months: 15 }).toRelativeCalendar({ base })).toBe("in 2 years");

  expect(base.minus({ minutes: 1 }).toRelativeCalendar({ base })).toBe("today");
  expect(base.minus({ minutes: 5 }).toRelativeCalendar({ base })).toBe("today");
  expect(base.minus({ minutes: 65 }).toRelativeCalendar({ base })).toBe("today");
  expect(base.minus({ hours: 24 }).toRelativeCalendar({ base })).toBe("yesterday");
  expect(base.minus({ days: 3 }).toRelativeCalendar({ base })).toBe("3 days ago");
  expect(base.minus({ months: 1 }).toRelativeCalendar({ base })).toBe("last month");
  expect(base.minus({ months: 5 }).toRelativeCalendar({ base })).toBe("5 months ago");
  expect(base.minus({ months: 15 }).toRelativeCalendar({ base })).toBe("last year");
});

test("DateTime#toRelativeCalendar takes a unit argument", () => {
  const base = DateTime.fromObject({ year: 1983, month: 10, day: 14, hour: 12 }),
    target = base.plus({ months: 3 });
  expect(target.toRelativeCalendar({ base, unit: "months" })).toBe("in 3 months");
});

Helpers.withoutRTF("DateTime#toRelativeCalendar works without RTF", () => {
  const base = DateTime.fromObject({ year: 2019, month: 10, day: 25 });
  expect(base.plus({ months: 1 }).toRelativeCalendar({ base })).toBe("next month");
});

Helpers.withoutRTF("DateTime#toRelativeCalendar falls back to English", () => {
  const base = DateTime.fromObject({ year: 2019, month: 12, day: 25 });
  expect(base.setLocale("fr").plus({ months: 1 }).toRelativeCalendar({ base })).toBe("next year");
});

test("DateTime#toRelativeCalendar works down through the units for different zone than local", () => {
  const target = DateTime.now().setZone(`UTC+3`),
    target1 = target.plus({ days: 1 }),
    target2 = target1.plus({ days: 1 }),
    target3 = target2.plus({ days: 1 }),
    options = { unit: "days" };

  expect(target.toRelativeCalendar(options)).toBe("today");
  expect(target1.toRelativeCalendar(options)).toBe("tomorrow");
  expect(target2.toRelativeCalendar(options)).toBe("in 2 days");
  expect(target3.toRelativeCalendar(options)).toBe("in 3 days");
});

test("DateTime#toRelative works down through the units for different zone than local", () => {
  const base = DateTime.now().setZone(`UTC+3`);

  expect(base.plus({ minutes: 65 }).toRelative()).toBe("in 1 hour");
  expect(base.plus({ minutes: 165 }).toRelative()).toBe("in 2 hours");
  expect(base.plus({ hours: 25 }).toRelative()).toBe("in 1 day");
  expect(base.plus({ months: 15 }).toRelative()).toBe("in 1 year");

  expect(base.minus({ minutes: 65 }).toRelative()).toBe("1 hour ago");
  expect(base.minus({ minutes: 165 }).toRelative()).toBe("2 hours ago");
  expect(base.minus({ hours: 25 }).toRelative()).toBe("1 day ago");
  expect(base.minus({ months: 15 }).toRelative()).toBe("1 year ago");
});

test("DateTime#toRelative reports units shortened by historical zone jumps", () => {
  const cases = [
    [
      "Pacific/Apia",
      "2011-12-24T00:00",
      "2011-12-31T00:00",
      ["weeks", "days", "hours"],
      "in 1 week",
    ],
    [
      "Antarctica/Davis",
      "1969-01-31T00:00",
      "1969-04-30T00:00",
      ["quarters", "months", "days"],
      "in 1 quarter",
    ],
    [
      "Antarctica/Davis",
      "1969-01-31T00:00",
      "1969-02-28T00:00",
      ["months", "weeks", "days"],
      "in 1 month",
    ],
    ["Antarctica/Macquarie", "1948-03-24T10:00", "1948-03-25T10:00", ["days", "hours"], "in 1 day"],
    [
      "Pacific/Enderbury",
      "1994-11-21T00:00",
      "1995-11-21T00:00",
      ["years", "months", "days"],
      "in 1 year",
    ],
  ];

  for (const [zone, from, to, units, expected] of cases) {
    const base = DateTime.fromISO(from, { zone });
    const target = DateTime.fromISO(to, { zone });

    expect(target.toRelative({ base, unit: units })).toBe(expected);
  }
});

test("DateTime#toRelative finds a backward six-day week across the Pacific/Apia jump", () => {
  const base = DateTime.fromISO("2011-12-31T00:00", { zone: "Pacific/Apia" });
  const target = DateTime.fromISO("2011-12-24T00:00", { zone: "Pacific/Apia" });
  const units = ["weeks", "days", "hours"];

  expect(target.diff(base, "weeks").weeks).toBe(-1);
  expect(target.toRelative({ base, unit: units })).toBe(target.toRelative({ base, unit: "weeks" }));
});

test("DateTime#toRelative finds a backward shortened quarter in Antarctica/Davis", () => {
  const base = DateTime.fromISO("1969-04-30T00:00", { zone: "Antarctica/Davis" });
  const target = DateTime.fromISO("1969-01-31T00:00", { zone: "Antarctica/Davis" });
  const units = ["quarters", "months", "days"];

  expect(target.diff(base, "quarters").quarters).toBe(-1);
  expect(target.toRelative({ base, unit: units })).toBe(
    target.toRelative({ base, unit: "quarters" })
  );
});

test("DateTime#toRelative applies padding across the Pacific/Apia date-line jump", () => {
  const base = DateTime.fromISO("2011-12-24T00:00", { zone: "Pacific/Apia" });
  const target = DateTime.fromISO("2011-12-29T23:00", { zone: "Pacific/Apia" });
  const padding = 2 * 3600000;
  const units = ["weeks", "days", "hours"];
  const paddedTarget = target.plus(padding);

  expect(paddedTarget.toISO()).toBe("2011-12-31T01:00:00.000+14:00");
  expect(target.toRelative({ base, unit: units })).toBe(target.toRelative({ base, unit: "days" }));
  expect(target.toRelative({ base, unit: units, padding })).toBe(
    paddedTarget.toRelative({ base, unit: "weeks" })
  );
});

test("DateTime#toRelative does not skip spans that only just reach a unit", () => {
  const cases = [
    ["seconds", "2023-01-01T00:00:00", "2023-01-01T00:00:01", ["seconds"]],
    ["minutes", "2023-01-01T00:00:00", "2023-01-01T00:01:00", ["minutes", "seconds"]],
    ["hours", "2023-01-01T00:00:00", "2023-01-01T01:00:00", ["hours", "minutes"]],
    ["days", "2023-01-01T00:00:00", "2023-01-02T00:00:00", ["days", "hours"]],
    ["weeks", "2023-01-01T00:00:00", "2023-01-08T00:00:00", ["weeks", "days"]],
    ["months", "2023-01-31T00:00:00", "2023-02-28T00:00:00", ["months", "weeks"]],
    ["quarters", "2023-01-31T00:00:00", "2023-04-30T00:00:00", ["quarters", "months"]],
    ["years", "2024-02-29T00:00:00", "2025-02-28T00:00:00", ["years", "months"]],
  ];

  for (const [unit, from, to, units] of cases) {
    const base = DateTime.fromISO(from, { zone: "UTC" });
    const target = DateTime.fromISO(to, { zone: "UTC" });

    expect(target.toRelative({ base, unit: units })).toBe(target.toRelative({ base, unit }));
    expect(target.toRelative({ base, unit: units })).toMatch(new RegExp(unit.slice(0, -1)));
  }
});

test("DateTime#toRelative falls through for spans just under a unit in both directions", () => {
  const day = 86400000;
  const units = ["years", "quarters", "months", "weeks", "days", "hours", "minutes", "seconds"];
  const base = DateTime.fromISO("2023-06-01T00:00", { zone: "UTC" });
  const cases = [
    [1, 0, "seconds"],
    [999, 0, "seconds"],
    [59999, 59, "seconds"],
    [3599999, 59, "minutes"],
    [day - 1, 23, "hours"],
    [7 * day - 1, 6, "days"],
    [30 * day - 1, 4, "weeks"],
    [364 * day, 3, "quarters"],
  ];

  for (const [delta, amount, unit] of cases) {
    for (const sign of [1, -1]) {
      const target = DateTime.fromMillis(+base + sign * delta, { zone: "UTC" });
      const value = `${amount} ${unit}`;
      const expected = sign > 0 ? `in ${value}` : `${value} ago`;

      expect(target.toRelative({ base, unit: units })).toBe(expected);
    }
  }
});

test("DateTime#toRelativeCalendar keeps calendary boundary semantics", () => {
  const zone = "America/New_York";
  const late = DateTime.fromISO("2024-03-14T23:00", { zone });
  const early = DateTime.fromISO("2024-03-15T01:00", { zone });
  expect(early.toRelativeCalendar({ base: late })).toBe("tomorrow");
  expect(late.toRelativeCalendar({ base: early })).toBe("yesterday");

  const eve = DateTime.fromISO("2023-12-31T23:59", { zone });
  const newYear = DateTime.fromISO("2024-01-01T00:00", { zone });
  expect(newYear.toRelativeCalendar({ base: eve })).toBe("next year");
  expect(eve.toRelativeCalendar({ base: newYear })).toBe("last year");
});

test("DateTime#toRelative padding crosses a day boundary in either direction", () => {
  const base = DateTime.fromISO("2024-01-10T00:00", { zone: "UTC" });
  const ahead = DateTime.fromISO("2024-01-10T23:00", { zone: "UTC" });
  const behind = DateTime.fromISO("2024-01-09T01:00", { zone: "UTC" });

  expect(ahead.toRelative({ base })).toBe("in 23 hours");
  expect(ahead.toRelative({ base, padding: 2 * 3600000 })).toBe("in 1 day");
  expect(behind.toRelative({ base })).toBe("23 hours ago");
  expect(behind.toRelative({ base, padding: 2 * 3600000 })).toBe("1 day ago");
});

test("DateTime#toRelative handles unknown and zero-valued unit lists", () => {
  const base = DateTime.fromISO("2024-05-05T05:05", { zone: "Europe/Berlin" });

  expect(() => base.toRelative({ base, unit: ["fortnights"] })).toThrow(/Invalid unit/);
  expect(base.toRelative({ base })).toBe("in 0 seconds");
  expect(base.toRelative({ base, unit: ["years", "months"] })).toBe("in 0 months");
});
