/* global test expect */

import { Duration } from "../../src/luxon";
import { casualMatrix } from "../../src/duration";

const businessMatrix = {
  ...casualMatrix,
  months: {
    weeks: 4,
    days: 22,
    hours: 22 * 7,
    minutes: 22 * 7 * 60,
    seconds: 22 * 7 * 60 * 60,
    milliseconds: 22 * 7 * 60 * 60 * 1000,
  },
  weeks: {
    days: 5,
    hours: 5 * 7,
    minutes: 5 * 7 * 60,
    seconds: 5 * 7 * 60 * 60,
    milliseconds: 5 * 7 * 60 * 60 * 1000,
  },
  days: {
    hours: 7,
    minutes: 7 * 60,
    seconds: 7 * 60 * 60,
    milliseconds: 7 * 60 * 60 * 1000,
  },
};

const convert = (amt, from, to) =>
  Duration.fromObject({ [from]: amt }, { matrix: businessMatrix }).as(to);

test("One day is made of 7 hours", () => {
  expect(convert(1, "days", "hours")).toBeCloseTo(7, 4);
  expect(convert(7, "hours", "days")).toBeCloseTo(1, 4);
});

test("One and a half week is made of 7 days 3 hours and 30 minutes", () => {
  const dur = Duration.fromObject({ weeks: 1.5 }, { matrix: businessMatrix }).shiftTo(
    "days",
    "hours",
    "minutes"
  );

  expect(dur.days).toBeCloseTo(7, 4);
  expect(dur.hours).toBeCloseTo(3, 4);
  expect(dur.minutes).toBeCloseTo(30, 4);
});

test("Duration#as follows each custom matrix edge in both directions", () => {
  const matrix = {
    ...businessMatrix,
    years: { ...businessMatrix.years, months: 17 },
    months: { ...businessMatrix.months, days: 41 },
    days: { ...businessMatrix.days, hours: 31 },
    hours: { ...businessMatrix.hours, minutes: 47 },
    minutes: { ...businessMatrix.minutes, seconds: 53 },
    seconds: { ...businessMatrix.seconds, milliseconds: 997 },
  };
  const cases = [
    ["years", 2, "months", 34],
    ["months", 8.5, "years", 0.5],
    ["months", 2, "days", 82],
    ["days", 20.5, "months", 0.5],
    ["days", 2, "hours", 62],
    ["hours", 15.5, "days", 0.5],
    ["hours", 2, "minutes", 94],
    ["minutes", 23.5, "hours", 0.5],
    ["minutes", 2, "seconds", 106],
    ["seconds", 26.5, "minutes", 0.5],
    ["seconds", 2, "milliseconds", 1994],
    ["milliseconds", 498.5, "seconds", 0.5],
  ];

  for (const [from, amount, to, expected] of cases) {
    expect(Duration.fromObject({ [from]: amount }, { matrix }).as(to)).toBe(expected);
  }
});

test("Duration arithmetic keeps the receiver's custom matrix", () => {
  for (const [operation, expected] of [
    ["plus", 720],
    ["minus", 360],
  ]) {
    const duration = Duration.fromObject({ days: 1, hours: 2 }, { matrix: businessMatrix });
    expect(duration[operation]({ hours: 3 }).as("minutes")).toBe(expected);
  }
});
