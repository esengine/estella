@echo off
setlocal

cd /d "%~dp0\.."

echo === Building Playable HTML ===
echo.

REM Step 1: Build SDK
echo [1/4] Building SDK...
cd sdk
call npm run build
if errorlevel 1 goto :error
cd ..

REM Step 2: Build Playground (IIFE format)
echo [2/4] Building Playground (IIFE)...
cd sdk\examples\playground
call npm run build:playable
if errorlevel 1 goto :error
cd ..\..\..

REM Step 3: Check if WASM SDK exists
echo [3/4] Checking WASM SDK...
if not exist "build-web-single\sdk\esengine.single.js" (
    echo.
    echo WARNING: Single-file WASM SDK not found!
    echo Please run: scripts\build-web-single.bat first
    echo.
    echo Or if you have a regular WASM build, you can manually run:
    echo   node tools/bundle-playable.js --wasm YOUR_WASM.js --game sdk/examples/playground/build/playable/game.js --output playable.html
    goto :end
)

REM Step 4: Bundle into single HTML
echo [4/4] Bundling into single HTML...
node tools\bundle-playable.js ^
    --wasm build-web-single\sdk\esengine.single.js ^
    --game sdk\examples\playground\build\playable\game.js ^
    --output playable.html

if errorlevel 1 goto :error

echo.
echo === Success! ===
echo Output: playable.html
goto :end

:error
echo.
echo === Build Failed ===
pause
exit /b 1

:end
endlocal
pause
