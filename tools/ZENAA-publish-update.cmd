@echo off
rem ZENAA - upload the latest changes to GitHub. Double-click me.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-update.ps1" %*
echo.
pause
