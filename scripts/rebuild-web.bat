@echo off
setlocal

cd /d "%~dp0.."

echo === Running EHT ===
python tools/eht.py --verbose
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] EHT failed!
    pause
    exit /b 1
)

echo.
echo === Building Web SDK ===
cd build-web
call emmake mingw32-make esengine_sdk -j%NUMBER_OF_PROCESSORS%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [OK] Build complete!
) else (
    echo.
    echo [ERROR] Build failed!
)

pause
