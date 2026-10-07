@echo off
rem MOMOSAI VJ bridge (smartphone remote / OSC / Art-Net) for the browser version.
rem Needs Node.js 18+ (https://nodejs.org/). The desktop app (app/) has the bridge built in.
setlocal
set "HERE=%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found.
  echo  Install Node.js LTS from https://nodejs.org/ and run this file again,
  echo  or use the desktop app version which includes the bridge.
  echo.
  pause
  exit /b 1
)
node "%HERE%bridge\server.mjs" %*
pause
endlocal
