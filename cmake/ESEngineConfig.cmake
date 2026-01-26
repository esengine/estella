# ESEngine Configuration Options
# This file contains common configuration settings for the ESEngine build

# Enable position independent code
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Output directories
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# Debug/Release configurations
set(CMAKE_DEBUG_POSTFIX "_d")

# Define ES_DEBUG in debug builds
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    add_compile_definitions(ES_DEBUG)
endif()

# Platform detection
if(WIN32)
    add_compile_definitions(ES_PLATFORM_WINDOWS)
elseif(APPLE)
    add_compile_definitions(ES_PLATFORM_MACOS)
elseif(UNIX)
    add_compile_definitions(ES_PLATFORM_LINUX)
endif()

# Native platform detection (for scripting support)
if(NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    add_compile_definitions(ES_PLATFORM_NATIVE)
endif()

# Scripting support (Native platform only)
if(NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    add_compile_definitions(ES_SCRIPTING_ENABLED)
endif()

# Export compile commands for IDE support
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# =============================================================================
# Strict Compiler Warnings
# =============================================================================

# Function to apply strict warnings to a target
function(esengine_set_strict_warnings target)
    if(MSVC)
        target_compile_options(${target} PRIVATE
            /W4           # Warning level 4
            /permissive-  # Strict conformance mode
            /w14242       # Conversion warnings
            /w14254       # Larger bitfield assigned
            /w14263       # Member function hides virtual
            /w14265       # Class has virtual but no virtual dtor
            /w14287       # Unsigned/negative constant mismatch
            /w14296       # Expression always false
            /w14311       # Pointer truncation
            /w14545       # Expression before comma is function
            /w14546       # Function call before comma missing args
            /w14547       # Operator before comma has no effect
            /w14549       # Operator before comma no effect
            /w14555       # Expression no effect, expected side-effect
            /w14619       # pragma warning invalid
            /w14640       # Thread unsafe static init
            /w14826       # Conversion signed/unsigned is extended
            /w14905       # Wide string literal cast to LPSTR
            /w14906       # String literal cast to LPWSTR
            /w14928       # Illegal copy-init
            /wd4996       # Disable deprecated warnings (we handle these ourselves)
        )
    else()
        target_compile_options(${target} PRIVATE
            -Wall
            -Wextra
            -Wpedantic
            -Wshadow
            -Wnon-virtual-dtor
            -Wold-style-cast
            -Wcast-align
            -Wunused
            -Woverloaded-virtual
            -Wconversion
            -Wsign-conversion
            -Wnull-dereference
            -Wdouble-promotion
            -Wformat=2
            -Wimplicit-fallthrough
            -Wno-deprecated-declarations  # We handle deprecated ourselves
        )
        if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
            target_compile_options(${target} PRIVATE
                -Wmisleading-indentation
                -Wduplicated-cond
                -Wduplicated-branches
                -Wlogical-op
                -Wuseless-cast
            )
        endif()
    endif()
endfunction()

# Message about current configuration
message(STATUS "ESEngine Configuration:")
message(STATUS "  Build Type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  Web Build: ${ES_BUILD_WEB}")
message(STATUS "  WxGame Build: ${ES_BUILD_WXGAME}")
message(STATUS "  Build Examples: ${ES_BUILD_EXAMPLES}")
message(STATUS "  Build Tests: ${ES_BUILD_TESTS}")
if(NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    message(STATUS "  Scripting Enabled: YES (QuickJS)")
else()
    message(STATUS "  Scripting Enabled: NO (Web platform)")
endif()
