@echo off
color 0A
title Push Updates to GitHub - MessMate
echo =================================================================
echo             PUSHING ALL UPDATES TO GITHUB
echo =================================================================
echo.
cd /d "%~dp0"

echo [1/3] Staging all files...
git add .

echo [2/3] Checking for uncommitted changes...
git commit -m "Update MessMate features and fixes" >nul 2>&1

echo [3/3] Pushing to GitHub (https://github.com/Sohan-1070/mess-menu-automation)...
echo.
git push origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo =================================================================
    echo  [SUCCESS] All updates pushed to GitHub!
    echo  Render will now automatically redeploy your live website.
    echo =================================================================
) else (
    echo.
    color 0C
    echo =================================================================
    echo  [ERROR] Push failed. Please check your internet connection or
    echo  sign in to GitHub if prompted.
    echo =================================================================
)

echo.
echo Press any key to exit.
pause >nul
