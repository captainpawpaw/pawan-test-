@echo off
rem Build a single PaneLiveWallpaper.exe in the dist folder.
cd /d "%~dp0"
py -m pip install --upgrade pyinstaller -r requirements.txt || goto :error
py -m PyInstaller --onefile --noconsole --name PaneLiveWallpaper --add-data "wallpaper.html;." pane_wallpaper.py || goto :error
echo.
echo Built dist\PaneLiveWallpaper.exe
goto :eof
:error
echo Build failed.
exit /b 1
