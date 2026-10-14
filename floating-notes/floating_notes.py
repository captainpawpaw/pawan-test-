"""Floating Notes.

Plain, frameless, always-on-top note windows for Windows. Each window fades
to see-through when the mouse isn't over it, and steps through four views:

    dot  --click-->  root  --click-->  projects  --click a project-->  notes

Open as many windows as you like (one per job); they share the same
projects. Windows, their positions and what they show are restored the next
time you start the app. Launching the app again while it's running opens a
new window instead of a second copy.

Notes are always saved on this PC first (%APPDATA%\\FloatingNotes\\data.json),
so the app works offline. Optionally they also sync with a file in a Google
Drive for desktop folder; edits made on different PCs are merged, and if the
same project changed in two places, both versions are kept.

Standard library only. Run it with `pythonw floating_notes.py`, or build a
single .exe with build.bat.
"""

import copy
import json
import os
import queue
import socket
import sys
import threading
import time
import tkinter as tk
import uuid
from tkinter import filedialog, messagebox

APP_NAME = "Floating Notes"
PORT = 47653  # localhost only; used so a second launch opens a window in the running app
SAVE_DELAY_MS = 600
FADE_TICK_MS = 40

# Opacity when the mouse is away. "Off" keeps windows solid.
FADE_LEVELS = {"Off": 1.0, "Light": 0.7, "Medium": 0.45, "Strong": 0.2}
DEFAULT_FADE = "Medium"

# Seconds after the cursor leaves (and typing stops) before a window shrinks back to its dot.
HIDE_AFTER = {"3 seconds": 3, "10 seconds": 10, "30 seconds": 30, "Never": None}
DEFAULT_HIDE = "3 seconds"
TYPING_KEEPS_AWAKE = 2  # seconds a keystroke keeps a window solid with the cursor elsewhere

DOT = 40
ROOT_SIZE = (200, 120)
PROJECTS_SIZE = (260, 360)
NOTES_SIZE = (340, 420)
MIN_NOTES_SIZE = (220, 160)

LIGHT = dict(bg="#f7f7f5", fg="#1f1f1f", muted="#76767a", line="#dcdcd8", hover="#ebebe8", field="#ffffff")
DARK = dict(bg="#1f1f21", fg="#e9e9e7", muted="#9b9ba0", line="#38383c", hover="#2c2c30", field="#262629")


# --------------------------------------------------------------------------
# Pure helpers (unit tested)
# --------------------------------------------------------------------------

def sort_projects(projects):
    """Most recently edited first."""
    return sorted(projects, key=lambda p: p.get("updated", 0), reverse=True)


def filter_projects(projects, query):
    """Projects whose name or notes contain every word of the query (case-insensitive)."""
    words = query.lower().split()
    if not words:
        return list(projects)
    out = []
    for p in projects:
        hay = (p.get("name", "") + "\n" + p.get("text", "")).lower()
        if all(w in hay for w in words):
            out.append(p)
    return out


