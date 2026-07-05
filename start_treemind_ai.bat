@echo off
title TreeMind AI - Launcher
echo ==========================================
echo       TreeMind AI Launcher Service        
echo ==========================================
echo.

:: Get the directory of the batch file
set "PROJECT_DIR=%~dp0"

echo [1/3] Launching Backend Server in a new window...
start "TreeMind AI - Backend Server" cmd /c "cd /d \"%PROJECT_DIR%backend\" && echo Starting Node.js backend server... && node server.js"

echo [2/3] Launching Frontend Dev Server in a new window...
start "TreeMind AI - Frontend Dev Server" cmd /c "cd /d \"%PROJECT_DIR%frontend\" && echo Starting Vite dev server... && npm run dev"

echo [3/3] Launching Public Tunnel in this window...
echo.
echo Tunnel URL: https://treemind-vault-beta-pkm.loca.lt
echo Bypass Password: Your public IP address
echo.

:loop
echo [%time%] Connecting to localtunnel...
call npx -y localtunnel --port 5000 --subdomain treemind-vault-beta-pkm
echo [%time%] Tunnel disconnected. Reconnecting in 5 seconds...
ping -n 6 127.0.0.1 > nul
goto loop
