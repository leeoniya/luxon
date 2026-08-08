/* global test expect */

import { DateTime } from "../../src/luxon";

const dt = DateTime.fromObject(
  {
    year: 1982,
    month: 5,
    day: 25,
    hour: 9,
    minute: 23,
    second: 54,
    millisecond: 123,
  },
  {
    zone: "utc",
  }
);
const ny = dt.setZone("America/New_York", { keepLocalTime: true });

//------
// #toFormat()
//------

test("DateTime#toFormat accepts the locale from the DateTime or the options", () => {
  expect(dt.setLocale("fr").toFormat("LLLL")).toBe("mai");
  expect(dt.toFormat("LLLL", { locale: "fr" })).toBe("mai");
  expect(dt.setLocale("pt").toFormat("LLLL", { locale: "fr" })).toBe("mai");
});

test("DateTime#toFormat reuses the system locale for repeated macro tokens", () => {
  expect(dt.toFormat("D D")).toBe("5/25/1982 5/25/1982");
});

test("DateTime#toFormat('u') returns fractional seconds", () => {
  expect(dt.toFormat("u")).toBe("123");
  expect(dt.set({ millisecond: 82 }).toFormat("u")).toBe("082");
  expect(dt.set({ millisecond: 2 }).toFormat("u")).toBe("002");
  expect(dt.set({ millisecond: 80 }).toFormat("u")).toBe("080"); // I think this is OK
});

test("DateTime#toFormat('uu') returns fractional seconds as two digits", () => {
  expect(dt.toFormat("uu")).toBe("12");
  expect(dt.set({ millisecond: 82 }).toFormat("uu")).toBe("08");
  expect(dt.set({ millisecond: 789 }).toFormat("uu")).toBe("78");
});

test("DateTime#toFormat('uuu') returns fractional seconds as one digit", () => {
  expect(dt.toFormat("uuu")).toBe("1");
  expect(dt.set({ millisecond: 82 }).toFormat("uuu")).toBe("0");
  expect(dt.set({ millisecond: 789 }).toFormat("uuu")).toBe("7");
});

test("DateTime#toFormat('S') returns the millisecond", () => {
  expect(dt.toFormat("S")).toBe("123");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("S")).toBe("১২৩");
  expect(dt.toFormat("S")).toBe("123");
  expect(dt.set({ millisecond: 82 }).toFormat("S")).toBe("82");
});

test("DateTime#toFormat('SSS') returns padded the millisecond", () => {
  expect(dt.toFormat("SSS")).toBe("123");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("SSS")).toBe("১২৩");
  expect(dt.set({ millisecond: 82 }).toFormat("SSS")).toBe("082");
});

test("DateTime#toFormat('s') returns the second", () => {
  expect(dt.toFormat("s")).toBe("54");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("s")).toBe("৫৪");
  expect(dt.set({ second: 6 }).toFormat("s")).toBe("6");
});

test("DateTime#toFormat('ss') returns the padded second", () => {
  expect(dt.toFormat("ss")).toBe("54");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("ss")).toBe("৫৪");
  expect(dt.set({ second: 6 }).toFormat("ss")).toBe("06");
});

test("DateTime#toFormat('m') returns the minute", () => {
  expect(dt.toFormat("m")).toBe("23");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("m")).toBe("২৩");
  expect(dt.set({ minute: 6 }).toFormat("m")).toBe("6");
});

test("DateTime#toFormat('mm') returns the padded minute", () => {
  expect(dt.toFormat("mm")).toBe("23");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("mm")).toBe("২৩");
  expect(dt.set({ minute: 6 }).toFormat("mm")).toBe("06");
});

test("DateTime#toFormat('h') returns the hours", () => {
  expect(dt.toFormat("h")).toBe("9");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("h")).toBe("৯");
  expect(dt.set({ hour: 0 }).toFormat("h")).toBe("12");
  expect(dt.set({ hour: 24 }).toFormat("h")).toBe("12");
  expect(dt.set({ hour: 12 }).toFormat("h")).toBe("12");
  expect(dt.set({ hour: 13 }).toFormat("h")).toBe("1");
});

test("DateTime#toFormat('hh') returns the padded hour (12-hour time)", () => {
  expect(dt.toFormat("hh")).toBe("09");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("hh")).toBe("০৯");
  expect(dt.set({ hour: 0 }).toFormat("h")).toBe("12");
  expect(dt.set({ hour: 24 }).toFormat("h")).toBe("12");
  expect(dt.set({ hour: 12 }).toFormat("hh")).toBe("12");
  expect(dt.set({ hour: 13 }).toFormat("hh")).toBe("01");
});

test("DateTime#toFormat('H') returns the hour (24-hour time)", () => {
  expect(dt.toFormat("H")).toBe("9");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("H")).toBe("৯");
  expect(dt.set({ hour: 12 }).toFormat("H")).toBe("12");
  expect(dt.set({ hour: 13 }).toFormat("H")).toBe("13");
});

test("DateTime#toFormat('HH') returns the padded hour (24-hour time)", () => {
  expect(dt.toFormat("HH")).toBe("09");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("HH")).toBe("০৯");
  expect(dt.set({ hour: 12 }).toFormat("HH")).toBe("12");
  expect(dt.set({ hour: 13 }).toFormat("HH")).toBe("13");
});

