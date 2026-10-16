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

rem Keep the profile small. The profile stays in this folder on purpose (copying the folder also copies
rem the settings and the saved media), so stop Chrome from filling it with parts this app never uses:
rem extension packages, on-device models, a speech engine... about 200 MB in total.
set "SLIM=--disable-extensions --disable-component-update --disable-default-apps --disk-cache-size=33554432 --media-cache-size=33554432"
rem OptimizationHints is the one that stops the on-device model downloads (40 MB, measured with Chrome 154).
set "OFF=CalculateNativeWinOcclusion,Translate,OptimizationHints,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationGuideModelDownloading"

rem Parts that older versions of this launcher let Chrome download: remove them (Chrome recreates what it needs).
rem Skipped while a VJ window is still open on this profile (Chrome keeps "lockfile" there while it runs).
if exist "!PROFILE!\" if not exist "!PROFILE!\lockfile" for %%D in ("component_crx_cache" "extensions_crx_cache" "optimization_guide_model_store" "OptimizationGuideModelsManifest" "OnDeviceHeadSuggestModel" "WasmTtsEngine" "Default\Extensions") do if exist "!PROFILE!\%%~D\" rmdir /s /q "!PROFILE!\%%~D" 2>nul

rem Chrome ignores --app and opens a new tab when the URL has raw non-ASCII characters
rem (e.g. a Japanese folder name such as the Desktop under OneDrive), so percent-encode the path.
set "URL="
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "([Uri]$env:PAGE).AbsoluteUri" 2^>nul`) do set "URL=%%U"
if not defined URL (
  set "URL=!PAGE:\=/!"
  set "URL=!URL: =%%20!"
  set "URL=file:///!URL!"
)

rem "start-windows.bat --print" shows what would run, without starting (for checking the launcher itself).
if /i "%~1"=="--print" (
  echo BROWSER=!BROWSER!
  echo PROFILE=!PROFILE!
  echo URL=!URL!
  echo FLAGS=%SLIM% --disable-features=%OFF%
  endlocal
  exit /b 0
)

start "" "%BROWSER%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows %SLIM% --disable-features=%OFF% --autoplay-policy=no-user-gesture-required --app="!URL!"

endlocal
exit /b 0
