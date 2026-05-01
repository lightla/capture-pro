@echo off
setlocal
cd /d "%~dp0\\src-tauri"

REM Runs the app using the built `dist/` files (no Vite dev server required).
cargo run --release

