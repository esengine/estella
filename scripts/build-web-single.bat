@echo off
setlocal

cd /d "%~dp0\.."

set BUILD_DIR=build-web-single

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"
cd "%BUILD_DIR%"

call emcmake cmake .. -DES_BUILD_WEB=ON -DES_BUILD_TESTS=OFF -DES_BUILD_SINGLE_FILE=ON -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 goto :error

call emmake make esengine_single -j4
if errorlevel 1 goto :error

echo.
echo Single-file SDK built:
dir sdk\esengine.single.js

echo.
echo Bundling playable HTML...
node "%~dp0\..\tools\bundle-playable.js" --wasm sdk\esengine.single.js --game "%~dp0\..\sdk\examples\playground\build\playable\game.js" --output sdk\playable.html
if errorlevel 1 goto :error

echo.
echo Final output:
dir sdk\playable.html
goto :end

:error
echo Build failed!
pause
exit /b 1

:end
endlocal
pause
