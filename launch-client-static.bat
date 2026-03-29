@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "CLIENT_DIR=%ROOT_DIR%client"

if not exist "%CLIENT_DIR%\package.json" (
  echo [ERROR] client\package.json not found.
  echo Run this file from the project root.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not installed or not in PATH.
  echo Install Node.js LTS first: https://nodejs.org/
  exit /b 1
)

pushd "%CLIENT_DIR%"

if not exist "node_modules" (
  echo Installing client dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    popd
    exit /b 1
  )
)

echo Building static site...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  popd
  exit /b 1
)

if "%~1"=="--check" (
  echo [OK] Build completed successfully.
  popd
  exit /b 0
)

echo.
echo Starting static preview server...
echo Open the URL shown below in your browser.
echo Press Ctrl+C to stop.
call npm run preview -- --host --open

popd
endlocal
