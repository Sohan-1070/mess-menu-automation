@echo off
title MessMate - WhatsApp Mess Menu Automation
echo ================================================================
echo           MessMate - WhatsApp Mess Menu Automation
echo ================================================================
echo Starting local automation server...
echo.

if not exist "node_modules" (
    echo Installing dependencies, please wait...
    call npm install
)

echo Starting server on http://localhost:3000 ...
start "" "http://localhost:3000"
node server.js
pause
