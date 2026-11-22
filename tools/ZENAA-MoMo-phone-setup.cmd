@echo off
rem Double-click: installs the ZENAA MoMo app on the MoMo phone (USB cable or Wi-Fi) with SMS already allowed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0momo-phone-setup.ps1"
