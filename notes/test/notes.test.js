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
    { id: "x", body: "hi", tags: [], pinned: true, createdAt: 5, updatedAt: 6 },
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

test("applySnapshot keeps local copies of notes with unsaved edits", async () => {
  const { applySnapshot } = await import("../src/cloud.js");
  const local = [{ id: "a", body: "typing…" }, { id: "b", body: "old" }, { id: "new", body: "draft" }];
  const remote = [{ id: "a", body: "stale" }, { id: "b", body: "from other device" }, { id: "c", body: "added elsewhere" }];
  const dirty = new Set(["a", "new"]);
  const merged = Object.fromEntries(applySnapshot(local, remote, (id) => dirty.has(id)).map((n) => [n.id, n.body]));
  assert.deepEqual(merged, { a: "typing…", b: "from other device", c: "added elsewhere", new: "draft" });
});

test("normalizeTag cleans user input", async () => {
  const { normalizeTag } = await import("../src/notes.js");
  assert.equal(normalizeTag("  #Work Stuff "), "work-stuff");
  assert.equal(normalizeTag("Q3/plans!"), "q3plans");
  assert.equal(normalizeTag("#  "), "");
});

test("addTags adds several comma-separated tags without duplicates; removeTag removes one", async () => {
  const { addTags, removeTag } = await import("../src/notes.js");
  const n = note("x", { tags: ["work"] });
  const added = addTags(n, "Ideas, work, , #Travel");
  assert.deepEqual(added.tags, ["work", "ideas", "travel"]);
  assert.equal(addTags(added, "ideas"), added); // nothing new -> same object, no save
  assert.deepEqual(removeTag(added, "work").tags, ["ideas", "travel"]);
});

test("search matches tag-field tags and text across all notes", () => {
  const ns = [
    note("Meeting notes\nbudget review", { tags: ["work", "finance"] }),
    note("Packing list #travel", { tags: [] }),
    note("Old note without tags field"),
  ];
  delete ns[2].tags;
  assert.deepEqual(tagsOf(ns[0]), ["finance", "work"]);
  assert.equal(filterNotes(ns, "finan").length, 1); // partial tag match
  assert.equal(filterNotes(ns, "#work").length, 1);
  assert.equal(filterNotes(ns, "#travel").length, 1); // inline hashtag still counts
  assert.equal(filterNotes(ns, "note").length, 2); // text across notes
  assert.equal(filterNotes(ns, "#work budget").length, 1);
});

test("validateImport keeps and cleans tags", () => {
  const [n] = validateImport([{ id: "x", body: "b", tags: ["Work", "work", " Big Ideas "] }]);
  assert.deepEqual(n.tags, ["work", "big-ideas"]);
});
