/* global test expect */

import { DateTime, Duration } from "../../src/luxon";
import { casualMatrix } from "../../src/duration";

function createDateTime() {
  return DateTime.fromObject({
    year: 2010,
    month: 2,
    day: 3,

    hour: 4,
    minute: 5,
    second: 6,
    millisecond: 7,
  });
}

//------
// #plus()
//------
test("DateTime#plus({ years: 1 }) adds a year", () => {
  const i = createDateTime().plus({ years: 1 });
  expect(i.year).toBe(2011);
});

test("DateTime#plus({quarter: 1}) adds a quarter", () => {
  const i = createDateTime().plus({ quarters: 1 });
  expect(i.quarter).toBe(2);
  expect(i.month).toBe(5);
});

test("DateTime#plus({ months: 1 }) at the end of the month", () => {
  const i = DateTime.fromISO("2018-01-31T10:00"),
    later = i.plus({ months: 1 });
  expect(later.day).toBe(28);
  expect(later.month).toBe(2);
});

test("DateTime#plus({ months: 1 }) at the end of the month in a leap year", () => {
  const i = DateTime.fromISO("2016-01-31T10:00"),
    later = i.plus({ months: 1 });
  expect(later.day).toBe(29);
  expect(later.month).toBe(2);
});

test("DateTime#plus({ months: 13 }) at the end of the month", () => {
  const i = DateTime.fromISO("2015-01-31T10:00"),
    later = i.plus({ months: 13 });
  expect(later.day).toBe(29);
  expect(later.month).toBe(2);
  expect(later.year).toBe(2016);
});

test("DateTime#plus({ days: 1 }) keeps the same time across a DST", () => {
  const i = DateTime.fromISO("2016-03-12T10:00", {
      zone: "America/Los_Angeles",
    }),
    later = i.plus({ days: 1 });
  expect(later.day).toBe(13);
  expect(later.hour).toBe(10);
});

test("DateTime#plus({ hours: 24 }) gains an hour to spring forward", () => {
  const i = DateTime.fromISO("2016-03-12T10:00", {
      zone: "America/Los_Angeles",
    }),
    later = i.plus({ hours: 24 });
  expect(later.day).toBe(13);
  expect(later.hour).toBe(11);
});

// #669
test("DateTime#plus({ days:0, hours: 24 }) gains an hour to spring forward", () => {
  const i = DateTime.fromISO("2016-03-12T10:00", {
      zone: "America/Los_Angeles",
    }),
    later = i.plus({ days: 0, hours: 24 });
  expect(later.day).toBe(13);
  expect(later.hour).toBe(11);
});

test("DateTime#plus(Duration) adds the right amount of time", () => {
  const i = DateTime.fromISO("2016-03-12T10:13"),
    later = i.plus(Duration.fromObject({ day: 1, hour: 3, minute: 28 }));
  expect(later.day).toBe(13);
  expect(later.hour).toBe(13);
  expect(later.minute).toBe(41);
});

test("DateTime#plus(multiple) adds the right amount of time", () => {
  const i = DateTime.fromISO("2016-03-12T10:13"),
    later = i.plus({ days: 1, hours: 3, minutes: 28 });
  expect(later.day).toBe(13);
  expect(later.hour).toBe(13);
  expect(later.minute).toBe(41);
});

test("DateTime#plus ignores inherited duration units", () => {
  const amount = Object.create({ days: 10 });
  amount.hours = 2;

  expect(DateTime.utc(2020, 1, 1).plus(amount).toISO()).toBe("2020-01-01T02:00:00.000Z");
});

test("DateTime#plus and #minus ignore nullish duration values", () => {
  const dt = DateTime.utc(2020, 1, 1);
  const amount = { days: null, hours: undefined };

  expect(dt.plus(amount)).toEqual(dt);
  expect(dt.minus(amount)).toEqual(dt);
});

