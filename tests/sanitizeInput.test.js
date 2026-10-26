import test from "node:test";
import assert from "node:assert/strict";
import {
  optionalObjectId,
  optionalEnum,
  optionalSearchString,
} from "../utils/sanitizeInput.js";

test("optionalObjectId accepts valid id and rejects operators", () => {
  assert.equal(optionalObjectId("507f1f77bcf86cd799439011"), "507f1f77bcf86cd799439011");
  assert.equal(optionalObjectId(""), undefined);
  assert.throws(() => optionalObjectId({ $gt: "" }), /Invalid/);
  assert.throws(() => optionalObjectId("not-an-id"), /Invalid/);
});

test("optionalEnum whitelists values", () => {
  assert.equal(optionalEnum("retail", ["retail", "wholesale"], "salesType"), "retail");
  assert.throws(() => optionalEnum("admin", ["retail", "wholesale"], "salesType"), /Invalid/);
});

test("optionalSearchString caps length and rejects objects", () => {
  assert.equal(optionalSearchString("  abc  "), "abc");
  assert.throws(() => optionalSearchString({ $regex: "x" }), /string/);
  const long = "a".repeat(200);
  assert.equal(optionalSearchString(long, 50).length, 50);
});
