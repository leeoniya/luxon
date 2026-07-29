import Info from "../src/info.js";
import Locale from "../src/impl/locale.js";
import { runSuite } from "./lib/tinybench-suite.js";

// Each pair is the point: once with a Locale handed in, once leaving Info to
// build one. The second is the path a caller actually takes.
function runInfoSuite(method) {
  const locale = Locale.create(null, null, null);

  return runSuite(`Info.${method}`, (bench) => {
    bench
      .add(`Info.${method} with existing locale`, () => {
        Info[method]("long", { locObj: locale });
      })
      .add(`Info.${method}`, () => {
        Info[method]("long");
      });
  });
}

const allSuites = ["months", "monthsFormat", "weekdays", "weekdaysFormat"].map(
  (method) => () => runInfoSuite(method)
);

export default allSuites;
