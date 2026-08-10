import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { patchedEntry, patchKey, patchKeys, withNeeds, type PatchKey } from "../lib/patches.ts";

const numberingTable = patchKey("numberingTable");

const builds: [string, PatchKey[]][] = [
  ["numberingTable", [numberingTable]],
  ["every patch", [...patchKeys]],
];

const samples = {
  arab: "٠١٢٣٤٥٦٧٨٩",
  arabext: "۰۱۲۳۴۵۶۷۸۹",
  bali: "᭐᭑᭒᭓᭔᭕᭖᭗᭘᭙",
  beng: "০১২৩৪৫৬৭৮৯",
  deva: "०१२३४५६७८९",
  fullwide: "０１２３４５６７８９",
  gujr: "૦૧૨૩૪૫૬૭૮૯",
  hanidec: "〇一二三四五六七八九",
  khmr: "០១២៣៤៥៦៧៨៩",
  knda: "೦೧೨೩೪೫೬೭೮೯",
  laoo: "໐໑໒໓໔໕໖໗໘໙",
  limb: "᥆᥇᥈᥉᥊᥋᥌᥍᥎᥏",
  mlym: "൦൧൨൩൪൫൬൭൮൯",
  mong: "᠐᠑᠒᠓᠔᠕᠖᠗᠘᠙",
  mymr: "၀၁၂၃၄၅၆၇၈၉",
  orya: "୦୧୨୩୪୫୬୭୮୯",
  tamldec: "௦௧௨௩௪௫௬௭௮௯",
  telu: "౦౧౨౩౪౫౬౭౮౯",
  thai: "๐๑๒๓๔๕๖๗๘๙",
  tibt: "༠༡༢༣༤༥༦༧༨༩",
  latn: "0123456789",
} as const;

type DigitsModule = {
  parseDigits(value: string): number;
  digitRegex(locale: { numberingSystem: string }, append?: string): RegExp;
};

async function loadDigits(keys: PatchKey[]): Promise<DigitsModule> {
  const entry = await patchedEntry(keys);
  return (await import(new URL("impl/digits.js", entry).href)) as DigitsModule;
}

test("numberingTable is independent", () => {
  assert.deepEqual(withNeeds([numberingTable]), [numberingTable]);
});

test("numberingTable keeps one source of numbering-system keys", async () => {
  const entry = await patchedEntry([numberingTable]);
  const source = await readFile(new URL("impl/digits.js", entry), "utf8");
  assert.doesNotMatch(source, /numberingSystemsUTF16/);
});

for (const [label, keys] of builds) {
  describe(`numberingTable > ${label}`, async () => {
    const stock = await loadDigits([]);
    const candidate = await loadDigits(keys);

    test("all supported digit strings and regexes match stock", () => {
      for (const [numberingSystem, digits] of Object.entries(samples)) {
        assert.equal(candidate.parseDigits(digits), stock.parseDigits(digits), numberingSystem);

        const expected = stock.digitRegex({ numberingSystem }, "+");
        const actual = candidate.digitRegex({ numberingSystem }, "+");
        assert.equal(actual.source, expected.source, numberingSystem);

        for (const digit of digits) {
          assert.equal(
            actual.test(`${digit}+`),
            expected.test(`${digit}+`),
            `${numberingSystem}: ${digit}`
          );
        }
      }
    });

    test("an unknown numbering system retains stock behavior", () => {
      const locale = { numberingSystem: "not-a-numbering-system" };
      assert.equal(candidate.digitRegex(locale).source, stock.digitRegex(locale).source);
    });
  });
}
