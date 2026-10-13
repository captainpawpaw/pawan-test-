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

# Win32 constants
WM_DESTROY, WM_PAINT, WM_CLOSE, WM_ERASEBKGND = 0x0002, 0x000F, 0x0010, 0x0014
WM_MOUSEACTIVATE, WM_GETICON, WM_TIMER = 0x0021, 0x007F, 0x0113
WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONUP = 0x0200, 0x0201, 0x0202, 0x0208
WM_CAPTURECHANGED, WM_MOUSELEAVE = 0x0215, 0x02A3
WM_DPICHANGED, WM_DISPLAYCHANGE, WM_SETTINGCHANGE = 0x02E0, 0x007E, 0x001A
WM_APP_SCREENS = 0x8001  # WM_APP + 1: a panel saw the screens change
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
DWMWA_CLOAKED, DWMWA_WINDOW_CORNER_PREFERENCE = 14, 33
DWMWCP_ROUND = 2
MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY, MONITOR_DEFAULTTONEAREST = 0, 1, 2
MDT_EFFECTIVE_DPI = 0
WPF_SETMINPOSITION = 0x1
ERROR_CLASS_ALREADY_EXISTS = 1410
TIMER_ID = 1
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
        props = DWM_THUMBNAIL_PROPERTIES()
        props.dwFlags = DWM_TNP_VISIBLE | DWM_TNP_RECTDESTINATION | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY
        props.opacity = opacity
        props.fSourceClientAreaOnly = False
        size = wintypes.SIZE()
        ok = area is not None and DwmQueryThumbnailSourceSize(self.thumb, ctypes.byref(size)) == 0
        # A minimized window that DWM has no picture for reports a tiny caption-sized source.
        if ok and size.cx > 0 and size.cy >= 60:
            l, t, r, b = area
            aw, ah = r - l, b - t
            s = min(aw / size.cx, ah / size.cy)
            dw, dh = max(1, int(size.cx * s)), max(1, int(size.cy * s))
            dx, dy = l + (aw - dw) // 2, t + (ah - dh) // 2
            props.rcDestination = wintypes.RECT(dx, dy, dx + dw, dy + dh)
            props.fVisible = True
            self.has_preview = True
        else:
            props.fVisible = False
            self.has_preview = False
        DwmUpdateThumbnailProperties(self.thumb, ctypes.byref(props))

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
        create_window(self, WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE)
        pref = ctypes.c_int(DWMWCP_ROUND)
        self.round_corners = DwmSetWindowAttribute(
            self.hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ctypes.byref(pref), ctypes.sizeof(pref)) == 0

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
        for e in self.entries:
            if e not in entries and e.thumb_host == self.hwnd:
                e.place(None)
        work = work_rect(self.monitor)
        if work is None:
            entries = []
        if not entries:
            self.entries, self.rects = [], []
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
        self.size = (w, h)
        SetWindowPos(self.hwnd, wintypes.HWND(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW)
        if not self.round_corners:
            SetWindowRgn(self.hwnd, CreateRoundRectRgn(0, 0, w + 1, h + 1, self.px(16), self.px(16)), True)

        self.entries, self.rects = shown, []
        close = self.px(22)
        dragging = self.shelf.drag.entry if self.shelf.drag and self.shelf.drag.active else None
        for i, e in enumerate(shown):
            left = pad + i * (tile_w + gap)
            tile = (left, pad, left + tile_w, pad + tile_h)
            area = (left + inset, pad + inset, left + tile_w - inset, pad + tile_h - cap_h)
            close_rect = (tile[2] - close - self.px(4), tile[1] + self.px(4),
                          tile[2] - self.px(4), tile[1] + self.px(4) + close)
            self.rects.append((tile, close_rect))
            if dragging is not e:  # while dragged, the preview lives in the ghost window
                e.show_in(self.hwnd)
                e.place(area)
        if self.hover >= n:
            self.hover = -1
        InvalidateRect(self.hwnd, None, True)
        return overflow

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
            else:
                self.on_hover(*xy(lp))
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
            if not self.rects:
                return
            br = self.shelf.brushes
            FillRect(hdc, ctypes.byref(wintypes.RECT(0, 0, *self.size)), br["panel"])
            old_font = SelectObject(hdc, self.font)
            old_pen = SelectObject(hdc, GetStockObject(NULL_PEN))
            SetBkMode(hdc, TRANSPARENT)
            radius = self.px(12)
            dragging = self.shelf.drag.entry if self.shelf.drag and self.shelf.drag.active else None
            for i, (e, (tile, close)) in enumerate(zip(self.entries, self.rects)):
                hovered = i == self.hover and dragging is None
                lifted = e is dragging
                SelectObject(hdc, br["tile_drag" if lifted else "tile_hover" if hovered else "tile"])
                RoundRect(hdc, *tile, radius, radius)
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
                tr = wintypes.RECT(text_left, cap_top, r - self.px(10), b)
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


class Ghost:
    """The small preview that follows the pointer while you drag a thumbnail."""

    def __init__(self, shelf, entry, scale):
        self.shelf = shelf
        self.entry = entry
        self.hwnd = None
        self.w, self.h = int(176 * scale), int(118 * scale)
        create_window(self, WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT)
        pref = ctypes.c_int(DWMWCP_ROUND)
        DwmSetWindowAttribute(self.hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ctypes.byref(pref), ctypes.sizeof(pref))
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
            FillRect(hdc, ctypes.byref(wintypes.RECT(0, 0, self.w, self.h)), self.shelf.brushes["ghost"])
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
        self.shelf.layout()

    def drop(self, pt):
        self.finish()
        target = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
        if target and not same_monitor(target, self.entry.monitor):
            move_to_monitor(self.entry.hwnd, self.entry.monitor, target)
            self.entry.monitor = target
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
        self.hook = None
        self._hook_ref = None
        self.brushes = {}

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
        """Create the windows and pump messages until stop(). Blocks."""
        register_class()
        create_window(self, 0, parent=wintypes.HWND(HWND_MESSAGE))
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
        if self.drag:
            self.drag.finish()
            self.drag = None
        for e in self.entries:
            e.release()
        self.entries.clear()
        self.drop_panels()
        for b in self.brushes.values():
            DeleteObject(b)
        self.brushes.clear()
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
        if msg == WM_TIMER:
            self.tick()
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


def class_name(h):
    buf = ctypes.create_unicode_buffer(256)
    GetClassNameW(h, buf, 256)
    return buf.value


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