def snippet(text, query, width=36):
    """A short piece of `text` around the first query word, for search results."""
    words = query.lower().split()
    flat = " ".join(text.split())
    if not words:
        return ""
    i = flat.lower().find(words[0])
    if i < 0:
        return ""
    start = max(0, i - width // 3)
    piece = flat[start:start + width]
    return ("…" if start > 0 else "") + piece + ("…" if start + width < len(flat) else "")


def fit_rect(x, y, w, h, areas):
    """Move a w*h rectangle at (x, y) so it sits fully inside one screen's work area.

    `areas` is a list of (left, top, right, bottom). The rectangle goes to the
    area it overlaps most, or the nearest one if it's off every screen (say a
    monitor was unplugged).
    """
    if not areas:
        return x, y

    def overlap(a):
        l, t, r, b = a
        return max(0, min(x + w, r) - max(x, l)) * max(0, min(y + h, b) - max(y, t))

    def distance(a):
        l, t, r, b = a
        cx, cy = x + w / 2, y + h / 2
        dx = max(l - cx, 0, cx - r)
        dy = max(t - cy, 0, cy - b)
        return dx * dx + dy * dy

    best = max(areas, key=overlap)
    if overlap(best) == 0:
        best = min(areas, key=distance)
    l, t, r, b = best
    x = min(max(x, l), max(l, r - w))
    y = min(max(y, t), max(t, b - h))
    return int(x), int(y)


def timestamp(t=None):
    """The date-and-time line that starts each note, e.g. "Wed 14 Oct 2026, 09:41"."""
    return time.strftime("%a %d %b %Y, %H:%M", time.localtime(t))


def entry_prefix(existing, stamp):
    """Text to append before a new note: a blank line after the previous note, then the stamp line."""
    if not existing.strip():
        gap = ""
    elif existing.endswith("\n\n"):
        gap = ""
    elif existing.endswith("\n"):
        gap = "\n"
    else:
        gap = "\n\n"
    return gap + stamp + "\n"


def new_id():
    return uuid.uuid4().hex[:12]


# --------------------------------------------------------------------------
# Google Drive sync (pure parts)
# --------------------------------------------------------------------------

DRIVE_FILE = "Floating Notes.json"
SYNC_EVERY_MS = 5000
TOMBSTONE_DAYS = 90


def device_name():
    return os.environ.get("COMPUTERNAME") or socket.gethostname() or "another PC"


def merge_projects(local, remote, deleted_local, deleted_remote, last_synced, device="another PC", now=None):
    """Merge this PC's projects with the Drive copy.

    - A project changed on only one side takes that side's version.
    - Changed on both sides since the last sync: the newer one wins and the
      older is kept as a separate "(conflict …)" project, so no text is lost.
    - Deletions travel as tombstones {id: when}; a project edited after it was
      deleted elsewhere survives.

    Returns (projects, deleted, conflicts) where conflicts names the projects
    that were kept twice.
    """
    now = time.time() if now is None else now
    deleted = dict(deleted_remote)
    for pid, t in deleted_local.items():
        deleted[pid] = max(t, deleted.get(pid, 0))
    lmap = {p["id"]: p for p in local}
    rmap = {p["id"]: p for p in remote}
    order = [p["id"] for p in local] + [p["id"] for p in remote if p["id"] not in lmap]
    out, conflicts = [], []
    for pid in order:
        l, r = lmap.get(pid), rmap.get(pid)
        if l and r and l != r:
            winner, loser = (l, r) if l.get("updated", 0) >= r.get("updated", 0) else (r, l)
            base = last_synced.get(pid)
            both_changed = base is None or (l.get("updated", 0) > base and r.get("updated", 0) > base)
            if both_changed and l.get("text") != r.get("text") and loser.get("text", "").strip():
                where = device if loser is l else "another PC"
                copy_ = dict(loser, id=new_id(), name=f"{loser['name']} (conflict, {where})")
                out.append(copy_)
                conflicts.append(loser["name"])
            p = winner
        else:
            p = l or r
        if deleted.get(pid, 0) >= p.get("updated", 0):
            continue
        out.append(p)
    cutoff = now - TOMBSTONE_DAYS * 86400
    deleted = {pid: t for pid, t in deleted.items() if t >= cutoff}
    return out, deleted, conflicts


def drive_folder_candidates():
    """Folders Google Drive for desktop usually creates, if present."""
    found = []
    if IS_WINDOWS:
        for letter in "GHIJKLMNOPQRSTUVWXYZDEF":
            found.append(f"{letter}:\\My Drive")
    home = os.path.expanduser("~")
    found += [os.path.join(home, "My Drive"), os.path.join(home, "Google Drive", "My Drive"),
              os.path.join(home, "Google Drive")]
    return [f for f in found if os.path.isdir(f)]


def sync_with_drive(folder, snapshot, last_mtime):
    """Runs on a worker thread. Reads the Drive file, merges, writes it back if needed.

    `snapshot` is a deep copy of {projects, deleted, last_synced}; this never
    touches live app state. Returns a result dict for the main thread.
    """
    if not folder or not os.path.isdir(folder):
        return {"status": "offline"}
    path = os.path.join(folder, DRIVE_FILE)
    remote = {"projects": [], "deleted": {}}
    mtime = None
    try:
        mtime = os.stat(path).st_mtime
        if mtime == last_mtime and not snapshot["dirty"]:
            return {"status": "synced", "unchanged": True, "mtime": mtime}
        with open(path, encoding="utf-8") as f:
            loaded = json.load(f)
        if not isinstance(loaded, dict) or not isinstance(loaded.get("projects"), list):
            return {"status": "error", "detail": f"{DRIVE_FILE} isn't a Floating Notes file"}
        remote = {"projects": loaded["projects"], "deleted": loaded.get("deleted", {})}
    except FileNotFoundError:
        pass
    except ValueError:
        # Probably mid-download by Google Drive; never overwrite it. Try again next time.
        return {"status": "error", "detail": "the Drive copy is still downloading or damaged"}
    except OSError as e:
        return {"status": "offline", "detail": str(e)}

    projects, deleted, conflicts = merge_projects(
        snapshot["projects"], remote["projects"], snapshot["deleted"], remote["deleted"],
        snapshot["last_synced"], device=device_name())
    if projects != remote["projects"] or deleted != remote["deleted"]:
        body = {"app": APP_NAME, "version": 1, "saved_by": device_name(), "saved_at": time.time(),
                "projects": projects, "deleted": deleted}
        tmp = path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(body, f, ensure_ascii=False, indent=1)
            os.replace(tmp, path)
            mtime = os.stat(path).st_mtime
        except OSError as e:
            return {"status": "error", "detail": f"couldn't write to Drive: {e.strerror or e}"}
    return {"status": "synced", "projects": projects, "deleted": deleted, "conflicts": conflicts,
            "mtime": mtime, "counter": snapshot["counter"]}


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------

def data_path():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "FloatingNotes", "data.json")


class Store:
    """Projects, open windows and settings, kept in one JSON file."""

    def __init__(self, path):
        self.path = path
        self.data = {"projects": [], "windows": [], "settings": {}, "deleted": {}, "sync": {}}
        self.counter = 0  # bumped on every project change; lets a finished sync tell if it's stale
        self.error = None
        try:
            with open(path, encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                self.data.update({k: loaded[k] for k in self.data if k in loaded})
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as e:
            # Keep the unreadable file instead of overwriting it with an empty one.
            self.error = f"Couldn't read {path}: {e}"
            try:
                os.replace(path, path + ".unreadable")
            except OSError:
                pass

    @property
    def projects(self):
        return self.data["projects"]

    @property
    def settings(self):
        return self.data["settings"]

    def project(self, pid):
        return next((p for p in self.projects if p["id"] == pid), None)

    def delete_project(self, p):
        self.projects.remove(p)
        self.data["deleted"][p["id"]] = time.time()

    def add_project(self, name):
        now = time.time()
        p = {"id": new_id(), "name": name.strip() or "Untitled", "text": "", "created": now, "updated": now}
        self.projects.append(p)
        return p

    def save(self):
        """Write atomically so a crash mid-write never leaves a half-written file."""
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)


