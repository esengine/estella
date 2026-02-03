@echo off
setlocal

cd /d "%~dp0\.."

set BUILD_DIR=build-web

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"
cd "%BUILD_DIR%"

call emcmake cmake .. -DES_BUILD_WEB=ON -DES_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 goto :error

call emmake make -j4
if errorlevel 1 goto :error

echo.
echo Build complete: %BUILD_DIR%\sdk\
dir sdk\
goto :end

:error
echo Build failed!
pause
exit /b 1

:end
endlocal
pause
