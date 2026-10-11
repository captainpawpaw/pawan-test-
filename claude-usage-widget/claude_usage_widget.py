"""Claude Usage Widget.

A small always-on-top desktop widget for Windows that shows your Claude plan
usage (the 5-hour session limit and the weekly limits) and keeps it up to date.

It reads usage from one of two places:
  * your Claude Code login (the token Claude Code saves in ~/.claude), or
  * a claude.ai "sessionKey" cookie you paste into Settings.

Standard library only. Run it with `pythonw claude_usage_widget.py`, or build
a single .exe with build.bat. `python claude_usage_widget.py --once` prints
your usage to the console and exits, which is handy for checking your setup.
"""

import json
import os
import queue
import re
import sys
import threading
import time
import tkinter as tk
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from tkinter import messagebox, ttk

APP_NAME = "Claude Usage Widget"
OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
CLAUDE_AI = "https://claude.ai"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)

DEFAULTS = {
    "auth": "auto",  # auto | claude_code | session_key
    "session_key": "",
    "org_id": "",
    "interval": 60,  # seconds between refreshes
    "alert_at": 80,  # percent; bars turn amber and you get a beep
    "on_top": True,
    "x": None,
    "y": None,
}

# Friendly names for the limits the usage endpoints report, in display order.
LABELS = {
    "five_hour": "Current session (5h)",
    "seven_day": "Weekly · all models",
    "seven_day_opus": "Weekly · Opus",
    "seven_day_sonnet": "Weekly · Sonnet",
    "seven_day_oauth_apps": "Weekly · OAuth apps",
    "extra_usage": "Extra usage",
}


class UsageError(Exception):
    """A problem worth showing the user as-is."""


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

def config_path():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "ClaudeUsageWidget", "config.json")


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(config_path(), encoding="utf-8") as f:
            cfg.update(json.load(f))
    except (OSError, ValueError):
        pass
    return cfg


def save_config(cfg):
    path = config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


# --------------------------------------------------------------------------
# Fetching usage
# --------------------------------------------------------------------------

def claude_code_credentials_path():
    base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    return os.path.join(base, ".credentials.json")


def read_claude_code_token():
    """Return Claude Code's OAuth access token, or None if there is no login."""
    try:
        with open(claude_code_credentials_path(), encoding="utf-8") as f:
            oauth = json.load(f).get("claudeAiOauth") or {}
    except (OSError, ValueError):
        return None
    token = oauth.get("accessToken")
    if not token:
        return None
    expires_ms = oauth.get("expiresAt")
    if expires_ms and expires_ms / 1000 < time.time():
        # Claude Code refreshes this token itself. We only read it, because
        # refreshing it here would sign Claude Code out.
        raise UsageError("Claude Code login has expired. Open Claude Code once to refresh it.")
    return token


def http_get_json(url, headers):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise UsageError(f"Not authorised ({e.code}). Check your login in Settings.") from None
        if e.code == 429:
            raise UsageError("Rate limited. Try a longer refresh interval.") from None
        raise UsageError(f"Server returned {e.code}.") from None
    except urllib.error.URLError as e:
        raise UsageError(f"Can't reach server: {e.reason}") from None
    except ValueError:
        raise UsageError("Server sent something that isn't JSON (possibly a Cloudflare check).") from None


def fetch_via_claude_code(token):
    return http_get_json(OAUTH_USAGE_URL, {
        "Authorization": f"Bearer {token}",
        "anthropic-beta": "oauth-2025-04-20",
        "Accept": "application/json",
        "User-Agent": "claude-usage-widget/1.0",
    })


def fetch_via_session_key(cfg):
    key = cfg["session_key"].strip()
    if key.lower().startswith("sessionkey="):
        key = key.split("=", 1)[1]
    headers = {
        "Cookie": f"sessionKey={key}",
        "Accept": "application/json",
        "User-Agent": BROWSER_UA,
        "Referer": CLAUDE_AI + "/settings/usage",
    }
    org_id = cfg.get("org_id")
    if not org_id:
        orgs = http_get_json(CLAUDE_AI + "/api/organizations", headers)
        if not isinstance(orgs, list) or not orgs:
            raise UsageError("No organisations found for this session key.")
        # Prefer an org with a chat plan; fall back to the first one.
        chat = [o for o in orgs if "chat" in (o.get("capabilities") or [])]
        org_id = (chat or orgs)[0]["uuid"]
        cfg["org_id"] = org_id
    return http_get_json(f"{CLAUDE_AI}/api/organizations/{org_id}/usage", headers)


