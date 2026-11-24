@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   DeepSeek Chat - 一键同步上游并发布前端热更新 (hotfix)
echo ========================================================
echo.
node scripts\sync-upstream.mjs --mode hotfix %*
echo.
pause