# --------------------------------------------------------------------------
# Windows-specific bits (all optional; the app runs without them)
# --------------------------------------------------------------------------

IS_WINDOWS = sys.platform == "win32"


def enable_dpi_awareness():
    if not IS_WINDOWS:
        return
    import ctypes
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass


def work_areas(root):
    """Work area (screen minus taskbar) of every monitor, as (l, t, r, b)."""
    if IS_WINDOWS:
        try:
            import ctypes
            from ctypes import wintypes

            class MONITORINFO(ctypes.Structure):
                _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                            ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

            areas = []
            proc = ctypes.WINFUNCTYPE(ctypes.c_int, wintypes.HMONITOR, wintypes.HDC,
                                      ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

            def cb(hmon, _hdc, _rect, _data):
                info = MONITORINFO()
                info.cbSize = ctypes.sizeof(MONITORINFO)
                if ctypes.windll.user32.GetMonitorInfoW(hmon, ctypes.byref(info)):
                    r = info.rcWork
                    areas.append((r.left, r.top, r.right, r.bottom))
                return 1

            ctypes.windll.user32.EnumDisplayMonitors(None, None, proc(cb), 0)
            if areas:
                return areas
        except (AttributeError, OSError):
            pass
    return [(0, 0, root.winfo_screenwidth(), root.winfo_screenheight())]


def system_uses_dark_mode():
    if not IS_WINDOWS:
        return False
    try:
        import winreg
        key = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
            return winreg.QueryValueEx(k, "AppsUseLightTheme")[0] == 0
    except (ImportError, OSError):
        return False


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def launch_command():
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    exe = pyw if os.path.exists(pyw) else sys.executable
    return f'"{exe}" "{os.path.abspath(__file__)}"'


def get_autostart():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, APP_NAME)
            return True
    except (ImportError, OSError):
        return False


def set_autostart(enabled):
    try:
        import winreg
    except ImportError:
        return
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, launch_command())
        else:
            try:
                winreg.DeleteValue(k, APP_NAME)
            except OSError:
                pass


# --------------------------------------------------------------------------
# Single instance: a second launch asks the running app for a new window
# --------------------------------------------------------------------------

def ask_running_app_for_window():
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.5) as s:
            s.sendall(b"new\n")
            return s.recv(16).startswith(b"ok")
    except OSError:
        return False


