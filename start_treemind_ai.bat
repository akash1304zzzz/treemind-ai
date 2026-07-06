@echo off
title TreeMind AI - Launcher
echo ==========================================
echo       TreeMind AI Launcher Service        
echo ==========================================
echo.

:: Get the directory of the batch file
set "PROJECT_DIR=%~dp0"

echo [1/2] Launching Backend Server in a new window...
start "TreeMind AI - Backend Server" cmd /c "cd /d \"%PROJECT_DIR%backend\" && echo Starting Node.js backend server... && node server.js"

echo [2/2] Launching Frontend Dev Server in a new window...
start "TreeMind AI - Frontend Dev Server" cmd /c "cd /d \"%PROJECT_DIR%frontend\" && echo Starting Vite dev server... && npm run dev"

echo.
echo ==========================================
echo TreeMind AI is running!
echo Local Web Dashboard: http://localhost:5173
echo Mobile App Server IP: http://192.168.1.142:5000
echo ==========================================
echo.
pause
