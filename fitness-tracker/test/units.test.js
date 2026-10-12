import { test } from "node:test";
import assert from "node:assert/strict";
import { toKg, fromKg, bwText, bwValue } from "../src/units.js";

test("entry to kg", () => {
  assert.equal(toKg("kg", "78.5"), 78.5);
  assert.equal(toKg("lb", "175"), 79.4);
  assert.equal(toKg("st", "12", "7"), 79.4);
  assert.equal(toKg("st", "12", ""), 76.2);
  assert.equal(toKg("kg", ""), null);
  assert.equal(toKg("st", "-1", "3"), null);
});

test("kg to entry and text", () => {
  assert.deepEqual(fromKg(79.4, "st"), { main: "12", extra: "7" });
  assert.deepEqual(fromKg(79.4, "lb"), { main: "175", extra: "" });
  assert.deepEqual(fromKg(88.9, "st"), { main: "14", extra: "0" }); // 195.99 lb rounds up to 14 st 0
  assert.equal(bwText(79.4, "st"), "12 st 7 lb");
  assert.equal(bwText(79.4, "kg"), "79.4 kg");
  assert.equal(bwText(79.4, "lb"), "175 lb");
  assert.equal(bwValue(79.4, "st"), 12.5);
});