test("DateTime#plus maintains invalidity", () => {
  expect(DateTime.invalid("because").plus({ day: 1 }).isValid).toBe(false);
});

test("DateTime#plus works across the 100 barrier", () => {
  const d = DateTime.fromISO("0099-12-31").plus({ day: 2 });
  expect(d.year).toBe(100);
  expect(d.month).toBe(1);
  expect(d.day).toBe(2);
});

test("DateTime#plus works across the 100 barrier when passing through February", () => {
  const d = DateTime.fromISO("0099-12-31").plus({ day: 61 });
  expect(d.year).toBe(100);
  expect(d.month).toBe(3);
  expect(d.day).toBe(2);
});

test("DateTime#plus renders invalid when out of max. datetime range using days", () => {
  const d = DateTime.utc(1970, 1, 1, 0, 0, 0, 0).plus({ day: 1e8 + 1 });
  expect(d.isValid).toBe(false);
});

test("DateTime#plus renders invalid when out of max. datetime range using seconds", () => {
  const d = DateTime.utc(1970, 1, 1, 0, 0, 0, 0).plus({ second: 1e8 * 24 * 60 * 60 + 1 });
  expect(d.isValid).toBe(false);
});

test("DateTime#plus renders invalid when out of max. datetime range using IANAZone", () => {
  const d = DateTime.utc(1970, 1, 1, 0, 0, 0, 0)
    .setZone("America/Los_Angeles")
    .plus({ second: 1e8 * 24 * 60 * 60 + 1 });
  expect(d.isValid).toBe(false);
});

test("DateTime#plus handles fractional days", () => {
  const d = DateTime.fromISO("2016-01-31T10:00");
  expect(d.plus({ days: 0.8 })).toEqual(d.plus({ hours: (24 * 4) / 5 }));
  expect(d.plus({ days: 6.8 })).toEqual(d.plus({ days: 6, hours: (24 * 4) / 5 }));
  expect(d.plus({ days: 6.8, milliseconds: 17 })).toEqual(
    d.plus({ days: 6, milliseconds: 0.8 * 24 * 60 * 60 * 1000 + 17 })
  );
});

test("DateTime#plus handles fractional large units", () => {
  const units = ["weeks", "months", "quarters", "years"];

  for (const unit of units) {
    const d = DateTime.fromISO("2016-01-31T10:00");
    expect(d.plus({ [unit]: 8.7 })).toEqual(
      d.plus({
        [unit]: 8,
        milliseconds: Duration.fromObject({ [unit]: 0.7 }).as("milliseconds"),
      })
    );
  }
});

// #645
test("DateTime#plus supports positive and negative duration units", () => {
  const d = DateTime.fromISO("2020-01-08T12:34");
  expect(d.plus({ months: 1, days: -1 })).toEqual(d.plus({ months: 1 }).plus({ days: -1 }));
  expect(d.plus({ years: 4, days: -1 })).toEqual(d.plus({ years: 4 }).plus({ days: -1 }));
  expect(d.plus({ years: 0.5, days: -1.5 })).toEqual(d.plus({ years: 0.5 }).plus({ days: -1.5 }));
});

//------
// #minus()
//------
test("DateTime#minus({ years: 1 }) subtracts a year", () => {
  const dt = createDateTime().minus({ years: 1 });
  expect(dt.year).toBe(2009);
});

test("DateTime#minus({ quarters: 1 }) subtracts a quarter", () => {
  const dt = createDateTime().minus({ quarters: 1 });
  expect(dt.year).toBe(2009);
  expect(dt.quarter).toBe(4);
  expect(dt.month).toBe(11);
});

test("DateTime#minus({ months: 1 }) at the end of the month", () => {
  const i = DateTime.fromISO("2018-03-31T10:00"),
    earlier = i.minus({ months: 1 });
  expect(earlier.day).toBe(28);
  expect(earlier.month).toBe(2);
});

