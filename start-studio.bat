@echo off
chcp 65001 >nul
title NEKOMA STUDIO - Agent Office 3D
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  May chua cai Node.js. Mo PowerShell va chay:
  echo     winget install OpenJS.NodeJS.LTS
  echo  roi mo lai file nay.
  echo.
  pause
  exit /b 1
)
node office\server.mjs
pause