test("DateTime#toFormat('Z') returns the narrow offset", () => {
  expect(dt.toUTC(360).toFormat("Z")).toBe("+6");
  expect(dt.toUTC(390).toFormat("Z")).toBe("+6:30");
  expect(dt.toUTC(-360).toFormat("Z")).toBe("-6");
  expect(dt.toUTC(-390).toFormat("Z")).toBe("-6:30");
  expect(dt.toUTC().toFormat("Z")).toBe("+0");
});

test("DateTime#toFormat('ZZ') returns the padded offset", () => {
  expect(dt.toUTC(360).toFormat("ZZ")).toBe("+06:00");
  expect(dt.toUTC(390).toFormat("ZZ")).toBe("+06:30");
  expect(dt.toUTC(-360).toFormat("ZZ")).toBe("-06:00");
  expect(dt.toUTC(-390).toFormat("ZZ")).toBe("-06:30");
  expect(dt.toUTC().toFormat("ZZ")).toBe("+00:00");
});

test("DateTime#toFormat('ZZZ') returns a numerical offset", () => {
  expect(dt.toUTC(360).toFormat("ZZZ")).toBe("+0600");
  expect(dt.toUTC(390).toFormat("ZZZ")).toBe("+0630");
  expect(dt.toUTC(-360).toFormat("ZZZ")).toBe("-0600");
  expect(dt.toUTC(-390).toFormat("ZZZ")).toBe("-0630");
  expect(dt.toUTC().toFormat("ZZZ")).toBe("+0000");
});

test("DateTime#toFormat('ZZZZ') returns the short offset name", () => {
  const zoned = dt.setZone("America/Los_Angeles");
  expect(zoned.toFormat("ZZZZ")).toBe("PDT");
  expect(dt.toUTC().toFormat("ZZZZ")).toBe("UTC");
});

test("DateTime#toFormat('ZZZZZ') returns the full offset name", () => {
  const zoned = dt.setZone("America/Los_Angeles");
  expect(zoned.toFormat("ZZZZZ")).toBe("Pacific Daylight Time");
  expect(dt.toUTC().toFormat("ZZZZZ")).toBe("UTC");
});

test("DateTime#toFormat('z') returns the zone name", () => {
  const zoned = dt.setZone("America/Los_Angeles");
  expect(zoned.toFormat("z")).toBe("America/Los_Angeles");

  const utc = dt.toUTC();
  expect(utc.toFormat("z")).toBe("UTC");
});

test("DateTime#toFormat('a') returns the meridiem", () => {
  expect(dt.toFormat("a")).toBe("AM");
  expect(dt.reconfigure({ locale: "my" }).toFormat("a")).toBe("နံနက်");
  expect(dt.set({ hour: 13 }).toFormat("a")).toBe("PM");
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "my" }).toFormat("a")).toBe("ညနေ");
});

test("DateTime#toFormat('d') returns the day", () => {
  expect(dt.toFormat("d")).toBe("25");
  expect(dt.set({ day: 1 }).toFormat("d")).toBe("1");
});

test("DateTime#toFormat('dd') returns the padded day", () => {
  expect(dt.toFormat("dd")).toBe("25");
  expect(dt.set({ day: 1 }).toFormat("dd")).toBe("01");
});

test("DateTime#toFormat('E' || 'c') returns weekday number", () => {
  expect(dt.toFormat("E")).toBe("2");
  expect(dt.toFormat("c")).toBe("2");
});

test("DateTime#toFormat('EEE') returns short format weekday name", () => {
  expect(dt.toFormat("EEE")).toBe("Tue");
  expect(dt.reconfigure({ locale: "de" }).toFormat("EEE")).toBe("Di.");
});

test("DateTime#toFormat('ccc') returns short standalone weekday name", () => {
  expect(dt.toFormat("ccc")).toBe("Tue");
  expect(dt.reconfigure({ locale: "de" }).toFormat("ccc")).toBe("Di");
});

test("DateTime#toFormat('EEEE') returns the full format weekday name", () => {
  expect(dt.toFormat("EEEE")).toBe("Tuesday");
});

test("DateTime#toFormat('cccc') returns the full standalone weekday name", () => {
  expect(dt.toFormat("cccc")).toBe("Tuesday");
});

test("DateTime#toFormat('EEEEE' || 'ccccc') returns narrow weekday name", () => {
  expect(dt.toFormat("EEEEE")).toBe("T");
  expect(dt.toFormat("ccccc")).toBe("T");
});

test("DateTime#toFormat('M' || 'L') return the month number", () => {
  expect(dt.toFormat("M")).toBe("5");
  expect(dt.toFormat("L")).toBe("5");
});

test("DateTime#toFormat('MM' || 'LL') return the padded month number", () => {
  expect(dt.toFormat("MM")).toBe("05");
});

test("DateTime#toFormat('MMM') returns the short format month name", () => {
  expect(dt.toFormat("MMM")).toBe("May");
  expect(dt.reconfigure({ locale: "de" }).toFormat("MMM")).toBe("Mai");
  expect(dt.set({ month: 8 }).toFormat("MMM")).toBe("Aug");
});

