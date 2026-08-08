/* global test expect */

import { DateTime, Settings } from "../../src/luxon";

const dt = DateTime.fromObject(
  {},
  {
    locale: "fr",
    numberingSystem: "beng",
    outputCalendar: "coptic",
  }
);

//------
// #reconfigure()
//------
test("DateTime#reconfigure() sets the locale", () => {
  const recon = dt.reconfigure({ locale: "it" });
  expect(recon.locale).toBe("it");
  expect(recon.numberingSystem).toBe("beng");
  expect(recon.outputCalendar).toBe("coptic");
});

test("DateTime#reconfigure() sets the outputCalendar", () => {
  const recon = dt.reconfigure({ outputCalendar: "ethioaa" });
  expect(recon.locale).toBe("fr");
  expect(recon.numberingSystem).toBe("beng");
  expect(recon.outputCalendar).toBe("ethioaa");
});

test("DateTime#reconfigure() sets the numberingSystem", () => {
  const recon = dt.reconfigure({ numberingSystem: "thai" });
  expect(recon.locale).toBe("fr");
  expect(recon.numberingSystem).toBe("thai");
  expect(recon.outputCalendar).toBe("coptic");
});

test("DateTime#reconfigure() with no arguments no opts", () => {
  const recon = dt.reconfigure();
  expect(recon.locale).toBe("fr");
  expect(recon.numberingSystem).toBe("beng");
  expect(recon.outputCalendar).toBe("coptic");
});

test("DateTime#reconfigure() sets the weekSettings", () => {
  const original = DateTime.local(2022, 1, 4, { locale: "en-US" });
  const recon = original.reconfigure({
    weekSettings: { firstDay: 6, minimalDays: 1, weekend: [1, 2] },
  });
  expect(recon.startOf("week", { useLocaleWeeks: true }).weekday).toBe(6);
});

test("DateTime#reconfigure() preserves weekSettings when setting other options", () => {
  const original = DateTime.local(2022, 1, 4, {
    locale: "en-US",
    weekSettings: { firstDay: 3, minimalDays: 1, weekend: [] },
  });
  const recon = original.reconfigure({ locale: "de-DE" });
  expect(recon.locale).toBe("de-DE");
  expect(recon.startOf("week", { useLocaleWeeks: true }).weekday).toBe(3);
});

test("DateTime#reconfigure() keeps each locale configuration independent", () => {
  const original = DateTime.fromISO("2024-03-10T18:30:00Z", { zone: "UTC" });
  const plain = { locale: "en-US" };
  const configured = [
    [{ locale: "en-US", numberingSystem: "arab" }, (value) => value.toFormat("yyyy")],
    [
      {
        locale: "en-US",
        weekSettings: { firstDay: 1, minimalDays: 4, weekend: [6, 7] },
      },
      (value) => `${value.localWeekday} ${value.localWeekNumber}`,
    ],
    [
      { locale: "en-US", outputCalendar: "islamic" },
      (value) => value.toLocaleString({ month: "long" }),
    ],
  ];

  for (const [extra, read] of configured) {
    const configuredFirst = read(original.reconfigure(extra));
    const plainSecond = read(original.reconfigure(plain));
    expect(configuredFirst).not.toBe(plainSecond);

    const plainFirst = read(original.reconfigure(plain));
    const configuredSecond = read(original.reconfigure(extra));
    expect(plainFirst).not.toBe(configuredSecond);
    expect(read(original.reconfigure(plain))).toBe(plainFirst);
  }
});

test("DateTime#toFormat options do not change later default formatting", () => {
  const original = DateTime.fromISO("2024-03-10T18:30:00Z", { zone: "UTC" });

  expect(original.toFormat("MMMM")).toBe("March");
  expect(original.toFormat("MMMM", { locale: "de-DE" })).toBe("März");
  expect(original.toFormat("MMMM")).toBe("March");
});

// Note: the Settings.defaultLocale JSDoc says changes do "not affect existing instances",
// but instances created without an explicit locale re-resolve the default at format time,
// so in practice they do observe later changes. This test pins that long-standing behavior;
// if it is ever aligned with the docs instead, update or remove this test alongside.
test("a DateTime created without an explicit locale observes later default locale changes", () => {
  const previousLocale = Settings.defaultLocale;
  Settings.defaultLocale = null;
  Settings.resetCaches();
  const original = DateTime.fromISO("2024-03-10T18:30:00Z", { zone: "UTC" });

  try {
    expect(original.toFormat("MMMM")).toBe("March");
    Settings.defaultLocale = "de-DE";
    expect(original.toFormat("MMMM")).toBe("März");
    Settings.defaultLocale = null;
    expect(original.toFormat("MMMM")).toBe("March");
  } finally {
    Settings.defaultLocale = previousLocale;
    Settings.resetCaches();
  }
});

test("an explicit gregory calendar stays separate from a changed default output calendar", () => {
  const previousOutputCalendar = Settings.defaultOutputCalendar;
  const format = { year: "numeric", month: "numeric", day: "numeric" };
  const jsDate = new Date("2024-03-10T18:30:00Z");

  try {
    Settings.defaultOutputCalendar = "gregory";
    DateTime.fromJSDate(jsDate, { zone: "UTC", locale: "en-US", numberingSystem: "latn" });

    Settings.defaultOutputCalendar = "islamic";
    const implicit = DateTime.fromJSDate(jsDate, {
      zone: "UTC",
      locale: "en-US",
      numberingSystem: "latn",
    });
    const gregory = DateTime.fromJSDate(jsDate, {
      zone: "UTC",
      locale: "en-US",
      numberingSystem: "latn",
      outputCalendar: "gregory",
    });

    expect(implicit.outputCalendar).toBe("islamic");
    expect(gregory.outputCalendar).toBe("gregory");
    expect(implicit.toLocaleString(format)).toBe(
      new Intl.DateTimeFormat("en-US-u-ca-islamic-nu-latn", {
        ...format,
        timeZone: "UTC",
      }).format(jsDate)
    );
    expect(gregory.toLocaleString(format)).toBe(
      new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
        ...format,
        timeZone: "UTC",
      }).format(jsDate)
    );
  } finally {
    Settings.defaultOutputCalendar = previousOutputCalendar;
    Settings.resetCaches();
  }
});
