@echo off
setlocal

if "%TIZEN_TOOLS_PATH%"=="" (
    echo ERROR: TIZEN_TOOLS_PATH environment variable is not set.
    exit /b 1
)
set TZ=%TIZEN_TOOLS_PATH%\tizen-core\tz.exe
set PROJECT=%~dp0
set PROJECT=%PROJECT:~0,-1%
set OUTPUT=%PROJECT%\Debug\IcfTizenOcDisplay.wgt

:: ── Preflight checks ────────────────────────────────────────────────────────

if not exist "%PROJECT%\config.js" (
    echo WARNING: config.js not found. The WGT will be built without credentials.
    echo          Copy config.template.js to config.js and fill in your credentials.
    echo.
)

:: ── Build + package ─────────────────────────────────────────────────────────

echo [1/2] Building...
"%TZ%" build -w "%PROJECT%"
if errorlevel 1 (
    echo ERROR: build failed.
    exit /b 1
)

:: ── SSSP config ─────────────────────────────────────────────────────────────

echo [2/2] Generating sssp_config.xml...
python "%PROJECT%\generate_sssp.py" "%OUTPUT%"
if errorlevel 1 (
    echo ERROR: generate_sssp.py failed.
    exit /b 1
)

echo.
echo Done. Output: %OUTPUT%