test("DateTime#minus({ months: 1 }) at the end of the month in a leap year", () => {
  const i = DateTime.fromISO("2016-03-31T10:00"),
    earlier = i.minus({ months: 1 });
  expect(earlier.day).toBe(29);
  expect(earlier.month).toBe(2);
});

test("DateTime#minus({ months: 13 }) at the end of the month", () => {
  const i = DateTime.fromISO("2017-03-31T10:00"),
    earlier = i.minus({ months: 13 });
  expect(earlier.day).toBe(29);
  expect(earlier.month).toBe(2);
  expect(earlier.year).toBe(2016);
});

test("DateTime#minus ignores inherited duration units", () => {
  const amount = Object.create({ days: 10 });
  amount.hours = 2;

  expect(DateTime.utc(2020, 1, 1).minus(amount).toISO()).toBe("2019-12-31T22:00:00.000Z");
});

test("DateTime#minus maintains invalidity", () => {
  expect(DateTime.invalid("because").minus({ day: 1 }).isValid).toBe(false);
});

test("DateTime#minus works across the 100 barrier", () => {
  const d = DateTime.fromISO("0100-01-02").minus({ day: 2 });
  expect(d.year).toBe(99);
  expect(d.month).toBe(12);
  expect(d.day).toBe(31);
});

test("DateTime#minus renders invalid when out of max. datetime range using days", () => {
  const d = DateTime.utc(1970, 1, 1, 0, 0, 0, 0).minus({ day: 1e8 + 1 });
  expect(d.isValid).toBe(false);
});

test("DateTime#minus renders invalid when out of max. datetime range using seconds", () => {
  const d = DateTime.utc(1970, 1, 1, 0, 0, 0, 0).minus({ second: 1e8 * 24 * 60 * 60 + 1 });
  expect(d.isValid).toBe(false);
});

test("DateTime#plus renders invalid when out of max. datetime range using IANAZone", () => {
  const d = DateTime.utc(1970, 1, 1, 0, 0, 0, 0)
    .setZone("America/Los_Angeles")
    .minus({ second: 1e8 * 24 * 60 * 60 + 1 });
  expect(d.isValid).toBe(false);
});

test("DateTime#minus handles fractional days", () => {
  const d = DateTime.fromISO("2016-01-31T10:00");
  expect(d.minus({ days: 0.8 })).toEqual(d.minus({ hours: (24 * 4) / 5 }));
  expect(d.minus({ days: 6.8 })).toEqual(d.minus({ days: 6, hours: (24 * 4) / 5 }));
  expect(d.minus({ days: 6.8, milliseconds: 17 })).toEqual(
    d.minus({ days: 6, milliseconds: 0.8 * 24 * 60 * 60 * 1000 + 17 })
  );
});

test("DateTime#minus handles fractional large units", () => {
  const units = ["weeks", "months", "quarters", "years"];

  for (const unit of units) {
    const d = DateTime.fromISO("2016-01-31T10:00");
    expect(d.minus({ [unit]: 8.7 })).toEqual(
      d.minus({
        [unit]: 8,
        milliseconds: Duration.fromObject({ [unit]: 0.7 }).as("milliseconds"),
      })
    );
  }
});

// #645
test("DateTime#minus supports positive and negative duration units", () => {
  const d = DateTime.fromISO("2020-01-08T12:34");
  expect(d.minus({ months: 1, days: -1 })).toEqual(d.minus({ months: 1 }).minus({ days: -1 }));
  expect(d.minus({ years: 4, days: -1 })).toEqual(d.minus({ years: 4 }).minus({ days: -1 }));
  expect(d.minus({ years: 0.5, days: -1.5 })).toEqual(
    d.minus({ years: 0.5 }).minus({ days: -1.5 })
  );
});

