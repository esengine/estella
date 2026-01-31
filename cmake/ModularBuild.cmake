# =============================================================================
# ESEngine Modular Build Configuration
# =============================================================================
#
# This file configures the modular WASM build using Emscripten's dynamic linking.
#
# Module Structure:
#   - es_core (SIDE_MODULE): Platform, Application, Log, Input
#   - es_ecs (SIDE_MODULE): ECS system (header-only, minimal cpp)
#   - es_renderer (SIDE_MODULE): Shader, Texture, Buffer, RenderPipeline
#   - es_resource (SIDE_MODULE): ResourceManager, Loaders
#   - es_ui_core (SIDE_MODULE): UIContext, Widget base, Layout, SystemFont
#   - es_ui_widgets (SIDE_MODULE): Button, Label, ScrollView, etc.
#   - es_ui_docking (SIDE_MODULE): Editor-only docking system
#
# Usage:
#   emcmake cmake -B build-modular -DES_BUILD_WEB=ON -DES_BUILD_MODULAR=ON
#   cmake --build build-modular
#

if(NOT ES_BUILD_MODULAR)
    return()
endif()

if(NOT ES_BUILD_WEB)
    message(FATAL_ERROR "ES_BUILD_MODULAR requires ES_BUILD_WEB=ON")
endif()

message(STATUS "")
message(STATUS "=== ESEngine Modular Build Configuration ===")
message(STATUS "")

# Common include directories for all modules
set(ES_COMMON_INCLUDES
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
)

# Common compile definitions
set(ES_COMMON_DEFINITIONS ES_PLATFORM_WEB ES_BUILD_MODULAR)

# =============================================================================
# es_core - Platform Core Module
# =============================================================================

set(ES_CORE_SOURCES
    src/esengine/core/Application.cpp
    src/esengine/core/Engine.cpp
    src/esengine/core/Log.cpp
    src/esengine/platform/input/Input.cpp
    src/esengine/platform/PathResolver.cpp
    src/esengine/platform/web/WebPlatform.cpp
    src/esengine/platform/web/WebFileSystem.cpp
)

add_library(es_core SHARED ${ES_CORE_SOURCES})
target_include_directories(es_core PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_core PRIVATE glm)
target_compile_definitions(es_core PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_core)

set_target_properties(es_core PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules"
)

# =============================================================================
# es_renderer - Rendering Module
# =============================================================================

set(ES_RENDERER_SOURCES
    src/esengine/renderer/RenderContext.cpp
    src/esengine/renderer/Renderer.cpp
    src/esengine/renderer/Shader.cpp
    src/esengine/renderer/Buffer.cpp
    src/esengine/renderer/Texture.cpp
    src/esengine/renderer/Framebuffer.cpp
    src/esengine/renderer/RenderPipeline.cpp
)

add_library(es_renderer SHARED ${ES_RENDERER_SOURCES})
target_include_directories(es_renderer PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_renderer PRIVATE glm)
target_compile_definitions(es_renderer PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_renderer)

set_target_properties(es_renderer PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules"
)

# =============================================================================
# es_resource - Resource Management Module
# =============================================================================

set(ES_RESOURCE_SOURCES
    src/esengine/resource/ResourceManager.cpp
    src/esengine/resource/ShaderParser.cpp
    src/esengine/resource/loaders/ShaderLoader.cpp
)

add_library(es_resource SHARED ${ES_RESOURCE_SOURCES})
target_include_directories(es_resource PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_resource PRIVATE glm)
target_compile_definitions(es_resource PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_resource)

set_target_properties(es_resource PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules"
)

# =============================================================================
# es_ui_core - UI Core Module (includes SystemFont)
# =============================================================================

set(ES_UI_CORE_SOURCES
    src/esengine/ui/UIContext.cpp
    src/esengine/ui/rendering/UIBatchRenderer.cpp
    src/esengine/ui/layout/StackLayout.cpp
    src/esengine/ui/layout/WrapLayout.cpp
    src/esengine/ui/widgets/Widget.cpp
    src/esengine/ui/widgets/Panel.cpp
    src/esengine/ui/font/SystemFont.cpp
    src/esengine/ui/text/TextMeasureHelper.cpp
)

add_library(es_ui_core SHARED ${ES_UI_CORE_SOURCES})
target_include_directories(es_ui_core PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_ui_core PRIVATE glm)
target_compile_definitions(es_ui_core PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_ui_core)

set_target_properties(es_ui_core PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules"
)

# =============================================================================
# es_ui_widgets - UI Widgets Module
# =============================================================================

set(ES_UI_WIDGETS_SOURCES
    src/esengine/ui/widgets/Label.cpp
    src/esengine/ui/widgets/Button.cpp
    src/esengine/ui/widgets/Checkbox.cpp
    src/esengine/ui/widgets/Slider.cpp
    src/esengine/ui/widgets/ClickablePanel.cpp
)

add_library(es_ui_widgets SHARED ${ES_UI_WIDGETS_SOURCES})
target_include_directories(es_ui_widgets PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_ui_widgets PRIVATE glm)
target_compile_definitions(es_ui_widgets PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_ui_widgets)