test("DateTime#toFormat('LLL') returns the short standalone month name", () => {
  expect(dt.toFormat("LLL")).toBe("May");
  expect(dt.reconfigure({ locale: "de" }).toFormat("LLL")).toBe("Mai");
  expect(dt.set({ month: 8 }).toFormat("LLL")).toBe("Aug");
});

test("DateTime#toFormat('MMMM') returns the full format month name", () => {
  expect(dt.toFormat("MMMM")).toBe("May");
  expect(dt.set({ month: 8 }).toFormat("MMMM")).toBe("August");
  expect(dt.set({ month: 8 }).reconfigure({ locale: "ru" }).toFormat("MMMM")).toBe("августа");
});

test("DateTime#toFormat('LLLL') returns the full standalone month name", () => {
  expect(dt.toFormat("LLLL")).toBe("May");
  expect(dt.set({ month: 8 }).toFormat("LLLL")).toBe("August");
});

test("DateTime#toFormat('MMMMM' || 'LLLLL') returns the narrow month name", () => {
  expect(dt.toFormat("MMMMM")).toBe("M");
  expect(dt.toFormat("LLLLL")).toBe("M");
});

test("DateTime#toFormat('y') returns the full year", () => {
  expect(dt.toFormat("y")).toBe("1982");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("y")).toBe("১৯৮২");
  expect(dt.set({ year: 3 }).toFormat("y")).toBe("3");
});

test("DateTime#toFormat('yy') returns the two-digit year", () => {
  expect(dt.toFormat("yy")).toBe("82");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("yy")).toBe("৮২");
  expect(dt.set({ year: 3 }).toFormat("yy")).toBe("03");
});

test("DateTime#toFormat('yyyy') returns the padded full year", () => {
  expect(dt.toFormat("yyyy")).toBe("1982");
  expect(dt.reconfigure({ locale: "bn" }).toFormat("yyyy")).toBe("১৯৮২");
  expect(dt.set({ year: 3 }).toFormat("yyyy")).toBe("0003");
  expect(dt.set({ year: 3 }).reconfigure({ locale: "bn" }).toFormat("yyyy")).toBe("০০০৩");
});

test("DateTime#toFormat('yyyy') returns the padded full year", () => {
  const bigDt = DateTime.fromObject({ year: 36000 });
  expect(bigDt.toFormat("yyyy")).toBe("36000");

  const lilDt = DateTime.fromObject({ year: 17 });
  expect(lilDt.toFormat("yyyy")).toBe("0017");
});

test("DateTime#toFormat('yyyyyy') returns the padded extended year", () => {
  const hugeDt = DateTime.fromObject({ year: 136000 });
  expect(hugeDt.toFormat("yyyyyy")).toBe("136000");

  const bigDt = DateTime.fromObject({ year: 36000 });
  expect(bigDt.toFormat("yyyyyy")).toBe("036000");

  expect(dt.toFormat("yyyyyy")).toBe("001982");

  const lilDt = DateTime.fromObject({ year: 17 });
  expect(lilDt.toFormat("yyyyyy")).toBe("000017");
});

test("DateTime#toFormat('G') returns the short era", () => {
  expect(dt.toFormat("G")).toBe("AD");
  expect(dt.reconfigure({ locale: "de" }).toFormat("G")).toBe("n. Chr.");
  expect(dt.set({ year: -21 }).toFormat("G")).toBe("BC");
  expect(dt.set({ year: -21 }).reconfigure({ locale: "de" }).toFormat("G")).toBe("v. Chr.");
});

test("DateTime#toFormat('GG') returns the full era", () => {
  expect(dt.toFormat("GG")).toBe("Anno Domini");
  expect(dt.set({ year: -21 }).toFormat("GG")).toBe("Before Christ");
});

test("DateTime#toFormat('GGGGG') returns the narrow era", () => {
  expect(dt.toFormat("GGGGG")).toBe("A");
  expect(dt.set({ year: -21 }).toFormat("GGGGG")).toBe("B");
});

test("DateTime#toFormat('W') returns the week number", () => {
  expect(dt.toFormat("W")).toBe("21");
  expect(dt.set({ weekNumber: 5 }).toFormat("W")).toBe("5");
});

test("DateTime#toFormat('WW') returns the padded week number", () => {
  expect(dt.toFormat("WW")).toBe("21");
  expect(dt.set({ weekNumber: 5 }).toFormat("WW")).toBe("05");
});

test("DateTime#toFormat('kk') returns the abbreviated week year", () => {
  expect(dt.toFormat("kk")).toBe("82");
});

test("DateTime#toFormat('kkkk') returns the full week year", () => {
  expect(dt.toFormat("kkkk")).toBe("1982");
});

test("DateTime#toFormat('o') returns an unpadded ordinal", () => {
  expect(dt.toFormat("o")).toBe("145");
  expect(dt.set({ month: 1, day: 13 }).toFormat("o")).toBe("13");
  expect(dt.set({ month: 1, day: 8 }).toFormat("o")).toBe("8");
});

