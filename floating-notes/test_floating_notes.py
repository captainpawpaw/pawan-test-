"""Unit tests for the parts of Floating Notes that don't need a screen.

Run with `py -m unittest` (Windows) or `python3 -m unittest` in this folder.
"""

import json
import os
import tempfile
import unittest

import floating_notes as fn


class SearchTests(unittest.TestCase):
    projects = [
        {"id": "a", "name": "Acme website", "text": "Call Sam about the login page", "updated": 3},
        {"id": "b", "name": "Taxes 2026", "text": "receipts in the blue folder", "updated": 5},
        {"id": "c", "name": "Groceries", "text": "", "updated": 1},
    ]

    def test_sort_newest_first(self):
        self.assertEqual([p["id"] for p in fn.sort_projects(self.projects)], ["b", "a", "c"])

    def test_empty_query_returns_all(self):
        self.assertEqual(len(fn.filter_projects(self.projects, "  ")), 3)

    def test_matches_name_or_notes_case_insensitive(self):
        self.assertEqual([p["id"] for p in fn.filter_projects(self.projects, "ACME")], ["a"])
        self.assertEqual([p["id"] for p in fn.filter_projects(self.projects, "folder")], ["b"])

    def test_every_word_must_match(self):
        self.assertEqual([p["id"] for p in fn.filter_projects(self.projects, "sam login")], ["a"])
        self.assertEqual(fn.filter_projects(self.projects, "sam receipts"), [])

    def test_snippet_shows_text_around_match(self):
        s = fn.snippet("Call Sam about the login page and more words after it", "login", width=20)
        self.assertIn("login", s)
        self.assertTrue(s.startswith("…"))
        self.assertEqual(fn.snippet("nothing here", "zzz"), "")


class FitRectTests(unittest.TestCase):
    left = (0, 0, 1920, 1040)        # primary, taskbar at the bottom
    right = (1920, 0, 3840, 1080)    # second monitor to the right

    def test_inside_stays_put(self):
        self.assertEqual(fn.fit_rect(100, 100, 300, 300, [self.left]), (100, 100))

    def test_pulled_back_from_right_edge(self):
        self.assertEqual(fn.fit_rect(1800, 50, 300, 300, [self.left]), (1620, 50))

    def test_kept_above_taskbar(self):
        self.assertEqual(fn.fit_rect(100, 1000, 300, 300, [self.left]), (100, 740))

    def test_works_on_second_monitor(self):
        self.assertEqual(fn.fit_rect(2500, 500, 300, 300, [self.left, self.right]), (2500, 500))

    def test_goes_to_monitor_it_overlaps_most(self):
        x, _ = fn.fit_rect(1850, 100, 300, 300, [self.left, self.right])
        self.assertEqual(x, 1920)  # mostly on the right monitor

    def test_unplugged_monitor_moves_to_nearest(self):
        self.assertEqual(fn.fit_rect(5000, 300, 300, 300, [self.left, self.right]), (3540, 300))

    def test_monitor_left_of_primary(self):
        left_of_primary = (-1920, 0, 0, 1080)
        self.assertEqual(fn.fit_rect(-500, 100, 300, 300, [self.left, left_of_primary]), (-500, 100))


class NewNoteTests(unittest.TestCase):
    stamp = "Wed 14 Oct 2026, 09:41"

    def test_first_note_has_no_gap(self):
        self.assertEqual(fn.entry_prefix("", self.stamp), self.stamp + "\n")
        self.assertEqual(fn.entry_prefix("  \n", self.stamp), self.stamp + "\n")

    def test_blank_line_after_previous_note(self):
        self.assertEqual(fn.entry_prefix("old note", self.stamp), "\n\n" + self.stamp + "\n")
        self.assertEqual(fn.entry_prefix("old note\n", self.stamp), "\n" + self.stamp + "\n")
        self.assertEqual(fn.entry_prefix("old note\n\n", self.stamp), self.stamp + "\n")

    def test_timestamp_format(self):
        import time
        t = time.mktime((2026, 10, 14, 9, 41, 0, 0, 0, -1))
        self.assertEqual(fn.timestamp(t), "Wed 14 Oct 2026, 09:41")


class LookTests(unittest.TestCase):
    def test_stamp_lines_found(self):
        text = "old\n\nWed 14 Oct 2026, 09:41\nhello\n\nMi 15 Okt 2026, 10:02\nnot a date: 14 Oct"
        self.assertEqual(fn.stamp_lines(text), [3, 6])

    def test_white_is_the_default(self):
        self.assertEqual(fn.resolve_colors({})["bg"], "#ffffff")

    def test_custom_colours_override_the_preset(self):
        c = fn.resolve_colors({"preset": "Dark", "colors": {"bg": "#ffeedd"}})
        self.assertEqual(c["bg"], "#ffeedd")
        self.assertEqual(c["fg"], fn.PRESETS["Dark"]["fg"])
        self.assertEqual(set(c), {k for k, _ in fn.COLOR_ROLES})


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "FloatingNotes", "data.json")

    def tearDown(self):
        self.dir.cleanup()

    def test_round_trip(self):
        s = fn.Store(self.path)
        p = s.add_project("  Client X  ")
        p["text"] = "first note ✓"
        s.data["windows"] = [{"id": "w1", "x": 10, "y": 20, "view": "notes", "project": p["id"]}]
        s.save()
        again = fn.Store(self.path)
        self.assertEqual(again.projects[0]["name"], "Client X")
        self.assertEqual(again.projects[0]["text"], "first note ✓")
        self.assertEqual(again.data["windows"][0]["project"], p["id"])
        self.assertFalse(os.path.exists(self.path + ".tmp"))

    def test_blank_name_becomes_untitled(self):
        self.assertEqual(fn.Store(self.path).add_project("   ")["name"], "Untitled")

    def test_corrupt_file_is_kept_aside_not_overwritten(self):
        os.makedirs(os.path.dirname(self.path))
        with open(self.path, "w") as f:
            f.write("{not json")
        s = fn.Store(self.path)
        self.assertIsNotNone(s.error)
        self.assertEqual(s.projects, [])
        with open(self.path + ".unreadable") as f:
            self.assertEqual(f.read(), "{not json")


