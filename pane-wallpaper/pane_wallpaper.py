"""Pane Live Wallpaper.

Runs the animated Pane Desktop wallpapers (Aurora, Bloom, Starfield, Tide) as
your real Windows desktop background, behind your desktop icons. A tray icon
lets you switch wallpaper, change the accent color, cap the frame rate, pause,
and start it with Windows.

It also runs the thumbnail shelf (pane_shelf.py): minimized windows show up as
live previews above the taskbar, and clicking one brings that window back.

How it works: the wallpaper is a small web page (wallpaper.html) shown in an
Edge WebView2 window. That window is then re-parented into the desktop's
wallpaper layer (the "WorkerW" window that Explorer puts between the
wallpaper and the icons), the same trick live-wallpaper apps use.

Run it with `pyw pane_wallpaper.py`, or build a single .exe with build.bat.
Needs: pip install -r requirements.txt
"""

import ctypes
import json
import os
import sys
import threading
import time

APP_NAME = "Pane Live Wallpaper"
HOST_TITLE = "Pane Live Wallpaper host"
MUTEX_NAME = "Local\\PaneLiveWallpaper"

WALLS = [("aurora", "Aurora"), ("bloom", "Bloom"), ("stars", "Starfield"), ("waves", "Tide")]
ACCENTS = [
    ("Blue", "#4f8cff"),
    ("Violet", "#8b5cf6"),
    ("Pink", "#d9467a"),
    ("Orange", "#e07a1f"),
    ("Green", "#1f9d63"),
    ("Teal", "#0f9bab"),
]
FRAME_RATES = [15, 30, 60]
SHELF_COLORS = ACCENTS + [("Yellow", "#e0b21f"), ("Gray", "#8a90a0")]
SHELF_KINDS = [("color_browser", "Web browsers"), ("color_folder", "Folders"), ("color_app", "Apps")]

DEFAULTS = {
    "wall": "aurora",
    "accent": "#4f8cff",
    "fps": 30,
    "paused": False,
    "auto_pause": True,  # pause while another app is maximized or full screen
    "shelf": True,       # thumbnail shelf for minimized windows
    "shelf_zoom": True,      # rest the pointer on a preview to see it at twice the size
    "shelf_autohide": True,  # shrink a shelf to a thin bar while an open window overlaps it
    "shelf_colors": True,  # color-code thumbnails: browsers, folders, other apps
    "color_browser": "#4f8cff",
    "color_folder": "#e0b21f",
    "color_app": "#1f9d63",
}


# --------------------------------------------------------------------------
# Config and startup
# --------------------------------------------------------------------------

def config_path():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "PaneLiveWallpaper", "config.json")


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


def resource_path(name):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


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
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, launch_command())
        else:
            try:
                winreg.DeleteValue(k, APP_NAME)
            except OSError:
                pass


# --------------------------------------------------------------------------
# Win32: finding the wallpaper layer and parking our window in it
# --------------------------------------------------------------------------

