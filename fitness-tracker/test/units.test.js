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

test("lifting weights in lb: stored in kg, shown in lb", async () => {
  const { liftToKg, liftField, liftText, roundLift } = await import("../src/units.js");
  assert.equal(liftToKg("135", "lb"), "61.235");
  assert.equal(liftField("61.235", "lb"), "135");
  assert.equal(liftText(61.235, "lb"), "135 lb");
  assert.equal(liftText(100, "lb"), "220.5 lb");
  assert.equal(liftText(57.5, "kg"), "57.5 kg");
  assert.equal(liftToKg("80", "kg"), "80");
  assert.equal(liftToKg("", "lb"), "");
  assert.equal(Math.round(roundLift(100 * 0.7, "lb") / 0.45359237), 155); // 154.3 lb -> 155
  assert.equal(roundLift(73.5, "kg"), 72.5);
});
