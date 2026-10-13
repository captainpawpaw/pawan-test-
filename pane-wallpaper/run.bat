@echo off
rem Launch the live wallpaper without a console window. Installs what it needs the first time.
cd /d "%~dp0"
py -c "import webview, pystray, PIL" 2>nul || py -m pip install -r requirements.txt || goto :error
start "" pyw "%~dp0pane_wallpaper.py"
goto :eof
:error
echo Could not install the required packages.
pause
exit /b 1