def fetch_usage(cfg):
    """Return (source description, raw usage dict)."""
    mode = cfg.get("auth", "auto")
    has_key = bool(cfg.get("session_key", "").strip())
    if mode in ("auto", "claude_code"):
        try:
            token = read_claude_code_token()
        except UsageError:
            if mode == "claude_code" or not has_key:
                raise
            token = None
        if token:
            return "Claude Code login", fetch_via_claude_code(token)
        if mode == "claude_code":
            raise UsageError(f"No Claude Code login found at {claude_code_credentials_path()}.")
    if has_key:
        return "claude.ai session", fetch_via_session_key(cfg)
    raise UsageError("Not signed in. Log in to Claude Code, or paste a claude.ai session key in Settings.")


def parse_time(value):
    if not value:
        return None
    s = value.replace("Z", "+00:00")
    # Older Pythons only accept 0, 3 or 6 fractional digits.
    s = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], s)
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_meters(data):
    """Turn the raw usage dict into [(key, label, percent, resets_at)]."""
    meters = []
    for key, value in (data or {}).items():
        if not isinstance(value, dict) or value.get("utilization") is None:
            continue
        if key == "extra_usage" and not value.get("is_enabled", True):
            continue
        label = LABELS.get(key) or key.replace("_", " ").capitalize()
        pct = max(0.0, float(value["utilization"]))
        meters.append((key, label, pct, parse_time(value.get("resets_at"))))
    order = list(LABELS)
    meters.sort(key=lambda m: order.index(m[0]) if m[0] in order else len(order))
    return meters


def describe_reset(resets_at, now=None):
    if not resets_at:
        return ""
    now = now or datetime.now(timezone.utc)
    secs = int((resets_at - now).total_seconds())
    if secs <= 0:
        return "resetting now"
    days, rem = divmod(secs, 86400)
    hours, rem = divmod(rem, 3600)
    mins = rem // 60
    if days:
        left = f"{days}d {hours}h"
    elif hours:
        left = f"{hours}h {mins}m"
    else:
        left = f"{max(mins, 1)}m"
    local = resets_at.astimezone()
    when = local.strftime("%a %H:%M") if days else local.strftime("%H:%M")
    return f"resets in {left} ({when})"


# --------------------------------------------------------------------------
# Start with Windows
# --------------------------------------------------------------------------

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


def beep():
    try:
        import winsound
        winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
    except Exception:
        pass


# --------------------------------------------------------------------------
# The widget
# --------------------------------------------------------------------------

BG = "#1f1e1d"
PANEL = "#2b2a28"
TEXT = "#f0eee6"
MUTED = "#a3a29c"
ACCENT = "#d97757"  # Claude orange
AMBER = "#e0a33a"
RED = "#e05d4f"
TRACK = "#3a3936"
WIDTH = 280