set_target_properties(es_ui_widgets PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules"
)

# =============================================================================
# es_scrollview
# =============================================================================

add_library(es_scrollview SHARED src/esengine/ui/widgets/ScrollView.cpp)
target_include_directories(es_scrollview PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_scrollview PRIVATE glm)
target_compile_definitions(es_scrollview PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_scrollview)
set_target_properties(es_scrollview PROPERTIES LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules")

# =============================================================================
# es_textfield
# =============================================================================

add_library(es_textfield SHARED src/esengine/ui/widgets/TextField.cpp)
target_include_directories(es_textfield PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_textfield PRIVATE glm)
target_compile_definitions(es_textfield PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_textfield)
set_target_properties(es_textfield PROPERTIES LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules")

# =============================================================================
# es_dropdown
# =============================================================================

add_library(es_dropdown SHARED src/esengine/ui/widgets/Dropdown.cpp)
target_include_directories(es_dropdown PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_dropdown PRIVATE glm)
target_compile_definitions(es_dropdown PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_dropdown)
set_target_properties(es_dropdown PROPERTIES LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules")

# =============================================================================
# es_treeview
# =============================================================================

add_library(es_treeview SHARED src/esengine/ui/widgets/TreeView.cpp)
target_include_directories(es_treeview PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_treeview PRIVATE glm)
target_compile_definitions(es_treeview PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_treeview)
set_target_properties(es_treeview PROPERTIES LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules")

# =============================================================================
# es_contextmenu
# =============================================================================

add_library(es_contextmenu SHARED src/esengine/ui/widgets/ContextMenu.cpp)
target_include_directories(es_contextmenu PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_contextmenu PRIVATE glm)
target_compile_definitions(es_contextmenu PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_contextmenu)
set_target_properties(es_contextmenu PROPERTIES LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules")

# =============================================================================
# es_ui_docking - UI Docking Module (Editor only)
# =============================================================================

set(ES_UI_DOCKING_SOURCES
    src/esengine/ui/docking/DockNode.cpp
    src/esengine/ui/docking/DockPanel.cpp
    src/esengine/ui/docking/DockTabBar.cpp
    src/esengine/ui/docking/DockZone.cpp
    src/esengine/ui/docking/DockArea.cpp
    src/esengine/ui/docking/DockLayoutSerializer.cpp
)

add_library(es_ui_docking SHARED ${ES_UI_DOCKING_SOURCES})
target_include_directories(es_ui_docking PUBLIC ${ES_COMMON_INCLUDES})
target_link_libraries(es_ui_docking PRIVATE glm)
target_compile_definitions(es_ui_docking PUBLIC ${ES_COMMON_DEFINITIONS})
es_apply_side_module_settings(es_ui_docking)

set_target_properties(es_ui_docking PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules"
)

# =============================================================================
# Optional Font Modules
# =============================================================================

if(ES_FEATURE_SDF_FONT)
    set(ES_FONT_SDF_SOURCES
        src/esengine/ui/font/SDFFont.cpp
        src/esengine/ui/font/MSDFFont.cpp
    )

    add_library(es_font_sdf SHARED ${ES_FONT_SDF_SOURCES})
    target_include_directories(es_font_sdf PUBLIC
        ${ES_COMMON_INCLUDES}
        ${CMAKE_SOURCE_DIR}/third_party/freetype/include
        ${CMAKE_SOURCE_DIR}/third_party/msdfgen
    )
    target_link_libraries(es_font_sdf PRIVATE glm freetype msdfgen-core msdfgen-ext)
    target_compile_definitions(es_font_sdf PUBLIC ${ES_COMMON_DEFINITIONS} ES_FEATURE_SDF_FONT=1)
    es_apply_side_module_settings(es_font_sdf)

    set_target_properties(es_font_sdf PROPERTIES
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules"
    )

    message(STATUS "  - es_font_sdf: ENABLED")
endif()

if(ES_FEATURE_BITMAP_FONT)
    add_library(es_font_bitmap SHARED src/esengine/ui/font/BitmapFont.cpp)
    target_include_directories(es_font_bitmap PUBLIC ${ES_COMMON_INCLUDES})
    target_link_libraries(es_font_bitmap PRIVATE glm)
    target_compile_definitions(es_font_bitmap PUBLIC ${ES_COMMON_DEFINITIONS} ES_FEATURE_BITMAP_FONT=1)
    es_apply_side_module_settings(es_font_bitmap)

    set_target_properties(es_font_bitmap PROPERTIES
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/modules"
    )

    message(STATUS "  - es_font_bitmap: ENABLED")
endif()

# =============================================================================
# Print Summary
# =============================================================================

message(STATUS "")
message(STATUS "Modular build targets (output: build-modular/modules/):")
message(STATUS "  Core:")
message(STATUS "    - es_core, es_renderer, es_resource")
message(STATUS "  UI:")
message(STATUS "    - es_ui_core, es_ui_widgets")
message(STATUS "    - es_scrollview, es_textfield, es_dropdown")
message(STATUS "    - es_treeview, es_contextmenu")
message(STATUS "  Editor:")
message(STATUS "    - es_ui_docking")
message(STATUS "")
