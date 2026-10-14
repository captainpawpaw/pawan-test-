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
