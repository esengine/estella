# =============================================================================
# ESEngine Modular Build Configuration
# =============================================================================
#
# This file configures the modular WASM build using Emscripten's dynamic linking.
#
# Module Structure:
#   - esengine_core (MAIN_MODULE): Core engine, renderer, ECS, platform
#   - es_ui (SIDE_MODULE): UI system, widgets, docking
#   - es_font_sdf (SIDE_MODULE): SDF font rendering (requires FreeType)
#   - es_font_bitmap (SIDE_MODULE): Bitmap font rendering (lightweight)
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

# =============================================================================
# Core Module Sources (MAIN_MODULE)
# =============================================================================

set(ES_CORE_SOURCES
    src/esengine/core/Application.cpp
    src/esengine/core/Engine.cpp
    src/esengine/core/Log.cpp
    src/esengine/resource/ResourceManager.cpp
    src/esengine/renderer/RenderContext.cpp
    src/esengine/renderer/Renderer.cpp
    src/esengine/renderer/Shader.cpp
    src/esengine/renderer/Buffer.cpp
    src/esengine/renderer/Texture.cpp
    src/esengine/renderer/Framebuffer.cpp
    src/esengine/renderer/stb_image_impl.cpp
    src/esengine/platform/input/Input.cpp
    src/esengine/platform/PathResolver.cpp
    src/esengine/platform/web/WebPlatform.cpp
    src/esengine/platform/web/WebFileSystem.cpp
)

# =============================================================================
# UI Core Module Sources (SIDE_MODULE) - Base UI system
# =============================================================================

set(ES_UI_CORE_SOURCES
    src/esengine/ui/UIContext.cpp
    src/esengine/ui/rendering/UIBatchRenderer.cpp
    src/esengine/ui/layout/StackLayout.cpp
    src/esengine/ui/layout/WrapLayout.cpp
    src/esengine/ui/widgets/Widget.cpp
    src/esengine/ui/widgets/Panel.cpp
)

# =============================================================================
# UI Widgets Module Sources (SIDE_MODULE) - Common widgets
# =============================================================================

set(ES_UI_WIDGETS_SOURCES
    src/esengine/ui/widgets/Label.cpp
    src/esengine/ui/widgets/Button.cpp
    src/esengine/ui/widgets/ScrollView.cpp
    src/esengine/ui/widgets/TreeView.cpp
    src/esengine/ui/widgets/TextField.cpp
    src/esengine/ui/widgets/Checkbox.cpp
    src/esengine/ui/widgets/Slider.cpp
)

# =============================================================================
# UI Docking Module Sources (SIDE_MODULE) - Editor docking system
# =============================================================================

set(ES_UI_DOCKING_SOURCES
    src/esengine/ui/docking/DockNode.cpp
    src/esengine/ui/docking/DockPanel.cpp
    src/esengine/ui/docking/DockTabBar.cpp
    src/esengine/ui/docking/DockZone.cpp
    src/esengine/ui/docking/DockArea.cpp
    src/esengine/ui/docking/DockLayoutSerializer.cpp
)

# =============================================================================
# Font Module Sources (SIDE_MODULE)
# =============================================================================

set(ES_FONT_SDF_SOURCES
    src/esengine/ui/font/SDFFont.cpp
)

set(ES_FONT_BITMAP_SOURCES
    src/esengine/ui/font/BitmapFont.cpp
)

# =============================================================================
# Create Core Library (Static for linking)
# =============================================================================

add_library(esengine_core_lib STATIC ${ES_CORE_SOURCES})

target_include_directories(esengine_core_lib
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
)

target_link_libraries(esengine_core_lib PUBLIC glm)
target_compile_definitions(esengine_core_lib PUBLIC ES_PLATFORM_WEB ES_BUILD_MODULAR)

# =============================================================================
# Create UI Core Side Module
# =============================================================================

add_library(es_ui_core SHARED ${ES_UI_CORE_SOURCES})

target_include_directories(es_ui_core
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
)

target_link_libraries(es_ui_core PRIVATE glm)
target_compile_definitions(es_ui_core PUBLIC ES_PLATFORM_WEB ES_BUILD_MODULAR)

es_apply_side_module_settings(es_ui_core)

# =============================================================================
# Create UI Widgets Side Module
# =============================================================================

add_library(es_ui_widgets SHARED ${ES_UI_WIDGETS_SOURCES})

target_include_directories(es_ui_widgets
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
)

target_link_libraries(es_ui_widgets PRIVATE glm)
target_compile_definitions(es_ui_widgets PUBLIC ES_PLATFORM_WEB ES_BUILD_MODULAR)

es_apply_side_module_settings(es_ui_widgets)

# =============================================================================
# Create UI Docking Side Module (Editor only)
# =============================================================================

add_library(es_ui_docking SHARED ${ES_UI_DOCKING_SOURCES})

target_include_directories(es_ui_docking
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
)

target_link_libraries(es_ui_docking PRIVATE glm)
target_compile_definitions(es_ui_docking PUBLIC ES_PLATFORM_WEB ES_BUILD_MODULAR)

es_apply_side_module_settings(es_ui_docking)

# =============================================================================
# Create Font SDF Side Module (if enabled)
# =============================================================================

if(ES_FEATURE_SDF_FONT)
    add_library(es_font_sdf SHARED ${ES_FONT_SDF_SOURCES})

    target_include_directories(es_font_sdf
        PUBLIC
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
            ${CMAKE_SOURCE_DIR}/third_party/freetype/include
    )

    target_link_libraries(es_font_sdf PRIVATE glm freetype)
    target_compile_definitions(es_font_sdf PUBLIC ES_PLATFORM_WEB ES_BUILD_MODULAR ES_FEATURE_SDF_FONT=1)

    es_apply_side_module_settings(es_font_sdf)

    message(STATUS "  - es_font_sdf: ENABLED (SDF font with FreeType)")
endif()

# =============================================================================
# Create Font Bitmap Side Module (if enabled)
# =============================================================================

if(ES_FEATURE_BITMAP_FONT)
    add_library(es_font_bitmap SHARED ${ES_FONT_BITMAP_SOURCES})

    target_include_directories(es_font_bitmap
        PUBLIC
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
    )

    target_link_libraries(es_font_bitmap PRIVATE glm)
    target_compile_definitions(es_font_bitmap PUBLIC ES_PLATFORM_WEB ES_BUILD_MODULAR ES_FEATURE_BITMAP_FONT=1)

    es_apply_side_module_settings(es_font_bitmap)

    message(STATUS "  - es_font_bitmap: ENABLED (lightweight bitmap font)")
endif()

# =============================================================================
# Print Summary
# =============================================================================

message(STATUS "")
message(STATUS "Modular build targets:")
message(STATUS "  - esengine_core_lib: Core engine (static library)")
message(STATUS "  - es_ui_core: UI core (side module)")
message(STATUS "  - es_ui_widgets: UI widgets (side module)")
message(STATUS "  - es_ui_docking: UI docking - editor only (side module)")
if(ES_FEATURE_SDF_FONT)
    message(STATUS "  - es_font_sdf: SDF font (side module)")
endif()
if(ES_FEATURE_BITMAP_FONT)
    message(STATUS "  - es_font_bitmap: Bitmap font (side module)")
endif()
message(STATUS "")