//------
// #startOf()
//------
test("DateTime#startOf('year') goes to the start of the year", () => {
  const dt = createDateTime().startOf("year");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(1);
  expect(dt.day).toBe(1);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime#startOf('quarter') goes to the start of the quarter", () => {
  const monthToQuarterStart = (month, quarterStart) => {
    const dt = DateTime.fromObject({
      year: 2017,
      month,
      day: 10,
      hour: 4,
      minute: 5,
      second: 6,
      millisecond: 7,
    }).startOf("quarter");

    expect(dt.year).toBe(2017);
    expect(dt.month).toBe(quarterStart);
    expect(dt.day).toBe(1);
    expect(dt.hour).toBe(0);
    expect(dt.minute).toBe(0);
    expect(dt.second).toBe(0);
    expect(dt.millisecond).toBe(0);
  };

  monthToQuarterStart(1, 1);
  monthToQuarterStart(2, 1);
  monthToQuarterStart(3, 1);
  monthToQuarterStart(4, 4);
  monthToQuarterStart(5, 4);
  monthToQuarterStart(6, 4);
  monthToQuarterStart(7, 7);
  monthToQuarterStart(8, 7);
  monthToQuarterStart(9, 7);
  monthToQuarterStart(10, 10);
  monthToQuarterStart(11, 10);
  monthToQuarterStart(12, 10);
});

test("DateTime#startOf('month') goes to the start of the month", () => {
  const dt = createDateTime().startOf("month");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(1);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime#startOf('day') goes to the start of the day", () => {
  const dt = createDateTime().startOf("day");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(3);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime#startOf('hour') goes to the start of the hour", () => {
  const dt = createDateTime().startOf("hour");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(3);
  expect(dt.hour).toBe(4);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime#startOf('minute') goes to the start of the minute", () => {
  const dt = createDateTime().startOf("minute");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(3);
  expect(dt.hour).toBe(4);
  expect(dt.minute).toBe(5);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime#startOf('second') goes to the start of the second", () => {
  const dt = createDateTime().startOf("second");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(3);
  expect(dt.hour).toBe(4);
  expect(dt.minute).toBe(5);
  expect(dt.second).toBe(6);
  expect(dt.millisecond).toBe(0);
});

test("DateTime#startOf('week') goes to the start of the week", () => {
  // using a different day so that it doesn't end up as the first of the month
  const dt = DateTime.fromISO("2016-03-12T10:00").startOf("week");

  expect(dt.year).toBe(2016);
  expect(dt.month).toBe(3);
  expect(dt.day).toBe(7);
  expect(dt.hour).toBe(0);
  expect(dt.minute).toBe(0);
  expect(dt.second).toBe(0);
  expect(dt.millisecond).toBe(0);
});

test("DateTime#startOf maintains invalidity", () => {
  expect(DateTime.invalid("because").startOf("day").isValid).toBe(false);
});

test("DateTime#startOf throws on invalid units", () => {
  expect(() => DateTime.fromISO("2016-03-12T10:00").startOf("splork")).toThrow();
  expect(() => DateTime.fromISO("2016-03-12T10:00").startOf("")).toThrow();
});

//------
// #endOf()
//------
test("DateTime#endOf('year') goes to the start of the year", () => {
  const dt = createDateTime().endOf("year");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(12);
  expect(dt.day).toBe(31);
  expect(dt.hour).toBe(23);
  expect(dt.minute).toBe(59);
  expect(dt.second).toBe(59);
  expect(dt.millisecond).toBe(999);
});

test("DateTime#endOf('quarter') goes to the end of the quarter", () => {
  const dt = createDateTime().endOf("quarter");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(3);
  expect(dt.day).toBe(31);
  expect(dt.hour).toBe(23);
  expect(dt.minute).toBe(59);
  expect(dt.second).toBe(59);
  expect(dt.millisecond).toBe(999);
});

