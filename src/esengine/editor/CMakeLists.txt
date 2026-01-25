# ESEngine Editor Build Configuration

set(EDITOR_SOURCES
    main.cpp
    EditorApplication.cpp
)

set(EDITOR_HEADERS
    EditorApplication.hpp
)

# Create editor executable
add_executable(esengine_editor ${EDITOR_SOURCES} ${EDITOR_HEADERS})

# Link against the engine library
target_link_libraries(esengine_editor PRIVATE esengine)

# Include directories
target_include_directories(esengine_editor PRIVATE
    ${CMAKE_SOURCE_DIR}/src
)

# Set output directory
set_target_properties(esengine_editor PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin
)

# Windows-specific settings
if(WIN32)
    # Use main instead of WinMain for console output during development
    set_target_properties(esengine_editor PROPERTIES
        WIN32_EXECUTABLE OFF
    )
endif()

# Copy assets or resources if needed (future)
# add_custom_command(TARGET esengine_editor POST_BUILD
#     COMMAND ${CMAKE_COMMAND} -E copy_directory
#         ${CMAKE_SOURCE_DIR}/assets
#         $<TARGET_FILE_DIR:esengine_editor>/assets
# )

message(STATUS "Editor target configured: esengine_editor")
