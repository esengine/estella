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

# Export compile commands for IDE support
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Message about current configuration
message(STATUS "ESEngine Configuration:")
message(STATUS "  Build Type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  Web Build: ${ES_BUILD_WEB}")
message(STATUS "  WxGame Build: ${ES_BUILD_WXGAME}")
message(STATUS "  Build Examples: ${ES_BUILD_EXAMPLES}")
message(STATUS "  Build Tests: ${ES_BUILD_TESTS}")
