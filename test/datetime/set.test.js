/* global test expect */

import { DateTime } from "../../src/luxon";
import Helpers, { supportsMinDaysInFirstWeek } from "../helpers";

const withDefaultWeekSettings = Helpers.setUnset("defaultWeekSettings");

const dtFactory = () => DateTime.fromJSDate(new Date(1982, 4, 25, 9, 23, 54, 123));
const dt = dtFactory();

//------
// year/month/day/hour/minute/second/millisecond
//-------
test("DateTime#set() sets Gregorian fields", () => {
  expect(dt.set({ year: 2012 }).year).toBe(2012);
  expect(dt.set({ month: 2 }).month).toBe(2);
  expect(dt.set({ month: 2 }).hour).toBe(9); // this will cross a DST for many people
  expect(dt.set({ day: 5 }).day).toBe(5);
  expect(dt.set({ hour: 4 }).hour).toBe(4);
  expect(dt.set({ minute: 16 }).minute).toBe(16);
  expect(dt.set({ second: 45 }).second).toBe(45);
  expect(dt.set({ millisecond: 86 }).millisecond).toBe(86);
});

test("DateTime#set({ month }) doesn't go to the wrong month", () => {
  const end = DateTime.fromJSDate(new Date(1983, 4, 31)),
    moved = end.set({ month: 4 });
  expect(moved.month).toBe(4);
  expect(moved.day).toBe(30);
});

test("DateTime#set({ year }) doesn't wrap leap years", () => {
  const end = DateTime.fromJSDate(new Date(2012, 1, 29)),
    moved = end.set({ year: 2013 });
  expect(moved.month).toBe(2);
  expect(moved.day).toBe(28);
});

//------
// weekYear/weekNumber/weekday
//------

test("DateTime#set({ weekYear }) sets the date to the same weekNumber/weekday of the target weekYear", () => {
  const modified = dt.set({ weekYear: 2017 });
  expect(modified.weekday).toBe(2); // still tuesday
  expect(modified.weekNumber).toBe(21);
  expect(modified.year).toBe(2017);
  expect(modified.month).toBe(5);
  expect(modified.day).toBe(23); // 2017-W21-2 is the 23
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ weekNumber }) sets the date to the same weekday of the target weekNumber", () => {
  const modified = dt.set({ weekNumber: 2 });
  expect(modified.weekday).toBe(2); // still tuesday
  expect(modified.year).toBe(1982);
  expect(modified.month).toBe(1);
  expect(modified.day).toBe(12);
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ weekday }) sets the weekday to this week's matching day", () => {
  const modified = dt.set({ weekday: 1 });
  expect(modified.weekday).toBe(1);
  expect(modified.year).toBe(1982);
  expect(modified.month).toBe(5);
  expect(modified.day).toBe(24); // monday is the previous day
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ weekday }) handles week year edge cases", () => {
  const endOfWeekIs = (startISO, expectedISO) => {
    const start = DateTime.fromISO(startISO);
    const expected = DateTime.fromISO(expectedISO);
    expect(start.set({ weekday: 7 })).toEqual(expected);
  };

  endOfWeekIs("2016-01-02", "2016-01-03");
  endOfWeekIs("2016-12-29", "2017-01-01");
  endOfWeekIs("2021-01-01", "2021-01-03");
  endOfWeekIs("2028-01-01", "2028-01-02");
});

//------
// locale-based week units
//------

