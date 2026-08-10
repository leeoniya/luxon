import type { MutationSet } from "../lib/mutations.ts";

const set: MutationSet = {
  patch: "10-numbering-table.patch",
  tests: ["test/numbering-table-patch.test.ts"],
  mutations: [
    {
      name: "shifts the Arabic UTF-16 range by one",
      find: '+  arab: ["[\\u0660-\\u0669]", 1632, 1641],',
      replace: '+  arab: ["[\\u0660-\\u0669]", 1633, 1642],',
    },
    {
      name: "uses the Arabic regex for extended Arabic digits",
      find: '+  arabext: ["[\\u06F0-\\u06F9]", 1776, 1785],',
      replace: '+  arabext: ["[\\u0660-\\u0669]", 1776, 1785],',
    },
    {
      name: "throws instead of retaining unknown-numbering-system behavior",
      find: "+    regex = new RegExp(`${numberingSystems[ns]?.[0]}${append}`);",
      replace: "+    regex = new RegExp(`${numberingSystems[ns][0]}${append}`);",
    },
  ],
};

export default set;