test("DateTime#toFormat('ooo') returns an unpadded ordinal", () => {
  expect(dt.toFormat("ooo")).toBe("145");
  expect(dt.set({ month: 1, day: 13 }).toFormat("ooo")).toBe("013");
  expect(dt.set({ month: 1, day: 8 }).toFormat("ooo")).toBe("008");
});

test("DateTime#toFormat('q') returns an unpadded quarter", () => {
  expect(dt.toFormat("q")).toBe("2");
  expect(dt.set({ month: 2 }).toFormat("q")).toBe("1");
});

test("DateTime#toFormat('qq') returns a padded quarter", () => {
  expect(dt.toFormat("qq")).toBe("02");
  expect(dt.set({ month: 2 }).toFormat("qq")).toBe("01");
});

test("DateTime#toFormat('D') returns a short date representation", () => {
  expect(dt.toFormat("D")).toBe("5/25/1982");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("D")).toBe("25/05/1982");
});

test("DateTime#toFormat('DD') returns a medium date representation", () => {
  expect(dt.toFormat("DD")).toBe("May 25, 1982");
  expect(dt.set({ month: 8 }).toFormat("DD")).toBe("Aug 25, 1982");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("DD")).toBe("25 mai 1982");
  expect(dt.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("DD")).toBe("25 févr. 1982");
});

test("DateTime#toFormat('DDD') returns a long date representation", () => {
  expect(dt.toFormat("DDD")).toBe("May 25, 1982");
  expect(dt.set({ month: 8 }).toFormat("DDD")).toBe("August 25, 1982");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("DDD")).toBe("25 mai 1982");
  expect(dt.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("DDD")).toBe(
    "25 février 1982"
  );
});

test("DateTime#toFormat('DDDD') returns a long date representation", () => {
  expect(dt.toFormat("DDDD")).toBe("Tuesday, May 25, 1982");
  expect(dt.set({ month: 8 }).toFormat("DDDD")).toBe("Wednesday, August 25, 1982");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("DDDD")).toBe("mardi 25 mai 1982");
  expect(dt.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("DDDD")).toBe(
    "jeudi 25 février 1982"
  );
});

test("DateTime#toFormat('t') returns a short time representation", () => {
  expect(dt.toFormat("t")).toMatchIgnoringWeirdSpaces("9:23 AM");
  expect(dt.set({ hour: 13 }).toFormat("t")).toMatchIgnoringWeirdSpaces("1:23 PM");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("t")).toBe("09:23");
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("t")).toBe("13:23");
});

test("DateTime#toFormat('T') returns a short 24-hour time representation", () => {
  expect(dt.toFormat("T")).toBe("09:23");
  expect(dt.set({ hour: 13 }).toFormat("T")).toBe("13:23");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("T")).toBe("09:23");
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("T")).toBe("13:23");
});

test("DateTime#toFormat('tt') returns a medium time representation", () => {
  expect(dt.toFormat("tt")).toMatchIgnoringWeirdSpaces("9:23:54 AM");
  expect(dt.set({ hour: 13 }).toFormat("tt")).toMatchIgnoringWeirdSpaces("1:23:54 PM");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("tt")).toBe("09:23:54");
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("tt")).toBe("13:23:54");
});

test("DateTime#toFormat('TT') returns a medium 24-hour time representation", () => {
  expect(dt.toFormat("TT")).toBe("09:23:54");
  expect(dt.set({ hour: 13 }).toFormat("TT")).toBe("13:23:54");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("TT")).toBe("09:23:54");
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("TT")).toBe("13:23:54");
});

test("DateTime#toFormat('ttt') returns a medium time representation", () => {
  // these seem to fail on Travis
  // expect(dt.toFormat('ttt')).toBe('9:23:54 AM GMT');
  // expect(dt.set({ hour: 13 }).toFormat('ttt')).toBe('1:23:54 PM GMT');
  // expect(dt.reconfigure({ locale: 'fr' }).toFormat('ttt')).toBe('09:23:54 UTC');
  // expect(dt.set({ hour: 13 }).reconfigure({ locale: 'fr' }).toFormat('ttt')).toBe('13:23:54 UTC');
});

test("DateTime#toFormat('TTT') returns a medium time representation", () => {
  // these seem to fail on Travis
  // expect(dt.toFormat('TTT')).toBe('09:23:54 GMT');
  // expect(dt.set({ hour: 13 }).toFormat('TTT')).toBe('13:23:54 GMT');
  // expect(dt.reconfigure({locale: 'fr' }).toFormat('TTT')).toBe('09:23:54 UTC');
  // expect(dt.set({hour: 13 }).reconfigure({ locale: 'fr' }).toFormat('TTT')).toBe('13:23:54 UTC');
});

test("DateTime#toFormat('f') returns a short date/time representation without seconds", () => {
  expect(dt.toFormat("f").replace(/\s+/g, " ")).toBe("5/25/1982, 9:23 AM");
  expect(dt.set({ hour: 13 }).toFormat("f").replace(/\s+/g, " ")).toBe("5/25/1982, 1:23 PM");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("f")).toBe("25/05/1982 09:23");
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("f")).toBe("25/05/1982 13:23");
});

