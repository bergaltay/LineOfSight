@echo off
rem Lunar Landing Site Navigator: serve the app locally and open it in the browser.
rem Usage: double-click, or "start.bat [port]" (default port 8000). Close this window to stop.
rem Needs only Python 3. All data the app uses is already in web\data\.
cd /d "%~dp0"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8000"
set "URL=http://localhost:%PORT%/web/"
set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  echo Python 3 is needed to serve the app: https://www.python.org/downloads/
  echo Any static web server works too; serve this folder and open /web/.
  pause
  exit /b 1
)
echo Lunar Landing Site Navigator: %URL%
echo Close this window to stop. If the port is busy, run: start.bat 8080
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start %URL%"
%PY% -m http.server %PORT% --bind 127.0.0.1
pause