test("DateTime#endOf('quarter') goes to the end of the quarter in December", () => {
  const monthToQuarterEnd = (month, endMonth) => {
    const dt = DateTime.fromObject({
      year: 2017,
      month,
      day: 10,
      hour: 4,
      minute: 5,
      second: 6,
      millisecond: 7,
    }).endOf("quarter");

    expect(dt.year).toBe(2017);
    expect(dt.month).toBe(endMonth);
    expect(dt.day).toBe(dt.endOf("month").day);
    expect(dt.hour).toBe(23);
    expect(dt.minute).toBe(59);
    expect(dt.second).toBe(59);
    expect(dt.millisecond).toBe(999);
  };

  monthToQuarterEnd(1, 3);
  monthToQuarterEnd(2, 3);
  monthToQuarterEnd(3, 3);
  monthToQuarterEnd(4, 6);
  monthToQuarterEnd(5, 6);
  monthToQuarterEnd(6, 6);
  monthToQuarterEnd(7, 9);
  monthToQuarterEnd(8, 9);
  monthToQuarterEnd(9, 9);
  monthToQuarterEnd(10, 12);
  monthToQuarterEnd(11, 12);
  monthToQuarterEnd(12, 12);
});

test("DateTime#endOf('month') goes to the start of the month", () => {
  const dt = createDateTime().endOf("month");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(28);
  expect(dt.hour).toBe(23);
  expect(dt.minute).toBe(59);
  expect(dt.second).toBe(59);
  expect(dt.millisecond).toBe(999);
});

test("DateTime#endOf('day') goes to the start of the day", () => {
  const dt = createDateTime().endOf("day");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(3);
  expect(dt.hour).toBe(23);
  expect(dt.minute).toBe(59);
  expect(dt.second).toBe(59);
  expect(dt.millisecond).toBe(999);
});

test("DateTime#endOf('hour') goes to the start of the hour", () => {
  const dt = createDateTime().endOf("hour");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(3);
  expect(dt.hour).toBe(4);
  expect(dt.minute).toBe(59);
  expect(dt.second).toBe(59);
  expect(dt.millisecond).toBe(999);
});

test("DateTime#endOf('minute') goes to the start of the minute", () => {
  const dt = createDateTime().endOf("minute");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(3);
  expect(dt.hour).toBe(4);
  expect(dt.minute).toBe(5);
  expect(dt.second).toBe(59);
  expect(dt.millisecond).toBe(999);
});

test("DateTime#endOf('second') goes to the start of the second", () => {
  const dt = createDateTime().endOf("second");

  expect(dt.year).toBe(2010);
  expect(dt.month).toBe(2);
  expect(dt.day).toBe(3);
  expect(dt.hour).toBe(4);
  expect(dt.minute).toBe(5);
  expect(dt.second).toBe(6);
  expect(dt.millisecond).toBe(999);
});

test("DateTime#endOf('week') goes to the end of the week", () => {
  // using a different day so that it doesn't end up as the first of the month
  const dt = DateTime.fromISO("2016-03-12T10:00").endOf("week");

  expect(dt.year).toBe(2016);
  expect(dt.month).toBe(3);
  expect(dt.day).toBe(13);
  expect(dt.hour).toBe(23);
  expect(dt.minute).toBe(59);
  expect(dt.second).toBe(59);
  expect(dt.millisecond).toBe(999);
});

test("DateTime#endOf maintains invalidity", () => {
  expect(DateTime.invalid("because").endOf("day").isValid).toBe(false);
});

test("DateTime#endOf throws on invalid units", () => {
  expect(() => DateTime.fromISO("2016-03-12T10:00").endOf("splork")).toThrow();
  expect(() => DateTime.fromISO("2016-03-12T10:00").endOf(null)).toThrow();
});

test("DateTime bare numeric arithmetic is elapsed milliseconds across DST", () => {
  const beforeSpring = DateTime.fromISO("2024-03-10T01:30", {
    zone: "America/New_York",
  });
  const afterSpring = DateTime.fromISO("2024-03-10T03:30", {
    zone: "America/New_York",
  });

  expect(beforeSpring.plus(3600000).toISO()).toBe("2024-03-10T03:30:00.000-04:00");
  expect(beforeSpring.plus(3600000).equals(beforeSpring.plus({ hours: 1 }))).toBe(true);
  expect(afterSpring.minus(3600000).toISO()).toBe("2024-03-10T01:30:00.000-05:00");
  expect(afterSpring.minus(3600000).equals(afterSpring.minus({ hours: 1 }))).toBe(true);
});

