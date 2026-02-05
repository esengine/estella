@echo off
setlocal

cd /d "%~dp0\.."

set BUILD_DIR=build-wxgame
set OUTPUT_DIR=desktop\public\wasm

echo === Building ESEngine for WeChat MiniGame ===

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"
cd "%BUILD_DIR%"

echo Configuring...
call emcmake cmake .. -DES_BUILD_WXGAME=ON -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 goto :error

echo Building...
call cmake --build . --target esengine_wxgame -j4
if errorlevel 1 goto :error

echo.
echo Copying to %OUTPUT_DIR%...
if not exist "..\%OUTPUT_DIR%" mkdir "..\%OUTPUT_DIR%"
copy /Y sdk\esengine.wxgame.js "..\%OUTPUT_DIR%\"
copy /Y sdk\esengine.wxgame.wasm "..\%OUTPUT_DIR%\"

echo.
echo === Build complete ===
echo Output files:
echo   - %OUTPUT_DIR%\esengine.wxgame.js
echo   - %OUTPUT_DIR%\esengine.wxgame.wasm
goto :end

:error
echo Build failed!
pause
exit /b 1

:end
endlocal
pause