test("DateTime#toFormat('ff') returns a medium date/time representation without seconds", () => {
  expect(dt.toFormat("ff").replace(/\s+/g, " ")).toBe("May 25, 1982, 9:23 AM");
  expect(dt.set({ hour: 13 }).toFormat("ff").replace(/\s+/g, " ")).toBe("May 25, 1982, 1:23 PM");
  expect(dt.set({ month: 8 }).toFormat("ff").replace(/\s+/g, " ")).toBe("Aug 25, 1982, 9:23 AM");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("ff")).toBe("25 mai 1982, 09:23");
  expect(dt.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("ff")).toBe(
    "25 févr. 1982, 09:23"
  );
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("ff")).toBe(
    "25 mai 1982, 13:23"
  );
});

test("DateTime#toFormat('fff') returns a medium date/time representation without seconds", () => {
  expect(ny.toFormat("fff")).toBe("May 25, 1982 at 9:23 AM EDT");
  expect(ny.set({ hour: 13 }).toFormat("fff")).toBe("May 25, 1982 at 1:23 PM EDT");
  expect(ny.set({ month: 8 }).toFormat("fff")).toBe("August 25, 1982 at 9:23 AM EDT");
  expect(ny.reconfigure({ locale: "fr" }).toFormat("fff")).toBe("25 mai 1982 à 09:23 UTC−4");
  expect(ny.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("fff")).toBe(
    "25 février 1982 à 09:23 UTC−5"
  );
  expect(ny.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("fff")).toBe(
    "25 mai 1982 à 13:23 UTC−4"
  );
});

test("DateTime#toFormat('ffff') returns a long date/time representation without seconds", () => {
  expect(ny.toFormat("ffff")).toBe("Tuesday, May 25, 1982 at 9:23 AM Eastern Daylight Time");
  expect(ny.set({ hour: 13 }).toFormat("ffff")).toBe(
    "Tuesday, May 25, 1982 at 1:23 PM Eastern Daylight Time"
  );
  expect(ny.set({ month: 2 }).toFormat("ffff")).toBe(
    "Thursday, February 25, 1982 at 9:23 AM Eastern Standard Time"
  );
  expect(ny.reconfigure({ locale: "fr" }).toFormat("ffff")).toBe(
    "mardi 25 mai 1982 à 09:23 heure d’été de l’Est nord-américain"
  );
  expect(ny.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("ffff")).toBe(
    "jeudi 25 février 1982 à 09:23 heure normale de l’Est nord-américain"
  );
  expect(ny.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("ffff")).toBe(
    "mardi 25 mai 1982 à 13:23 heure d’été de l’Est nord-américain"
  );
});

test("DateTime#toFormat('F') returns a short date/time representation with seconds", () => {
  expect(dt.toFormat("F").replace(/\s+/g, " ")).toBe("5/25/1982, 9:23:54 AM");
  expect(dt.set({ hour: 13 }).toFormat("F").replace(/\s+/g, " ")).toBe("5/25/1982, 1:23:54 PM");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("F")).toBe("25/05/1982 09:23:54");
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("F")).toBe(
    "25/05/1982 13:23:54"
  );
});

test("DateTime#toFormat('FF') returns a medium date/time representation with seconds", () => {
  expect(dt.toFormat("FF").replace(/\s+/g, " ")).toBe("May 25, 1982, 9:23:54 AM");
  expect(dt.set({ hour: 13 }).toFormat("FF").replace(/\s+/g, " ")).toBe("May 25, 1982, 1:23:54 PM");
  expect(dt.set({ month: 8 }).toFormat("FF").replace(/\s+/g, " ")).toBe("Aug 25, 1982, 9:23:54 AM");
  expect(dt.reconfigure({ locale: "fr" }).toFormat("FF")).toBe("25 mai 1982, 09:23:54");
  expect(dt.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("FF")).toBe(
    "25 févr. 1982, 09:23:54"
  );
  expect(dt.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("FF")).toBe(
    "25 mai 1982, 13:23:54"
  );
});

test("DateTime#toFormat('FFF') returns a medium date/time representation without seconds", () => {
  expect(ny.toFormat("FFF")).toBe("May 25, 1982 at 9:23:54 AM EDT");
  expect(ny.set({ hour: 13 }).toFormat("FFF")).toBe("May 25, 1982 at 1:23:54 PM EDT");
  expect(ny.set({ month: 8 }).toFormat("FFF")).toBe("August 25, 1982 at 9:23:54 AM EDT");
  expect(ny.reconfigure({ locale: "fr" }).toFormat("FFF")).toBe("25 mai 1982 à 9:23:54 UTC−4");
  expect(ny.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("FFF")).toBe(
    "25 février 1982 à 9:23:54 UTC−5"
  );
  expect(ny.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("FFF")).toBe(
    "25 mai 1982 à 13:23:54 UTC−4"
  );
});