def listen_for_launches(on_new_window):
    """Returns False if the port is taken (another app holds it)."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        srv.bind(("127.0.0.1", PORT))
    except OSError:
        srv.close()
        return False
    srv.listen(4)

    def loop():
        while True:
            try:
                conn, _ = srv.accept()
            except OSError:
                return
            with conn:
                try:
                    conn.settimeout(1)
                    if conn.recv(16).startswith(b"new"):
                        on_new_window()
                        conn.sendall(b"ok\n")
                except OSError:
                    pass

    threading.Thread(target=loop, daemon=True).start()
    return True


# --------------------------------------------------------------------------
# One floating window
# --------------------------------------------------------------------------

class NoteWindow:
    def __init__(self, app, state):
        self.app = app
        self.c = app.colors
        # state is saved as-is: id, x, y (the dot's spot), view, project, w, h (notes size)
        self.state = state
        self.alpha = 1.0
        self.text = None
        self.status = None
        self._drag = None
        self.last_active = time.monotonic()  # last hover, drag or keystroke
        self.last_key = 0.0

        w = self.win = tk.Toplevel(app.root)
        w.overrideredirect(True)
        w.attributes("-topmost", True)
        w.configure(bg=self.c["bg"])
        w.bind("<Escape>", lambda e: self.show("dot"))
        w.bind("<Key>", self.touch_key, add="+")
        self.body = None
        self.show(state.get("view", "dot"), save=False)

    # ---- layout ---------------------------------------------------------

    def show(self, view, save=True):
        if view == "notes" and not self.app.store.project(self.state.get("project")):
            view = "projects"
        self.state["view"] = view
        self.last_active = time.monotonic()  # each view gets a fresh countdown before shrinking
        self.text = self.status = None
        if self.body is not None:
            self.body.destroy()
        bg = self.app.key_color if view == "dot" else self.c["bg"]
        self.win.configure(bg=bg)
        self.body = tk.Frame(self.win, bg=bg, highlightthickness=1,
                             highlightbackground=self.c["line"], highlightcolor=self.c["line"])
        self.body.pack(fill="both", expand=True)
        getattr(self, "build_" + view)()
        self.place()
        if save:
            self.app.layout_changed()

    def size(self):
        view = self.state["view"]
        if view == "dot":
            return DOT, DOT
        if view == "root":
            return ROOT_SIZE
        if view == "projects":
            return PROJECTS_SIZE
        return self.state.get("w", NOTES_SIZE[0]), self.state.get("h", NOTES_SIZE[1])

    def place(self):
        w, h = self.size()
        x, y = fit_rect(self.state.get("x", 0), self.state.get("y", 0), w, h, self.app.areas)
        if self.state["view"] == "dot":
            self.state["x"], self.state["y"] = x, y
        self.win.geometry(f"{w}x{h}+{x}+{y}")

    def header(self, title, back=None):
        bar = tk.Frame(self.body, bg=self.c["bg"])
        bar.pack(fill="x")
        if back:
            self.button(bar, "‹", back, font=("Segoe UI", 13)).pack(side="left", padx=(4, 0))
        label = tk.Label(bar, text=title, bg=self.c["bg"], fg=self.c["muted"], anchor="w",
                         font=("Segoe UI", 9), padx=8 if not back else 2, pady=6)
        label.pack(side="left", fill="x", expand=True)
        self.button(bar, "×", self.close, tip="Close this window").pack(side="right", padx=(0, 4))
        self.button(bar, "–", lambda: self.show("dot"), tip="Shrink to a dot").pack(side="right")
        for widget in (bar, label):
            self.make_draggable(widget)
            widget.bind("<Button-3>", self.menu)
        return bar

    def button(self, parent, text, command, tip=None, font=("Segoe UI", 11)):
        b = tk.Label(parent, text=text, bg=self.c["bg"], fg=self.c["muted"], font=font,
                     padx=6, cursor="hand2")
        b.bind("<Button-1>", lambda e: command())
        b.bind("<Enter>", lambda e: b.configure(fg=self.c["fg"]))
        b.bind("<Leave>", lambda e: b.configure(fg=self.c["muted"]))
        return b

    def row(self, parent, text, command, muted=False):
        r = tk.Label(parent, text=text, bg=self.c["bg"], fg=self.c["muted" if muted else "fg"],
                     anchor="w", font=("Segoe UI", 10), padx=12, pady=5, cursor="hand2")
        r.pack(fill="x")
        r.bind("<Button-1>", lambda e: command())
        r.bind("<Enter>", lambda e: r.configure(bg=self.c["hover"]))
        r.bind("<Leave>", lambda e: r.configure(bg=self.c["bg"]))
        return r

    # ---- views ----------------------------------------------------------

    def build_dot(self):
        self.body.configure(highlightthickness=0)
        cv = tk.Canvas(self.body, width=DOT, height=DOT, bg=self.app.key_color, highlightthickness=0,
                       cursor="hand2")
        cv.pack()
        cv.create_oval(2, 2, DOT - 2, DOT - 2, fill=self.c["bg"], outline=self.c["line"], width=1)
        cv.create_text(DOT / 2, DOT / 2, text="✎", fill=self.c["muted"], font=("Segoe UI", 12))
        self.make_draggable(cv, on_click=lambda: self.show("root"))
        cv.bind("<Button-3>", self.menu)

    def build_root(self):
        self.header(APP_NAME)
        p = self.app.store.project(self.state.get("project"))
        self.row(self.body, "Projects  ›", lambda: self.show("projects"))
        if p:
            self.row(self.body, f"Back to {p['name']}", lambda: self.show("notes"))
        self.row(self.body, "New window", lambda: self.app.new_window(near=self), muted=True)

    def build_projects(self):
        self.header("Projects", back=lambda: self.show("root"))
        query = tk.StringVar()
        search = tk.Entry(self.body, textvariable=query, bg=self.c["field"], fg=self.c["fg"],
                          insertbackground=self.c["fg"], relief="flat", font=("Segoe UI", 10),
                          highlightthickness=1, highlightbackground=self.c["line"],
                          highlightcolor=self.c["muted"])
        search.pack(fill="x", padx=8, pady=(0, 6), ipady=3)
        self.placeholder(search, "Search projects and notes")

        lst = tk.Listbox(self.body, bg=self.c["bg"], fg=self.c["fg"], relief="flat", highlightthickness=0,
                         activestyle="none", selectbackground=self.c["hover"], selectforeground=self.c["fg"],
                         font=("Segoe UI", 10), borderwidth=0)
        lst.pack(fill="both", expand=True, padx=4)
        shown = []

        def refresh(*_):
            q = "" if search.is_placeholder() else query.get()
            shown[:] = sort_projects(filter_projects(self.app.store.projects, q))
            lst.delete(0, "end")
            for p in shown:
                extra = snippet(p["text"], q) if q and q.lower() not in p["name"].lower() else ""
                lst.insert("end", f"  {p['name']}" + (f"   —  {extra}" if extra else ""))
            if not shown:
                lst.insert("end", "  No projects match." if q else "  No projects yet. Add one below.")
                lst.itemconfigure(0, fg=self.c["muted"])

        def picked(e):
            i = lst.nearest(e.y)
            if 0 <= i < len(shown) and lst.bbox(i):
                return shown[i]
            return None

        def open_project(e):
            p = picked(e)
            if p:
                self.state["project"] = p["id"]
                self.show("notes")

        def project_menu(e):
            p = picked(e)
            if not p:
                return self.menu(e)
            m = tk.Menu(self.win, tearoff=0)
            m.add_command(label="Rename…", command=lambda: ask_name("Rename", p["name"], lambda n: rename(p, n)))
            m.add_command(label="Delete…", command=lambda: delete(p))
            m.tk_popup(e.x_root, e.y_root)

        def rename(p, name):
            p["name"] = name
            p["updated"] = time.time()
            self.app.data_changed()

        def delete(p):
            if messagebox.askyesno(APP_NAME, f"Delete “{p['name']}” and its notes?", parent=self.win):
                self.app.store.delete_project(p)
                self.app.data_changed()

        foot = tk.Frame(self.body, bg=self.c["bg"])
        foot.pack(fill="x", pady=(2, 6))

        def ask_name(prompt, initial, done):
            for child in foot.winfo_children():
                child.destroy()
            entry = tk.Entry(foot, bg=self.c["field"], fg=self.c["fg"], insertbackground=self.c["fg"],
                             relief="flat", font=("Segoe UI", 10), highlightthickness=1,
                             highlightbackground=self.c["muted"])
            entry.insert(0, initial)
            entry.pack(fill="x", padx=8, ipady=3)
            entry.select_range(0, "end")
            self.win.focus_force()
            entry.focus_set()

            def finish(ok):
                name = entry.get().strip()
                build_foot()
                if ok and name:
                    done(name)

            entry.bind("<Return>", lambda e: finish(True))
            entry.bind("<Escape>", lambda e: (finish(False), "break")[1])

        def create(name):
            p = self.app.store.add_project(name)
            self.app.data_changed()
            self.state["project"] = p["id"]
            self.show("notes")

        def build_foot():
            for child in foot.winfo_children():
                child.destroy()
            self.row(foot, "+ New project", lambda: ask_name("New project", "", create), muted=True)

        build_foot()
        lst.bind("<ButtonRelease-1>", open_project)
        lst.bind("<Button-3>", project_menu)
        query.trace_add("write", refresh)
        self.refresh_view = refresh
        refresh()

    def build_notes(self):
        p = self.app.store.project(self.state["project"])
        self.header(p["name"], back=lambda: self.show("projects"))
        foot = tk.Frame(self.body, bg=self.c["bg"])
        foot.pack(side="bottom", fill="x")  # packed before the text so it never gets squeezed out
        new_note = self.button(foot, "+ Note", lambda: self.start_note(force=True), font=("Segoe UI", 9))
        new_note.pack(side="left", padx=(6, 0))
        self.status = tk.Label(foot, text="", bg=self.c["bg"], fg=self.c["muted"], font=("Segoe UI", 8),
                               anchor="w", padx=12)
        self.status.pack(side="left", fill="x", expand=True)
        self.status.configure(text=self.app.status_text() if hasattr(self.app, "sync_status") else "")
        grip = tk.Label(foot, text="◢", bg=self.c["bg"], fg=self.c["line"], cursor="size_nw_se" if IS_WINDOWS else "bottom_right_corner",
                        font=("Segoe UI", 8), padx=2)
        grip.pack(side="right")
        grip.bind("<ButtonPress-1>", self.start_resize)
        grip.bind("<B1-Motion>", self.resize)
        grip.bind("<ButtonRelease-1>", lambda e: self.app.layout_changed())

        frame = tk.Frame(self.body, bg=self.c["bg"])
        frame.pack(fill="both", expand=True)
        bar = tk.Scrollbar(frame, orient="vertical", width=10, relief="flat", borderwidth=0)
        text = self.text = tk.Text(frame, wrap="word", undo=True, width=1, height=1, bg=self.c["bg"], fg=self.c["fg"],
                                   insertbackground=self.c["fg"], relief="flat", highlightthickness=0,
                                   font=("Segoe UI", 11), padx=12, pady=4, spacing2=2,
                                   yscrollcommand=bar.set)
        bar.configure(command=text.yview)
        bar.pack(side="right", fill="y")
        text.pack(side="left", fill="both", expand=True)
        text.insert("1.0", p["text"])
        text.edit_reset()
        text.edit_modified(False)
        text.mark_set("insert", "end-1c")
        text.see("end")

        def changed(_e):
            if not text.edit_modified() or getattr(self, "_loading", False):
                return
            text.edit_modified(False)
            cur = self.app.store.project(p["id"])
            if cur is None:
                return
            cur["text"] = text.get("1.0", "end-1c")
            cur["updated"] = time.time()
            self.set_status("Editing…")
            self.app.data_changed(source=self, text_only=True)

        text.bind("<<Modified>>", changed)
        text.bind("<Button-1>", lambda e: self.win.focus_force(), add="+")
        self.stamped = False  # a new note (date line) starts on the first keystroke at the end
        text.bind("<KeyPress>", self.maybe_start_note, add="+")

        self.win.after(10, lambda: (self.win.focus_force(), text.focus_set()))

    def start_note(self, force=False):
        """Add a blank line and today's date and time at the end, ready for a new note."""
        text = self.text
        if text is None:
            return
        existing = text.get("1.0", "end-1c")
        text.insert("end", entry_prefix(existing, timestamp()))
        text.mark_set("insert", "end-1c")
        text.see("end")
        self.stamped = True
        if force:
            self.win.focus_force()
            text.focus_set()

    def maybe_start_note(self, e):
        """Before the first thing typed at the end of the notes, start a dated note."""
        if self.stamped or self.text is None:
            return
        ctrl = bool(e.state & 0x4)
        typing = (e.char and e.char.isprintable() and not ctrl) or e.keysym in ("Return", "KP_Enter") \
            or (ctrl and e.keysym.lower() == "v")
        if not typing:
            return
        text = self.text
        at_end = text.compare("insert", ">=", "end-1c") and not text.tag_ranges("sel")
        if at_end:
            self.start_note()
        else:
            self.stamped = True  # editing an older note; don't stamp this visit

    def reload_notes(self):
        """Show the project's latest text after another window or PC changed it.

        Everything typed here is already in the store before any other change is
        applied, so replacing the text loses nothing; the cursor and scroll stay put.
        """
        if self.text is None:
            return
        p = self.app.store.project(self.state["project"])
        if p is None:
            return
        if self.text.get("1.0", "end-1c") != p["text"]:
            top = self.text.yview()[0]
            cursor = self.text.index("insert")
            self._loading = True
            try:
                self.text.delete("1.0", "end")
                self.text.insert("1.0", p["text"])
                self.text.edit_modified(False)
            finally:
                self._loading = False
            self.text.mark_set("insert", cursor)
            self.text.yview_moveto(top)

    def set_status(self, msg):
        if self.status is not None:
            self.status.configure(text=msg)

    def placeholder(self, entry, hint):
        def show_hint(_=None):
            if not entry.get():
                entry.hinted = True  # set first: inserting the hint fires the search callback
                entry.insert(0, hint)
                entry.configure(fg=self.c["muted"])

        def hide_hint(_=None):
            if getattr(entry, "hinted", False):
                entry.delete(0, "end")
                entry.configure(fg=self.c["fg"])
                entry.hinted = False

        entry.is_placeholder = lambda: getattr(entry, "hinted", False)
        entry.bind("<FocusIn>", hide_hint)
        entry.bind("<FocusOut>", show_hint)
        entry.bind("<Button-1>", lambda e: self.win.focus_force(), add="+")
        show_hint()

    # ---- moving and resizing --------------------------------------------

    def make_draggable(self, widget, on_click=None):
        def press(e):
            self._drag = (e.x_root, e.y_root, self.win.winfo_x(), self.win.winfo_y(), False)

        def motion(e):
            if not self._drag:
                return
            sx, sy, wx, wy, moved = self._drag
            dx, dy = e.x_root - sx, e.y_root - sy
            if not moved and abs(dx) + abs(dy) < 4:
                return
            self._drag = (sx, sy, wx, wy, True)
            self.win.geometry(f"+{wx + dx}+{wy + dy}")

        def release(e):
            moved = self._drag and self._drag[4]
            self._drag = None
            if moved:
                self.state["x"], self.state["y"] = self.win.winfo_x(), self.win.winfo_y()
                self.place()
                self.app.layout_changed()
            elif on_click:
                on_click()

        widget.bind("<ButtonPress-1>", press)
        widget.bind("<B1-Motion>", motion)
        widget.bind("<ButtonRelease-1>", release)

    def start_resize(self, e):
        self._resize = (e.x_root, e.y_root, self.win.winfo_width(), self.win.winfo_height())

    def resize(self, e):
        sx, sy, w, h = self._resize
        w = max(MIN_NOTES_SIZE[0], w + e.x_root - sx)
        h = max(MIN_NOTES_SIZE[1], h + e.y_root - sy)
        self.state["w"], self.state["h"] = w, h
        self.win.geometry(f"{w}x{h}")

    # ---- fading ---------------------------------------------------------

    def has_focus(self):
        try:
            f = self.win.focus_get()
        except (KeyError, tk.TclError):
            return False
        return f is not None and f.winfo_toplevel() is self.win

    def is_hovered(self):
        px, py = self.win.winfo_pointerxy()
        x, y = self.win.winfo_rootx(), self.win.winfo_rooty()
        return x <= px < x + self.win.winfo_width() and y <= py < y + self.win.winfo_height()

    def touch_key(self, _e=None):
        self.last_key = self.last_active = time.monotonic()

    def fade_step(self, idle, hide_after):
        now = time.monotonic()
        pointed = self._drag is not None or self.is_hovered()
        if pointed:
            self.last_active = now
        typing = self.has_focus() and now - self.last_key < TYPING_KEEPS_AWAKE
        if hide_after is not None and self.state["view"] != "dot" and now - self.last_active >= hide_after:
            self.show("dot")
            return
        awake = pointed or typing or (hide_after is None and self.has_focus())
        target = 1.0 if awake else idle
        if abs(self.alpha - target) < 0.02:
            new = target
        else:
            new = self.alpha + (target - self.alpha) * (0.45 if awake else 0.18)
        if new != self.alpha:
            self.alpha = new
            self.win.attributes("-alpha", round(new, 3))

    # ---- menu and closing -----------------------------------------------

    def menu(self, e):
        m = tk.Menu(self.win, tearoff=0)
        m.add_command(label="New window", command=lambda: self.app.new_window(near=self))
        hide = tk.Menu(m, tearoff=0)
        hvar = tk.StringVar(value=self.app.store.settings.get("hide", DEFAULT_HIDE))
        for name in HIDE_AFTER:
            hide.add_radiobutton(label=name, variable=hvar, value=name,
                                 command=lambda n=name: self.app.set_setting("hide", n))
        m.add_cascade(label="Shrink to dot after", menu=hide)
        fade = tk.Menu(m, tearoff=0)
        var = tk.StringVar(value=self.app.store.settings.get("fade", DEFAULT_FADE))
        for name in FADE_LEVELS:
            fade.add_radiobutton(label=name, variable=var, value=name,
                                 command=lambda n=name: self.app.set_setting("fade", n))
        m.add_cascade(label="Fade when idle", menu=fade)
        drive = tk.Menu(m, tearoff=0)
        folder = self.app.store.settings.get("drive_folder")
        if folder:
            drive.add_command(label=self.app.status_text(), state="disabled")
            if self.app.sync_detail:
                drive.add_command(label=self.app.sync_detail[:80], state="disabled")
            drive.add_command(label=f"Folder: {folder}", state="disabled")
            drive.add_separator()
            drive.add_command(label="Sync now", command=self.app.sync_now)
            drive.add_command(label="Change folder…", command=lambda: self.app.choose_drive_folder(self.win))
            drive.add_command(label="Stop syncing (keep notes on this PC)", command=self.app.stop_drive_sync)
        else:
            drive.add_command(label="Notes are saved on this PC only", state="disabled")
            drive.add_command(label="Save to Google Drive…", command=lambda: self.app.choose_drive_folder(self.win))
        m.add_cascade(label="Google Drive", menu=drive)
        if IS_WINDOWS:
            auto = tk.BooleanVar(value=get_autostart())
            m.add_checkbutton(label="Start with Windows", variable=auto,
                              command=lambda: set_autostart(auto.get()))
        m.add_separator()
        m.add_command(label="Close this window", command=self.close)
        m.add_command(label=f"Quit {APP_NAME}", command=self.app.quit)
        m.tk_popup(e.x_root, e.y_root)

    def close(self):
        self.app.close_window(self)


