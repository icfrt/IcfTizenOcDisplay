@echo off
setlocal

set PROJECT=%~dp0
set PROJECT=%PROJECT:~0,-1%

:: ── Arguments / prompts ─────────────────────────────────────────────────────
::
::   Usage: deploy.bat <user@host> <remote_path>
::   Example: deploy.bat root@myserver.com /var/www/tizen
::
::   If arguments are omitted you will be prompted.

set SCP_USER_HOST=%1
set SCP_REMOTE_PATH=%2

if "%SCP_USER_HOST%"=="" set /p SCP_USER_HOST=Server (user@host):
if "%SCP_REMOTE_PATH%"=="" set /p SCP_REMOTE_PATH=Remote path:

:: ── Bump version ────────────────────────────────────────────────────────────

echo [1/3] Bumping version...
for /f "delims=" %%v in ('python "%PROJECT%\bump_version.py"') do set VERSION=%%v
if errorlevel 1 (
    echo ERROR: version bump failed.
    exit /b 1
)
echo       New version: %VERSION%

:: ── Build ───────────────────────────────────────────────────────────────────

echo [2/3] Building...
call "%PROJECT%\build.bat"
if errorlevel 1 exit /b 1

:: ── Deploy via SCP ──────────────────────────────────────────────────────────

echo [3/3] Uploading to %SCP_USER_HOST%:%SCP_REMOTE_PATH% ...
scp "%PROJECT%\Debug\IcfTizenOcDisplay.wgt" "%PROJECT%\Debug\sssp_config.xml" "%SCP_USER_HOST%:%SCP_REMOTE_PATH%/"
if errorlevel 1 (
    echo ERROR: scp failed.
    exit /b 1
)

echo.
echo Done. Version %VERSION% deployed to %SCP_USER_HOST%:%SCP_REMOTE_PATH%
