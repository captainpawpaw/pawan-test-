import { test } from "node:test";
import assert from "node:assert/strict";
import { lastWeighIn, nextWeighIn, weighInDue, describeWeighIn, weighInCalendar } from "../src/weighin.js";

// Monday 12 Oct 2026
const mon = (h, m = 0) => new Date(2026, 9, 12, h, m);
const setting = { on: true, day: 1, time: "07:30", since: new Date(2026, 9, 1).getTime() };

test("last and next weigh-in times", () => {
  assert.equal(lastWeighIn(setting, mon(8)).getTime(), mon(7, 30).getTime());
  assert.equal(lastWeighIn(setting, mon(7)).getTime(), new Date(2026, 9, 5, 7, 30).getTime());
  assert.equal(nextWeighIn(setting, mon(8)).getTime(), new Date(2026, 9, 19, 7, 30).getTime());
  assert.equal(lastWeighIn({ ...setting, day: 0 }, mon(8)).getTime(), new Date(2026, 9, 11, 7, 30).getTime());
});

test("asks once the time has passed, until a weight is logged or the week is skipped", () => {
  assert.equal(weighInDue(setting, [], mon(8)).getTime(), mon(7, 30).getTime());
  assert.equal(weighInDue(setting, [{ date: "2026-10-12", kg: 80 }], mon(8)), null);
  assert.ok(weighInDue(setting, [{ date: "2026-10-11", kg: 80 }], mon(8)));
  assert.equal(weighInDue({ ...setting, skipped: mon(7, 30).getTime() }, [], mon(8)), null);
  // a skipped week doesn't hide the next one
  assert.ok(weighInDue({ ...setting, skipped: mon(7, 30).getTime() }, [], new Date(2026, 9, 19, 9)));
});

test("doesn't ask when off, or for a weigh-in before it was set up", () => {
  assert.equal(weighInDue({ ...setting, on: false }, [], mon(8)), null);
  assert.equal(weighInDue(null, [], mon(8)), null);
  assert.equal(weighInDue({ ...setting, since: mon(7, 45).getTime() }, [], mon(8)), null);
});

test("describes the schedule and makes a repeating calendar event", () => {
  assert.match(describeWeighIn(setting), /^Mondays at 7:30/);
  const ics = weighInCalendar(setting, "https://example.test/", mon(8));
  assert.match(ics, /DTSTART:20261019T073000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO/);
  assert.match(ics, /BEGIN:VALARM/);
});
