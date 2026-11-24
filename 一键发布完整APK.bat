@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\sync-upstream.mjs --mode full --force %*
echo.
pause