test("DateTime#set({ localWeekday }) sets the weekday to this week's matching day based on the locale (en-US)", () => {
  const modified = dt.reconfigure({ locale: "en-US" }).set({ localWeekday: 1 });
  expect(modified.localWeekday).toBe(1);
  expect(modified.weekday).toBe(7);
  expect(modified.year).toBe(1982);
  expect(modified.month).toBe(5);
  expect(modified.day).toBe(23);
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ localWeekday }) sets the weekday to this week's matching day based on the locale (de-DE)", () => {
  const modified = dt.reconfigure({ locale: "de-DE" }).set({ localWeekday: 1 });
  expect(modified.localWeekday).toBe(1);
  expect(modified.weekday).toBe(1);
  expect(modified.year).toBe(1982);
  expect(modified.month).toBe(5);
  expect(modified.day).toBe(24);
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ localWeekday }) handles crossing over into the previous year", () => {
  const modified = DateTime.local(2022, 1, 1, 9, 23, 54, 123, { locale: "en-US" }).set({
    localWeekday: 2,
  });
  expect(modified.localWeekday).toBe(2);
  expect(modified.weekday).toBe(1);
  expect(modified.year).toBe(2021);
  expect(modified.month).toBe(12);
  expect(modified.day).toBe(27);
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ localWeekday }) handles crossing over into the previous year", () => {
  const modified = DateTime.local(2022, 1, 1, 9, 23, 54, 123, { locale: "en-US" }).set({
    localWeekday: 2,
  });
  expect(modified.localWeekday).toBe(2);
  expect(modified.weekday).toBe(1);
  expect(modified.year).toBe(2021);
  expect(modified.month).toBe(12);
  expect(modified.day).toBe(27);
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ localWeekNumber }) sets the date to the same weekday of the target weekNumber (en-US)", () => {
  const modified = dt.reconfigure({ locale: "en-US" }).set({ localWeekNumber: 2 });
  expect(modified.weekday).toBe(2); // still tuesday
  expect(modified.localWeekNumber).toBe(2);
  expect(modified.year).toBe(1982);
  expect(modified.month).toBe(1);
  expect(modified.day).toBe(supportsMinDaysInFirstWeek() ? 5 : 12);
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ localWeekNumber }) sets the date to the same weekday of the target weekNumber (de-DE)", () => {
  const modified = dt.reconfigure({ locale: "de-DE" }).set({ localWeekNumber: 2 });
  expect(modified.weekday).toBe(2); // still tuesday
  expect(modified.localWeekNumber).toBe(2);
  expect(modified.year).toBe(1982);
  expect(modified.month).toBe(1);
  expect(modified.day).toBe(12);
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ localWeekNumber }) sets the date to the same weekday of the target weekNumber (custom weekSettings)", () => {
  withDefaultWeekSettings(
    {
      firstDay: 7,
      weekend: [6, 7],
      minimalDays: 1,
    },
    () => {
      const modified = dtFactory().set({ localWeekNumber: 2 });
      expect(modified.weekday).toBe(2); // still tuesday
      expect(modified.localWeekNumber).toBe(2);
      expect(modified.year).toBe(1982);
      expect(modified.month).toBe(1);
      expect(modified.day).toBe(5);
      expect(modified.hour).toBe(9);
      expect(modified.minute).toBe(23);
      expect(modified.second).toBe(54);
      expect(modified.millisecond).toBe(123);
    }
  );
});

