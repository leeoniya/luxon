/* global test expect */
import { DateTime, Interval, Duration, Settings } from "../../src/luxon";
import Helpers from "../helpers";

const withThrowOnInvalid = Helpers.setUnset("throwOnInvalid");

//------
// .fromObject()
//-------
test("Interval.fromDateTimes creates an interval from datetimes", () => {
  const start = DateTime.fromObject({ year: 2016, month: 5, day: 25 }),
    end = DateTime.fromObject({ year: 2016, month: 5, day: 27 }),
    int = Interval.fromDateTimes(start, end);

  expect(int.start).toBe(start);
  expect(int.end).toBe(end);
});

test("Interval.fromDateTimes creates an interval from objects", () => {
  const start = { year: 2016, month: 5, day: 25 },
    end = { year: 2016, month: 5, day: 27 },
    int = Interval.fromDateTimes(start, end);

  expect(int.start).toEqual(DateTime.fromObject(start));
  expect(int.end).toEqual(DateTime.fromObject(end));
});

test("Interval.fromDateTimes creates an interval from Dates", () => {
  const start = DateTime.fromObject({
      year: 2016,
      month: 5,
      day: 25,
    }).toJSDate(),
    end = DateTime.fromObject({ year: 2016, month: 5, day: 27 }).toJSDate(),
    int = Interval.fromDateTimes(start, end);

  expect(int.start.toJSDate()).toEqual(start);
  expect(int.end.toJSDate()).toEqual(end);
});

test("Interval.fromDateTimes results in an invalid Interval if the endpoints are invalid", () => {
  const validDate = DateTime.fromObject({ year: 2016, month: 5, day: 25 }),
    invalidDate = DateTime.invalid("because");

  expect(Interval.fromDateTimes(validDate, invalidDate).invalidReason).toBe(
    "missing or invalid end"
  );
  expect(Interval.fromDateTimes(invalidDate, validDate).invalidReason).toBe(
    "missing or invalid start"
  );

  expect(Interval.fromDateTimes(validDate.plus({ days: 1 }), validDate).invalidReason).toBe(
    "end before start"
  );
});

test("Interval.fromDateTimes throws with invalid input", () => {
  expect(() => Interval.fromDateTimes(DateTime.now(), true)).toThrow();
});

test("Interval.fromDateTimes throws with start date coming after end date", () => {
  const start = DateTime.fromObject({
      year: 2016,
      month: 5,
      day: 25,
    }).toJSDate(),
    end = DateTime.fromObject({ year: 2016, month: 5, day: 27 }).toJSDate();

  withThrowOnInvalid(true, () => {
    expect(() => Interval.fromDateTimes(end, start)).toThrow();
  });
});

//------
// .after()
//-------
test("Interval.after takes a duration", () => {
  const start = DateTime.fromObject({ year: 2016, month: 5, day: 25 }),
    int = Interval.after(start, Duration.fromObject({ days: 3 }));

  expect(int.start).toBe(start);
  expect(int.end.day).toBe(28);
});

test("Interval.after an object", () => {
  const start = DateTime.fromObject({ year: 2016, month: 5, day: 25 }),
    int = Interval.after(start, { days: 3 });

  expect(int.start).toBe(start);
  expect(int.end.day).toBe(28);
});

test("Interval.after preserves calendar and elapsed-time arithmetic across DST", () => {
  const start = DateTime.fromISO("2024-03-10T01:30", { zone: "America/New_York" });

  expect(Interval.after(start, { days: 1 }).end.toISO()).toBe("2024-03-11T01:30:00.000-04:00");
  expect(Interval.after(start, { hours: 24 }).end.toISO()).toBe("2024-03-11T02:30:00.000-04:00");
  expect(Interval.after(start, Duration.fromObject({ hours: 1.5 })).end.toISO()).toBe(
    "2024-03-10T04:00:00.000-04:00"
  );
});

//------
// .before()
//-------
test("Interval.before takes a duration", () => {
  const end = DateTime.fromObject({ year: 2016, month: 5, day: 25 }),
    int = Interval.before(end, Duration.fromObject({ days: 3 }));

  expect(int.start.day).toBe(22);
  expect(int.end).toBe(end);
});

test("Interval.before takes a number and unit", () => {
  const end = DateTime.fromObject({ year: 2016, month: 5, day: 25 }),
    int = Interval.before(end, { days: 3 });

  expect(int.start.day).toBe(22);
  expect(int.end).toBe(end);
});

test("Interval.before preserves calendar and elapsed-time arithmetic across DST", () => {
  const end = DateTime.fromISO("2024-03-11T01:30", { zone: "America/New_York" });

  expect(Interval.before(end, { days: 1 }).start.toISO()).toBe("2024-03-10T01:30:00.000-05:00");
  expect(Interval.before(end, { hours: 24 }).start.toISO()).toBe("2024-03-10T00:30:00.000-05:00");
});

//------
// .invalid()
//-------
test("Interval.invalid produces invalid Intervals", () => {
  expect(Interval.invalid("because").isValid).toBe(false);
});

test("Interval.invalid throws if throwOnInvalid is set", () => {
  try {
    Settings.throwOnInvalid = true;
    expect(() => Interval.invalid("because")).toThrow();
  } finally {
    Settings.throwOnInvalid = false;
  }
});

test("Interval.invalid throws if no reason is specified", () => {
  expect(() => Interval.invalid()).toThrow();
});
