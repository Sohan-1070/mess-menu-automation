@echo off
title Push MessMate to GitHub
echo ================================================================
echo           Push MessMate to GitHub (Sohan-1070)
echo ================================================================
echo.
echo Make sure you have created the empty repository on GitHub:
echo https://github.com/new?name=mess-menu-automation
echo.
echo Pushing local branch 'main' to origin...
git push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo ================================================================
    echo SUCCESS! Repository pushed to:
    echo https://github.com/Sohan-1070/mess-menu-automation
    echo ================================================================
) else (
    echo.
    echo If push failed, make sure the repository is created on github.com
    echo and you are signed in.
)

pause
