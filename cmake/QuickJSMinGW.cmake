# =============================================================================
# QuickJS Build Configuration Helper
# =============================================================================
# QuickJS requires GCC/MinGW on Windows, cannot compile with MSVC

if(WIN32 AND MSVC)
    message(FATAL_ERROR "
========================================================================
QuickJS requires MinGW-w64 (GCC) on Windows, cannot use MSVC.

Please choose one of the following options:

Option 1 (Recommended): Use MinGW-w64 for the entire project
  1. Install MSYS2: https://www.msys2.org/
  2. In MSYS2 terminal: pacman -S mingw-w64-x86_64-gcc mingw-w64-x86_64-cmake
  3. Use MSYS2 MinGW terminal to build:
     cmake -B build -G \"MinGW Makefiles\"
     cmake --build build

Option 2: Use MSYS2 UCRT64 environment (Modern Windows API)
  1. Install MSYS2
  2. In MSYS2 terminal: pacman -S mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-cmake
  3. Use UCRT64 terminal to build

Option 3: Mixed toolchain (Advanced)
  Use ExternalProject to build QuickJS with MinGW separately
  (Not currently implemented)

For now, please rebuild using MinGW-w64 instead of MSVC.
========================================================================
")
endif()

# GCC/MinGW-specific settings for QuickJS
if(CMAKE_C_COMPILER_ID STREQUAL "GNU")
    message(STATUS "QuickJS: Using GCC/MinGW compiler")
endif()
