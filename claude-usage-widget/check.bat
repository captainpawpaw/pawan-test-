@echo off
rem Show your usage, or the exact error, in this window.
cd /d "%~dp0"
where py >nul 2>nul && (py claude_usage_widget.py --once & goto :done)
where python >nul 2>nul && (python claude_usage_widget.py --once & goto :done)
echo Python was not found on this PC.
echo Install it from https://www.python.org/downloads/windows/
echo and tick "Add python.exe to PATH" in the installer.
:done
echo.
pause
