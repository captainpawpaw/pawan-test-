"""Thumbnail shelf for minimized windows.

When you minimize a window anywhere in Windows, a live preview of it appears
in a shelf just above the taskbar. Click a preview to bring that window back.
With "swap" on, the window you were using takes its place on the shelf.
Hover a preview and click its x (or middle-click the preview) to close that
window.

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
    LoadCursorW = _sig(user32.LoadCursorW, wintypes.HANDLE, wintypes.HINSTANCE, ctypes.c_void_p)
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
    GetDpiForWindow = getattr(user32, "GetDpiForWindow", None)
    if GetDpiForWindow:
        _sig(GetDpiForWindow, U, H)

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

# Win32 constants
WM_DESTROY, WM_PAINT, WM_CLOSE, WM_ERASEBKGND = 0x0002, 0x000F, 0x0010, 0x0014
WM_MOUSEACTIVATE, WM_GETICON, WM_TIMER = 0x0021, 0x007F, 0x0113
WM_MOUSEMOVE, WM_LBUTTONUP, WM_MBUTTONUP, WM_MOUSELEAVE = 0x0200, 0x0202, 0x0208, 0x02A3
WM_DPICHANGED, WM_DISPLAYCHANGE, WM_SETTINGCHANGE = 0x02E0, 0x007E, 0x001A
MA_NOACTIVATE = 3
WS_POPUP = 0x80000000
WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_NOACTIVATE = 0x80, 0x8, 0x08000000
GWL_EXSTYLE = -20
GW_OWNER = 4
SW_HIDE, SW_SHOWNOACTIVATE, SW_RESTORE, SW_MINIMIZE = 0, 4, 9, 6
SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x10, 0x40
HWND_TOPMOST = -1
EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND = 0x0016, 0x0017
WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS = 0x0, 0x2
OBJID_WINDOW = 0
TME_LEAVE = 0x2
IDC_ARROW = 32512
ICON_BIG, ICON_SMALL2 = 1, 2
GCLP_HICON, GCLP_HICONSM = -14, -34
SMTO_ABORTIFHUNG = 0x2
DI_NORMAL = 0x3
TRANSPARENT = 1
NULL_PEN = 8
DT_CENTER, DT_VCENTER, DT_SINGLELINE, DT_END_ELLIPSIS, DT_NOPREFIX = 0x1, 0x4, 0x20, 0x8000, 0x800
DWM_TNP_RECTDESTINATION, DWM_TNP_OPACITY, DWM_TNP_VISIBLE, DWM_TNP_SOURCECLIENTAREAONLY = 0x1, 0x4, 0x8, 0x10
DWMWA_CLOAKED, DWMWA_WINDOW_CORNER_PREFERENCE = 14, 33
DWMWCP_ROUND = 2
MONITOR_DEFAULTTOPRIMARY, MONITOR_DEFAULTTONEAREST = 1, 2
ERROR_CLASS_ALREADY_EXISTS = 1410
TIMER_ID = 1
SHELL_CLASSES = {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
                 "Windows.UI.Core.CoreWindow", "XamlExplorerHostIslandWindow"}


def rgb(r, g, b):
    return r | (g << 8) | (b << 16)  # COLORREF is 0x00BBGGRR


COLORS = {
    "panel": rgb(24, 26, 34),
    "tile": rgb(36, 39, 50),
    "tile_hover": rgb(52, 57, 72),
    "text": rgb(242, 243, 247),
    "close": rgb(196, 43, 28),
    "close_hover": rgb(232, 64, 48),
}

# One window procedure for the process; it hands messages to the live Shelf.
_shelves = {}
_creating = None


def _wndproc(hwnd, msg, wp, lp):
    shelf = _shelves.get(hwnd)
    if shelf is None and _creating is not None:
        shelf = _creating
        shelf.hwnd = hwnd
        _shelves[hwnd] = shelf
    if shelf is not None:
        try:
            handled = shelf.on_message(msg, wp, lp)
        except Exception as e:  # never let a Python error escape into Windows
            print(f"shelf: {e!r}", file=sys.stderr)
            handled = None
        if handled is not None:
            return handled
    return DefWindowProcW(hwnd, msg, wp, lp)


_WNDPROC_REF = WNDPROC(_wndproc) if sys.platform == "win32" else None


class Entry:
    def __init__(self, hwnd):
        self.hwnd = hwnd
        self.thumb = None
        self.has_preview = False
        self.title = ""
        self.icon = None


class Shelf:
    """Owns the shelf window, its message loop and the minimize hook (all on one thread)."""

    def __init__(self, get_cfg=lambda: {}):
        self.get_cfg = get_cfg
        self.hwnd = None
        self.thread = None
        self.entries = []
        self.rects = []        # (tile_rect, close_rect) per visible entry
        self.visible = []
        self.hover = -1
        self.hover_close = False
        self.tracking = False
        self.covered = False
        self.scale = 1.0
        self.size = (0, 0)
        self.round_corners = False
        self.hook = None
        self._hook_ref = None
        self.brushes = {}
        self.font = None

    # ---- lifecycle ----
    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self.run, name="PaneShelf", daemon=True)
        self.thread.start()

    def stop(self):
        if self.hwnd:
            PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    def run(self):
        """Create the window and pump messages until stop(). Blocks."""
        global _creating
        hinst = GetModuleHandleW(None)
        wc = WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
        wc.lpfnWndProc = _WNDPROC_REF
        wc.hInstance = hinst
        wc.hCursor = LoadCursorW(None, ctypes.c_void_p(IDC_ARROW))
        wc.lpszClassName = CLASS_NAME
        if not RegisterClassExW(ctypes.byref(wc)) and ctypes.get_last_error() != ERROR_CLASS_ALREADY_EXISTS:
            raise OSError("Couldn't register the shelf window class.")

        _creating = self
        try:
            CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE, CLASS_NAME, "Pane shelf",
                            WS_POPUP, 0, 0, 10, 10, None, None, hinst, None)
        finally:
            _creating = None
        if not self.hwnd:
            raise OSError("Couldn't create the shelf window.")

        pref = ctypes.c_int(DWMWCP_ROUND)
        self.round_corners = DwmSetWindowAttribute(
            self.hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ctypes.byref(pref), ctypes.sizeof(pref)) == 0
        self.update_scale()
        for name, color in COLORS.items():
            self.brushes[name] = CreateSolidBrush(color)

        self._hook_ref = WINEVENTPROC(self.on_winevent)
        self.hook = SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, None,
                                    self._hook_ref, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS)
        SetTimer(self.hwnd, TIMER_ID, 1000, None)
        self.add_existing()

        msg = wintypes.MSG()
        while GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            TranslateMessage(ctypes.byref(msg))
            DispatchMessageW(ctypes.byref(msg))

    def cleanup(self):
        KillTimer(self.hwnd, TIMER_ID)
        if self.hook:
            UnhookWinEvent(self.hook)
            self.hook = None
        for e in self.entries:
            if e.thumb:
                DwmUnregisterThumbnail(e.thumb)
        self.entries.clear()
        for b in self.brushes.values():
            DeleteObject(b)
        self.brushes.clear()
        if self.font:
            DeleteObject(self.font)
            self.font = None
        _shelves.pop(self.hwnd, None)
        self.hwnd = None

    # ---- which windows belong on the shelf ----
    def trackable(self, h):
        if not h or h == self.hwnd or not IsWindow(h) or not IsWindowVisible(h):
            return False
        if GetWindow(h, GW_OWNER) or GetWindowLongPtrW(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW:
            return False
        if GetWindowTextLengthW(h) == 0 or class_name(h) in SHELL_CLASSES:
            return False
        cloaked = wintypes.DWORD()
        if DwmGetWindowAttribute(h, DWMWA_CLOAKED, ctypes.byref(cloaked), ctypes.sizeof(cloaked)) == 0 and cloaked.value:
            return False  # on another virtual desktop, or a suspended store app
        return True

    def add_existing(self):
        found = []

        def visit(h, _):
            if IsIconic(h) and self.trackable(h):
                found.append(h)
            return True

        EnumWindows(WNDENUMPROC(visit), 0)
        for h in reversed(found):  # EnumWindows lists top of the z-order first
            self.add(h, relayout=False)
        self.layout()

    def add(self, h, relayout=True):
        if any(e.hwnd == h for e in self.entries) or not self.trackable(h):
            return
        e = Entry(h)
        thumb = wintypes.HANDLE()
        if DwmRegisterThumbnail(self.hwnd, h, ctypes.byref(thumb)) == 0:
            e.thumb = thumb
        e.title = window_title(h)
        e.icon = window_icon(h)
        self.entries.append(e)
        if relayout:
            self.layout()

    def remove(self, h):
        for e in list(self.entries):
            if e.hwnd == h:
                if e.thumb:
                    DwmUnregisterThumbnail(e.thumb)
                self.entries.remove(e)
        self.layout()

    # ---- events ----
    def on_winevent(self, hook, event, hwnd, id_object, id_child, thread, time_ms):
        try:
            if id_object != OBJID_WINDOW or id_child != 0 or not self.hwnd:
                return
            if event == EVENT_SYSTEM_MINIMIZESTART:
                self.add(hwnd)
            elif event == EVENT_SYSTEM_MINIMIZEEND:
                self.remove(hwnd)
        except Exception as e:
            print(f"shelf hook: {e!r}", file=sys.stderr)

    def on_message(self, msg, wp, lp):
        if msg == WM_PAINT:
            self.paint()
            return 0
        if msg == WM_ERASEBKGND:
            return 1
        if msg == WM_MOUSEACTIVATE:
            return MA_NOACTIVATE
        if msg == WM_MOUSEMOVE:
            self.on_hover(*xy(lp))
            return 0
        if msg == WM_MOUSELEAVE:
            self.tracking = False
            self.set_hover(-1, False)
            return 0
        if msg == WM_LBUTTONUP:
            i, on_close = self.hit(*xy(lp))
            if i >= 0:
                h = self.visible[i].hwnd
                self.close_window(h) if on_close else self.bring_back(h)
            return 0
        if msg == WM_MBUTTONUP:
            i, _ = self.hit(*xy(lp))
            if i >= 0:
                self.close_window(self.visible[i].hwnd)
            return 0
        if msg == WM_TIMER:
            self.tick()
            return 0
        if msg in (WM_DPICHANGED, WM_DISPLAYCHANGE, WM_SETTINGCHANGE):
            self.update_scale()
            self.layout()
            return None
        if msg == WM_CLOSE:
            DestroyWindow(self.hwnd)
            return 0
        if msg == WM_DESTROY:
            self.cleanup()
            PostQuitMessage(0)
            return 0
        return None

    def tick(self):
        """Once a second: drop windows that closed or came back some other way, refresh titles."""
        changed = False
        for e in list(self.entries):
            if not IsWindow(e.hwnd) or not IsIconic(e.hwnd) or not IsWindowVisible(e.hwnd):
                if e.thumb:
                    DwmUnregisterThumbnail(e.thumb)
                self.entries.remove(e)
                changed = True
            else:
                t = window_title(e.hwnd)
                if t != e.title:
                    e.title = t
                    InvalidateRect(self.hwnd, None, False)
        covered = fullscreen_app_in_front()
        if covered != self.covered:
            self.covered = covered
            changed = True
        if changed:
            self.layout()

    # ---- actions ----
    def bring_back(self, h):
        front = GetForegroundWindow()
        if IsIconic(h):
            ShowWindow(h, SW_RESTORE)
        # Our click counts as the last input, so Windows lets us hand focus over.
        if not SetForegroundWindow(h):
            SwitchToThisWindow(h, True)
        swap = self.get_cfg().get("shelf_swap", True)
        if swap and front and front != h and not IsIconic(front) and self.trackable(front):
            ShowWindow(front, SW_MINIMIZE)

    def close_window(self, h):
        PostMessageW(h, WM_CLOSE, 0, 0)

    # ---- layout and drawing ----
    def update_scale(self):
        dpi = GetDpiForWindow(self.hwnd) if (GetDpiForWindow and self.hwnd) else 96
        self.scale = (dpi or 96) / 96
        if self.font:
            DeleteObject(self.font)
        self.font = CreateFontW(-self.px(13), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, "Segoe UI")

    def px(self, v):
        return int(round(v * self.scale))

    def layout(self):
        if not self.hwnd:
            return
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        GetMonitorInfoW(MonitorFromPoint(wintypes.POINT(0, 0), MONITOR_DEFAULTTOPRIMARY), ctypes.byref(mi))
        work = mi.rcWork
        pad, gap = self.px(10), self.px(10)
        tile_w, tile_h = self.px(220), self.px(170)
        cap_h, inset = self.px(30), self.px(8)
        fits = max(1, (work.right - work.left - 2 * pad - self.px(40) + gap) // (tile_w + gap))
        self.visible = self.entries[-fits:]
        hidden = self.entries[:-fits] if len(self.entries) > fits else []
        for e in hidden:
            self.set_thumb(e, None)

        if not self.visible or self.covered:
            ShowWindow(self.hwnd, SW_HIDE)
            self.rects = []
            return

        n = len(self.visible)
        w = 2 * pad + n * tile_w + (n - 1) * gap
        h = 2 * pad + tile_h
        x = work.left + (work.right - work.left - w) // 2
        y = work.bottom - h - self.px(12)
        self.size = (w, h)
        SetWindowPos(self.hwnd, wintypes.HWND(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW)
        if not self.round_corners:
            SetWindowRgn(self.hwnd, CreateRoundRectRgn(0, 0, w + 1, h + 1, self.px(16), self.px(16)), True)

        self.rects = []
        close = self.px(22)
        for i, e in enumerate(self.visible):
            left = pad + i * (tile_w + gap)
            tile = (left, pad, left + tile_w, pad + tile_h)
            area = (left + inset, pad + inset, left + tile_w - inset, pad + tile_h - cap_h)
            close_rect = (tile[2] - close - self.px(4), tile[1] + self.px(4), tile[2] - self.px(4), tile[1] + self.px(4) + close)
            self.rects.append((tile, close_rect))
            self.set_thumb(e, area)
        if self.hover >= n:
            self.hover = -1
        InvalidateRect(self.hwnd, None, True)

    def set_thumb(self, e, area):
        if not e.thumb:
            e.has_preview = False
            return
        props = DWM_THUMBNAIL_PROPERTIES()
        props.dwFlags = DWM_TNP_VISIBLE | DWM_TNP_RECTDESTINATION | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY
        props.opacity = 255
        props.fSourceClientAreaOnly = False
        size = wintypes.SIZE()
        ok = area is not None and DwmQueryThumbnailSourceSize(e.thumb, ctypes.byref(size)) == 0
        # A minimized window that DWM has no picture for reports a tiny caption-sized source.
        if ok and size.cx > 0 and size.cy >= 60:
            l, t, r, b = area
            aw, ah = r - l, b - t
            s = min(aw / size.cx, ah / size.cy)
            dw, dh = max(1, int(size.cx * s)), max(1, int(size.cy * s))
            dx, dy = l + (aw - dw) // 2, t + (ah - dh) // 2
            props.rcDestination = wintypes.RECT(dx, dy, dx + dw, dy + dh)
            props.fVisible = True
            e.has_preview = True
        else:
            props.fVisible = False
            e.has_preview = False
        DwmUpdateThumbnailProperties(e.thumb, ctypes.byref(props))

    def paint(self):
        ps = PAINTSTRUCT()
        hdc = BeginPaint(self.hwnd, ctypes.byref(ps))
        try:
            if not self.rects:
                return
            full = wintypes.RECT(0, 0, *self.size)
            FillRect(hdc, ctypes.byref(full), self.brushes["panel"])
            old_font = SelectObject(hdc, self.font)
            old_pen = SelectObject(hdc, GetStockObject(NULL_PEN))
            SetBkMode(hdc, TRANSPARENT)
            SetTextColor(hdc, COLORS["text"])
            radius = self.px(12)
            for i, (e, (tile, close)) in enumerate(zip(self.visible, self.rects)):
                hovered = i == self.hover
                SelectObject(hdc, self.brushes["tile_hover" if hovered else "tile"])
                RoundRect(hdc, *tile, radius, radius)
                l, t, r, b = tile
                cap_top = b - self.px(30)
                if not e.has_preview and e.icon:  # no live picture: show the app's icon instead
                    big = self.px(48)
                    DrawIconEx(hdc, (l + r - big) // 2, (t + cap_top - big) // 2, e.icon, big, big, 0, None, DI_NORMAL)
                small = self.px(16)
                text_left = l + self.px(10)
                if e.icon:
                    DrawIconEx(hdc, text_left, cap_top + (self.px(30) - small) // 2, e.icon, small, small, 0, None, DI_NORMAL)
                    text_left += small + self.px(8)
                tr = wintypes.RECT(text_left, cap_top, r - self.px(10), b)
                DrawTextW(hdc, e.title, -1, ctypes.byref(tr),
                          DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX)
                if hovered:
                    SelectObject(hdc, self.brushes["close_hover" if self.hover_close else "close"])
                    d = close[2] - close[0]
                    RoundRect(hdc, *close, d, d)
                    cr = wintypes.RECT(*close)
                    DrawTextW(hdc, "✕", -1, ctypes.byref(cr), DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX)
            SelectObject(hdc, old_pen)
            SelectObject(hdc, old_font)
        finally:
            EndPaint(self.hwnd, ctypes.byref(ps))

    # ---- mouse ----
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
            self.hover, self.hover_close = i, on_close
            InvalidateRect(self.hwnd, None, False)


# ---- small helpers ----

def xy(lp):
    x, y = lp & 0xFFFF, (lp >> 16) & 0xFFFF
    return (x - 0x10000 if x & 0x8000 else x), (y - 0x10000 if y & 0x8000 else y)


def class_name(h):
    buf = ctypes.create_unicode_buffer(256)
    GetClassNameW(h, buf, 256)
    return buf.value


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


def fullscreen_app_in_front():
    """True while a game or video fills the screen, so the shelf gets out of the way."""
    fg = GetForegroundWindow()
    if not fg or class_name(fg) in SHELL_CLASSES:
        return False
    r = wintypes.RECT()
    GetWindowRect(fg, ctypes.byref(r))
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    if not GetMonitorInfoW(MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST), ctypes.byref(mi)):
        return False
    m = mi.rcMonitor
    return r.left <= m.left and r.top <= m.top and r.right >= m.right and r.bottom >= m.bottom


def main():
    if sys.platform != "win32":
        print("The thumbnail shelf only runs on Windows.", file=sys.stderr)
        return 1
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        pass
    shelf = Shelf()
    shelf.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
