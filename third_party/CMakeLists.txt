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
    # Use PRIVATE to avoid exposing quickjs internal files (like 'version' text file)
    # which could be mistakenly included as headers by the compiler
    target_include_directories(quickjs PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/quickjs
    )

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
endif()
