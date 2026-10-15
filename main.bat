@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 立體卡牌工坊

rem 雙擊這個檔案就能開工坊。只在這台電腦上執行（127.0.0.1），圖片不會上傳到任何地方。
rem 測試用：先 set NO_BROWSER=1 再執行，就不會自動打開瀏覽器。

set "URL=http://127.0.0.1:5190/"

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js。請先安裝 Node.js 22 以上版本：https://nodejs.org/
  pause
  exit /b 1
)

curl -s -f -o nul "%URL%" >nul 2>nul
if not errorlevel 1 (
  echo 立體卡牌工坊已經在執行，直接打開瀏覽器。
  if not "%NO_BROWSER%"=="1" start "" "%URL%"
  exit /b 0
)

if not exist "node_modules\" (
  echo 第一次執行，正在安裝需要的套件，只需要一次……
  call npm install
  if errorlevel 1 (
    echo 安裝失敗。請把上面的錯誤訊息貼給 Claude。
    pause
    exit /b 1
  )
)

echo 正在啟動立體卡牌工坊，準備好會自動打開瀏覽器。
echo 要結束，關掉這個視窗就可以。
echo.
if not "%NO_BROWSER%"=="1" start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%' | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Milliseconds 500 } }"
call npm run dev
echo.
echo 立體卡牌工坊已停止。
pause
