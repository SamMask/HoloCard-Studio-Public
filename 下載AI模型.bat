@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 下載 AI 模型 - 立體卡牌工坊

rem 雙擊這個檔案就會下載工坊的 AI 模型（自動去背、拆成立體層用），約 275 MB，只要一次。
rem 只有這個檔案會連網路下載；工坊本身執行時不會自動下載，也不會把圖片傳出去。

echo ============================================
echo   立體卡牌工坊：下載 AI 模型
echo ============================================
echo.
echo 會下載兩個 AI 模型（約 275 MB，只要一次），用在「自動去背」和「拆成立體層」。
echo 下載完會自動檢查檔案是不是完整、正確。
echo 如果工坊開著，請先關掉工坊的視窗再下載。
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js。請先安裝 Node.js 22 以上版本：https://nodejs.org/
  echo 裝好之後，再雙擊這個檔案一次。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 第一次使用，先安裝需要的套件，只需要一次……
  call npm install
  if errorlevel 1 (
    echo 套件安裝失敗。請把上面的錯誤訊息貼給 Claude。
    pause
    exit /b 1
  )
  echo.
)

echo 開始下載。網路慢的話要等幾分鐘，請不要關掉這個視窗。
echo.
call npm run --silent fetch-models
if errorlevel 1 (
  echo.
  echo 沒有下載完成。請確認網路正常，再雙擊這個檔案一次（已經下載好的模型會跳過）。
  pause
  exit /b 1
)

echo.
echo 好了！AI 模型已經下載好。
echo 重新打開工坊（雙擊 main.bat），上傳沒有透明背景的圖時就能按〔自動去背〕。
echo.
pause
