@echo off
setlocal
cd /d "%~dp0"

set ESBUILD_EXE=%CD%\node_modules\.pnpm\@esbuild+win32-x64@0.27.7\node_modules\@esbuild\win32-x64\esbuild.exe

if not exist "%ESBUILD_EXE%" (
  echo [build-frontend] ERROR: esbuild.exe not found at:
  echo   %ESBUILD_EXE%
  exit /b 1
)

if not exist "dist" mkdir dist
if exist "dist\assets" rmdir /s /q "dist\assets"
mkdir "dist\assets"

echo [build-frontend] Bundling with esbuild...
"%ESBUILD_EXE%" "src\main.tsx" ^
  --bundle ^
  --format=esm ^
  --platform=browser ^
  --target=es2020 ^
  --jsx=automatic ^
  --outfile="dist\assets\app.js" ^
  --asset-names="assets/[name]-[hash]" ^
  --loader:.svg=file ^
  --loader:.png=file ^
  --loader:.jpg=file ^
  --loader:.jpeg=file ^
  --loader:.webp=file ^
  --loader:.gif=file ^
  --minify ^
  --define:process.env.NODE_ENV=\"production\" ^
  --log-level=info

if errorlevel 1 exit /b 1

echo [build-frontend] Writing dist\index.html...
(
  echo ^<!doctype html^>
  echo ^<html lang="en"^>
  echo   ^<head^>
  echo     ^<meta charset="UTF-8" /^>
  echo     ^<meta name="viewport" content="width=device-width, initial-scale=1.0" /^>
  echo     ^<title^>Capture Pro^</title^>
  echo     ^<link rel="stylesheet" href="/assets/app.css" /^>
  echo   ^</head^>
  echo   ^<body^>
  echo     ^<div id="root"^>^</div^>
  echo     ^<script type="module" src="/assets/app.js"^>^</script^>
  echo   ^</body^>
  echo ^</html^>
) > "dist\\index.html"

echo [build-frontend] Done.
