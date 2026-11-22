@echo off
rem ZENAA - put this folder on GitHub (first time). Double-click me.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0github-setup.ps1" %*
echo.
pause
