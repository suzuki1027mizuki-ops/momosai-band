@echo off
rem MOMOSAI VJ launcher for Windows.
rem Opens momosai-vj.html in Chrome (or Edge) as an app window with a dedicated profile,
rem with background throttling disabled so the visuals never slow down.
setlocal EnableDelayedExpansion

set "HERE=%~dp0"
set "PAGE=%HERE%momosai-vj.html"
set "PROFILE=%HERE%.vj-profile"

set "BROWSER="
for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
  if not defined BROWSER if exist %%P set "BROWSER=%%~P"
)

if not defined BROWSER (
  echo.
  echo  Chrome / Edge was not found.
  echo  Please drag and drop momosai-vj.html onto a Chrome window.
  echo.
  pause
  exit /b 1
)

if not exist "%PAGE%" (
  echo.
  echo  momosai-vj.html was not found next to this file.
  echo  Please keep all files in the same folder.
  echo.
  pause
  exit /b 1
)

set "URL=!PAGE:\=/!"
set "URL=!URL: =%%20!"
set "URL=file:///!URL!"

start "" "%BROWSER%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion,Translate --autoplay-policy=no-user-gesture-required --app="!URL!"

endlocal
exit /b 0
