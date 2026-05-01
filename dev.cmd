@echo off
setlocal
cd /d "%~dp0"

REM Runs Tauri dev the reliable way on Windows, even when PowerShell blocks npm.ps1 shims.
REM This will start Vite on http://localhost:1420 and then launch the Tauri app.

call npm.cmd run tauri dev