if __name__ == "__main__":
    unittest.main()


class MergeTests(unittest.TestCase):
    def p(self, pid, text, updated, name=None):
        return {"id": pid, "name": name or pid, "text": text, "updated": updated}

    def test_new_projects_from_both_sides(self):
        out, _, conflicts = fn.merge_projects([self.p("a", "x", 1)], [self.p("b", "y", 2)], {}, {}, {})
        self.assertEqual(sorted(p["id"] for p in out), ["a", "b"])
        self.assertEqual(conflicts, [])

    def test_changed_on_one_side_takes_that_side(self):
        base = {"a": 5}
        out, _, conflicts = fn.merge_projects([self.p("a", "old", 5)], [self.p("a", "new", 9)], {}, {}, base)
        self.assertEqual(out[0]["text"], "new")
        self.assertEqual(conflicts, [])
        out, _, _ = fn.merge_projects([self.p("a", "mine", 9)], [self.p("a", "old", 5)], {}, {}, base)
        self.assertEqual(out[0]["text"], "mine")

    def test_changed_on_both_sides_keeps_both(self):
        out, _, conflicts = fn.merge_projects(
            [self.p("a", "laptop text", 8, "Job")], [self.p("a", "desktop text", 9, "Job")], {}, {}, {"a": 5},
            device="LAPTOP")
        self.assertEqual(len(out), 2)
        main = next(p for p in out if p["id"] == "a")
        copy_ = next(p for p in out if p["id"] != "a")
        self.assertEqual(main["text"], "desktop text")  # newer wins
        self.assertEqual(copy_["text"], "laptop text")
        self.assertEqual(copy_["name"], "Job (conflict, LAPTOP)")
        self.assertEqual(conflicts, ["Job"])

    def test_deletion_travels_but_later_edit_survives(self):
        out, deleted, _ = fn.merge_projects([self.p("a", "x", 5)], [], {}, {"a": 6}, {"a": 5}, now=10)
        self.assertEqual(out, [])
        self.assertIn("a", deleted)
        out, _, _ = fn.merge_projects([self.p("a", "edited later", 7)], [], {}, {"a": 6}, {"a": 5}, now=10)
        self.assertEqual(out[0]["text"], "edited later")

    def test_old_tombstones_are_pruned(self):
        _, deleted, _ = fn.merge_projects([], [], {"a": 1}, {}, {}, now=1 + 91 * 86400)
        self.assertEqual(deleted, {})


class DriveSyncTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.drive = self.dir.name

    def tearDown(self):
        self.dir.cleanup()

    def snap(self, projects, dirty=True):
        return {"projects": projects, "deleted": {}, "last_synced": {}, "counter": 1, "dirty": dirty}

    def test_offline_when_folder_missing(self):
        r = fn.sync_with_drive(os.path.join(self.drive, "nope"), self.snap([]), None)
        self.assertEqual(r["status"], "offline")

    def test_two_pcs_end_up_with_both_projects(self):
        a = fn.sync_with_drive(self.drive, self.snap([{"id": "a", "name": "A", "text": "1", "updated": 1}]), None)
        b = fn.sync_with_drive(self.drive, self.snap([{"id": "b", "name": "B", "text": "2", "updated": 2}]), None)
        self.assertEqual(sorted(p["id"] for p in b["projects"]), ["a", "b"])
        with open(os.path.join(self.drive, fn.DRIVE_FILE), encoding="utf-8") as f:
            self.assertEqual(len(json.load(f)["projects"]), 2)
        self.assertEqual(a["status"], "synced")

    def test_unchanged_file_is_not_reread(self):
        r = fn.sync_with_drive(self.drive, self.snap([{"id": "a", "name": "A", "text": "", "updated": 1}]), None)
        again = fn.sync_with_drive(self.drive, self.snap([], dirty=False), r["mtime"])
        self.assertTrue(again.get("unchanged"))

    def test_damaged_drive_file_is_never_overwritten(self):
        path = os.path.join(self.drive, fn.DRIVE_FILE)
        with open(path, "w") as f:
            f.write('{"projects": [')
        r = fn.sync_with_drive(self.drive, self.snap([{"id": "a", "name": "A", "text": "", "updated": 1}]), None)
        self.assertEqual(r["status"], "error")
        with open(path) as f:
            self.assertEqual(f.read(), '{"projects": [')