test("DateTime#toFormat('FFFF') returns a long date/time representation without seconds", () => {
  expect(ny.toFormat("FFFF")).toBe("Tuesday, May 25, 1982 at 9:23:54 AM Eastern Daylight Time");
  expect(ny.set({ hour: 13 }).toFormat("FFFF")).toBe(
    "Tuesday, May 25, 1982 at 1:23:54 PM Eastern Daylight Time"
  );
  expect(ny.set({ month: 2 }).toFormat("FFFF")).toBe(
    "Thursday, February 25, 1982 at 9:23:54 AM Eastern Standard Time"
  );
  expect(ny.reconfigure({ locale: "fr" }).toFormat("FFFF")).toBe(
    "mardi 25 mai 1982 à 9:23:54 heure d’été de l’Est nord-américain"
  );
  expect(ny.set({ month: 2 }).reconfigure({ locale: "fr" }).toFormat("FFFF")).toBe(
    "jeudi 25 février 1982 à 9:23:54 heure normale de l’Est nord-américain"
  );
  expect(ny.set({ hour: 13 }).reconfigure({ locale: "fr" }).toFormat("FFFF")).toBe(
    "mardi 25 mai 1982 à 13:23:54 heure d’été de l’Est nord-américain"
  );
});

test("DateTime#toFormat returns a full formatted string", () => {
  expect(dt.toFormat("MM/yyyy GG")).toBe("05/1982 Anno Domini");
});

test("DateTime#toFormat() accepts literals in single quotes", () => {
  expect(dt.toFormat("dd/MM/yyyy 'at' hh:mm")).toBe("25/05/1982 at 09:23");
  expect(dt.toFormat("MMdd'T'hh")).toBe("0525T09");
});

test("DateTime#toFormat allows escaping of single quotes", () => {
  expect(dt.toFormat("dd/MM/yyyy 'at' ''hh:mm''")).toBe("25/05/1982 at '09:23'");
});

test("DateTime#toFormat() uses the numbering system", () => {
  expect(dt.reconfigure({ numberingSystem: "beng" }).toFormat("S")).toBe("১২৩");
  expect(dt.toFormat("S", { numberingSystem: "beng" })).toBe("১২৩");
});

test("DateTime#toFormat() uses the output calendar", () => {
  expect(dt.reconfigure({ outputCalendar: "islamic" }).toFormat("MMMM yyyy")).toBe("Shaʻban 1402");
  expect(dt.toFormat("MMMM yyyy", { outputCalendar: "islamic" })).toBe("Shaʻban 1402");
});

test("DateTime#toFormat() uses alternative-calendar values for numeric tokens", () => {
  expect(dt.toFormat("d dd L LL M MM y yy yyyy yyyyyy G", { outputCalendar: "islamic" })).toBe(
    "2 02 8 08 8 08 1402 02 1402 1402 AH"
  );
  expect(dt.toFormat("LL")).toBe("05");
});

test("DateTime#toFormat handles many distinct format strings", () => {
  const results = Array.from({ length: 1100 }, (_, index) =>
    dt.toFormat(`'literal ${index}:' yyyy`)
  );

  expect([results[0], results[999], results[1000], results[1099]]).toEqual([
    "literal 0: 1982",
    "literal 999: 1982",
    "literal 1000: 1982",
    "literal 1099: 1982",
  ]);
});

test("DateTime#toFormat() returns something different for invalid DateTimes", () => {
  expect(DateTime.invalid("because").toFormat("dd MM yyyy")).toBe("Invalid DateTime");
});

test("DateTime#toFormat('X') returns a Unix timestamp in seconds", () => {
  expect(dt.toFormat("X")).toBe("391166634");
});

test("DateTime#toFormat('X') rounds down", () => {
  expect(dt.plus(500).toFormat("X")).toBe("391166634");
});

test("DateTime#toFormat('x') returns a Unix timestamp in milliseconds", () => {
  expect(dt.toFormat("x")).toBe("391166634123");
});

test("DateTime#toFormat('n')", () => {
  expect(DateTime.fromISO("2012-01-01", { locale: "de-DE" }).toFormat("n")).toBe("52");
  expect(DateTime.fromISO("2012-01-01", { locale: "en-US" }).toFormat("n")).toBe("1");
});

test("DateTime#toFormat('nn')", () => {
  expect(DateTime.fromISO("2012-01-01", { locale: "de-DE" }).toFormat("nn")).toBe("52");
  expect(DateTime.fromISO("2012-01-01", { locale: "en-US" }).toFormat("nn")).toBe("01");
});

test("DateTime#toFormat('ii')", () => {
  expect(DateTime.fromISO("2012-01-01", { locale: "de-DE" }).toFormat("ii")).toBe("11");
  expect(DateTime.fromISO("2012-01-01", { locale: "en-US" }).toFormat("ii")).toBe("12");
});

test("DateTime#toFormat('iiii')", () => {
  expect(DateTime.fromISO("2012-01-01", { locale: "de-DE" }).toFormat("iiii")).toBe("2011");
  expect(DateTime.fromISO("2012-01-01", { locale: "en-US" }).toFormat("iiii")).toBe("2012");
});

