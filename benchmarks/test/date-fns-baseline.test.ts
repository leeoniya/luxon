import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as core from "date-fns";
import * as tz from "@date-fns/tz";
import { enUS } from "date-fns/locale/en-US";
import { fr } from "date-fns/locale/fr";
import { API_CASES, BASE_TS, type DateFnsApi } from "../lib/api-cases.ts";
import {
  formatterFor,
  parseCases,
  parserFor,
  type BuildSpec,
  type ParseCaseKey,
} from "../lib/build.ts";
import { localeFor, patternFor, type FormatKey } from "../lib/format-paths.ts";

const ZONE = "America/New_York";
const api: DateFnsApi = { core, tz, locales: { enUS, fr } };

function spec(fmt: FormatKey): BuildSpec {
  return {
    library: "date-fns",
    luxonEntry: null,
    easyZone: false,
    zone: ZONE,
    locale: localeFor(fmt),
    formatKey: fmt,
    pattern: patternFor("date-fns", fmt),
  };
}

describe("date-fns baseline formatting", () => {
  const midnight = Date.UTC(2024, 0, 1, 5);

  test("renders every ladder format in the requested zone and locale", async () => {
    const rendered = new Map<FormatKey, string>();

    for (const fmt of ["numeric", "abbr", "text", "text fr"] as FormatKey[]) {
      rendered.set(fmt, (await formatterFor(spec(fmt)))(midnight));
    }

    assert.equal(rendered.get("numeric"), "2024-01-01 00:00:00");
    assert.match(rendered.get("abbr")!, /^2024-01-01 00:00:00 (?:EST|GMT-5)$/);
    assert.equal(rendered.get("text"), "Mon, 01 Jan 2024 00:00:00 -0500");
    assert.match(rendered.get("text fr")!, /^lun\., 01 janv\. 2024 00:00:00 -0500$/);
  });
});

describe("date-fns baseline parsing", () => {
  const expected = Date.UTC(2024, 0, 1, 5);
  const inputs: Record<ParseCaseKey, string> = {
    iso: "2024-01-01T00:00:00.000",
    "iso+off": "2024-01-01T00:00:00.000-05:00",
    tokens: "2024-01-01 00:00:00",
    "tokens+off": "2024-01-01T00:00:00.000-05:00",
    millis: "",
  };

  test("round-trips every parser shape to the same instant", async () => {
    for (const kase of parseCases) {
      const parse = await parserFor(spec("numeric"), kase, inputs[kase.key]);
      assert.equal(parse(expected, inputs[kase.key]), expected, kase.key);
    }
  });

  test("places local token input on the far side of a DST gap", async () => {
    const kase = parseCases.find(({ key }) => key === "tokens")!;
    const parse = await parserFor(spec("numeric"), kase, "2024-03-10 03:30:00");

    assert.equal(parse(0, "2024-03-10 03:30:00"), Date.UTC(2024, 2, 10, 7, 30));
  });
});

describe("date-fns API columns", () => {
  test("every populated cell returns a finite checksum", () => {
    for (const kase of API_CASES) {
      if (kase.dateFns === undefined) continue;
      assert.ok(Number.isFinite(kase.dateFns(api)(BASE_TS)), kase.key);
    }
  });

  test("unsupported Luxon-specific operations remain blank", () => {
    const missing = API_CASES.filter(({ dateFns }) => dateFns === undefined).map(({ key }) => key);

    assert.deepEqual(missing, [
      "fromFormatParser",
      "getPossibleOffsets",
      "Duration plus pooled",
      "Duration as",
      "Duration as pooled",
      "Duration shiftTo",
      "Duration shiftTo pooled",
      "Duration toFormat num",
      "Duration toFormat text",
      "Interval splitBy",
      "Interval toDuration pooled",
    ]);
  });
});