test("DateTime#set({ localWeekYear }) sets the date to the same weekNumber/weekday of the target weekYear (en-US)", () => {
  const modified = dt.reconfigure({ locale: "en-US" }).set({ localWeekYear: 2017 });
  expect(modified.localWeekday).toBe(3); // still tuesday
  expect(modified.localWeekNumber).toBe(supportsMinDaysInFirstWeek() ? 22 : 21); // still week 22
  expect(modified.localWeekYear).toBe(2017);
  expect(modified.year).toBe(2017);
  expect(modified.month).toBe(5);
  expect(modified.day).toBe(supportsMinDaysInFirstWeek() ? 30 : 23); // 2017-W22-3 is the 30
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

test("DateTime#set({ localWeekNumber }) sets the date to the same weekday of the target weekNumber (custom weekSettings)", () => {
  withDefaultWeekSettings(
    {
      firstDay: 7,
      weekend: [6, 7],
      minimalDays: 1,
    },
    () => {
      const modified = dtFactory().set({ localWeekNumber: 2 });
      expect(modified.weekday).toBe(2); // still tuesday
      expect(modified.localWeekNumber).toBe(2);
      expect(modified.year).toBe(1982);
      expect(modified.month).toBe(1);
      expect(modified.day).toBe(5);
      expect(modified.hour).toBe(9);
      expect(modified.minute).toBe(23);
      expect(modified.second).toBe(54);
      expect(modified.millisecond).toBe(123);
    }
  );
});

test("DateTime#set({ localWeekYear }) sets the date to the same weekNumber/weekday of the target weekYear (de-DE)", () => {
  const modified = dt.reconfigure({ locale: "de-DE" }).set({ localWeekYear: 2017 });
  expect(modified.localWeekday).toBe(2); // still tuesday
  expect(modified.localWeekNumber).toBe(21); // still week 21
  expect(modified.localWeekYear).toBe(2017);
  expect(modified.year).toBe(2017);
  expect(modified.month).toBe(5);
  expect(modified.day).toBe(23); // 2017-W21-2 is the 30
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

//------
// year/ordinal
//------
test("DateTime#set({ ordinal }) sets the date to the ordinal within the current year", () => {
  const modified = dt.set({ ordinal: 200 });
  expect(modified.year).toBe(1982);
  expect(modified.month).toBe(7);
  expect(modified.day).toBe(19);
  expect(modified.hour).toBe(9);
  expect(modified.minute).toBe(23);
  expect(modified.second).toBe(54);
  expect(modified.millisecond).toBe(123);
});

//------
// set multiple things
//------

test("DateTime.set does units in increasing size", () => {
  const modified = dt.set({ day: 31, month: 3 });
  expect(modified.month).toBe(3);
  expect(modified.day).toBe(31);
});

//------
// set invalid things
//------
test("DateTime#set throws for invalid units", () => {
  expect(() => dt.set({ glorb: 200 })).toThrow();
});

test("DateTime#set throws for metadata", () => {
  expect(() => dt.set({ zone: "UTC" })).toThrow();
  expect(() => dt.set({ locale: "be" })).toThrow();
  expect(() => dt.set({ invalid: true })).toThrow();
});

test("DateTime#set throws for mixing incompatible units", () => {
  expect(() => dt.set({ year: 2020, weekNumber: 22 })).toThrow();
  expect(() => dt.set({ ordinal: 200, weekNumber: 22 })).toThrow();
  expect(() => dt.set({ ordinal: 200, month: 8 })).toThrow();
  expect(() => dt.set({ year: 2020, localWeekNumber: 22 })).toThrow();
  expect(() => dt.set({ ordinal: 200, localWeekNumber: 22 })).toThrow();
  expect(() => dt.set({ weekday: 2, localWeekNumber: 22 })).toThrow();
  expect(() => dt.set({ weekday: 2, localWeekYear: 2022 })).toThrow();
});

test("DateTime#set maintains invalidity", () => {
  expect(DateTime.invalid("because").set({ ordinal: 200 }).isValid).toBe(false);
});

test("DateTime clone-backed setters preserve unchanged fields", () => {
  const original = DateTime.fromISO("2024-03-10T01:30:00.000", {
    zone: "America/New_York",
    locale: "en-US",
  });

  const later = original.plus({ hours: 5 });
  expect(+later).toBe(+original + 5 * 3600000);
  expect(later.zoneName).toBe(original.zoneName);
  expect(later.locale).toBe(original.locale);

  const moved = original.setZone("Europe/Berlin");
  expect(+moved).toBe(+original);
  expect(moved.zoneName).toBe("Europe/Berlin");
  expect(moved.locale).toBe(original.locale);

  const french = original.setLocale("fr");
  expect(+french).toBe(+original);
  expect(french.zoneName).toBe(original.zoneName);
  expect(french.locale).toBe("fr");
  expect(french.toFormat("MMMM")).not.toBe(original.toFormat("MMMM"));

  const arab = original.reconfigure({ numberingSystem: "arab" });
  expect(arab.numberingSystem).toBe("arab");
  expect(arab.toFormat("yyyy")).not.toBe(original.toFormat("yyyy"));

  const changed = original.set({ hour: 4 });
  expect(changed.hour).toBe(4);
  expect(changed.zoneName).toBe(original.zoneName);
  expect(changed.locale).toBe(original.locale);
});

test("DateTime clone-backed setters preserve and replace wasHole", () => {
  const hole = DateTime.fromObject(
    { year: 2024, month: 3, day: 10, hour: 2, minute: 30 },
    { zone: "America/New_York" }
  );
  const solid = DateTime.fromObject(
    { year: 2024, month: 3, day: 10, hour: 4 },
    { zone: "America/New_York" }
  );

  expect(hole.wasHole).toBe(true);
  expect(hole.setLocale("fr").wasHole).toBe(true);
  expect(solid.wasHole).toBe(false);
  expect(solid.setLocale("fr").wasHole).toBe(false);
  expect(solid.set({ hour: 2, minute: 30 }).wasHole).toBe(true);
  expect(hole.set({ hour: 4 }).wasHole).toBe(false);
});

test("invalid DateTimes stay invalid through clone-backed methods", () => {
  const invalid = DateTime.invalid("because");

  expect(invalid.setLocale("fr").isValid).toBe(false);
  expect(invalid.setZone("Europe/Berlin").isValid).toBe(false);
  expect(invalid.plus({ days: 1 }).isValid).toBe(false);
  expect(invalid.endOf("day").isValid).toBe(false);
  expect(invalid.setLocale("fr").invalidReason).toBe("because");
});