test("DateTime#toFormat name tokens agree with locale parts for every field value", () => {
  const partOf = (dateTime, options, type) =>
    dateTime.toLocaleParts(options).find((part) => part.type === type).value;

  for (const locale of ["fr", "de", "ru", "ja"]) {
    for (let month = 1; month <= 12; month++) {
      const dateTime = DateTime.fromObject(
        { year: 2024, month, day: 15 },
        { zone: "America/New_York", locale }
      );

      for (const [token, length, standalone] of [
        ["MMM", "short", false],
        ["MMMM", "long", false],
        ["MMMMM", "narrow", false],
        ["LLL", "short", true],
        ["LLLL", "long", true],
        ["LLLLL", "narrow", true],
      ]) {
        const options = standalone ? { month: length } : { month: length, day: "numeric" };
        expect(dateTime.toFormat(token)).toBe(partOf(dateTime, options, "month"));
      }
    }

    for (let day = 1; day <= 7; day++) {
      const dateTime = DateTime.fromObject(
        { year: 2024, month: 4, day },
        { zone: "America/New_York", locale }
      );

      for (const [token, length, standalone] of [
        ["EEE", "short", false],
        ["EEEE", "long", false],
        ["EEEEE", "narrow", false],
        ["ccc", "short", true],
        ["cccc", "long", true],
        ["ccccc", "narrow", true],
      ]) {
        const options = standalone
          ? { weekday: length }
          : { weekday: length, month: "long", day: "numeric" };
        expect(dateTime.toFormat(token)).toBe(partOf(dateTime, options, "weekday"));
      }
    }

    for (let hour = 0; hour < 24; hour++) {
      const dateTime = DateTime.fromObject(
        { year: 2024, month: 6, day: 12, hour },
        { zone: "America/New_York", locale }
      );
      expect(dateTime.toFormat("a")).toBe(
        partOf(dateTime, { hour: "numeric", hourCycle: "h12" }, "dayPeriod")
      );
    }

    for (const year of [2024, 0, 1, -1, -44, -3000]) {
      const dateTime = DateTime.fromObject(
        { year, month: 6, day: 12 },
        { zone: "America/New_York", locale }
      );

      for (const [token, length] of [
        ["G", "short"],
        ["GG", "long"],
        ["GGGGG", "narrow"],
      ]) {
        expect(dateTime.toFormat(token)).toBe(partOf(dateTime, { era: length }, "era"));
      }
    }
  }

  // Absolute anchors: a locale-resolution bug that poisoned toFormat and
  // toLocaleParts symmetrically would slip through the parity sweep above.
  const anchor = (month, locale) =>
    DateTime.fromObject({ year: 2024, month, day: 15 }, { zone: "America/New_York", locale });

  expect(anchor(7, "fr").toFormat("MMMM")).toBe("juillet");
  expect(anchor(3, "de").toFormat("MMMM")).toBe("März");
  expect(anchor(3, "ru").toFormat("MMMM")).toBe("марта");
  expect(anchor(3, "ru").toFormat("LLLL")).toBe("март");
});

test("DateTime#toFormat preserves Russian month contexts and widths", () => {
  const dateTime = DateTime.fromObject(
    { year: 2024, month: 9, day: 3 },
    { zone: "America/New_York", locale: "ru" }
  );
  const formatted = dateTime.toFormat("MMMM");
  const standalone = dateTime.toFormat("LLLL");

  expect(formatted).toBe(
    dateTime.toLocaleParts({ month: "long", day: "numeric" }).find((part) => part.type === "month")
      .value
  );
  expect(standalone).toBe(
    dateTime.toLocaleParts({ month: "long" }).find((part) => part.type === "month").value
  );
  expect(formatted).not.toBe(standalone);
  expect(new Set(["MMM", "MMMM", "MMMMM"].map((token) => dateTime.toFormat(token))).size).toBe(3);
});

test("DateTime#toFormat follows resolved and explicit non-Gregorian calendars", () => {
  for (const locale of ["fa", "fa-IR"]) {
    const march10 = DateTime.fromObject({ year: 2024, month: 3, day: 10 }, { zone: "UTC", locale });
    const march28 = DateTime.fromObject({ year: 2024, month: 3, day: 28 }, { zone: "UTC", locale });

    for (const dateTime of [march10, march28]) {
      const month = dateTime
        .toLocaleParts({ month: "long", day: "numeric" })
        .find((part) => part.type === "month").value;
      expect(dateTime.toFormat("MMMM")).toBe(month);
    }
    expect(march10.toFormat("MMMM")).not.toBe(march28.toFormat("MMMM"));
  }

  for (const outputCalendar of ["islamic", "hebrew", "buddhist"]) {
    for (let month = 1; month <= 12; month++) {
      const dateTime = DateTime.fromObject(
        { year: 2024, month, day: 14 },
        { zone: "UTC", locale: "en-US", outputCalendar }
      );
      const part = (options, type) =>
        dateTime.toLocaleParts(options).find((item) => item.type === type).value;

      expect(dateTime.toFormat("MMMM")).toBe(part({ month: "long", day: "numeric" }, "month"));
      expect(dateTime.toFormat("d")).toBe(part({ day: "numeric" }, "day"));
      expect(dateTime.toFormat("y")).toBe(part({ year: "numeric" }, "year"));
    }
  }
});

