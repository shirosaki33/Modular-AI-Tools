@echo off
title Modular AI Tools - Localhost
color 0A
cd /d "%~dp0"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py"
if not defined PY (
    echo Python not found. Install it from https://www.python.org and check "Add to PATH".
    pause
    exit /b 1
)

echo ========================================================
echo   Modular AI Tools - Localhost Server
echo ========================================================
echo.
%PY% server_max.py   %*
pause