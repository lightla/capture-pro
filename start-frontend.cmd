@echo off
setlocal
cd /d "%~dp0"

REM Starts the Vite dev server on http://localhost:1420
call npm.cmd run dev

