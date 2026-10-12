import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allTags, createNote, filterNotes, mergeNotes, previewOf, sortNotes, tagsOf, titleOf, validateImport,
} from "../src/notes.js";

const note = (body, extra = {}) => ({ ...createNote(1000), body, ...extra });

test("titleOf uses first non-empty line and strips heading marks", () => {
  assert.equal(titleOf(note("\n\n# Groceries\nmilk")), "Groceries");
  assert.equal(titleOf(note("")), "Untitled");
  assert.equal(titleOf(note("###   ")), "Untitled");
});

test("previewOf skips the title and collapses whitespace", () => {
  assert.equal(previewOf(note("Title\n  line one\n\nline two ")), "line one line two");
  assert.equal(previewOf(note("T\n" + "x".repeat(100)), 10), "xxxxxxxxx…");
});

test("tagsOf finds unique lowercase hashtags but not mid-word #", () => {
  assert.deepEqual(tagsOf(note("#Work stuff #ideas and #work again, issue#5")), ["ideas", "work"]);
});

test("sortNotes puts pinned first, then newest", () => {
  const a = note("a", { id: "a", updatedAt: 3 });
  const b = note("b", { id: "b", updatedAt: 1, pinned: true });
  const c = note("c", { id: "c", updatedAt: 2 });
  assert.deepEqual(sortNotes([a, b, c]).map((n) => n.id), ["b", "a", "c"]);
});

test("filterNotes requires all terms and matches #tags exactly", () => {
  const ns = [note("Trip plan #travel\nbook hotel"), note("Hotel review #work"), note("#travelling notes")];
  assert.equal(filterNotes(ns, "").length, 3);
  assert.equal(filterNotes(ns, "HOTEL").length, 2);
  assert.equal(filterNotes(ns, "hotel #travel").length, 1);
  assert.equal(filterNotes(ns, "#travel").length, 1);
});

test("allTags counts tags across notes", () => {
  assert.deepEqual(allTags([note("#a #b"), note("#a")]), [["a", 2], ["b", 1]]);
});

test("validateImport accepts wrapped or bare arrays and drops bad entries", () => {
  const good = { id: "x", body: "hi", pinned: 1, createdAt: 5, updatedAt: 6 };
  assert.deepEqual(validateImport({ notes: [good, { id: 3 }, null] }), [
    { id: "x", body: "hi", pinned: true, createdAt: 5, updatedAt: 6 },
  ]);
  assert.equal(validateImport([good]).length, 1);
  assert.throws(() => validateImport({ foo: 1 }));
});

test("mergeNotes keeps the newer version of each note", () => {
  const local = [{ id: "a", body: "old", updatedAt: 1 }, { id: "b", body: "keep", updatedAt: 9 }];
  const incoming = [{ id: "a", body: "new", updatedAt: 2 }, { id: "b", body: "stale", updatedAt: 3 }, { id: "c", body: "add", updatedAt: 1 }];
  const merged = Object.fromEntries(mergeNotes(local, incoming).map((n) => [n.id, n.body]));
  assert.deepEqual(merged, { a: "new", b: "keep", c: "add" });
});