if sys.platform == "win32":
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    LONG_PTR = ctypes.c_ssize_t
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                    ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    def _sig(fn, res, *args):
        fn.restype = res
        fn.argtypes = args
        return fn

    FindWindowW = _sig(user32.FindWindowW, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR)
    FindWindowExW = _sig(user32.FindWindowExW, wintypes.HWND,
                         wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR)
    SendMessageTimeoutW = _sig(user32.SendMessageTimeoutW, LONG_PTR,
                               wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
                               wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t))
    EnumWindows = _sig(user32.EnumWindows, wintypes.BOOL, WNDENUMPROC, wintypes.LPARAM)
    SetParent = _sig(user32.SetParent, wintypes.HWND, wintypes.HWND, wintypes.HWND)
    GetWindowLongPtrW = _sig(user32.GetWindowLongPtrW, LONG_PTR, wintypes.HWND, ctypes.c_int)
    SetWindowLongPtrW = _sig(user32.SetWindowLongPtrW, LONG_PTR, wintypes.HWND, ctypes.c_int, LONG_PTR)
    SetWindowPos = _sig(user32.SetWindowPos, wintypes.BOOL, wintypes.HWND, wintypes.HWND,
                        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT)
    ShowWindow = _sig(user32.ShowWindow, wintypes.BOOL, wintypes.HWND, ctypes.c_int)
    GetWindowRect = _sig(user32.GetWindowRect, wintypes.BOOL, wintypes.HWND, ctypes.POINTER(wintypes.RECT))
    GetSystemMetrics = _sig(user32.GetSystemMetrics, ctypes.c_int, ctypes.c_int)
    GetForegroundWindow = _sig(user32.GetForegroundWindow, wintypes.HWND)
    GetClassNameW = _sig(user32.GetClassNameW, ctypes.c_int, wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    IsZoomed = _sig(user32.IsZoomed, wintypes.BOOL, wintypes.HWND)
    IsWindow = _sig(user32.IsWindow, wintypes.BOOL, wintypes.HWND)
    IsWindowVisible = _sig(user32.IsWindowVisible, wintypes.BOOL, wintypes.HWND)
    MonitorFromWindow = _sig(user32.MonitorFromWindow, wintypes.HMONITOR, wintypes.HWND, wintypes.DWORD)
    GetMonitorInfoW = _sig(user32.GetMonitorInfoW, wintypes.BOOL, wintypes.HMONITOR, ctypes.POINTER(MONITORINFO))
    SystemParametersInfoW = _sig(user32.SystemParametersInfoW, wintypes.BOOL,
                                 wintypes.UINT, wintypes.UINT, ctypes.c_void_p, wintypes.UINT)
    SetLayeredWindowAttributes = _sig(user32.SetLayeredWindowAttributes, wintypes.BOOL,
                                      wintypes.HWND, wintypes.COLORREF, ctypes.c_ubyte, wintypes.DWORD)
    MessageBoxW = _sig(user32.MessageBoxW, ctypes.c_int,
                       wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT)
    CreateMutexW = _sig(kernel32.CreateMutexW, wintypes.HANDLE, ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)

GWL_STYLE, GWL_EXSTYLE = -16, -20
WS_CHILD, WS_VISIBLE, WS_POPUP = 0x40000000, 0x10000000, 0x80000000
WS_CAPTION, WS_THICKFRAME, WS_SYSMENU = 0x00C00000, 0x00040000, 0x00080000
WS_MINIMIZEBOX, WS_MAXIMIZEBOX = 0x00020000, 0x00010000
WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE, WS_EX_LAYERED = 0x40000, 0x80, 0x08000000, 0x80000
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SWP_FRAMECHANGED = 0x1, 0x2, 0x10, 0x40, 0x20
HWND_BOTTOM = 1
SW_SHOWNOACTIVATE = 4
SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 76, 77, 78, 79
SMTO_NORMAL = 0
WM_SPAWN_WORKER = 0x052C  # undocumented: asks Explorer to create the wallpaper WorkerW
MONITOR_DEFAULTTONEAREST = 2
SPI_GETDESKWALLPAPER, SPI_SETDESKWALLPAPER = 0x0073, 0x0014
LWA_ALPHA = 0x2
ERROR_ALREADY_EXISTS = 183
SHELL_CLASSES = {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"}


def show_error(text):
    if sys.platform == "win32":
        MessageBoxW(None, text, APP_NAME, 0x10)
    else:
        print(text, file=sys.stderr)


def virtual_screen():
    return (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN))


def find_desktop_layer():
    """Return (mode, parent, insert_after, worker) describing where the wallpaper goes.

    mode "child":   Windows 11 24H2 and later. The wallpaper WorkerW is a child of
                    Progman, so we become a child of Progman too, slotted between the
                    icons (SHELLDLL_DefView) and that WorkerW.
    mode "sibling": Earlier Windows 10/11. The wallpaper WorkerW is a top-level window
                    right behind the one that holds the icons; we become its child.
    """
    progman = FindWindowW("Progman", None)
    if not progman:
        raise RuntimeError("Couldn't find the Windows desktop window (Progman).")
    result = ctypes.c_size_t()
    SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0xD, 0x1, SMTO_NORMAL, 1000, ctypes.byref(result))
    SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0, 0, SMTO_NORMAL, 1000, ctypes.byref(result))

    worker = FindWindowExW(progman, None, "WorkerW", None)
    if worker:
        defview = FindWindowExW(progman, None, "SHELLDLL_DefView", None)
        return "child", progman, defview, worker

    found = []

    def visit(hwnd, _):
        if FindWindowExW(hwnd, None, "SHELLDLL_DefView", None):
            w = FindWindowExW(None, hwnd, "WorkerW", None)
            if w:
                found.append(w)
        return True

    EnumWindows(WNDENUMPROC(visit), 0)
    if found:
        return "sibling", found[0], None, None
    raise RuntimeError("Couldn't find the desktop wallpaper layer. Try signing out and back in.")


def place(hwnd, parent, insert_after):
    """Size our window to cover every monitor, in the parent's coordinates."""
    vx, vy, vw, vh = virtual_screen()
    pr = wintypes.RECT()
    GetWindowRect(parent, ctypes.byref(pr))
    flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED
    SetWindowPos(hwnd, insert_after or None, vx - pr.left, vy - pr.top, vw, vh, flags)


