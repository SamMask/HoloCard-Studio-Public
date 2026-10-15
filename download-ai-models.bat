@echo off
setlocal
cd /d "%~dp0"
title Download AI models - HoloCard Studio

rem Double-click this file to download the studio's AI models (used for "Remove background" and "Split into layers"), about 275 MB, just once.
rem Only this file downloads anything; the studio itself never downloads on its own and never sends your images anywhere.
rem Same as the Chinese-named file in this folder (download AI models), with English messages.

echo ============================================
echo   HoloCard Studio: download AI models
echo ============================================
echo.
echo This downloads two AI models (about 275 MB, just once) for "Remove background" and "Split into layers".
echo The files are checked automatically after downloading.
echo If the studio is open, please close its window first.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 22 or newer: https://nodejs.org/
  echo After installing it, double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First time here: installing what the studio needs. This only happens once...
  call npm install
  if errorlevel 1 (
    echo Installing failed. Please copy the error message above and ask for help.
    pause
    exit /b 1
  )
  echo.
)

echo Starting the download. On a slow connection this can take a few minutes. Please keep this window open.
echo.
call npm run --silent fetch-models
if errorlevel 1 (
  echo.
  echo The download did not finish. Check your internet connection and double-click this file again ^(models already downloaded are skipped^).
  pause
  exit /b 1
)

echo.
echo Done! The AI models are ready.
echo Open the studio again ^(double-click main.bat^). When you upload an image without a transparent background, you can now use "Remove background".
echo.
pause
