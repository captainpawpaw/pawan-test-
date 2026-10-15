"""Thumbnail shelf for minimized windows.

When you minimize a window anywhere in Windows, a live preview of it appears
in a shelf just above the taskbar of the screen the window was on. Click a
preview to bring that window back; nothing else is minimized or restored
for you. Hover a preview and click its x (or middle-click the preview) to
close that window.

Drag a preview to another screen to move the window there. It stays
minimized, joins that screen's shelf, and opens on that screen when you
click it.

Each virtual desktop shows only the windows minimized on it.

Rest the pointer on a preview and a copy twice its size pops up just above
it, easier to read. Click the big copy to open that window, or middle-click
it to close the window.

While an open window overlaps a screen's shelf, that shelf shrinks to a thin
see-through bar with one colored dot per minimized window. Point at the bar
to open the shelf again; it shrinks back once the pointer leaves, if a window
is still in the way.

Thumbnails are color-coded by type: web browsers, File Explorer folders,
and other apps each get their own border and tint (see KIND_COLORS; the tray
app lets you change them).

The previews are DWM thumbnails, the same live images the taskbar and
Alt+Tab use. Minimize and restore are picked up with a WinEvent hook, so
nothing is injected into other apps.

pane_wallpaper.py starts this from its tray menu. You can also run it on
its own with `pyw pane_shelf.py`; it has no tray icon then, so end it from
Task Manager.
"""

import ctypes
import sys
import threading

CLASS_NAME = "PaneShelfWindow"

if sys.platform == "win32":
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32")
    dwmapi = ctypes.WinDLL("dwmapi")
    kernel32 = ctypes.WinDLL("kernel32")
    try:
        shcore = ctypes.WinDLL("shcore")
    except OSError:
        shcore = None

    LRESULT = ctypes.c_ssize_t
    LONG_PTR = ctypes.c_ssize_t
    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    WINEVENTPROC = ctypes.WINFUNCTYPE(None, wintypes.HANDLE, wintypes.DWORD, wintypes.HWND,
                                      wintypes.LONG, wintypes.LONG, wintypes.DWORD, wintypes.DWORD)
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    class WNDCLASSEXW(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("style", wintypes.UINT), ("lpfnWndProc", WNDPROC),
                    ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                    ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
                    ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
                    ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR),
                    ("hIconSm", wintypes.HICON)]

    class PAINTSTRUCT(ctypes.Structure):
        _fields_ = [("hdc", wintypes.HDC), ("fErase", wintypes.BOOL), ("rcPaint", wintypes.RECT),
                    ("fRestore", wintypes.BOOL), ("fIncUpdate", wintypes.BOOL),
                    ("rgbReserved", ctypes.c_byte * 32)]

    class TRACKMOUSEEVENT(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                    ("hwndTrack", wintypes.HWND), ("dwHoverTime", wintypes.DWORD)]

    class DWM_THUMBNAIL_PROPERTIES(ctypes.Structure):
        _fields_ = [("dwFlags", wintypes.DWORD), ("rcDestination", wintypes.RECT),
                    ("rcSource", wintypes.RECT), ("opacity", ctypes.c_ubyte),
                    ("fVisible", wintypes.BOOL), ("fSourceClientAreaOnly", wintypes.BOOL)]

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                    ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    class WINDOWPLACEMENT(ctypes.Structure):
        _fields_ = [("length", wintypes.UINT), ("flags", wintypes.UINT), ("showCmd", wintypes.UINT),
                    ("ptMinPosition", wintypes.POINT), ("ptMaxPosition", wintypes.POINT),
                    ("rcNormalPosition", wintypes.RECT)]

    def _sig(fn, res, *args):
        fn.restype = res
        fn.argtypes = args
        return fn

    H, U, I, D, B = wintypes.HWND, wintypes.UINT, ctypes.c_int, wintypes.DWORD, wintypes.BOOL
    RegisterClassExW = _sig(user32.RegisterClassExW, wintypes.ATOM, ctypes.POINTER(WNDCLASSEXW))
    CreateWindowExW = _sig(user32.CreateWindowExW, H, D, wintypes.LPCWSTR, wintypes.LPCWSTR, D,
                           I, I, I, I, H, wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p)
    DefWindowProcW = _sig(user32.DefWindowProcW, LRESULT, H, U, wintypes.WPARAM, wintypes.LPARAM)
    DestroyWindow = _sig(user32.DestroyWindow, B, H)
    PostQuitMessage = _sig(user32.PostQuitMessage, None, I)
    GetMessageW = _sig(user32.GetMessageW, B, ctypes.POINTER(wintypes.MSG), H, U, U)
    TranslateMessage = _sig(user32.TranslateMessage, B, ctypes.POINTER(wintypes.MSG))
    DispatchMessageW = _sig(user32.DispatchMessageW, LRESULT, ctypes.POINTER(wintypes.MSG))
    PostMessageW = _sig(user32.PostMessageW, B, H, U, wintypes.WPARAM, wintypes.LPARAM)
    SetWinEventHook = _sig(user32.SetWinEventHook, wintypes.HANDLE, D, D, wintypes.HMODULE,
                           WINEVENTPROC, D, D, D)
    UnhookWinEvent = _sig(user32.UnhookWinEvent, B, wintypes.HANDLE)
    SetTimer = _sig(user32.SetTimer, ctypes.c_size_t, H, ctypes.c_size_t, U, ctypes.c_void_p)
    KillTimer = _sig(user32.KillTimer, B, H, ctypes.c_size_t)
    BeginPaint = _sig(user32.BeginPaint, wintypes.HDC, H, ctypes.POINTER(PAINTSTRUCT))
    EndPaint = _sig(user32.EndPaint, B, H, ctypes.POINTER(PAINTSTRUCT))
    InvalidateRect = _sig(user32.InvalidateRect, B, H, ctypes.c_void_p, B)
    SetWindowPos = _sig(user32.SetWindowPos, B, H, H, I, I, I, I, U)
    ShowWindow = _sig(user32.ShowWindow, B, H, I)
    IsWindow = _sig(user32.IsWindow, B, H)
    IsIconic = _sig(user32.IsIconic, B, H)
    IsWindowVisible = _sig(user32.IsWindowVisible, B, H)
    GetWindowTextW = _sig(user32.GetWindowTextW, I, H, wintypes.LPWSTR, I)
    GetWindowTextLengthW = _sig(user32.GetWindowTextLengthW, I, H)
    GetWindow = _sig(user32.GetWindow, H, H, U)
    GetWindowLongPtrW = _sig(user32.GetWindowLongPtrW, LONG_PTR, H, I)
    GetClassNameW = _sig(user32.GetClassNameW, I, H, wintypes.LPWSTR, I)
    GetForegroundWindow = _sig(user32.GetForegroundWindow, H)
    SetForegroundWindow = _sig(user32.SetForegroundWindow, B, H)
    SwitchToThisWindow = _sig(user32.SwitchToThisWindow, None, H, B)
    TrackMouseEvent = _sig(user32.TrackMouseEvent, B, ctypes.POINTER(TRACKMOUSEEVENT))
    SetCapture = _sig(user32.SetCapture, H, H)
    ReleaseCapture = _sig(user32.ReleaseCapture, B)
    GetCapture = _sig(user32.GetCapture, H)
    GetCursorPos = _sig(user32.GetCursorPos, B, ctypes.POINTER(wintypes.POINT))
    LoadCursorW = _sig(user32.LoadCursorW, wintypes.HANDLE, wintypes.HINSTANCE, ctypes.c_void_p)
    SetCursor = _sig(user32.SetCursor, wintypes.HANDLE, wintypes.HANDLE)
    SendMessageTimeoutW = _sig(user32.SendMessageTimeoutW, LONG_PTR, H, U, wintypes.WPARAM, wintypes.LPARAM,
                               U, U, ctypes.POINTER(ctypes.c_size_t))
    GetClassLongPtrW = _sig(getattr(user32, "GetClassLongPtrW", user32.GetClassLongW), ctypes.c_size_t, H, I)
    DrawIconEx = _sig(user32.DrawIconEx, B, wintypes.HDC, I, I, wintypes.HICON, I, I, U, wintypes.HBRUSH, U)
    FillRect = _sig(user32.FillRect, I, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.HBRUSH)
    DrawTextW = _sig(user32.DrawTextW, I, wintypes.HDC, wintypes.LPCWSTR, I, ctypes.POINTER(wintypes.RECT), U)
    SetWindowRgn = _sig(user32.SetWindowRgn, I, H, wintypes.HRGN, B)
    EnumWindows = _sig(user32.EnumWindows, B, WNDENUMPROC, wintypes.LPARAM)
    MonitorFromPoint = _sig(user32.MonitorFromPoint, wintypes.HMONITOR, wintypes.POINT, D)
    MonitorFromWindow = _sig(user32.MonitorFromWindow, wintypes.HMONITOR, H, D)
    GetMonitorInfoW = _sig(user32.GetMonitorInfoW, B, wintypes.HMONITOR, ctypes.POINTER(MONITORINFO))
    GetWindowRect = _sig(user32.GetWindowRect, B, H, ctypes.POINTER(wintypes.RECT))
    GetWindowPlacement = _sig(user32.GetWindowPlacement, B, H, ctypes.POINTER(WINDOWPLACEMENT))
    SetWindowPlacement = _sig(user32.SetWindowPlacement, B, H, ctypes.POINTER(WINDOWPLACEMENT))
    if shcore is not None:
        GetDpiForMonitor = _sig(shcore.GetDpiForMonitor, ctypes.c_long, wintypes.HMONITOR, ctypes.c_int,
                                ctypes.POINTER(U), ctypes.POINTER(U))
    else:
        GetDpiForMonitor = None

    CreateSolidBrush = _sig(gdi32.CreateSolidBrush, wintypes.HBRUSH, wintypes.COLORREF)
    DeleteObject = _sig(gdi32.DeleteObject, B, wintypes.HGDIOBJ)
    CreateFontW = _sig(gdi32.CreateFontW, wintypes.HFONT, I, I, I, I, I, D, D, D, D, D, D, D, D, wintypes.LPCWSTR)
    SelectObject = _sig(gdi32.SelectObject, wintypes.HGDIOBJ, wintypes.HDC, wintypes.HGDIOBJ)
    SetTextColor = _sig(gdi32.SetTextColor, wintypes.COLORREF, wintypes.HDC, wintypes.COLORREF)
    SetBkMode = _sig(gdi32.SetBkMode, I, wintypes.HDC, I)
    RoundRect = _sig(gdi32.RoundRect, B, wintypes.HDC, I, I, I, I, I, I)
    GetStockObject = _sig(gdi32.GetStockObject, wintypes.HGDIOBJ, I)
    CreateRoundRectRgn = _sig(gdi32.CreateRoundRectRgn, wintypes.HRGN, I, I, I, I, I, I)

    DwmRegisterThumbnail = _sig(dwmapi.DwmRegisterThumbnail, ctypes.c_long, H, H, ctypes.POINTER(wintypes.HANDLE))
    DwmUnregisterThumbnail = _sig(dwmapi.DwmUnregisterThumbnail, ctypes.c_long, wintypes.HANDLE)
    DwmUpdateThumbnailProperties = _sig(dwmapi.DwmUpdateThumbnailProperties, ctypes.c_long,
                                        wintypes.HANDLE, ctypes.POINTER(DWM_THUMBNAIL_PROPERTIES))
    DwmQueryThumbnailSourceSize = _sig(dwmapi.DwmQueryThumbnailSourceSize, ctypes.c_long,
                                       wintypes.HANDLE, ctypes.POINTER(wintypes.SIZE))
    DwmGetWindowAttribute = _sig(dwmapi.DwmGetWindowAttribute, ctypes.c_long, H, D, ctypes.c_void_p, D)
    DwmSetWindowAttribute = _sig(dwmapi.DwmSetWindowAttribute, ctypes.c_long, H, D, ctypes.c_void_p, D)
    GetModuleHandleW = _sig(kernel32.GetModuleHandleW, wintypes.HMODULE, wintypes.LPCWSTR)
    GetWindowThreadProcessId = _sig(user32.GetWindowThreadProcessId, D, H, ctypes.POINTER(D))
    OpenProcess = _sig(kernel32.OpenProcess, wintypes.HANDLE, D, B, D)
    QueryFullProcessImageNameW = _sig(kernel32.QueryFullProcessImageNameW, B, wintypes.HANDLE, D,
                                      wintypes.LPWSTR, ctypes.POINTER(D))
    CloseHandle = _sig(kernel32.CloseHandle, B, wintypes.HANDLE)
    SetWindowLongPtrW = _sig(user32.SetWindowLongPtrW, LONG_PTR, H, I, LONG_PTR)
    SetLayeredWindowAttributes = _sig(user32.SetLayeredWindowAttributes, B, H, wintypes.COLORREF,
                                      ctypes.c_ubyte, D)