class Widget:
    def __init__(self):
        self.cfg = load_config()
        self.results = queue.Queue()
        self.meters = []
        self.alerted = set()
        self.fetching = False
        self.next_fetch = None
        self.status = ("Loading…", MUTED)

        self.root = root = tk.Tk()
        root.title(APP_NAME)
        root.overrideredirect(True)
        root.configure(bg=BG, highlightthickness=1, highlightbackground="#45443f")
        root.attributes("-topmost", bool(self.cfg["on_top"]))
        self.place_window()

        header = tk.Frame(root, bg=PANEL)
        header.pack(fill="x")
        title = tk.Label(header, text="✳ Claude usage", bg=PANEL, fg=TEXT,
                         font=("Segoe UI Semibold", 10), padx=10, pady=6)
        title.pack(side="left")
        for text, cmd in (("✕", self.quit), ("⚙", self.open_settings), ("⟳", self.refresh_now)):
            b = tk.Label(header, text=text, bg=PANEL, fg=MUTED, font=("Segoe UI Symbol", 11),
                         padx=6, cursor="hand2")
            b.pack(side="right")
            b.bind("<Button-1>", lambda e, c=cmd: c())
            b.bind("<Enter>", lambda e, w=b: w.configure(fg=TEXT))
            b.bind("<Leave>", lambda e, w=b: w.configure(fg=MUTED))
        for w in (header, title):
            w.bind("<ButtonPress-1>", self.start_drag)
            w.bind("<B1-Motion>", self.drag)
            w.bind("<ButtonRelease-1>", self.end_drag)

        self.body = tk.Frame(root, bg=BG, padx=12, pady=8)
        self.body.pack(fill="both", expand=True)
        self.footer = tk.Label(root, bg=BG, fg=MUTED, font=("Segoe UI", 8), anchor="w",
                               justify="left", wraplength=WIDTH - 20, padx=12, pady=6)
        self.footer.pack(fill="x")

        self.menu = tk.Menu(root, tearoff=0)
        self.menu.add_command(label="Refresh now", command=self.refresh_now)
        self.menu.add_command(label="Settings…", command=self.open_settings)
        self.on_top_var = tk.BooleanVar(value=bool(self.cfg["on_top"]))
        self.menu.add_checkbutton(label="Always on top", variable=self.on_top_var, command=self.toggle_on_top)
        self.menu.add_separator()
        self.menu.add_command(label="Quit", command=self.quit)
        root.bind("<Button-3>", lambda e: self.menu.tk_popup(e.x_root, e.y_root))

        self.render()
        self.refresh_now()
        self.tick()

    # --- window placement -------------------------------------------------

    def place_window(self):
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        x, y = self.cfg.get("x"), self.cfg.get("y")
        if x is None or y is None or not (0 <= x < sw - 40 and 0 <= y < sh - 40):
            x, y = sw - WIDTH - 24, 60
        self.root.geometry(f"+{x}+{y}")

    def start_drag(self, e):
        self._drag = (e.x_root - self.root.winfo_x(), e.y_root - self.root.winfo_y())

    def drag(self, e):
        dx, dy = self._drag
        self.root.geometry(f"+{e.x_root - dx}+{e.y_root - dy}")

    def end_drag(self, e):
        self.cfg["x"], self.cfg["y"] = self.root.winfo_x(), self.root.winfo_y()
        save_config(self.cfg)

    def toggle_on_top(self):
        self.cfg["on_top"] = self.on_top_var.get()
        self.root.attributes("-topmost", self.cfg["on_top"])
        save_config(self.cfg)

    # --- refreshing ---------------------------------------------------------

    def refresh_now(self):
        if self.fetching:
            return
        self.fetching = True
        self.status = ("Refreshing…", MUTED)
        self.render_footer()
        cfg = dict(self.cfg)

        def work():
            try:
                source, data = fetch_usage(cfg)
                self.results.put(("ok", source, parse_meters(data), cfg.get("org_id")))
            except UsageError as e:
                self.results.put(("error", str(e), None, None))
            except Exception as e:  # never let the worker die silently
                self.results.put(("error", f"Unexpected error: {e}", None, None))

        threading.Thread(target=work, daemon=True).start()

    def tick(self):
        """Runs every second: picks up fetch results and schedules refreshes."""
        try:
            while True:
                self.handle_result(*self.results.get_nowait())
        except queue.Empty:
            pass
        now = time.time()
        if not self.fetching and self.next_fetch and now >= self.next_fetch:
            self.refresh_now()
        if int(now) % 15 == 0:
            self.render()  # keep the "resets in" countdowns current
        self.root.after(1000, self.tick)

    def handle_result(self, kind, info, meters, org_id):
        self.fetching = False
        self.next_fetch = time.time() + max(15, int(self.cfg["interval"]))
        if kind == "ok":
            if org_id and org_id != self.cfg.get("org_id"):
                self.cfg["org_id"] = org_id
                save_config(self.cfg)
            self.meters = meters
            self.status = (f"Updated {time.strftime('%H:%M:%S')} · {info}", MUTED)
            self.check_alerts()
            if not meters:
                self.status = ("Signed in, but no usage limits were reported.", MUTED)
        else:
            self.status = (info, RED)
        self.render()

    def check_alerts(self):
        threshold = float(self.cfg["alert_at"])
        crossed = []
        for key, label, pct, _ in self.meters:
            if pct >= threshold and key not in self.alerted:
                self.alerted.add(key)
                crossed.append(label)
            elif pct < threshold:
                self.alerted.discard(key)
        if crossed:
            beep()
            self.status = (f"Over {threshold:.0f}%: {', '.join(crossed)}", AMBER)

    # --- drawing ----------------------------------------------------------

    def bar_color(self, pct):
        if pct >= 95:
            return RED
        if pct >= float(self.cfg["alert_at"]):
            return AMBER
        return ACCENT

    def render(self):
        for child in self.body.winfo_children():
            child.destroy()
        if not self.meters:
            tk.Label(self.body, text="No usage data yet.", bg=BG, fg=MUTED,
                     font=("Segoe UI", 9)).pack(anchor="w")
        for i, (key, label, pct, resets_at) in enumerate(self.meters):
            row = tk.Frame(self.body, bg=BG)
            row.pack(fill="x", pady=(0 if i == 0 else 8, 0))
            top = tk.Frame(row, bg=BG)
            top.pack(fill="x")
            tk.Label(top, text=label, bg=BG, fg=TEXT, font=("Segoe UI", 9)).pack(side="left")
            tk.Label(top, text=f"{pct:.0f}%", bg=BG, fg=self.bar_color(pct),
                     font=("Segoe UI Semibold", 10)).pack(side="right")
            bar_w = WIDTH - 26
            c = tk.Canvas(row, width=bar_w, height=8, bg=BG, highlightthickness=0)
            c.pack(fill="x", pady=(3, 2))
            c.create_rectangle(0, 0, bar_w, 8, fill=TRACK, outline="")
            fill = int(bar_w * min(pct, 100) / 100)
            if fill:
                c.create_rectangle(0, 0, fill, 8, fill=self.bar_color(pct), outline="")
            reset = describe_reset(resets_at)
            if reset:
                tk.Label(row, text=reset, bg=BG, fg=MUTED, font=("Segoe UI", 8)).pack(anchor="w")
        self.render_footer()

    def render_footer(self):
        text, color = self.status
        self.footer.configure(text=text, fg=color)

    # --- settings -----------------------------------------------------------

    def open_settings(self):
        if getattr(self, "settings_win", None) and self.settings_win.winfo_exists():
            self.settings_win.lift()
            return
        win = self.settings_win = tk.Toplevel(self.root)
        win.title("Claude Usage Widget – Settings")
        win.attributes("-topmost", True)
        win.resizable(False, False)
        frm = ttk.Frame(win, padding=14)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Where to read usage from", font=("Segoe UI Semibold", 10)).grid(
            row=0, column=0, columnspan=2, sticky="w")
        auth = tk.StringVar(value=self.cfg["auth"])
        options = (
            ("auto", "Automatic (Claude Code login, else session key)"),
            ("claude_code", "Claude Code login only"),
            ("session_key", "claude.ai session key only"),
        )
        for i, (value, text) in enumerate(options, start=1):
            ttk.Radiobutton(frm, text=text, value=value, variable=auth).grid(
                row=i, column=0, columnspan=2, sticky="w")

        found = "found ✓" if os.path.exists(claude_code_credentials_path()) else "not found"
        ttk.Label(frm, text=f"Claude Code login: {found}", foreground="#666").grid(
            row=4, column=0, columnspan=2, sticky="w", pady=(2, 8))

        ttk.Label(frm, text="claude.ai session key").grid(row=5, column=0, sticky="w")
        key = tk.StringVar(value=self.cfg["session_key"])
        ttk.Entry(frm, textvariable=key, show="•", width=40).grid(row=5, column=1, sticky="we", padx=(8, 0))
        ttk.Label(frm, text="claude.ai → F12 → Application → Cookies → sessionKey. Keep it private.",
                  foreground="#666").grid(row=6, column=0, columnspan=2, sticky="w", pady=(2, 8))

        ttk.Label(frm, text="Refresh every (seconds)").grid(row=7, column=0, sticky="w")
        interval = tk.IntVar(value=int(self.cfg["interval"]))
        ttk.Spinbox(frm, from_=15, to=3600, increment=15, textvariable=interval, width=8).grid(
            row=7, column=1, sticky="w", padx=(8, 0))

        ttk.Label(frm, text="Warn me at (%)").grid(row=8, column=0, sticky="w", pady=(6, 0))
        alert_at = tk.IntVar(value=int(self.cfg["alert_at"]))
        ttk.Spinbox(frm, from_=10, to=100, increment=5, textvariable=alert_at, width=8).grid(
            row=8, column=1, sticky="w", padx=(8, 0), pady=(6, 0))

        autostart = tk.BooleanVar(value=get_autostart())
        auto_cb = ttk.Checkbutton(frm, text="Start with Windows", variable=autostart)
        auto_cb.grid(row=9, column=0, columnspan=2, sticky="w", pady=(8, 0))
        if sys.platform != "win32":
            auto_cb.state(["disabled"])

        def save():
            try:
                new_interval = max(15, int(interval.get()))
                new_alert = min(100, max(1, int(alert_at.get())))
            except (tk.TclError, ValueError):
                messagebox.showerror("Settings", "Please enter whole numbers.", parent=win)
                return
            new_key = key.get().strip()
            if new_key != self.cfg["session_key"]:
                self.cfg["org_id"] = ""  # a new key may belong to a different account
            self.cfg.update(auth=auth.get(), session_key=new_key,
                            interval=new_interval, alert_at=new_alert)
            save_config(self.cfg)
            if sys.platform == "win32":
                try:
                    set_autostart(autostart.get())
                except OSError as e:
                    messagebox.showwarning("Settings", f"Couldn't change startup setting: {e}", parent=win)
            win.destroy()
            self.alerted.clear()
            self.refresh_now()

        buttons = ttk.Frame(frm)
        buttons.grid(row=10, column=0, columnspan=2, sticky="e", pady=(14, 0))
        ttk.Button(buttons, text="Cancel", command=win.destroy).pack(side="right")
        ttk.Button(buttons, text="Save", command=save).pack(side="right", padx=(0, 6))

    def quit(self):
        self.root.destroy()

    def run(self):
        self.root.mainloop()


