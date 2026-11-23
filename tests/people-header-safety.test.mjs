import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../js/school-admin/people-access.mjs",import.meta.url),"utf8");

test("People & Access teacher option population cannot target the shared navigation root",()=>{
  assert.match(source,/if\(control\.tagName!==["']SELECT["']\)continue;/,
    "option population rejects non-select elements before replacing children");
  assert.match(source,/populateOptions\(["']select\[data-school-teacher\]["'],teachers\.teachers\|\|\[\],["']uid["']\)/,
    "single teacher controls use a select-qualified selector");
  assert.match(source,/populateMultiOptions\(["']select\[data-school-teacher-bulk\]["'],teachers\.teachers\|\|\[\],["']uid["']\)/,
    "bulk teacher controls use a select-qualified selector");
  assert.doesNotMatch(source,/populateOptions\(["']\[data-school-teacher\]["']/,
    "the broad selector that also matches #adminerva-nav must not return");
});