# Win32 constants
WM_DESTROY, WM_PAINT, WM_CLOSE, WM_ERASEBKGND = 0x0002, 0x000F, 0x0010, 0x0014
WM_MOUSEACTIVATE, WM_GETICON, WM_TIMER = 0x0021, 0x007F, 0x0113
WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONUP = 0x0200, 0x0201, 0x0202, 0x0208
WM_CAPTURECHANGED, WM_MOUSELEAVE = 0x0215, 0x02A3
WM_DPICHANGED, WM_DISPLAYCHANGE, WM_SETTINGCHANGE = 0x02E0, 0x007E, 0x001A
WM_APP_SCREENS = 0x8001  # WM_APP + 1: a panel saw the screens change
WM_APP_REFRESH = 0x8002  # WM_APP + 2: colors changed, repaint
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
MA_NOACTIVATE = 3
WS_POPUP = 0x80000000
WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT = 0x80, 0x8, 0x08000000, 0x20
GWL_EXSTYLE = -20
GW_OWNER = 4
HWND_MESSAGE = -3
SW_HIDE, SW_SHOWNOACTIVATE, SW_MINIMIZE, SW_SHOWMINNOACTIVE, SW_RESTORE = 0, 4, 6, 7, 9
SWP_NOACTIVATE, SWP_SHOWWINDOW, SWP_NOSIZE = 0x10, 0x40, 0x1
HWND_TOPMOST = -1
EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND = 0x0016, 0x0017
WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS = 0x0, 0x2
OBJID_WINDOW = 0
TME_LEAVE = 0x2
IDC_ARROW, IDC_SIZEALL = 32512, 32646
ICON_BIG, ICON_SMALL2 = 1, 2
GCLP_HICON, GCLP_HICONSM = -14, -34
SMTO_ABORTIFHUNG = 0x2
DI_NORMAL = 0x3
TRANSPARENT = 1
NULL_PEN = 8
DT_CENTER, DT_VCENTER, DT_SINGLELINE, DT_END_ELLIPSIS, DT_NOPREFIX = 0x1, 0x4, 0x20, 0x8000, 0x800
DWM_TNP_RECTDESTINATION, DWM_TNP_OPACITY, DWM_TNP_VISIBLE, DWM_TNP_SOURCECLIENTAREAONLY = 0x1, 0x4, 0x8, 0x10
DWMWA_EXTENDED_FRAME_BOUNDS, DWMWA_CLOAKED, DWMWA_WINDOW_CORNER_PREFERENCE = 9, 14, 33
WS_EX_LAYERED, LWA_ALPHA = 0x80000, 0x2
EVENT_SYSTEM_FOREGROUND, EVENT_OBJECT_SHOW, EVENT_OBJECT_HIDE, EVENT_OBJECT_LOCATIONCHANGE = 0x0003, 0x8002, 0x8003, 0x800B
BAR_ALPHA = 150         # 0-255: how see-through the shrunk bar is
DWMWCP_DONOTROUND, DWMWCP_ROUND = 1, 2
# Corner radii (at 100% scaling). Windows' own rounding is fixed at about 8px, so the shelf's
# windows are shaped with a region instead, which allows any radius.
SHELF_RADIUS, TILE_RADIUS, ZOOM_RADIUS, GHOST_RADIUS = 28, 18, 28, 18
MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY, MONITOR_DEFAULTTONEAREST = 0, 1, 2
MDT_EFFECTIVE_DPI = 0
WPF_SETMINPOSITION = 0x1
ERROR_CLASS_ALREADY_EXISTS = 1410
TIMER_ID = 1             # the once-a-second check
TIMER_OVERLAP = 2        # a short delay after windows move, so a drag doesn't re-check 60 times a second
TIMER_UNPEEK = 3         # a short delay after the pointer leaves an opened-up shelf
TIMER_ZOOM = 4           # how long the pointer rests on a preview before the big copy appears
TIMER_ZOOM_WATCH = 5     # while the big copy shows: is the pointer still on it or its tile?
ZOOM_DELAY_MS = 300
DRAG_START_PX = 6
SHELL_CLASSES = {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
                 "Windows.UI.Core.CoreWindow", "XamlExplorerHostIslandWindow"}


