@echo off
REM SPDX-License-Identifier: Apache-2.0
REM Configure + build the Stage 0 AOT bench with MSVC. Run from the repo root:
REM     bench\aot-stage0\build.bat
REM MSVC is installed here but not on PATH, so this calls vcvars itself
REM (see the cpp-harnesses-build-locally note).
setlocal
set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
    echo Could not find vcvars64.bat at "%VCVARS%"
    exit /b 1
)
call "%VCVARS%" >nul 2>&1 || exit /b 1

set "ROOT=%~dp0..\.."
pushd "%ROOT%" || exit /b 1

cmake -S bench/aot-stage0 -B build/cmake/aot-stage0 -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release || goto :fail
cmake --build build/cmake/aot-stage0 || goto :fail

popd
echo.
echo built: build\cmake\aot-stage0\bench_aot_stage0.exe
exit /b 0

:fail
popd
echo BUILD FAILED
exit /b 1
