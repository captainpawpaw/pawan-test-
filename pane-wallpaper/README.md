# Pane Live Wallpaper

The animated Pane Desktop wallpapers, running as your real Windows desktop background, behind your desktop icons. It also adds a **thumbnail shelf**: when you minimize a window, a live preview of it appears above the taskbar, and clicking the preview brings the window back.

There are four wallpapers:

- **Aurora**: drifting color glows with light curtains
- **Bloom**: a slowly turning flower of light
- **Starfield**: flying through stars and nebula
- **Tide**: layered waves under a low sun

All four are tinted by the accent color you pick.

## Run it

You need [Python 3.10+ for Windows](https://www.python.org/downloads/windows/) and the Microsoft Edge WebView2 Runtime. WebView2 comes with Windows 11 and up-to-date Windows 10. If it's missing, install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).

- Double-click **`run.bat`**. The first time, it installs the three packages the app needs (`pywebview`, `pystray`, `Pillow`).
- Or run `py -m pip install -r requirements.txt`, then `pyw pane_wallpaper.py`.

To build a standalone **`PaneLiveWallpaper.exe`** you can pin or share, double-click **`build.bat`**. The exe ends up in `dist\` and doesn't need Python installed.

## Using it

The app has no window. It lives in the **system tray**: click the **^** arrow at the right end of the taskbar if you don't see the four-squares icon. Right-click (or click) the icon for:

- **Wallpaper**: Aurora, Bloom, Starfield or Tide
- **Accent color**: blue, violet, pink, orange, green or teal
- **Frame rate**: 15, 30 (default) or 60 fps. Lower uses less power.
- **Pause**: freezes the current frame
- **Pause while an app is maximized or full screen**: on by default, so games and videos don't share the GPU with your wallpaper
- **Thumbnail shelf for minimized windows**: on by default (see below)
- **Swap from the shelf**: when you bring a window back from the shelf, the window you were using goes onto the shelf in its place
- **Start with Windows**
- **Quit**: puts your normal wallpaper back

## Thumbnail shelf

Minimize any window (the – button, the taskbar, or Win+Down) and a live preview of it appears in a shelf centered above the taskbar. Windows still plays its usual minimize animation, and the window keeps its taskbar button too.

- **Click a preview** to bring that window back.
- **Hover a preview** and click its **✕**, or **middle-click** it, to close that window.
- Windows that were already minimized when the app started show up on the shelf straight away.
- The shelf hides while a game or video is full screen.
- If an app doesn't give Windows a preview while it's minimized, its tile shows the app's icon instead.

The shelf sits on top of other windows, so it can cover the bottom of a tall window while something is minimized. Turn it off from the tray menu any time. To try the shelf without the wallpaper, run `pyw pane_shelf.py`; it has no tray icon then, so end it from Task Manager.

Settings are saved in `%APPDATA%\PaneLiveWallpaper\config.json`.

## How it works

The wallpaper is a small web page (`wallpaper.html`) shown in an Edge WebView2 window. The app moves that window into the desktop's wallpaper layer, the window Explorer keeps between your wallpaper image and your icons. It uses the same technique as other live-wallpaper apps. Your icons, right-click menu and normal wallpaper settings keep working. Your saved wallpaper image is never changed.

## Limitations

- **Several monitors:** one wallpaper stretches across all of them, and the shelf appears on the main monitor. If more windows are minimized than fit across the screen, the shelf shows the most recent ones.
- **If Explorer restarts** (after a crash, or after some updates), Windows removes the wallpaper layer and the app closes. Start it again from `run.bat` or the exe.
- The wallpaper layer is undocumented Windows behavior. Microsoft changed it in Windows 11 24H2, and the app handles both the old and new layouts. A future Windows update could change it again.