def rgb(r, g, b):
    return r | (g << 8) | (b << 16)  # COLORREF is 0x00BBGGRR


COLORS = {
    "panel": rgb(24, 26, 34),
    "tile": rgb(36, 39, 50),
    "tile_hover": rgb(52, 57, 72),
    "tile_drag": rgb(30, 32, 40),
    "ghost": rgb(52, 57, 72),
    "text": rgb(242, 243, 247),
    "muted": rgb(150, 155, 170),
    "close": rgb(196, 43, 28),
    "close_hover": rgb(232, 64, 48),
}

# Thumbnail colors by window type. The tray app overrides these with the
# color_browser / color_folder / color_app settings, and shelf_colors=False turns them off.
KIND_COLORS = {"browser": "#4f8cff", "folder": "#e0b21f", "app": "#1f9d63"}
BROWSERS = {
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe",
    "iexplore.exe", "chromium.exe", "librewolf.exe", "waterfox.exe", "floorp.exe", "zen.exe",
    "thorium.exe", "browser.exe", "maxthon.exe", "palemoon.exe", "seamonkey.exe", "duckduckgo.exe",
}
FOLDER_CLASSES = {"CabinetWClass", "ExploreWClass"}


def hex_to_colorref(hexv):
    v = hexv.lstrip("#")
    return rgb(int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))


def mix(c, base, t):
    """Blend COLORREF c into base by t (0..1)."""
    out = 0
    for shift in (0, 8, 16):
        a, b = (c >> shift) & 255, (base >> shift) & 255
        out |= int(round(b + (a - b) * t)) << shift
    return out

# One window procedure for the process; it hands each message to the object that owns the window.
_owners = {}
_creating = None


def _wndproc(hwnd, msg, wp, lp):
    owner = _owners.get(hwnd)
    if owner is None and _creating is not None:
        owner = _creating
        owner.hwnd = hwnd
        _owners[hwnd] = owner
    if owner is not None:
        try:
            handled = owner.on_message(msg, wp, lp)
        except Exception as e:  # never let a Python error escape into Windows
            print(f"shelf: {e!r}", file=sys.stderr)
            handled = None
        if msg == WM_DESTROY:
            _owners.pop(hwnd, None)
        if handled is not None:
            return handled
    return DefWindowProcW(hwnd, msg, wp, lp)


_WNDPROC_REF = WNDPROC(_wndproc) if sys.platform == "win32" else None


def square_corners(hwnd):
    """Turn off Windows 11's own small corner rounding; the window's region does the rounding."""
    pref = ctypes.c_int(DWMWCP_DONOTROUND)
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ctypes.byref(pref), ctypes.sizeof(pref))


def create_window(owner, ex_style, parent=None):
    """Create a window of our class whose messages go to owner.on_message."""
    global _creating
    _creating = owner
    try:
        CreateWindowExW(ex_style, CLASS_NAME, "Pane shelf", WS_POPUP, 0, 0, 10, 10,
                        parent, None, GetModuleHandleW(None), None)
    finally:
        _creating = None
    if not owner.hwnd:
        raise OSError("Couldn't create a shelf window.")
    return owner.hwnd


def register_class():
    wc = WNDCLASSEXW()
    wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
    wc.lpfnWndProc = _WNDPROC_REF
    wc.hInstance = GetModuleHandleW(None)
    wc.hCursor = LoadCursorW(None, ctypes.c_void_p(IDC_ARROW))
    wc.lpszClassName = CLASS_NAME
    if not RegisterClassExW(ctypes.byref(wc)) and ctypes.get_last_error() != ERROR_CLASS_ALREADY_EXISTS:
        raise OSError("Couldn't register the shelf window class.")


def place_thumb(thumb, area, opacity=255):
    """Fit a DWM thumbnail inside area (l, t, r, b) keeping its shape, or hide it when area is None.
    Returns True when Windows has a picture to show."""
    props = DWM_THUMBNAIL_PROPERTIES()
    props.dwFlags = DWM_TNP_VISIBLE | DWM_TNP_RECTDESTINATION | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY
    props.opacity = opacity
    props.fSourceClientAreaOnly = False
    size = wintypes.SIZE()
    ok = area is not None and DwmQueryThumbnailSourceSize(thumb, ctypes.byref(size)) == 0
    # A minimized window that DWM has no picture for reports a tiny caption-sized source.
    shown = bool(ok and size.cx > 0 and size.cy >= 60)
    if shown:
        l, t, r, b = area
        aw, ah = r - l, b - t
        s = min(aw / size.cx, ah / size.cy)
        dw, dh = max(1, int(size.cx * s)), max(1, int(size.cy * s))
        dx, dy = l + (aw - dw) // 2, t + (ah - dh) // 2
        props.rcDestination = wintypes.RECT(dx, dy, dx + dw, dy + dh)
    props.fVisible = shown
    DwmUpdateThumbnailProperties(thumb, ctypes.byref(props))
    return shown


class Entry:
    """A minimized window, and the screen whose shelf it sits on."""

    def __init__(self, hwnd):
        self.hwnd = hwnd
        self.monitor = monitor_of(hwnd)
        self.thumb = None
        self.thumb_host = None  # the window the DWM thumbnail draws into
        self.has_preview = False
        self.title = window_title(hwnd)
        self.icon = window_icon(hwnd)
        self.kind = window_kind(hwnd)

    def show_in(self, host_hwnd):
        """Make sure the live preview is registered to draw into host_hwnd."""
        if self.thumb_host == host_hwnd and self.thumb:
            return
        self.release()
        thumb = wintypes.HANDLE()
        if DwmRegisterThumbnail(host_hwnd, self.hwnd, ctypes.byref(thumb)) == 0:
            self.thumb = thumb
            self.thumb_host = host_hwnd

    def place(self, area, opacity=255):
        """Fit the preview inside area (l, t, r, b), or hide it when area is None."""
        if not self.thumb:
            self.has_preview = False
            return
        self.has_preview = place_thumb(self.thumb, area, opacity)

    def release(self):
        if self.thumb:
            DwmUnregisterThumbnail(self.thumb)
        self.thumb = None
        self.thumb_host = None