test("DateTime#plus preserves duration argument validation and own-property semantics", () => {
  const dt = DateTime.fromMillis(1710053999000, { zone: "America/New_York" });

  expect(() => dt.minus(Infinity)).toThrow();
  expect(() => dt.plus({ bogus: "nope" })).toThrow();
  expect(dt.plus(Object.create({ days: 9 })).toISO()).toBe("2024-03-10T01:59:59.000-05:00");
  expect(dt.plus({ days: undefined }).toISO()).toBe("2024-03-10T01:59:59.000-05:00");
  expect(dt.plus({ days: null }).toISO()).toBe("2024-03-10T01:59:59.000-05:00");
  expect(dt.plus(Duration.fromObject({ years: 1 })).toISO()).toBe("2025-03-10T01:59:59.000-04:00");
  expect(dt.plus(Duration.fromObject({ quarters: 1 })).toISO()).toBe(
    "2024-06-10T01:59:59.000-04:00"
  );
});

test("DateTime#minus negates every duration unit", () => {
  const dt = DateTime.fromMillis(1710053999000, { zone: "America/New_York" });
  const expected = {
    years: "2023-03-10T01:59:59.000-05:00",
    quarters: "2023-12-10T01:59:59.000-05:00",
    months: "2024-02-10T01:59:59.000-05:00",
    weeks: "2024-03-03T01:59:59.000-05:00",
    days: "2024-03-09T01:59:59.000-05:00",
    hours: "2024-03-10T00:59:59.000-05:00",
    minutes: "2024-03-10T01:58:59.000-05:00",
    seconds: "2024-03-10T01:59:58.000-05:00",
    milliseconds: "2024-03-10T01:59:58.999-05:00",
  };

  for (const [unit, iso] of Object.entries(expected)) {
    expect(dt.minus({ [unit]: 1 }).toISO()).toBe(iso);
  }
});

test("DateTime arithmetic distinguishes fractional, elapsed, and calendar amounts", () => {
  const ts = 1710053999000;
  const dt = DateTime.fromMillis(ts, { zone: "America/New_York" });

  expect(dt.plus({ days: 1.5 }).toISO()).toBe("2024-03-11T13:59:59.000-04:00");
  expect(dt.plus({ hours: 1.5 }).toISO()).toBe("2024-03-10T04:29:59.000-04:00");
  expect(DateTime.fromMillis(0).plus({ milliseconds: 9e15 }).toISO()).toBeNull();
  expect(dt.plus({ minutes: 1 }).valueOf() - ts).toBe(60000);
  expect(dt.plus({ hours: 2 }).valueOf() - ts).toBe(7200000);
  expect(dt.minus({ seconds: 90 }).valueOf() - ts).toBe(-90000);

  expect(dt.plus({ days: 1 }).toISO()).toBe("2024-03-11T01:59:59.000-04:00");
  expect(dt.plus({ weeks: 1 }).toISO()).toBe("2024-03-17T01:59:59.000-04:00");
  expect(dt.plus({ years: 1 }).toISO()).toBe("2025-03-10T01:59:59.000-04:00");
  expect(dt.plus({ quarters: 1 }).toISO()).toBe("2024-06-10T01:59:59.000-04:00");
});

