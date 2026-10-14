@echo off
rem Build a single FloatingNotes.exe in the dist folder.
cd /d "%~dp0"
py -m pip install --upgrade pyinstaller || goto :error
py -m PyInstaller --onefile --noconsole --name FloatingNotes floating_notes.py || goto :error
echo.
echo Built dist\FloatingNotes.exe
goto :eof
:error
echo Build failed.
exit /b 1