test("DateTime#toFormat follows Japanese era changes within positive years", () => {
  const eras = [1985, 2000, 2018, 2020].map((year) => {
    const dateTime = DateTime.fromObject(
      { year, month: 6, day: 1 },
      { zone: "UTC", locale: "ja-JP-u-ca-japanese" }
    );
    const expected = dateTime
      .toLocaleParts({ era: "long" })
      .find((part) => part.type === "era").value;
    expect(dateTime.toFormat("GG")).toBe(expected);
    return expected;
  });

  expect(new Set(eras).size).toBe(3);
});

test("DateTime#toFormat keeps literal, unknown, adjacent, and escaped token placement", () => {
  const dateTime = DateTime.fromObject(
    { year: 2024, month: 3, day: 5, hour: 14, minute: 7, second: 9 },
    { zone: "UTC", locale: "en-US" }
  );

  expect(dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss")).toBe("2024-03-05T14:07:09");
  expect(dateTime.toFormat("[HH]")).toBe("[14]");
  expect(dateTime.toFormat("'at' HH")).toBe("at 14");
  expect(dateTime.toFormat("HH 'sharp'")).toBe("14 sharp");
  expect(dateTime.toFormat("HHmmss")).toBe("140709");
  expect(dateTime.toFormat("'hello'")).toBe("hello");
  expect(dateTime.toFormat("-- --")).toBe("-- --");
  expect(dateTime.toFormat("")).toBe("");
  expect(dateTime.toFormat("Q HH")).toBe("Q 14");
  expect(dateTime.toFormat("HH Q HH")).toBe("14 Q 14");
  expect(dateTime.toFormat("''")).toBe("'");
  expect(dateTime.toFormat("'''HH'''")).toBe("'HH'");
});

test("DateTime#toFormat macro tokens equal their locale presets in every position", () => {
  const dateTime = DateTime.fromObject(
    { year: 2024, month: 3, day: 5, hour: 14, minute: 7 },
    { zone: "UTC", locale: "en-US" }
  );
  const formats = {
    D: DateTime.DATE_SHORT,
    DD: DateTime.DATE_MED,
    DDD: DateTime.DATE_FULL,
    DDDD: DateTime.DATE_HUGE,
    t: DateTime.TIME_SIMPLE,
    tt: DateTime.TIME_WITH_SECONDS,
    T: DateTime.TIME_24_SIMPLE,
    TT: DateTime.TIME_24_WITH_SECONDS,
    ttt: DateTime.TIME_WITH_SHORT_OFFSET,
    tttt: DateTime.TIME_WITH_LONG_OFFSET,
    TTT: DateTime.TIME_24_WITH_SHORT_OFFSET,
    TTTT: DateTime.TIME_24_WITH_LONG_OFFSET,
    f: DateTime.DATETIME_SHORT,
    ff: DateTime.DATETIME_MED,
    fff: DateTime.DATETIME_FULL,
    ffff: DateTime.DATETIME_HUGE,
    F: DateTime.DATETIME_SHORT_WITH_SECONDS,
    FF: DateTime.DATETIME_MED_WITH_SECONDS,
    FFF: DateTime.DATETIME_FULL_WITH_SECONDS,
    FFFF: DateTime.DATETIME_HUGE_WITH_SECONDS,
  };

  for (const [macro, preset] of Object.entries(formats)) {
    const rendered = dateTime.toLocaleString(preset);
    expect(dateTime.toFormat(macro)).toBe(rendered);
    expect(dateTime.toFormat(`<${macro}>`)).toBe(`<${rendered}>`);
    expect(dateTime.toFormat(`${macro} ${macro}`)).toBe(`${rendered} ${rendered}`);
  }
});

test("DateTime#toFormat keeps interleaved French and German compiled names separate", () => {
  const dateTime = DateTime.fromObject({ year: 2024, month: 3, day: 5, hour: 14 }, { zone: "UTC" });

  // Pinned substrings keep this meaningful even if a locale-resolution bug
  // poisoned toFormat and toLocaleParts symmetrically.
  const anchors = {
    fr: ["mars", "ap. J.-C."],
    de: ["März", "n. Chr."],
  };

  for (const locale of ["fr", "de", "fr", "de"]) {
    const localized = dateTime.reconfigure({ locale });
    const part = (options, type) =>
      localized.toLocaleParts(options).find((candidate) => candidate.type === type).value;
    const expected = [
      part({ weekday: "long" }, "weekday"),
      part({ month: "long" }, "month"),
      part({ hour: "numeric", hour12: true }, "dayPeriod"),
      part({ era: "short" }, "era"),
    ].join(" ");

    const rendered = localized.toFormat("cccc LLLL a G");
    expect(rendered).toBe(expected);

    for (const anchor of anchors[locale]) {
      expect(rendered).toContain(anchor);
    }
  }
});

test("DateTime#toFormat distinguishes French year zero and year one eras", () => {
  const eras = [0, 1, 0, 1].map((year) => {
    const dateTime = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: "UTC", locale: "fr" });
    const expected = dateTime
      .toLocaleParts({ era: "short" })
      .find(({ type }) => type === "era").value;
    expect(dateTime.toFormat("G")).toBe(expected);
    return expected;
  });

  expect(eras[0]).not.toBe(eras[1]);
  expect(eras[0]).toBe(eras[2]);
  expect(eras[1]).toBe(eras[3]);
});
