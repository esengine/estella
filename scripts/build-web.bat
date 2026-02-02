@echo off
setlocal

cd /d "%~dp0.."

if not exist build-web (
    echo Creating build-web directory...
    mkdir build-web
    cd build-web
    call emcmake cmake .. -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release -DES_BUILD_WEB=ON
) else (
    cd build-web
)

echo Building Web SDK...
call emmake mingw32-make esengine_sdk -j%NUMBER_OF_PROCESSORS%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [OK] Web SDK built successfully!
    echo Output: build-web/sdk/
) else (
    echo.
    echo [ERROR] Build failed!
)

pause
