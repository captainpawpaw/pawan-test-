# Pane Live Wallpaper

The animated Pane Desktop wallpapers, running as your real Windows desktop background, behind your desktop icons.

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
- **Start with Windows**
- **Quit**: puts your normal wallpaper back

Settings are saved in `%APPDATA%\PaneLiveWallpaper\config.json`.

## How it works

The wallpaper is a small web page (`wallpaper.html`) shown in an Edge WebView2 window. The app moves that window into the desktop's wallpaper layer, the window Explorer keeps between your wallpaper image and your icons. It uses the same technique as other live-wallpaper apps. Your icons, right-click menu and normal wallpaper settings keep working. Your saved wallpaper image is never changed.

## Limitations

- **Several monitors:** one wallpaper stretches across all of them.
- **If Explorer restarts** (after a crash, or after some updates), Windows removes the wallpaper layer and the app closes. Start it again from `run.bat` or the exe.
- The wallpaper layer is undocumented Windows behavior. Microsoft changed it in Windows 11 24H2, and the app handles both the old and new layouts. A future Windows update could change it again.