# --------------------------------------------------------------------------
# The app: owns the store and every window
# --------------------------------------------------------------------------

class App:
    def __init__(self, store):
        self.store = store
        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title(APP_NAME)
        self.colors = DARK if system_uses_dark_mode() else LIGHT
        # On Windows this color is see-through, which makes the dot round.
        self.key_color = "#ff00fe" if IS_WINDOWS else self.colors["bg"]
        self.areas = work_areas(self.root)
        self.windows = []
        self._save_job = None
        self._timers = {}
        self.sync_status = "local"  # local | synced | offline | error
        self.sync_detail = ""
        self._sync_running = False
        self._sync_results = queue.Queue()
        self._dirty = True  # local changes not yet merged with Drive
        self.notice = None  # (text, until): a message that outlasts the next "Saved"
        self.root.report_callback_exception = self.report_error

        for state in list(store.data["windows"]):
            self.open(state)
        if not self.windows:
            self.new_window()
        if store.error:
            messagebox.showwarning(APP_NAME, store.error + "\nIt was renamed to data.json.unreadable.")

        self.every(FADE_TICK_MS, "fade", self.fade_loop)
        self.every(3000, "screens", self.watch_screens)
        self.every(SYNC_EVERY_MS, "sync", self.sync_now)
        self.every(200, "sync-results", self.apply_sync_results)
        self.root.after(500, self.sync_now)

    def every(self, ms, name, fn):
        """Run fn every ms milliseconds until quit."""
        def tick():
            fn()
            self._timers[name] = self.root.after(ms, tick)
        self._timers[name] = self.root.after(ms, tick)

    def open(self, state):
        state.setdefault("id", new_id())
        nw = NoteWindow(self, state)
        self.windows.append(nw)
        if IS_WINDOWS:
            nw.win.attributes("-transparentcolor", self.key_color)
        return nw

    def new_window(self, near=None):
        if near is not None:
            x, y = near.win.winfo_x() + 30, near.win.winfo_y() + 30
        else:
            l, t, r, b = self.areas[0]
            x, y = r - DOT - 24, t + 24 + 50 * (len(self.windows) % 8)
        nw = self.open({"x": x, "y": y, "view": "root"})
        self.layout_changed()
        return nw

    def close_window(self, nw):
        self.windows.remove(nw)
        nw.win.destroy()
        if not self.windows:
            self.quit()
        else:
            self.layout_changed()

    def layout_changed(self):
        self.store.data["windows"] = [w.state for w in self.windows]
        self.save_soon()

    def data_changed(self, source=None, text_only=False, from_sync=False):
        if not from_sync:
            self.store.counter += 1
            self._dirty = True
        for w in self.windows:
            if w is source:
                continue
            if w.state["view"] == "notes":
                if self.store.project(w.state["project"]) is None:
                    w.show("projects", save=False)
                else:
                    w.reload_notes()
            elif w.state["view"] == "projects":
                w.refresh_view()
            elif w.state["view"] == "root" and not text_only:
                w.show("root", save=False)
        self.save_soon()

    def set_setting(self, key, value):
        self.store.settings[key] = value
        self.save_soon()

    def save_soon(self):
        if self._save_job:
            self.root.after_cancel(self._save_job)
        self._save_job = self.root.after(SAVE_DELAY_MS, self.save_now)

    def save_now(self):
        self._save_job = None
        try:
            self.store.save()
            self.saved_ok = True
        except OSError as e:
            self.saved_ok = False
            for w in self.windows:
                w.set_status(f"Couldn't save: {e.strerror or e}")
            return
        self.show_status()
        if self._dirty:
            self.sync_now()

    # ---- Google Drive ---------------------------------------------------

    def status_text(self):
        if self.notice and time.monotonic() < self.notice[1]:
            return self.notice[0]
        return {
            "local": "Saved on this PC",
            "synced": "Saved · Google Drive synced",
            "offline": "Saved on PC · Drive offline",
            "error": "Saved on PC · Drive sync paused",
        }[self.sync_status]

    def show_status(self):
        msg = self.status_text()
        for w in self.windows:
            w.set_status(msg)

    def sync_now(self):
        folder = self.store.settings.get("drive_folder")
        if not folder:
            self.sync_status = "local"
            return
        if self._sync_running:
            return
        self._sync_running = True
        snapshot = copy.deepcopy({
            "projects": self.store.projects,
            "deleted": self.store.data["deleted"],
            "last_synced": self.store.data["sync"].get("last", {}),
        })
        snapshot["counter"] = self.store.counter
        snapshot["dirty"] = self._dirty
        last_mtime = self.store.data["sync"].get("mtime")

        def work():
            try:
                result = sync_with_drive(folder, snapshot, last_mtime)
            except Exception as e:  # never let a sync problem take the app down
                result = {"status": "error", "detail": str(e)}
            self._sync_results.put(result)

        threading.Thread(target=work, daemon=True).start()

    def apply_sync_results(self):
        while not self._sync_results.empty():
            r = self._sync_results.get_nowait()
            self._sync_running = False
            before = self.sync_status
            self.sync_status = r["status"]
            self.sync_detail = r.get("detail", "")
            if "projects" in r:
                if r["counter"] != self.store.counter:
                    continue  # you typed while it ran; the next round includes it
                changed = self.adopt(r["projects"], r["deleted"])
                sync = self.store.data["sync"]
                sync["last"] = {p["id"]: p.get("updated", 0) for p in r["projects"]}
                sync["mtime"] = r["mtime"]
                self._dirty = False
                if changed:
                    self.data_changed(from_sync=True)
                else:
                    self.save_soon()
                if r["conflicts"]:
                    names = ", ".join(f"“{n}”" for n in r["conflicts"])
                    self.notice = (f"{names} changed on two PCs; kept both", time.monotonic() + 30)
            elif "mtime" in r:
                self.store.data["sync"]["mtime"] = r["mtime"]
            if self.sync_status != before or "projects" in r:
                self.show_status()

    def adopt(self, merged, deleted):
        """Make the store match a sync result, updating project dicts in place."""
        local = {p["id"]: p for p in self.store.projects}
        before = json.dumps([self.store.projects, self.store.data["deleted"]], sort_keys=True)
        new = []
        for m in merged:
            p = local.get(m["id"])
            if p is None:
                p = dict(m)
            elif p != m:
                p.clear()
                p.update(m)
            new.append(p)
        self.store.projects[:] = new
        self.store.data["deleted"] = dict(deleted)
        return json.dumps([self.store.projects, self.store.data["deleted"]], sort_keys=True) != before

    def choose_drive_folder(self, parent):
        current = self.store.settings.get("drive_folder")
        start = current or next(iter(drive_folder_candidates()), os.path.expanduser("~"))
        folder = filedialog.askdirectory(
            parent=parent, initialdir=start, mustexist=True,
            title="Choose a Google Drive folder for your notes (for example My Drive)")
        if not folder:
            return
        self.store.settings["drive_folder"] = os.path.normpath(folder)
        self.store.data["sync"] = {}  # first sync with this folder: merge everything
        self._dirty = True
        self.save_soon()
        self.sync_now()

    def stop_drive_sync(self):
        self.store.settings.pop("drive_folder", None)
        self.store.data["sync"] = {}
        self.sync_status = "local"
        self.save_soon()
        self.show_status()

    def fade_loop(self):
        idle = FADE_LEVELS.get(self.store.settings.get("fade", DEFAULT_FADE), FADE_LEVELS[DEFAULT_FADE])
        hide_after = HIDE_AFTER.get(self.store.settings.get("hide", DEFAULT_HIDE), HIDE_AFTER[DEFAULT_HIDE])
        for w in list(self.windows):
            try:
                w.fade_step(idle, hide_after)
            except tk.TclError:
                pass

    def watch_screens(self):
        """Pull windows back on screen if a monitor is unplugged or rearranged."""
        areas = work_areas(self.root)
        if areas != self.areas:
            self.areas = areas
            for w in self.windows:
                w.place()

    def report_error(self, exc, val, tb):
        import traceback
        traceback.print_exception(exc, val, tb)

    def quit(self):
        for job in [self._save_job, *self._timers.values()]:
            if job:
                self.root.after_cancel(job)
        folder = self.store.settings.get("drive_folder")
        if folder and self._dirty and not self._sync_running:
            # One last sync so notes typed just before quitting reach Drive now.
            snapshot = copy.deepcopy({"projects": self.store.projects, "deleted": self.store.data["deleted"],
                                      "last_synced": self.store.data["sync"].get("last", {})})
            snapshot.update(counter=self.store.counter, dirty=True)
            try:
                r = sync_with_drive(folder, snapshot, None)
                if "projects" in r:
                    self.adopt(r["projects"], r["deleted"])
                    self.store.data["sync"].update(last={p["id"]: p.get("updated", 0) for p in r["projects"]},
                                                   mtime=r["mtime"])
            except Exception:
                pass  # it syncs next time the app starts
        try:
            self.store.save()
        except OSError:
            pass
        self.root.destroy()

    def run(self):
        self.root.mainloop()


def main():
    if ask_running_app_for_window():
        return  # the running app opened a new window
    enable_dpi_awareness()
    store = Store(data_path())
    app = App(store)
    launches = queue.Queue()
    listen_for_launches(lambda: launches.put(1))

    def check_launches():
        while not launches.empty():
            launches.get_nowait()
            app.new_window()

    app.every(250, "launches", check_launches)
    app.run()


if __name__ == "__main__":
    main()