def attach(hwnd):
    """Turn the WebView window into a borderless child of the wallpaper layer."""
    style = GetWindowLongPtrW(hwnd, GWL_STYLE)
    style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)
    SetWindowLongPtrW(hwnd, GWL_STYLE, style | WS_CHILD | WS_VISIBLE)
    ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)

    mode, parent, insert_after, worker = find_desktop_layer()
    if mode == "child":
        # 24H2 composes Progman's children; a layered child is what shows up there.
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, GetWindowLongPtrW(hwnd, GWL_EXSTYLE) | WS_EX_LAYERED)
        SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA)
    SetParent(hwnd, parent)
    place(hwnd, parent, insert_after)
    if worker:
        SetWindowPos(worker, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
    ShowWindow(hwnd, SW_SHOWNOACTIVATE)
    return parent, insert_after


def class_name(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    GetClassNameW(hwnd, buf, 256)
    return buf.value


def desktop_covered():
    """True when the app in front is maximized or full screen, hiding the wallpaper."""
    fg = GetForegroundWindow()
    if not fg or not IsWindowVisible(fg) or class_name(fg) in SHELL_CLASSES:
        return False
    if IsZoomed(fg):
        return True
    r = wintypes.RECT()
    GetWindowRect(fg, ctypes.byref(r))
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    if not GetMonitorInfoW(MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST), ctypes.byref(mi)):
        return False
    m = mi.rcMonitor
    return r.left <= m.left and r.top <= m.top and r.right >= m.right and r.bottom >= m.bottom


def repaint_static_wallpaper():
    """Ask Windows to redraw the normal wallpaper so no frozen frame is left behind."""
    buf = ctypes.create_unicode_buffer(260)
    if SystemParametersInfoW(SPI_GETDESKWALLPAPER, 260, buf, 0):
        SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, buf, 0)


# --------------------------------------------------------------------------
# The app
# --------------------------------------------------------------------------

