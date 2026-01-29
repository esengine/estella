# ESEngine Editor Build Configuration

set(EDITOR_SOURCES
    main.cpp
    EditorApplication.cpp
    AssetDatabase.cpp
    ThumbnailGenerator.cpp
    DragDropManager.cpp

    # Project management
    project/ProjectSerializer.cpp
    project/RecentProjectsManager.cpp
    project/ProjectManager.cpp

    # Property editors
    property/PropertyEditor.cpp
    property/editors/FloatEditor.cpp
    property/editors/Vector3Editor.cpp
    property/editors/Vector2Editor.cpp
    property/editors/BoolEditor.cpp
    property/editors/IntEditor.cpp
    property/editors/StringEditor.cpp
    property/editors/ColorEditor.cpp
    property/editors/EnumEditor.cpp

    # Camera
    camera/EditorCamera.cpp

    # Gizmo
    gizmo/TransformGizmo.cpp

    # Panels
    panels/HierarchyPanel.cpp
    panels/InspectorPanel.cpp
    panels/SceneViewPanel.cpp
    panels/AssetBrowserPanel.cpp
    panels/AssetGridItem.cpp
    panels/ProjectLauncherPanel.cpp
    panels/NewProjectDialog.cpp
    panels/OutputLogPanel.cpp
    panels/GameViewPanel.cpp

    # Editor widgets
    widgets/StatusBar.cpp
    widgets/DrawerPanel.cpp
    widgets/EditorRootContainer.cpp
    widgets/EditorToolbar.cpp
    widgets/SceneToolbar.cpp
)

set(EDITOR_HEADERS
    EditorApplication.hpp
    AssetDatabase.hpp
    ThumbnailGenerator.hpp
    DragDropTypes.hpp
    DragDropManager.hpp

    # Core subsystem
    core/EditorEvents.hpp
    core/Selection.hpp

    # Project management
    project/ProjectTypes.hpp
    project/ProjectSerializer.hpp
    project/RecentProjectsManager.hpp
    project/ProjectManager.hpp

    # Command subsystem
    command/Command.hpp
    command/CommandHistory.hpp
    command/MacroCommand.hpp
    command/PropertyCommand.hpp
    command/EditorCommands.hpp

    # Property editors
    property/PropertyEditor.hpp
    property/editors/FloatEditor.hpp
    property/editors/Vector3Editor.hpp
    property/editors/Vector2Editor.hpp
    property/editors/BoolEditor.hpp
    property/editors/IntEditor.hpp
    property/editors/StringEditor.hpp
    property/editors/ColorEditor.hpp
    property/editors/EnumEditor.hpp

    # Camera
    camera/EditorCamera.hpp

    # Gizmo
    gizmo/TransformGizmo.hpp

    # Panels
    panels/HierarchyPanel.hpp
    panels/InspectorPanel.hpp
    panels/SceneViewPanel.hpp
    panels/AssetBrowserPanel.hpp
    panels/AssetBrowserTypes.hpp
    panels/AssetGridItem.hpp
    panels/ProjectLauncherPanel.hpp
    panels/NewProjectDialog.hpp
    panels/OutputLogPanel.hpp
    panels/GameViewPanel.hpp

    # Editor widgets
    widgets/StatusBar.hpp
    widgets/DrawerPanel.hpp
    widgets/EditorRootContainer.hpp
    widgets/EditorToolbar.hpp
    widgets/SceneToolbar.hpp
)

# Create editor executable
add_executable(esengine_editor ${EDITOR_SOURCES} ${EDITOR_HEADERS})

# Link against the engine library
target_link_libraries(esengine_editor PRIVATE esengine)

# Define ES_EDITOR macro for editor-specific code
target_compile_definitions(esengine_editor PRIVATE ES_EDITOR)

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
