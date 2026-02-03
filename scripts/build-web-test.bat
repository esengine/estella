@echo off
setlocal

cd /d "%~dp0\.."

set BUILD_DIR=build-web
set TEST_DIR=sdk\examples\playground\build

cd "%BUILD_DIR%"

call emmake make -j4
if errorlevel 1 goto :error

cd ..
copy /Y "%BUILD_DIR%\sdk\esengine.js" "%TEST_DIR%\"
copy /Y "%BUILD_DIR%\sdk\esengine.wasm" "%TEST_DIR%\"

echo.
echo Build and copy complete!
goto :end

:error
echo Build failed!
pause
exit /b 1

:end
pause