class WallpaperApp:
    def __init__(self, webview, pystray, Image, ImageDraw):
        self.webview, self.pystray = webview, pystray
        self.Image, self.ImageDraw = Image, ImageDraw
        self.cfg = load_config()
        self.window = None
        self.hwnd = None
        self.parent = None
        self.insert_after = None
        self.paused_now = None
        self.stop = threading.Event()
        self.icon = None
        self.shelf = None

    # ---- talking to the page ----
    def push(self):
        if not self.window:
            return
        payload = json.dumps({k: self.cfg[k] for k in ("wall", "accent", "fps")})
        try:
            self.window.evaluate_js(f"window.pane && window.pane.apply({payload})")
        except Exception:
            pass  # page still loading; on_loaded pushes again

    def set_paused(self, paused):
        if paused == self.paused_now or not self.window:
            return
        try:
            self.window.evaluate_js(f"window.pane && window.pane.pause({'true' if paused else 'false'})")
            self.paused_now = paused
        except Exception:
            pass

    def on_loaded(self):
        self.paused_now = None
        self.push()

    # ---- background work ----
    def setup(self):
        """Runs once the WebView window exists: move it into the wallpaper layer."""
        for _ in range(100):
            self.hwnd = FindWindowW(None, HOST_TITLE)
            if self.hwnd:
                break
            time.sleep(0.1)
        if not self.hwnd:
            show_error("The wallpaper window didn't start. Is the Microsoft Edge WebView2 Runtime installed?")
            self.quit()
            return
        try:
            self.parent, self.insert_after = attach(self.hwnd)
        except RuntimeError as e:
            show_error(str(e))
            self.quit()
            return
        self.push()
        self.watch()

    def watch(self):
        screen = virtual_screen()
        while not self.stop.wait(1.5):
            if not IsWindow(self.hwnd):
                # Explorer restarted and took the wallpaper layer (and our window) with it.
                self.quit()
                return
            now = virtual_screen()
            if now != screen:  # monitors or resolution changed
                screen = now
                place(self.hwnd, self.parent, self.insert_after)
            self.set_paused(bool(self.cfg["paused"] or (self.cfg["auto_pause"] and desktop_covered())))

    # ---- tray ----
    def tray_image(self):
        img = self.Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        d = self.ImageDraw.Draw(img)
        c = self.cfg["accent"].lstrip("#")
        rgb = tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
        for (x, y), alpha in (((4, 4), 255), ((34, 4), 205), ((4, 34), 205), ((34, 34), 155)):
            d.rounded_rectangle((x, y, x + 26, y + 26), radius=5, fill=rgb + (alpha,))
        return img

    def update(self, **changes):
        self.cfg.update(changes)
        save_config(self.cfg)
        self.push()
        if "accent" in changes and self.icon:
            self.icon.icon = self.tray_image()
        if self.icon:
            self.icon.update_menu()
        if self.shelf:
            self.shelf.refresh()

    def build_menu(self):
        item, Menu = self.pystray.MenuItem, self.pystray.Menu

        def choose(key, value):
            return lambda icon, it: self.update(**{key: value})

        def is_set(key, value):
            return lambda it: self.cfg[key] == value

        def toggle(key):
            return lambda icon, it: self.update(**{key: not self.cfg[key]})

        def toggle_autostart(icon, it):
            try:
                set_autostart(not get_autostart())
            except OSError as e:
                show_error(f"Couldn't change the startup setting: {e}")

        return Menu(
            item("Wallpaper", Menu(*[item(label, choose("wall", key), checked=is_set("wall", key), radio=True)
                                     for key, label in WALLS])),
            item("Accent color", Menu(*[item(label, choose("accent", hexv), checked=is_set("accent", hexv), radio=True)
                                        for label, hexv in ACCENTS])),
            item("Frame rate", Menu(*[item(f"{n} fps", choose("fps", n), checked=is_set("fps", n), radio=True)
                                      for n in FRAME_RATES])),
            Menu.SEPARATOR,
            item("Pause", toggle("paused"), checked=lambda it: self.cfg["paused"]),
            item("Pause while an app is maximized or full screen", toggle("auto_pause"),
                 checked=lambda it: self.cfg["auto_pause"]),
            item("Thumbnail shelf for minimized windows", lambda icon, it: self.toggle_shelf(),
                 checked=lambda it: self.cfg["shelf"]),
            item("Enlarge previews on hover", toggle("shelf_zoom"),
                 checked=lambda it: self.cfg["shelf_zoom"], enabled=lambda it: self.cfg["shelf"]),
            item("Shrink the shelf behind open windows", toggle("shelf_autohide"),
                 checked=lambda it: self.cfg["shelf_autohide"], enabled=lambda it: self.cfg["shelf"]),
            item("Shelf colors", Menu(
                item("Color-code by type", toggle("shelf_colors"), checked=lambda it: self.cfg["shelf_colors"]),
                Menu.SEPARATOR,
                *[item(label, Menu(*[item(name, choose(key, hexv), checked=is_set(key, hexv), radio=True)
                                     for name, hexv in SHELF_COLORS]),
                       enabled=lambda it: self.cfg["shelf_colors"])
                  for key, label in SHELF_KINDS],
            ), enabled=lambda it: self.cfg["shelf"]),
            Menu.SEPARATOR,
            item("Start with Windows", toggle_autostart, checked=lambda it: get_autostart()),
            Menu.SEPARATOR,
            item("Quit", lambda icon, it: self.quit()),
        )

    # ---- thumbnail shelf ----
    def start_shelf(self):
        import pane_shelf
        self.shelf = pane_shelf.Shelf(lambda: self.cfg)
        self.shelf.start()

    def toggle_shelf(self):
        on = not self.cfg["shelf"]
        self.update(shelf=on)
        if on:
            self.start_shelf()
        elif self.shelf:
            self.shelf.stop()
            self.shelf = None

    def quit(self):
        self.stop.set()
        if self.shelf:
            self.shelf.stop()
            self.shelf = None
        if self.icon:
            try:
                self.icon.stop()
            except Exception:
                pass
        if self.window:
            try:
                self.window.destroy()
            except Exception:
                pass

    def run(self):
        vx, vy, vw, vh = virtual_screen()
        self.window = self.webview.create_window(
            HOST_TITLE, url=resource_path("wallpaper.html"),
            x=vx, y=vy, width=vw, height=vh,
            frameless=True, easy_drag=False, focus=False, hidden=True,
            background_color="#05060A",
        )
        self.window.events.loaded += self.on_loaded

        self.icon = self.pystray.Icon("PaneLiveWallpaper", self.tray_image(), APP_NAME, self.build_menu())
        self.icon.run_detached()
        if self.cfg["shelf"]:
            self.start_shelf()
        try:
            self.webview.start(lambda: threading.Thread(target=self.setup, daemon=True).start(),
                               gui="edgechromium")
        finally:
            self.quit()
            repaint_static_wallpaper()


def main():
    if sys.platform != "win32":
        print(f"{APP_NAME} only runs on Windows.", file=sys.stderr)
        return 1
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # per-monitor: real pixel sizes
    except (AttributeError, OSError):
        pass
    CreateMutexW(None, False, MUTEX_NAME)
    if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
        show_error(f"{APP_NAME} is already running. Look for its icon in the system tray.")
        return 0
    try:
        import webview
        import pystray
        from PIL import Image, ImageDraw
    except ImportError as e:
        show_error(f"A required package is missing ({e.name}). Run: py -m pip install -r requirements.txt")
        return 1
    WallpaperApp(webview, pystray, Image, ImageDraw).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
