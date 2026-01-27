# Third-party libraries for ESEngine

# =============================================================================
# GLM - OpenGL Mathematics Library (Header-only)
# =============================================================================
add_library(glm INTERFACE)
target_include_directories(glm INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/glm)

# Define GLM options
target_compile_definitions(glm INTERFACE
    GLM_FORCE_RADIANS
    GLM_FORCE_DEPTH_ZERO_TO_ONE
    GLM_ENABLE_EXPERIMENTAL
)

# =============================================================================
# Native Platform Dependencies (GLFW, GLAD)
# =============================================================================
if(NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    # GLFW - Window and input library
    set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
    set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
    add_subdirectory(glfw)

    # GLAD - OpenGL function loader
    add_library(glad STATIC
        ${CMAKE_CURRENT_SOURCE_DIR}/glad/src/glad.c
    )
    target_include_directories(glad PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/glad/include
    )

    # =============================================================================
    # QuickJS - JavaScript Engine (Native Platform Only)
    # =============================================================================
    # QuickJS uses Unix APIs and requires MinGW on Windows (not MSVC)

    # Check compiler compatibility
    include(${CMAKE_SOURCE_DIR}/cmake/QuickJSMinGW.cmake)

    set(QUICKJS_SOURCES
        ${CMAKE_CURRENT_SOURCE_DIR}/quickjs/quickjs.c
        ${CMAKE_CURRENT_SOURCE_DIR}/quickjs/libregexp.c
        ${CMAKE_CURRENT_SOURCE_DIR}/quickjs/libunicode.c
        ${CMAKE_CURRENT_SOURCE_DIR}/quickjs/cutils.c
        ${CMAKE_CURRENT_SOURCE_DIR}/quickjs/quickjs-libc.c
    )

    add_library(quickjs STATIC ${QUICKJS_SOURCES})

    # QuickJS internal include (PRIVATE - contains VERSION file and internal headers)
    target_include_directories(quickjs PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/quickjs
    )

    # Create a clean include directory with only public headers
    # This avoids exposing internal files like VERSION to consumers
    set(QUICKJS_PUBLIC_INCLUDE_DIR "${CMAKE_BINARY_DIR}/quickjs_headers")
    file(MAKE_DIRECTORY "${QUICKJS_PUBLIC_INCLUDE_DIR}")

    # Copy only the public header files (exclude VERSION and internal files)
    configure_file(
        "${CMAKE_CURRENT_SOURCE_DIR}/quickjs/quickjs.h"
        "${QUICKJS_PUBLIC_INCLUDE_DIR}/quickjs.h"
        COPYONLY
    )
    configure_file(
        "${CMAKE_CURRENT_SOURCE_DIR}/quickjs/quickjs-libc.h"
        "${QUICKJS_PUBLIC_INCLUDE_DIR}/quickjs-libc.h"
        COPYONLY
    )

    # Export the clean include directory for consumers
    set(QUICKJS_INCLUDE_DIR "${QUICKJS_PUBLIC_INCLUDE_DIR}" PARENT_SCOPE)

    # QuickJS specific settings
    if(WIN32)
        # On Windows, QuickJS requires MinGW (GCC), not MSVC
        # CMake will automatically use MinGW if available
        target_compile_definitions(quickjs PRIVATE
            _GNU_SOURCE
            CONFIG_VERSION="2025-09-13"
        )
    else()
        target_compile_definitions(quickjs PRIVATE
            _GNU_SOURCE
            CONFIG_VERSION="2025-09-13"
        )
    endif()

    target_compile_definitions(quickjs PUBLIC ES_SCRIPTING_ENABLED)

    # =============================================================================
    # FreeType - Font rendering library
    # =============================================================================
    set(FT_DISABLE_ZLIB ON CACHE BOOL "" FORCE)
    set(FT_DISABLE_BZIP2 ON CACHE BOOL "" FORCE)
    set(FT_DISABLE_PNG ON CACHE BOOL "" FORCE)
    set(FT_DISABLE_HARFBUZZ ON CACHE BOOL "" FORCE)
    set(FT_DISABLE_BROTLI ON CACHE BOOL "" FORCE)
    add_subdirectory(freetype)
endif()