test("DateTime calendar arithmetic preserves proleptic and 400-year boundaries", () => {
  const utc = (year, month, day) => DateTime.fromObject({ year, month, day }, { zone: "UTC" });

  expect(utc(1, 3, 1).plus({ years: -1, days: 1 }).toISO()).toBe("0000-03-02T00:00:00.000Z");
  expect(utc(0, 3, 1).minus({ years: 1 }).toISO()).toBe("-000001-03-01T00:00:00.000Z");
  expect(utc(99, 12, 31).plus({ days: 1 }).toISO()).toBe("0100-01-01T00:00:00.000Z");
  expect(utc(1600, 2, 29).plus({ years: 400 }).toISO()).toBe("2000-02-29T00:00:00.000Z");
  expect(utc(2000, 2, 29).minus({ years: 400 }).toISO()).toBe("1600-02-29T00:00:00.000Z");
});

test("DateTime#endOf returns explicit proleptic, leap-year, and DST boundaries", () => {
  const cases = [
    ["0000-06-15T12:00:00.000", "year", "UTC", "0000-12-31T23:59:59.999Z"],
    ["0099-02-01T12:00:00.000", "months", "UTC", "0099-02-28T23:59:59.999Z"],
    ["1600-02-29T12:00:00.000", "month", "UTC", "1600-02-29T23:59:59.999Z"],
    ["2100-02-15T12:00:00.000", "month", "UTC", "2100-02-28T23:59:59.999Z"],
    ["2024-03-10T01:30:00.000", "day", "America/New_York", "2024-03-10T23:59:59.999-04:00"],
    ["2024-11-03T01:30:00.000", "days", "America/New_York", "2024-11-03T23:59:59.999-05:00"],
  ];

  for (const [iso, unit, zone, expected] of cases) {
    expect(DateTime.fromISO(iso, { zone }).endOf(unit).toISO()).toBe(expected);
  }
});

test("DateTime#endOf remains stable across repeated calls and receivers", () => {
  const dt = DateTime.fromISO("2024-03-10T01:30:00.000", { zone: "America/New_York" });

  for (const unit of ["day", "month", "hour"]) {
    const first = dt.endOf(unit).toISO();
    expect(dt.endOf(unit).toISO()).toBe(first);
    expect(dt.endOf(unit).toISO()).toBe(first);
  }

  const other = DateTime.fromISO("2020-07-04T09:00:00.000", { zone: "America/New_York" });
  expect(other.endOf("day").toISO()).not.toBe(dt.endOf("day").toISO());
});

test("DateTime#endOf returns explicit locale-week boundaries", () => {
  const cases = [
    [
      DateTime.fromISO("2024-03-10T01:30", { zone: "America/New_York", locale: "en-US" }),
      false,
      "2024-03-10T23:59:59.999-04:00",
    ],
    [
      DateTime.fromISO("2024-03-10T01:30", { zone: "America/New_York", locale: "en-US" }),
      true,
      "2024-03-16T23:59:59.999-04:00",
    ],
    [
      DateTime.fromISO("2020-12-31T23:30", { zone: "Europe/Paris", locale: "de-DE" }),
      false,
      "2021-01-03T23:59:59.999+01:00",
    ],
    [
      DateTime.fromISO("2020-12-31T23:30", { zone: "Europe/Paris", locale: "de-DE" }),
      true,
      "2021-01-03T23:59:59.999+01:00",
    ],
  ];

  for (const [dt, useLocaleWeeks, expected] of cases) {
    expect(dt.endOf("week", { useLocaleWeeks }).toISO()).toBe(expected);
  }
});

test("DateTime#toRelative supports short-style year wording", () => {
  const dt = DateTime.fromMillis(1710053999000, {
    zone: "America/New_York",
    locale: "en-US",
  });

  expect(dt.plus({ years: 1 }).toRelative({ base: dt, style: "short" })).toBe("in 1 yr.");
});

test("DateTime#toRelativeCalendar supports an explicit day unit", () => {
  const dt = DateTime.fromMillis(1710053999000, {
    zone: "America/New_York",
    locale: "en-US",
  });

  expect(dt.plus({ days: 1 }).toRelativeCalendar({ base: dt, unit: "days" })).toBe("tomorrow");
});
