import assert from "node:assert/strict";
import test from "node:test";
import { shade, stripColor, underlineSignificantStep } from "../lib/color.ts";
import { htmlReport } from "../lib/html-report.ts";

test("small consecutive changes keep only their baseline colour", () => {
  const colored = shade("89.0", 89, 1000, true);

  assert.equal(underlineSignificantStep(colored, 89, 91, 1000, 0, true), "\u001b[38;5;40m89.0\u001b[0m");
});

test("significant same-shade changes underline the baseline colour", () => {
  const colored = shade("51.0", 51, 1000, true);

  assert.equal(
    underlineSignificantStep(colored, 51, 90, 1000, 0, true),
    "\u001b[4;38;5;40m51.0\u001b[0m"
  );
});

test("significant uncoloured changes are still underlined", () => {
  assert.equal(
    underlineSignificantStep("90.0", 90, 51, undefined, 0, true),
    "\u001b[4m90.0\u001b[0m"
  );
});

test("measured spread can suppress an underline", () => {
  const colored = shade("65.0", 65, 1000, true);

  assert.equal(underlineSignificantStep(colored, 65, 90, 1000, 0.5, true), colored);
});

test("a change in baseline shade suppresses the row underline", () => {
  const colored = shade("400.0", 400, 1000, true);

  assert.equal(underlineSignificantStep(colored, 400, 600, 1000, 0, true), colored);
});

test("a change in rendered digit count suppresses the row underline", () => {
  const colored = shade("110.0", 110, 1000, true);

  assert.equal(underlineSignificantStep(colored, 110, 90, 1000, 0, true), colored);
});

test("an absolute change of 1.5ms or less is thermal noise", () => {
  assert.equal(underlineSignificantStep("2.5", 2.5, 1, undefined, 0, true), "2.5");
  assert.equal(
    underlineSignificantStep("2.6", 2.6, 1, undefined, 0, true),
    "\u001b[4m2.6\u001b[0m"
  );
});

test("HTML combines colour and underline classes", () => {
  const output = underlineSignificantStep(shade("51.0", 51, 1000, true), 51, 90, 1000, 0, true);

  assert.match(htmlReport(output, "test"), /<span class="g d">51\.0<\/span>/);
});

test("HTML marks an uncoloured change with the underline class", () => {
  const output = underlineSignificantStep("90.0", 90, 51, undefined, 0, true);

  assert.match(htmlReport(output, "test"), /<span class="d">90\.0<\/span>/);
});

test("HTML keeps the terminal container separate from the pink shade", () => {
  const report = htmlReport(shade("1.5", 1.5, 1, true), "test");

  assert.match(report, /body \{\s+background-color: #232627;\s+color: #fcfcfc;/);
  assert.match(report, /<pre class="t"><span class="p">1\.5<\/span><\/pre>/);
  assert.doesNotMatch(report, /\.t \{ color:/);
});

test("plain redirected output removes styling", () => {
  const output = underlineSignificantStep(shade("51.0", 51, 1000, true), 51, 90, 1000, 0, true);

  assert.equal(stripColor(output), "51.0");
});