class Panel:
    """The shelf on one screen."""

    def __init__(self, shelf, monitor):
        self.shelf = shelf
        self.monitor = monitor
        self.hwnd = None
        self.entries = []
        self.rects = []        # (tile_rect, close_rect) per entry
        self.size = (0, 0)
        self.scale = 1.0
        self.font = None
        self.hover = -1
        self.hover_close = False
        self.tracking = False
        self.all_entries = []      # everything on this screen's shelf, including overflow
        self.full_rect = None      # where the full shelf sits, in screen coordinates
        self.collapsed = False     # an open window overlaps the full shelf
        self.peek = False          # the pointer is on the bar, so show the full shelf anyway
        self.bar = False           # currently drawn as the thin bar
        self.dot = 8
        create_window(self, WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE)
        square_corners(self.hwnd)  # show() shapes it with a rounder region

    def px(self, v):
        return int(round(v * self.scale))

    def destroy(self):
        for e in self.entries:
            if e.thumb_host == self.hwnd:
                e.release()
        if self.hwnd:
            DestroyWindow(self.hwnd)

    def show(self, entries):
        """Lay out these entries along the bottom of this panel's screen (hide when empty)."""
        if self.shelf.zoom and self.shelf.zoom.panel is self:
            self.shelf.hide_zoom()  # the tiles are about to move
        for e in self.entries:
            if e not in entries and e.thumb_host == self.hwnd:
                e.place(None)
        work = work_rect(self.monitor)
        if work is None:
            entries = []
        self.all_entries = list(entries)
        if not entries:
            self.entries, self.rects, self.full_rect, self.bar = [], [], None, False
            ShowWindow(self.hwnd, SW_HIDE)
            return []

        scale = monitor_scale(self.monitor)
        if scale != self.scale or not self.font:
            self.scale = scale
            if self.font:
                DeleteObject(self.font)
            self.font = CreateFontW(-self.px(13), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, "Segoe UI")

        pad, gap = self.px(10), self.px(10)
        tile_w, tile_h = self.px(220), self.px(170)
        cap_h, inset = self.px(30), self.px(8)
        wl, wt, wr, wb = work
        fits = max(1, (wr - wl - 2 * pad - self.px(40) + gap) // (tile_w + gap))
        shown, overflow = entries[-fits:], entries[:-fits] if len(entries) > fits else []
        for e in overflow:
            if e.thumb_host == self.hwnd:
                e.place(None)

        n = len(shown)
        w = 2 * pad + n * tile_w + (n - 1) * gap
        h = 2 * pad + tile_h
        x = wl + (wr - wl - w) // 2
        y = wb - h - self.px(12)
        self.full_rect = (x, y, x + w, y + h)
        dragging_here = self.shelf.drag and self.shelf.drag.panel is self
        if self.collapsed and not self.peek and not dragging_here:
            self.show_bar(entries, x + w // 2, y + h)
            return overflow
        self.set_alpha(None)
        self.bar = False
        self.size = (w, h)
        SetWindowPos(self.hwnd, wintypes.HWND(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW)
        rad = self.px(SHELF_RADIUS)
        SetWindowRgn(self.hwnd, CreateRoundRectRgn(0, 0, w + 1, h + 1, rad, rad), True)

        self.entries, self.rects = shown, []
        close = self.px(22)
        dragging = self.shelf.drag.entry if self.shelf.drag and self.shelf.drag.active else None
        for i, e in enumerate(shown):
            left = pad + i * (tile_w + gap)
            tile = (left, pad, left + tile_w, pad + tile_h)
            area = (left + inset, pad + inset, left + tile_w - inset, pad + tile_h - cap_h)
            # In the caption row: Windows draws the live preview on top of anything the app paints
            # inside the preview area, so a close button up there would be hidden behind it.
            cy = tile[3] - cap_h + (cap_h - close) // 2
            close_rect = (tile[2] - close - self.px(8), cy, tile[2] - self.px(8), cy + close)
            self.rects.append((tile, close_rect))
            if dragging is not e:  # while dragged, the preview lives in the ghost window
                e.show_in(self.hwnd)
                e.place(area)
        if self.hover >= n:
            self.hover = -1
        InvalidateRect(self.hwnd, None, True)
        return overflow

    def show_bar(self, entries, center_x, bottom):
        """Shrink to a see-through bar, bottom-aligned inside where the full shelf would be,
        so pointing at it opens the shelf without the pointer falling off its edge."""
        for e in entries:
            if e.thumb_host == self.hwnd:
                e.place(None)
        self.dot, step = self.px(8), self.px(14)
        w = max(self.px(72), len(entries) * step + self.px(24))
        h = self.px(16)
        self.entries, self.rects, self.bar = list(entries), [], True
        self.hover = -1
        self.size = (w, h)
        SetWindowPos(self.hwnd, wintypes.HWND(HWND_TOPMOST), center_x - w // 2, bottom - h, w, h,
                     SWP_NOACTIVATE | SWP_SHOWWINDOW)
        SetWindowRgn(self.hwnd, CreateRoundRectRgn(0, 0, w + 1, h + 1, h, h), True)  # a pill
        self.set_alpha(BAR_ALPHA)
        InvalidateRect(self.hwnd, None, True)

    def set_alpha(self, alpha):
        """See-through (alpha 0-255) for the bar; None makes the window solid again.
        The full shelf stays an ordinary window so the live previews always draw."""
        ex = GetWindowLongPtrW(self.hwnd, GWL_EXSTYLE)
        if alpha is None:
            if ex & WS_EX_LAYERED:
                SetWindowLongPtrW(self.hwnd, GWL_EXSTYLE, ex & ~WS_EX_LAYERED)
            return
        if not ex & WS_EX_LAYERED:
            SetWindowLongPtrW(self.hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED)
        SetLayeredWindowAttributes(self.hwnd, 0, alpha, LWA_ALPHA)

    def unpeek(self):
        self.peek = False
        if self.all_entries:
            self.show(self.all_entries)
        self.shelf.update_overlap()

    # ---- messages ----
    def on_message(self, msg, wp, lp):
        if msg == WM_PAINT:
            self.paint()
            return 0
        if msg == WM_ERASEBKGND:
            return 1
        if msg == WM_MOUSEACTIVATE:
            return MA_NOACTIVATE
        if msg == WM_DPICHANGED:
            return 0  # show() already sizes the panel for its screen's DPI
        if msg in (WM_DISPLAYCHANGE, WM_SETTINGCHANGE):
            # Only top-level windows get these broadcasts. Let the shelf rebuild the
            # panels after this message returns, not from inside it.
            if self.shelf.hwnd:
                PostMessageW(self.shelf.hwnd, WM_APP_SCREENS, 0, 0)
            return None
        if msg == WM_LBUTTONDOWN:
            i, on_close = self.hit(*xy(lp))
            if i >= 0 and not on_close:
                self.shelf.drag = Drag(self.shelf, self, self.entries[i], cursor_pos())
                SetCapture(self.hwnd)
            return 0
        if msg == WM_MOUSEMOVE:
            drag = self.shelf.drag
            if drag and GetCapture() == self.hwnd:
                drag.move(cursor_pos())
                return 0
            KillTimer(self.hwnd, TIMER_UNPEEK)
            if self.bar:  # pointing at the bar: open the full shelf
                self.peek = True
                self.show(self.all_entries)
            self.on_hover(*xy(lp))
            return 0
        if msg == WM_TIMER and wp == TIMER_UNPEEK:
            KillTimer(self.hwnd, TIMER_UNPEEK)
            zoom = self.shelf.zoom
            if zoom and zoom.panel is self and zoom.contains(cursor_pos()):
                SetTimer(self.hwnd, TIMER_UNPEEK, 400, None)  # still reading the big copy
            elif self.peek and not self.contains(cursor_pos()):
                self.unpeek()
            return 0
        if msg == WM_TIMER and wp == TIMER_ZOOM:
            KillTimer(self.hwnd, TIMER_ZOOM)
            if 0 <= self.hover < len(self.entries) and not self.bar and not self.shelf.drag:
                self.shelf.show_zoom(self, self.hover)
            return 0
        if msg == WM_LBUTTONUP:
            drag = self.shelf.drag
            if drag and drag.active:
                self.shelf.drag = None
                ReleaseCapture()
                drag.drop(cursor_pos())
                return 0
            self.shelf.drag = None
            if GetCapture() == self.hwnd:
                ReleaseCapture()
            i, on_close = self.hit(*xy(lp))
            if i >= 0:
                h = self.entries[i].hwnd
                self.shelf.close_window(h) if on_close else self.shelf.bring_back(h)
            return 0
        if msg == WM_CAPTURECHANGED:
            drag = self.shelf.drag
            if drag:  # capture taken away (Alt+Tab, a dialog): cancel the drag
                self.shelf.drag = None
                drag.cancel()
            return 0
        if msg == WM_MBUTTONUP:
            i, _ = self.hit(*xy(lp))
            if i >= 0:
                self.shelf.close_window(self.entries[i].hwnd)
            return 0
        if msg == WM_MOUSELEAVE:
            self.tracking = False
            self.set_hover(-1, False)
            if self.peek:
                SetTimer(self.hwnd, TIMER_UNPEEK, 400, None)
            return 0
        if msg == WM_DESTROY:
            if self.font:
                DeleteObject(self.font)
                self.font = None
            self.hwnd = None
            return 0
        return None

    def paint(self):
        ps = PAINTSTRUCT()
        hdc = BeginPaint(self.hwnd, ctypes.byref(ps))
        try:
            if self.bar:
                self.paint_bar(hdc)
                return
            if not self.rects:
                return
            br = self.shelf.brushes
            FillRect(hdc, ctypes.byref(wintypes.RECT(0, 0, *self.size)), br["panel"])
            old_font = SelectObject(hdc, self.font)
            old_pen = SelectObject(hdc, GetStockObject(NULL_PEN))
            SetBkMode(hdc, TRANSPARENT)
            radius = self.px(TILE_RADIUS)
            dragging = self.shelf.drag.entry if self.shelf.drag and self.shelf.drag.active else None
            for i, (e, (tile, close)) in enumerate(zip(self.entries, self.rects)):
                hovered = i == self.hover and dragging is None
                lifted = e is dragging
                plain = COLORS["tile_drag" if lifted else "tile_hover" if hovered else "tile"]
                kind = self.shelf.kind_color(e)
                if kind is None:
                    SelectObject(hdc, self.shelf.brush(plain))
                    RoundRect(hdc, *tile, radius, radius)
                else:  # a colored border, then the tile tinted with the same color
                    SelectObject(hdc, self.shelf.brush(mix(kind, plain, 0.45) if lifted else kind))
                    RoundRect(hdc, *tile, radius, radius)
                    edge = self.px(2)
                    tint = mix(kind, plain, 0.10 if lifted else 0.30 if hovered else 0.20)
                    SelectObject(hdc, self.shelf.brush(tint))
                    RoundRect(hdc, tile[0] + edge, tile[1] + edge, tile[2] - edge, tile[3] - edge,
                              radius - edge, radius - edge)
                l, t, r, b = tile
                cap_top = b - self.px(30)
                if (lifted or not e.has_preview) and e.icon:  # no live picture here: show the app's icon
                    big = self.px(48)
                    DrawIconEx(hdc, (l + r - big) // 2, (t + cap_top - big) // 2, e.icon, big, big, 0, None, DI_NORMAL)
                small = self.px(16)
                text_left = l + self.px(10)
                if e.icon:
                    DrawIconEx(hdc, text_left, cap_top + (self.px(30) - small) // 2, e.icon, small, small, 0, None, DI_NORMAL)
                    text_left += small + self.px(8)
                SetTextColor(hdc, COLORS["muted" if lifted else "text"])
                tr = wintypes.RECT(text_left, cap_top, close[0] - self.px(6), b)  # leave room for the close button
                DrawTextW(hdc, e.title, -1, ctypes.byref(tr), DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX)
                if hovered:
                    SelectObject(hdc, br["close_hover" if self.hover_close else "close"])
                    d = close[2] - close[0]
                    RoundRect(hdc, *close, d, d)
                    SetTextColor(hdc, COLORS["text"])
                    cr = wintypes.RECT(*close)
                    DrawTextW(hdc, "✕", -1, ctypes.byref(cr), DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX)
            SelectObject(hdc, old_pen)
            SelectObject(hdc, old_font)
        finally:
            EndPaint(self.hwnd, ctypes.byref(ps))

    def paint_bar(self, hdc):
        w, h = self.size
        FillRect(hdc, ctypes.byref(wintypes.RECT(0, 0, w, h)), self.shelf.brushes["panel"])
        old_pen = SelectObject(hdc, GetStockObject(NULL_PEN))
        d, step = self.dot, self.px(14)
        x = (w - (len(self.entries) * step - (step - d))) // 2
        y = (h - d) // 2
        for e in self.entries:
            c = self.shelf.kind_color(e)
            SelectObject(hdc, self.shelf.brush(COLORS["muted"] if c is None else c))
            RoundRect(hdc, x, y, x + d, y + d, d, d)
            x += step
        SelectObject(hdc, old_pen)

    def contains(self, pt):
        r = wintypes.RECT()
        GetWindowRect(self.hwnd, ctypes.byref(r))
        return r.left <= pt.x < r.right and r.top <= pt.y < r.bottom

    def hit(self, x, y):
        for i, (tile, close) in enumerate(self.rects):
            if tile[0] <= x < tile[2] and tile[1] <= y < tile[3]:
                return i, close[0] <= x < close[2] and close[1] <= y < close[3]
        return -1, False

    def on_hover(self, x, y):
        if not self.tracking:
            tme = TRACKMOUSEEVENT(ctypes.sizeof(TRACKMOUSEEVENT), TME_LEAVE, self.hwnd, 0)
            TrackMouseEvent(ctypes.byref(tme))
            self.tracking = True
        self.set_hover(*self.hit(x, y))

    def set_hover(self, i, on_close):
        if (i, on_close) != (self.hover, self.hover_close):
            moved_tile = i != self.hover
            self.hover, self.hover_close = i, on_close
            InvalidateRect(self.hwnd, None, False)
            if moved_tile and i >= 0 and not self.bar and self.shelf.zoom_enabled():
                zoom = self.shelf.zoom
                if zoom and zoom.panel is self:
                    self.shelf.show_zoom(self, i)  # already zoomed: follow the pointer straight away
                else:
                    SetTimer(self.hwnd, TIMER_ZOOM, ZOOM_DELAY_MS, None)
            elif i < 0:
                KillTimer(self.hwnd, TIMER_ZOOM)  # the big copy, if any, hides itself when the pointer leaves

    def tile_screen_rect(self, i):
        r = wintypes.RECT()
        GetWindowRect(self.hwnd, ctypes.byref(r))
        l, t, rr, b = self.rects[i][0]
        return r.left + l, r.top + t, r.left + rr, r.top + b

    def tile_under(self, pt):
        """Index of the tile under a screen point, or -1."""
        if not self.contains(pt):
            return -1
        r = wintypes.RECT()
        GetWindowRect(self.hwnd, ctypes.byref(r))
        return self.hit(pt.x - r.left, pt.y - r.top)[0]


class Zoom:
    """A copy of a thumbnail at twice its size, shown just above it while the pointer rests there.
    It has its own live preview from Windows, so the tile underneath keeps its picture."""

    def __init__(self, shelf, panel, index):
        self.shelf, self.panel = shelf, panel
        self.entry = entry = panel.entries[index]
        self.index = index
        self.hwnd = None
        self.thumb = None
        self.scale = s = panel.scale
        px = lambda v: int(round(v * s))  # noqa: E731
        self.w, self.h = px(440), px(340)       # twice a tile
        self.inset, self.cap = px(12), px(48)
        self.font = CreateFontW(-px(17), 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 5, 0, "Segoe UI")
        create_window(self, WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE)
        square_corners(self.hwnd)
        rad = px(ZOOM_RADIUS)
        SetWindowRgn(self.hwnd, CreateRoundRectRgn(0, 0, self.w + 1, self.h + 1, rad, rad), True)

        # Centered above its tile, kept on the tile's screen.
        tl, tt, tr, _ = panel.tile_screen_rect(index)
        x = (tl + tr) // 2 - self.w // 2
        y = tt - px(14) - self.h
        work = work_rect(panel.monitor)
        if work:
            x = max(work[0] + px(8), min(x, work[2] - self.w - px(8)))
            y = max(work[1] + px(8), y)
        SetWindowPos(self.hwnd, wintypes.HWND(HWND_TOPMOST), x, y, self.w, self.h, SWP_NOACTIVATE | SWP_SHOWWINDOW)

        thumb = wintypes.HANDLE()
        self.has_preview = False
        if DwmRegisterThumbnail(self.hwnd, entry.hwnd, ctypes.byref(thumb)) == 0:
            self.thumb = thumb
            i = self.inset
            self.has_preview = place_thumb(thumb, (i, i, self.w - i, self.h - self.cap))
        SetTimer(self.hwnd, TIMER_ZOOM_WATCH, 120, None)

    def contains(self, pt):
        r = wintypes.RECT()
        if not self.hwnd or not GetWindowRect(self.hwnd, ctypes.byref(r)):
            return False
        return r.left <= pt.x < r.right and r.top <= pt.y < r.bottom

    def in_gap(self, pt):
        """The strip between the big copy and its tile, so moving up to it doesn't close it."""
        r = wintypes.RECT()
        if not self.hwnd or not GetWindowRect(self.hwnd, ctypes.byref(r)) or self.index >= len(self.panel.rects):
            return False
        tile_top = self.panel.tile_screen_rect(self.index)[1]
        return r.left <= pt.x < r.right and r.bottom <= pt.y < tile_top

    def destroy(self):
        if self.thumb:
            DwmUnregisterThumbnail(self.thumb)
            self.thumb = None
        if self.hwnd:
            KillTimer(self.hwnd, TIMER_ZOOM_WATCH)
            DestroyWindow(self.hwnd)
        if self.font:
            DeleteObject(self.font)
            self.font = None

    def on_message(self, msg, wp, lp):
        if msg == WM_PAINT:
            self.paint()
            return 0
        if msg == WM_ERASEBKGND:
            return 1
        if msg == WM_MOUSEACTIVATE:
            return MA_NOACTIVATE
        if msg == WM_TIMER and wp == TIMER_ZOOM_WATCH:
            pt = cursor_pos()
            if not self.contains(pt) and not self.in_gap(pt) and self.panel.tile_under(pt) != self.index:
                self.shelf.hide_zoom()
            return 0
        if msg == WM_LBUTTONUP:
            h = self.entry.hwnd
            self.shelf.hide_zoom()
            self.shelf.bring_back(h)
            return 0
        if msg == WM_MBUTTONUP:
            h = self.entry.hwnd
            self.shelf.hide_zoom()
            self.shelf.close_window(h)
            return 0
        if msg == WM_DESTROY:
            self.hwnd = None
            return 0
        return None

    def paint(self):
        ps = PAINTSTRUCT()
        hdc = BeginPaint(self.hwnd, ctypes.byref(ps))
        try:
            w, h, s = self.w, self.h, self.scale
            plain = COLORS["tile_hover"]
            kind = self.shelf.kind_color(self.entry)
            if kind is None:
                FillRect(hdc, ctypes.byref(wintypes.RECT(0, 0, w, h)), self.shelf.brush(plain))
            else:  # the same colored border and tint as the tile
                edge = max(2, int(3 * s))
                FillRect(hdc, ctypes.byref(wintypes.RECT(0, 0, w, h)), self.shelf.brush(kind))
                FillRect(hdc, ctypes.byref(wintypes.RECT(edge, edge, w - edge, h - edge)),
                         self.shelf.brush(mix(kind, plain, 0.25)))
            cap_top = h - self.cap
            e = self.entry
            if not self.has_preview and e.icon:
                big = int(96 * s)
                DrawIconEx(hdc, (w - big) // 2, (cap_top - big) // 2, e.icon, big, big, 0, None, DI_NORMAL)
            text_left = int(16 * s)
            if e.icon:
                small = int(24 * s)
                DrawIconEx(hdc, text_left, cap_top + (self.cap - small) // 2, e.icon, small, small, 0, None, DI_NORMAL)
                text_left += small + int(10 * s)
            old_font = SelectObject(hdc, self.font)
            SetBkMode(hdc, TRANSPARENT)
            SetTextColor(hdc, COLORS["text"])
            tr = wintypes.RECT(text_left, cap_top, w - int(16 * s), h)
            DrawTextW(hdc, e.title, -1, ctypes.byref(tr), DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX)
            SelectObject(hdc, old_font)
        finally:
            EndPaint(self.hwnd, ctypes.byref(ps))


class Ghost:
    """The small preview that follows the pointer while you drag a thumbnail."""

    def __init__(self, shelf, entry, scale):
        self.shelf = shelf
        self.entry = entry
        self.hwnd = None
        self.w, self.h = int(176 * scale), int(118 * scale)
        create_window(self, WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT)
        square_corners(self.hwnd)
        rad = int(GHOST_RADIUS * scale)
        SetWindowRgn(self.hwnd, CreateRoundRectRgn(0, 0, self.w + 1, self.h + 1, rad, rad), True)
        inset = int(6 * scale)
        entry.show_in(self.hwnd)
        entry.place((inset, inset, self.w - inset, self.h - inset), opacity=230)
        self.has_preview = entry.has_preview
        self.scale = scale

    def move(self, pt):
        SetWindowPos(self.hwnd, wintypes.HWND(HWND_TOPMOST), pt.x - self.w // 2, pt.y - self.h // 2,
                     self.w, self.h, SWP_NOACTIVATE | SWP_SHOWWINDOW)

    def destroy(self):
        if self.entry.thumb_host == self.hwnd:
            self.entry.release()
        if self.hwnd:
            DestroyWindow(self.hwnd)

    def on_message(self, msg, wp, lp):
        if msg == WM_PAINT:
            ps = PAINTSTRUCT()
            hdc = BeginPaint(self.hwnd, ctypes.byref(ps))
            kind = self.shelf.kind_color(self.entry)
            if kind is None:
                FillRect(hdc, ctypes.byref(wintypes.RECT(0, 0, self.w, self.h)), self.shelf.brushes["ghost"])
            else:
                edge = max(2, int(3 * self.scale))
                FillRect(hdc, ctypes.byref(wintypes.RECT(0, 0, self.w, self.h)), self.shelf.brush(kind))
                FillRect(hdc, ctypes.byref(wintypes.RECT(edge, edge, self.w - edge, self.h - edge)),
                         self.shelf.brush(mix(kind, COLORS["ghost"], 0.25)))
            if not self.has_preview and self.entry.icon:
                big = int(48 * self.scale)
                DrawIconEx(hdc, (self.w - big) // 2, (self.h - big) // 2, self.entry.icon, big, big, 0, None, DI_NORMAL)
            EndPaint(self.hwnd, ctypes.byref(ps))
            return 0
        if msg == WM_ERASEBKGND:
            return 1
        if msg == WM_MOUSEACTIVATE:
            return MA_NOACTIVATE
        if msg == WM_DESTROY:
            self.hwnd = None
            return 0
        return None


class Drag:
    """Press on a thumbnail; once the pointer moves a few pixels it becomes a drag."""

    def __init__(self, shelf, panel, entry, start):
        self.shelf, self.panel, self.entry = shelf, panel, entry
        self.start = (start.x, start.y)
        self.active = False
        self.ghost = None

    def move(self, pt):
        if not self.active:
            if abs(pt.x - self.start[0]) < DRAG_START_PX and abs(pt.y - self.start[1]) < DRAG_START_PX:
                return
            self.active = True
            self.shelf.hide_zoom()
            self.ghost = Ghost(self.shelf, self.entry, self.panel.scale)
            InvalidateRect(self.panel.hwnd, None, False)
        SetCursor(LoadCursorW(None, ctypes.c_void_p(IDC_SIZEALL)))
        self.ghost.move(pt)

    def finish(self):
        if self.ghost:
            self.ghost.destroy()
            self.ghost = None
        self.active = False

    def cancel(self):
        self.finish()
        self.shelf.end_peeks()
        self.shelf.layout()

    def drop(self, pt):
        self.finish()
        target = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
        if target and not same_monitor(target, self.entry.monitor):
            move_to_monitor(self.entry.hwnd, self.entry.monitor, target)
            self.entry.monitor = target
        self.shelf.end_peeks()
        self.shelf.layout()


class Shelf:
    """Owns the panels (one per screen), the minimize hook and the timer, all on one thread."""

    def __init__(self, get_cfg=lambda: {}):
        self.get_cfg = get_cfg
        self.hwnd = None       # hidden message-only window for the timer and stop()
        self.thread = None
        self.entries = []
        self.panels = {}       # monitor handle value -> Panel
        self.drag = None
        self.covered_monitor = None
        self.cloaked = set()
        self.hooks = []
        self._hook_ref = None
        self.overlap_pending = False
        self.zoom = None       # the big copy of the preview under the pointer, if showing
        self.brushes = {}
        self.brush_cache = {}  # COLORREF -> brush, for the color-coded tiles

    # ---- lifecycle ----
    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self.run, name="PaneShelf", daemon=True)
        self.thread.start()

    def zoom_enabled(self):
        return self.get_cfg().get("shelf_zoom", True)

    def show_zoom(self, panel, index):
        z = self.zoom
        if z and z.panel is panel and z.index == index:
            return
        self.hide_zoom()
        if 0 <= index < len(panel.entries) and panel.rects:
            self.zoom = Zoom(self, panel, index)

    def hide_zoom(self):
        z, self.zoom = self.zoom, None
        if z:
            z.destroy()
            p = z.panel
            if p.peek and p.hwnd and not p.contains(cursor_pos()):
                SetTimer(p.hwnd, TIMER_UNPEEK, 400, None)  # let an opened-up shelf shrink again

    def end_peeks(self):
        """After a drag the pointer may be anywhere: let shelves shrink again if they should."""
        cur = cursor_pos()
        for p in self.panels.values():
            if p.peek and p.hwnd and not p.contains(cur):
                p.peek = False

    def refresh(self):
        """Repaint the shelves, e.g. after the colors changed. Safe to call from any thread."""
        if self.hwnd:
            PostMessageW(self.hwnd, WM_APP_REFRESH, 0, 0)

    def kind_color(self, e):
        """The COLORREF for this window's type, or None when color-coding is off."""
        cfg = self.get_cfg()
        if not cfg.get("shelf_colors", True):
            return None
        try:
            return hex_to_colorref(cfg.get(f"color_{e.kind}") or KIND_COLORS[e.kind])
        except (ValueError, KeyError):
            return hex_to_colorref(KIND_COLORS.get(e.kind, KIND_COLORS["app"]))

    def brush(self, color):
        b = self.brush_cache.get(color)
        if b is None:
            b = self.brush_cache[color] = CreateSolidBrush(color)
        return b

    def stop(self):
        if self.hwnd:
            PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    def run(self):
        """Create the windows and pump messages until stop(). Blocks."""
        register_class()
        create_window(self, 0, parent=wintypes.HWND(HWND_MESSAGE))
        for name, color in COLORS.items():
            self.brushes[name] = CreateSolidBrush(color)
        self._hook_ref = WINEVENTPROC(self.on_winevent)
        flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
        for first, last in ((EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
                            (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
                            (EVENT_OBJECT_SHOW, EVENT_OBJECT_HIDE),
                            (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE)):
            hook = SetWinEventHook(first, last, None, self._hook_ref, 0, 0, flags)
            if hook:
                self.hooks.append(hook)
        SetTimer(self.hwnd, TIMER_ID, 1000, None)
        self.add_existing()

        msg = wintypes.MSG()
        while GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            TranslateMessage(ctypes.byref(msg))
            DispatchMessageW(ctypes.byref(msg))

    def cleanup(self):
        KillTimer(self.hwnd, TIMER_ID)
        for hook in self.hooks:
            UnhookWinEvent(hook)
        self.hooks.clear()
        KillTimer(self.hwnd, TIMER_OVERLAP)
        self.hide_zoom()
        if self.drag:
            self.drag.finish()
            self.drag = None
        for e in self.entries:
            e.release()
        self.entries.clear()
        self.drop_panels()
        for b in list(self.brushes.values()) + list(self.brush_cache.values()):
            DeleteObject(b)
        self.brushes.clear()
        self.brush_cache.clear()
        self.hwnd = None

    def drop_panels(self):
        for p in self.panels.values():
            p.destroy()
        self.panels.clear()

    # ---- which windows belong on the shelf ----
    def trackable(self, h):
        if not h or not IsWindow(h) or not IsWindowVisible(h) or h in _owners:
            return False
        if GetWindow(h, GW_OWNER) or GetWindowLongPtrW(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW:
            return False
        return GetWindowTextLengthW(h) > 0 and class_name(h) not in SHELL_CLASSES

    def add_existing(self):
        found = []

        def visit(h, _):
            if IsIconic(h) and self.trackable(h):
                found.append(h)
            return True

        EnumWindows(WNDENUMPROC(visit), 0)
        for h in reversed(found):  # EnumWindows lists the top of the z-order first
            self.add(h, relayout=False)
        self.layout()

    def add(self, h, relayout=True):
        if any(e.hwnd == h for e in self.entries) or not self.trackable(h):
            return
        self.entries.append(Entry(h))
        if relayout:
            self.layout()

    def remove(self, h):
        for e in [e for e in self.entries if e.hwnd == h]:
            if self.drag and self.drag.entry is e:
                self.drag.finish()
                self.drag = None
                ReleaseCapture()
            e.release()
            self.entries.remove(e)
        self.layout()

    # ---- layout across screens ----
    def layout(self):
        if not self.hwnd:
            return
        groups = {}
        for e in self.entries:
            if e.hwnd in self.cloaked:
                if e.thumb:
                    e.place(None)
                continue  # minimized on another virtual desktop
            if self.covered_monitor is not None and same_monitor(e.monitor, self.covered_monitor):
                if e.thumb and not (self.drag and self.drag.entry is e):
                    e.place(None)
                continue  # a game or video is full screen there
            groups.setdefault(handle_value(e.monitor), []).append(e)
        for key, panel in list(self.panels.items()):
            if key not in groups:
                panel.show([])
        for key, entries in groups.items():
            panel = self.panels.get(key)
            if panel is None:
                panel = self.panels[key] = Panel(self, entries[0].monitor)
            panel.show(entries)
        self.update_overlap()

    def update_overlap(self):
        """Shrink each screen's shelf to a bar while an open window overlaps it, and grow it back
        when nothing does."""
        if not self.hwnd or (self.drag and self.drag.active):
            return
        autohide = self.get_cfg().get("shelf_autohide", True)
        live = [p for p in self.panels.values() if p.hwnd and p.full_rect and p.all_entries]
        rects = open_window_rects() if autohide and live else []
        for p in live:
            l, t, r_, b = p.full_rect
            want = any(w[0] < r_ and w[2] > l and w[1] < b and w[3] > t for w in rects)
            if want != p.collapsed:
                p.collapsed = want
                p.show(p.all_entries)

    # ---- events ----
    def on_winevent(self, hook, event, hwnd, id_object, id_child, thread, time_ms):
        try:
            if id_object != OBJID_WINDOW or id_child != 0 or not self.hwnd:
                return
            if event == EVENT_SYSTEM_MINIMIZESTART:
                self.add(hwnd)
            elif event == EVENT_SYSTEM_MINIMIZEEND:
                self.remove(hwnd)
            elif self.panels and not self.overlap_pending:
                # A window moved, appeared, disappeared or came to the front: re-check shortly.
                self.overlap_pending = True
                SetTimer(self.hwnd, TIMER_OVERLAP, 80, None)
        except Exception as e:
            print(f"shelf hook: {e!r}", file=sys.stderr)

    def on_message(self, msg, wp, lp):
        if msg == WM_TIMER:
            if wp == TIMER_OVERLAP:
                KillTimer(self.hwnd, TIMER_OVERLAP)
                self.overlap_pending = False
                self.update_overlap()
            else:
                self.tick()
            return 0
        if msg == WM_APP_REFRESH:
            for p in self.panels.values():
                if p.hwnd:
                    InvalidateRect(p.hwnd, None, False)
            self.update_overlap()
            return 0
        if msg == WM_APP_SCREENS:
            self.screens_changed()
            return 0
        if msg == WM_CLOSE:
            DestroyWindow(self.hwnd)
            return 0
        if msg == WM_DESTROY:
            self.cleanup()
            PostQuitMessage(0)
            return 0
        return None

    def screens_changed(self):
        """Monitors were added, removed or rearranged: rebuild the panels from scratch."""
        self.hide_zoom()
        if self.drag:
            self.drag.finish()
            self.drag = None
        for e in self.entries:
            e.release()
            e.monitor = monitor_of(e.hwnd)
        self.drop_panels()
        self.layout()

    def tick(self):
        """Once a second: drop windows that closed or came back some other way, refresh titles,
        and notice virtual-desktop switches and full-screen apps."""
        if self.drag and self.drag.active:
            return
        changed = False
        for e in list(self.entries):
            if not IsWindow(e.hwnd) or not IsIconic(e.hwnd) or not IsWindowVisible(e.hwnd):
                e.release()
                self.entries.remove(e)
                changed = True
            else:
                t = window_title(e.hwnd)
                if t != e.title:
                    e.title = t
                    for p in self.panels.values():
                        if e in p.entries:
                            InvalidateRect(p.hwnd, None, False)
        cloaked = {e.hwnd for e in self.entries if is_cloaked(e.hwnd)}
        covered = fullscreen_monitor()
        if cloaked != self.cloaked or not same_monitor(covered, self.covered_monitor):
            self.cloaked, self.covered_monitor = cloaked, covered
            changed = True
        if changed:
            self.layout()
        else:
            self.update_overlap()

    # ---- actions ----
    def bring_back(self, h):
        """Restore just this window. Other windows are left exactly as they are."""
        if IsIconic(h):
            ShowWindow(h, SW_RESTORE)
        # Our click counts as the last input, so Windows lets us hand focus over.
        if not SetForegroundWindow(h):
            SwitchToThisWindow(h, True)

    def close_window(self, h):
        PostMessageW(h, WM_CLOSE, 0, 0)


# ---- screens ----

def handle_value(h):
    return getattr(h, "value", h) or 0


def same_monitor(a, b):
    return handle_value(a) == handle_value(b)


def monitor_of(h):
    # For a minimized window this uses where the window sits when restored.
    return MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST)


def monitor_info(m):
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    if not m or not GetMonitorInfoW(m, ctypes.byref(mi)):
        return None
    return mi


def work_rect(m):
    mi = monitor_info(m)
    if mi is None:
        return None
    r = mi.rcWork
    return r.left, r.top, r.right, r.bottom


def monitor_scale(m):
    if GetDpiForMonitor is not None:
        x, y = wintypes.UINT(), wintypes.UINT()
        if GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, ctypes.byref(x), ctypes.byref(y)) == 0 and x.value:
            return x.value / 96
    return 1.0


def move_to_monitor(h, src, dst):
    """Move a minimized window to another screen, keeping it minimized.

    Its restored position keeps the same offset from the top-left of the screen's
    work area, shrunk and nudged if needed so the whole window fits on the new screen.
    A window that was maximized before it was minimized comes back maximized there.
    """
    wp = WINDOWPLACEMENT()
    wp.length = ctypes.sizeof(WINDOWPLACEMENT)
    if not GetWindowPlacement(h, ctypes.byref(wp)):
        return False
    s, d = work_rect(src), work_rect(dst)
    if s is None or d is None:
        return False
    # rcNormalPosition is in "workspace" coordinates: screen coordinates shifted by
    # the primary screen's work-area offset (non-zero when the taskbar is on the top or left).
    primary = monitor_info(MonitorFromPoint(wintypes.POINT(0, 0), MONITOR_DEFAULTTOPRIMARY))
    ox = primary.rcWork.left - primary.rcMonitor.left if primary else 0
    oy = primary.rcWork.top - primary.rcMonitor.top if primary else 0

    r = wp.rcNormalPosition
    w = min(r.right - r.left, d[2] - d[0])
    h_ = min(r.bottom - r.top, d[3] - d[1])
    left = d[0] + (r.left + ox - s[0])
    top = d[1] + (r.top + oy - s[1])
    left = max(d[0], min(left, d[2] - w))
    top = max(d[1], min(top, d[3] - h_))
    wp.rcNormalPosition = wintypes.RECT(left - ox, top - oy, left - ox + w, top - oy + h_)
    wp.flags &= ~WPF_SETMINPOSITION
    wp.showCmd = SW_SHOWMINNOACTIVE
    return bool(SetWindowPlacement(h, ctypes.byref(wp)))


def fullscreen_monitor():
    """The screen a game or video is filling right now, or None."""
    fg = GetForegroundWindow()
    if not fg or class_name(fg) in SHELL_CLASSES or fg in _owners:
        return None
    r = wintypes.RECT()
    GetWindowRect(fg, ctypes.byref(r))
    m = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST)
    mi = monitor_info(m)
    if mi is None:
        return None
    b = mi.rcMonitor
    if r.left <= b.left and r.top <= b.top and r.right >= b.right and r.bottom >= b.bottom:
        return m
    return None


# ---- small helpers ----

def xy(lp):
    x, y = lp & 0xFFFF, (lp >> 16) & 0xFFFF
    return (x - 0x10000 if x & 0x8000 else x), (y - 0x10000 if y & 0x8000 else y)


def cursor_pos():
    pt = wintypes.POINT()
    GetCursorPos(ctypes.byref(pt))
    return pt


def process_name(h):
    """The lower-case .exe name of the process that owns window h, or "" if Windows won't say."""
    pid = wintypes.DWORD()
    GetWindowThreadProcessId(h, ctypes.byref(pid))
    proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if not proc:
        return ""  # e.g. an app running as administrator
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(len(buf))
        if not QueryFullProcessImageNameW(proc, 0, buf, ctypes.byref(size)):
            return ""
        return buf.value.replace("/", "\\").rsplit("\\", 1)[-1].lower()
    finally:
        CloseHandle(proc)


def window_kind(h):
    """"folder" for File Explorer windows, "browser" for web browsers, otherwise "app"."""
    if class_name(h) in FOLDER_CLASSES:
        return "folder"
    if process_name(h) in BROWSERS:
        return "browser"
    return "app"


def class_name(h):
    buf = ctypes.create_unicode_buffer(256)
    GetClassNameW(h, buf, 256)
    return buf.value


def window_bounds(h):
    """The visible frame of a window (GetWindowRect includes invisible resize borders)."""
    r = wintypes.RECT()
    if DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(r), ctypes.sizeof(r)) != 0:
        GetWindowRect(h, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def open_window_rects():
    """Screen rectangles of the open (not minimized) app windows on the current desktop."""
    rects = []

    def visit(h, _):
        if h in _owners or not IsWindowVisible(h) or IsIconic(h):
            return True
        if GetWindowLongPtrW(h, GWL_EXSTYLE) & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT):
            return True  # floating palettes, overlays and notifications don't count
        if GetWindowTextLengthW(h) == 0 or class_name(h) in SHELL_CLASSES or is_cloaked(h):
            return True
        b = window_bounds(h)
        if b[2] > b[0] and b[3] > b[1]:
            rects.append(b)
        return True

    EnumWindows(WNDENUMPROC(visit), 0)
    return rects


def is_cloaked(h):
    """True for windows on another virtual desktop (and suspended store apps)."""
    cloaked = wintypes.DWORD()
    return DwmGetWindowAttribute(h, DWMWA_CLOAKED, ctypes.byref(cloaked), ctypes.sizeof(cloaked)) == 0 \
        and cloaked.value != 0


def window_title(h):
    n = GetWindowTextLengthW(h)
    buf = ctypes.create_unicode_buffer(n + 1)
    GetWindowTextW(h, buf, n + 1)
    return buf.value


def window_icon(h):
    res = ctypes.c_size_t()
    for kind in (ICON_BIG, ICON_SMALL2):
        if SendMessageTimeoutW(h, WM_GETICON, kind, 0, SMTO_ABORTIFHUNG, 100, ctypes.byref(res)) and res.value:
            return wintypes.HICON(res.value)
    for idx in (GCLP_HICON, GCLP_HICONSM):
        v = GetClassLongPtrW(h, idx)
        if v:
            return wintypes.HICON(v)
    return None


def main():
    if sys.platform != "win32":
        print("The thumbnail shelf only runs on Windows.", file=sys.stderr)
        return 1
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        pass
    Shelf().run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
