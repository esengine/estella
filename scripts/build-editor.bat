@echo off
setlocal

cd /d "%~dp0.."

if not exist build (
    echo Creating build directory...
    mkdir build
    cd build
    cmake .. -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Debug
) else (
    cd build
)

echo Building Editor...
mingw32-make esengine_editor -j%NUMBER_OF_PROCESSORS%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [OK] Editor built successfully!
    echo Run: bin\esengine_editor.exe
) else (
    echo.
    echo [ERROR] Build failed!
)

pause
