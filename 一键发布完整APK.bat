@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   DeepSeek Chat - 一键同步上游并发布完整 APK (full)
echo ========================================================
echo.
node scripts\sync-upstream.mjs --mode full --force %*
echo.
pause
