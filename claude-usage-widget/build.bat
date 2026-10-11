@echo off
rem Build a single ClaudeUsageWidget.exe in the dist folder.
cd /d "%~dp0"
py -m pip install --upgrade pyinstaller || goto :error
py -m PyInstaller --onefile --noconsole --name ClaudeUsageWidget claude_usage_widget.py || goto :error
echo.
echo Built dist\ClaudeUsageWidget.exe
goto :eof
:error
echo Build failed.
exit /b 1