def print_once():
    cfg = load_config()
    try:
        source, data = fetch_usage(cfg)
    except UsageError as e:
        print(f"Error: {e}")
        return 1
    if cfg.get("org_id"):
        save_config(cfg)
    print(f"Source: {source}")
    for _, label, pct, resets_at in parse_meters(data):
        print(f"  {label:<24} {pct:5.1f}%  {describe_reset(resets_at)}")
    return 0


def log_path():
    return os.path.join(os.path.dirname(config_path()), "error.log")


def report_crash(details):
    """Save the error and show it, since pythonw has no console to print to."""
    try:
        os.makedirs(os.path.dirname(log_path()), exist_ok=True)
        with open(log_path(), "a", encoding="utf-8") as f:
            f.write(f"--- {time.strftime('%Y-%m-%d %H:%M:%S')}\n{details}\n")
    except OSError:
        pass
    try:
        messagebox.showerror(APP_NAME, f"Something went wrong:\n\n{details[-1500:]}\n\nSaved to {log_path()}")
    except Exception:
        print(details, file=sys.stderr)


def main():
    if "--once" in sys.argv:
        return print_once()
    try:
        widget = Widget()
        widget.root.report_callback_exception = lambda *exc: report_crash(
            "".join(traceback.format_exception(*exc)))
        widget.run()
    except Exception:
        report_crash(traceback.format_exc())
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
