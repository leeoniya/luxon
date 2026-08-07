/* global test expect */
import { IANAZone, SystemZone } from "../../src/luxon";

test("SystemZone.instance returns a singleton", () => {
  expect(SystemZone.instance).toBe(SystemZone.instance);
});

test("SystemZone.instance provides valid ...", () => {
  expect(SystemZone.instance.type).toBe("system");
  expect(SystemZone.instance.isUniversal).toBe(false);
  expect(SystemZone.instance.isValid).toBe(true);
  expect(SystemZone.instance).toBe(SystemZone.instance);

  // todo: figure out how to test these without inadvertently testing IANAZone
  expect(SystemZone.instance.name).toBe("America/New_York"); // this is true for the provided Docker container, what's the right way to test it?
  // expect(SystemZone.instance.offsetName()).toBe("UTC");
  // expect(SystemZone.instance.formatOffset(0, "short")).toBe("+00:00");
  // expect(SystemZone.instance.offset()).toBe(0);
});

test("SystemZone.formatOffset reflects winter and summer offsets", () => {
  expect(SystemZone.instance.formatOffset(Date.UTC(2024, 0, 15, 12), "short")).toBe("-05:00");
  expect(SystemZone.instance.formatOffset(Date.UTC(2024, 6, 15, 12), "techie")).toBe("-0400");
});

test("SystemZone.offset stays correct across repeated and interleaved timestamps", () => {
  const system = SystemZone.instance;
  const other = IANAZone.create("Asia/Kolkata");
  const instants = [
    Date.UTC(2024, 2, 10, 6, 59, 59),
    Date.UTC(2024, 2, 10, 7),
    0,
    -86_400_000 * 400,
    Date.UTC(2024, 10, 3, 6),
  ];

  for (const ts of [...instants, ...[...instants].reverse()]) {
    expect(system.offset(ts)).toBe(-new Date(ts).getTimezoneOffset());
    other.offset(ts);
    expect(system.offset(ts)).toBe(-new Date(ts).getTimezoneOffset());
  }
});
