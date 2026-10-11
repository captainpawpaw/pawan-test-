@echo off
rem Launch the widget without a console window.
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw "%~dp0claude_usage_widget.py" & goto :eof)
where pythonw >nul 2>nul && (start "" pythonw "%~dp0claude_usage_widget.py" & goto :eof)
echo Python was not found on this PC.
echo.
echo Install it from https://www.python.org/downloads/windows/
echo and tick "Add python.exe to PATH" in the installer, then run this again.
echo.
pause
