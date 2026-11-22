@echo off
rem Builds ZenaaStation.exe with the C# compiler that ships with Windows (.NET Framework 4.x).
rem Output: web\public\downloads\ZenaaStation.exe (served by ZENAA at /downloads/ZenaaStation.exe)
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo Could not find csc.exe — install/enable .NET Framework 4.8 in "Turn Windows features on or off".
  exit /b 1
)
set HERE=%~dp0
set OUT=%HERE%..\..\web\public\downloads
if not exist "%OUT%" mkdir "%OUT%"
"%CSC%" /nologo /target:winexe /optimize+ /platform:anycpu ^
  /win32icon:"%HERE%zenaa.ico" ^
  /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll ^
  /out:"%OUT%\ZenaaStation.exe" "%HERE%ZenaaStation.cs"
if errorlevel 1 exit /b 1
echo Built %OUT%\ZenaaStation.exe
