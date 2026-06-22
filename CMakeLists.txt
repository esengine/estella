cmake_minimum_required(VERSION 3.16)
project(ESEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ES_BUILD_WEB "Build for Web/Emscripten" OFF)
option(ES_BUILD_WXGAME "Build for WeChat MiniGame" OFF)
option(ES_BUILD_TESTS "Build tests" ON)
option(ES_BUILD_SINGLE_FILE "Build single-file SDK (WASM inlined)" OFF)
option(ES_ENABLE_SPINE "Enable Spine animation support" ON)
option(ES_ENABLE_BOX2D "Enable Box2D physics support" OFF)
option(ES_ENABLE_TILEMAP "Enable Tilemap support" ON)
option(ES_ENABLE_PARTICLES "Enable Particle system" ON)
option(ES_ENABLE_POSTPROCESS "Enable Post-processing pipeline" ON)
option(ES_ENABLE_BITMAP_TEXT "Enable Bitmap text rendering" ON)
option(ES_ENABLE_BASIS "Build the Basis Universal KTX2 transcoder module" OFF)
option(ES_BUILD_MAIN_MODULE "Build as MAIN_MODULE for dynamic linking" OFF)
option(ES_BUILD_SIDE_MODULE "Build side modules for dynamic linking" OFF)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(ESEngineConfig)
include(CompilerCache)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    include(Emscripten)
endif()

add_subdirectory(third_party)

# =============================================================================
# ESEngine Library
# =============================================================================

set(ESENGINE_SOURCES
    src/esengine/core/EstellaContext.cpp
    src/esengine/core/Log.cpp
    src/esengine/resource/ResourceManager.cpp
    src/esengine/resource/ShaderParser.cpp
    src/esengine/renderer/RenderContext.cpp
    src/esengine/renderer/Shader.cpp
    src/esengine/renderer/Buffer.cpp
    src/esengine/renderer/Texture.cpp
    src/esengine/renderer/Framebuffer.cpp
    src/esengine/renderer/RenderFrame.cpp
    src/esengine/renderer/RenderFrameMask.cpp
    src/esengine/renderer/RenderFrameSubmit.cpp
    src/esengine/renderer/FrameCapture.cpp
    src/esengine/renderer/RenderTarget.cpp
    src/esengine/renderer/ImmediateDraw.cpp
    src/esengine/renderer/CustomGeometry.cpp
    src/esengine/renderer/GLDevice.cpp
    src/esengine/renderer/TransientBufferPool.cpp
    src/esengine/renderer/DrawList.cpp
    src/esengine/renderer/BatchBuilder.cpp
    src/esengine/renderer/plugins/BatchPlugin.cpp
    src/esengine/renderer/plugins/SpritePlugin.cpp
    src/esengine/renderer/plugins/UIElementPlugin.cpp
    src/esengine/renderer/plugins/TextPlugin.cpp
    src/esengine/renderer/plugins/ShapePlugin.cpp
    src/esengine/platform/PathResolver.cpp
    src/esengine/animation/TweenSystem.cpp
    src/esengine/ecs/UILayoutSystem.cpp
    src/esengine/ecs/UISystem.cpp
)

if(ES_ENABLE_POSTPROCESS)
    list(APPEND ESENGINE_SOURCES
        src/esengine/renderer/PostProcessPipeline.cpp
    )
endif()

if(ES_ENABLE_TILEMAP)
    list(APPEND ESENGINE_SOURCES
        src/esengine/renderer/plugins/TilemapRenderPlugin.cpp
        src/esengine/tilemap/TilemapSystem.cpp
        src/esengine/tilemap/TiledMapLoader.cpp
    )
endif()

if(ES_ENABLE_PARTICLES)
    list(APPEND ESENGINE_SOURCES
        src/esengine/renderer/plugins/ParticlePlugin.cpp
        src/esengine/particle/Particle.cpp
        src/esengine/particle/ParticleSystem.cpp
    )
endif()


    list(APPEND ESENGINE_SOURCES
        src/esengine/text/BitmapFont.cpp
    )


set(ESENGINE_HEADERS
    src/esengine/ESEngine.hpp
    src/esengine/core/Types.hpp
    src/esengine/core/Log.hpp
    src/esengine/core/Reflection.hpp
    src/esengine/core/ServiceRegistry.hpp
    src/esengine/ecs/Entity.hpp
    src/esengine/ecs/ComponentMask.hpp
    src/esengine/ecs/Component.hpp
    src/esengine/ecs/System.hpp
    src/esengine/ecs/Registry.hpp
    src/esengine/ecs/SparseSet.hpp
    src/esengine/ecs/View.hpp
    src/esengine/ecs/TransformSystem.hpp
    src/esengine/ecs/components/Transform.hpp
    src/esengine/ecs/components/Hierarchy.hpp
    src/esengine/ecs/components/Sprite.hpp
    src/esengine/ecs/components/Camera.hpp
    src/esengine/ecs/components/Velocity.hpp
    src/esengine/ecs/components/Common.hpp
    src/esengine/ecs/components/SpineAnimation.hpp
    src/esengine/ecs/components/BitmapText.hpp
    src/esengine/math/Math.hpp
    src/esengine/resource/Handle.hpp
    src/esengine/resource/ResourcePool.hpp
    src/esengine/resource/ResourceManager.hpp
    src/esengine/renderer/RenderContext.hpp
    src/esengine/renderer/Shader.hpp
    src/esengine/renderer/Buffer.hpp
    src/esengine/renderer/Texture.hpp
    src/esengine/renderer/Framebuffer.hpp
    src/esengine/renderer/RenderStage.hpp
    src/esengine/renderer/RenderItem.hpp
    src/esengine/renderer/RenderTarget.hpp
    src/esengine/renderer/RenderFrame.hpp
    src/esengine/renderer/ImmediateDraw.hpp
    src/esengine/renderer/BlendMode.hpp
    src/esengine/renderer/CustomGeometry.hpp
    src/esengine/renderer/GfxEnums.hpp
    src/esengine/renderer/GfxDevice.hpp
    src/esengine/renderer/GLDevice.hpp
    src/esengine/renderer/TransientBufferPool.hpp
    src/esengine/renderer/DrawCommand.hpp
    src/esengine/renderer/DrawList.hpp
    src/esengine/renderer/ClipState.hpp
    src/esengine/renderer/FrameConstants.hpp
    src/esengine/renderer/PipelineState.hpp
    src/esengine/renderer/BatchBuilder.hpp
    src/esengine/renderer/RenderTypePlugin.hpp
    src/esengine/renderer/plugins/BatchPlugin.hpp
    src/esengine/renderer/plugins/SpritePlugin.hpp
    src/esengine/renderer/plugins/UIElementPlugin.hpp
    src/esengine/renderer/plugins/TextPlugin.hpp
    src/esengine/renderer/plugins/ShapePlugin.hpp
    src/esengine/platform/FileSystem.hpp
    src/esengine/events/Events.hpp
    src/esengine/events/Connection.hpp
    src/esengine/events/Signal.hpp
    src/esengine/events/Sink.hpp
    src/esengine/events/Dispatcher.hpp
    src/esengine/animation/TweenData.hpp
    src/esengine/animation/EasingFunctions.hpp
    src/esengine/animation/TweenSystem.hpp
)

if(ES_ENABLE_POSTPROCESS)
    list(APPEND ESENGINE_HEADERS
        src/esengine/renderer/PostProcessPipeline.hpp
    )
endif()

if(ES_ENABLE_TILEMAP)
    list(APPEND ESENGINE_HEADERS
        src/esengine/renderer/plugins/TilemapRenderPlugin.hpp
        src/esengine/tilemap/TilemapSystem.hpp
        src/esengine/tilemap/TiledMapLoader.hpp
    )
endif()

if(ES_ENABLE_PARTICLES)
    list(APPEND ESENGINE_HEADERS
        src/esengine/renderer/plugins/ParticlePlugin.hpp
        src/esengine/particle/ParticleSystem.hpp
    )
endif()

    list(APPEND ESENGINE_HEADERS
        src/esengine/text/BitmapFont.hpp
    )


list(APPEND ESENGINE_HEADERS
    src/esengine/ecs/components/RigidBody.hpp
    src/esengine/ecs/components/Collider.hpp
)

set(GENERATED_WEB_BINDINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/WebBindings.generated.cpp")
set(GENERATED_EDITOR_API "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/EditorAPI.generated.cpp")
set(GENERATED_TS_DEFINITIONS "${CMAKE_CURRENT_SOURCE_DIR}/sdk/src/wasm.generated.ts")

list(APPEND ESENGINE_SOURCES
    src/esengine/platform/web/WebFileSystem.cpp
)

# =============================================================================
# EHT - ESEngine Header Tool
# =============================================================================

find_package(Python3 COMPONENTS Interpreter)

if(Python3_FOUND)
    file(GLOB_RECURSE COMPONENT_HEADERS
        "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/ecs/components/*.hpp"
    )

    add_custom_command(
        OUTPUT ${GENERATED_WEB_BINDINGS} ${GENERATED_TS_DEFINITIONS}
        COMMAND ${Python3_EXECUTABLE}
            "${CMAKE_CURRENT_SOURCE_DIR}/tools/eht.py"
            --input "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/ecs/components"
            --output "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings"
            --ts-output "${CMAKE_CURRENT_SOURCE_DIR}/sdk/src"
        DEPENDS ${COMPONENT_HEADERS} "${CMAKE_CURRENT_SOURCE_DIR}/tools/eht.py"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Running EHT..."
        VERBATIM
    )

    add_custom_target(eht DEPENDS ${GENERATED_WEB_BINDINGS} ${GENERATED_TS_DEFINITIONS})
    message(STATUS "EHT: ENABLED")
else()
    message(WARNING "Python3 not found - EHT DISABLED")
endif()

add_library(esengine STATIC ${ESENGINE_SOURCES} ${ESENGINE_HEADERS})

if(Python3_FOUND)
    add_dependencies(esengine eht)
endif()

target_include_directories(esengine
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb
)

target_link_libraries(esengine PUBLIC glm yogacore)

if(ES_ENABLE_TILEMAP)
    target_link_libraries(esengine PUBLIC cute_tiled)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_TILEMAP)
endif()

if(ES_ENABLE_PARTICLES)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_PARTICLES)
endif()


if(ES_ENABLE_POSTPROCESS)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_POSTPROCESS)
endif()

if(ES_ENABLE_BITMAP_TEXT)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_BITMAP_TEXT)
endif()

if(ES_ENABLE_SPINE)
    # Core links no spine runtime — spine is fully side-module (spine{NN}.wasm).
    # ES_ENABLE_SPINE still gates the renderer's spine RenderItem plumbing and the
    # side-module mesh-submit binding (renderer_submitSpineBatch).
    target_compile_definitions(esengine PUBLIC ES_ENABLE_SPINE)
endif()

# ESEngine is a web-only engine: it targets Emscripten (WebGL2 / GLES3) and ships
# as wasm for web, WeChat MiniGame, and the Tauri desktop shell. There is no native
# GPU/runtime build. (The header-only / MockGfxDevice unit tests under tests/ still
# compile on any C++20 toolchain — they don't link this target.)
target_compile_options(esengine PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})
target_compile_definitions(esengine PUBLIC ES_PLATFORM_WEB)
if(ES_BUILD_WXGAME)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_WXGAME)
endif()

esengine_set_strict_warnings(esengine)

# =============================================================================
# Web SDK
# =============================================================================

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    set(SDK_BINDING_SOURCES
        src/esengine/bindings/WebSDKEntry.cpp
        src/esengine/bindings/EngineContext.cpp
        src/esengine/bindings/ResourceManagerBindings.cpp
        src/esengine/bindings/RendererBindings.cpp
        src/esengine/bindings/ImmediateDrawBindings.cpp
        src/esengine/bindings/GeometryBindings.cpp
        ${GENERATED_WEB_BINDINGS}
        ${GENERATED_EDITOR_API}
    )
    if(ES_ENABLE_POSTPROCESS)
        list(APPEND SDK_BINDING_SOURCES src/esengine/bindings/PostProcessBindings.cpp)
    endif()
    if(ES_ENABLE_TILEMAP)
        list(APPEND SDK_BINDING_SOURCES src/esengine/bindings/TilemapBindings.cpp)
    endif()

    add_executable(esengine_sdk ${SDK_BINDING_SOURCES})
    target_link_libraries(esengine_sdk PRIVATE esengine)
    es_apply_sdk_settings(esengine_sdk)

    set_target_properties(esengine_sdk PROPERTIES
        OUTPUT_NAME "esengine"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
    )

    # Single-file SDK (WASM inlined as Base64, for playable ads)
    if(ES_BUILD_SINGLE_FILE)
        add_executable(esengine_single ${SDK_BINDING_SOURCES})
        target_link_libraries(esengine_single PRIVATE esengine)
        es_apply_single_file_settings(esengine_single)

        set_target_properties(esengine_single PROPERTIES
            OUTPUT_NAME "esengine.single"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )

        # Generate playable ad HTML template
        file(WRITE "${CMAKE_BINARY_DIR}/sdk/playable.html.in" [=[
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="ad.size" content="width=320,height=480">
<title>Playable</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#1a1a1a}
#canvas{display:block;width:100%;height:100%;touch-action:none}
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script>
// ESEngine Single-File SDK will be inlined here
// SDK_PLACEHOLDER
</script>
<script>
(function(){
  function resizeCanvas(){
    var c=document.getElementById('canvas');
    var dpr=window.devicePixelRatio||1;
    c.width=window.innerWidth*dpr;
    c.height=window.innerHeight*dpr;
  }
  window.addEventListener('resize',resizeCanvas);
  resizeCanvas();

  ESEngineModule({
    canvas:document.getElementById('canvas'),
    print:function(t){console.log(t)},
    printErr:function(t){console.error(t)}
  }).then(function(Module){
    var Registry=new Module.Registry();
    Module.initRenderer();

    // Create camera
    var cam=Registry.create();
    Registry.addCamera(cam,{projectionType:1,fov:60,orthoSize:400,nearPlane:0.1,farPlane:1000,aspectRatio:1,isActive:true,priority:0});
    Registry.addLocalTransform(cam,{position:{x:0,y:0,z:10},rotation:{w:1,x:0,y:0,z:0},scale:{x:1,y:1,z:1}});

    // Create sprite
    var spr=Registry.create();
    Registry.addSprite(spr,{texture:0,color:{x:1,y:0.5,z:0.2,w:1},size:{x:100,y:100},uvOffset:{x:0,y:0},uvScale:{x:1,y:1},layer:0,flipX:false,flipY:false});
    Registry.addLocalTransform(spr,{position:{x:0,y:0,z:0},rotation:{w:1,x:0,y:0,z:0},scale:{x:1,y:1,z:1}});

    var start=performance.now();
    function loop(){
      var t=(performance.now()-start)/1000;
      var tr=Registry.getLocalTransform(spr);
      tr.position.x=Math.sin(t)*100;
      tr.position.y=Math.cos(t)*100;
      var vp=window.innerWidth*(window.devicePixelRatio||1);
      var vh=window.innerHeight*(window.devicePixelRatio||1);
      Module.renderFrame(Registry,vp,vh);
      requestAnimationFrame(loop);
    }
    loop();
  });
})();
</script>
</body>
</html>
]=])
    endif()

    # Core-only SDK (no Spine, for modular builds)
    if(NOT ES_ENABLE_SPINE)
        set_target_properties(esengine_sdk PROPERTIES
            OUTPUT_NAME "esengine-core"
        )
    endif()

    # WeChat MiniGame SDK (CommonJS compatible)
    if(ES_BUILD_WXGAME)
        add_executable(esengine_wxgame ${SDK_BINDING_SOURCES})
        target_link_libraries(esengine_wxgame PRIVATE esengine)
        es_apply_wxgame_sdk_settings(esengine_wxgame)

        set_target_properties(esengine_wxgame PROPERTIES
            OUTPUT_NAME "esengine.wxgame"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # Spine standalone WASM module (spine-c)
    if(ES_ENABLE_SPINE)
        file(GLOB_RECURSE SPINE_MODULE_SPINE_SOURCES
            "${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-4.2/spine-c/spine-c/src/spine/*.c"
        )
        add_executable(spine_module
            src/esengine/bindings/SpineModuleEntry.cpp
            ${SPINE_MODULE_SPINE_SOURCES}
        )
        target_include_directories(spine_module PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-4.2/spine-c/spine-c/include
        )
        es_apply_spine_module_settings(spine_module)

        set_target_properties(spine_module PROPERTIES
            OUTPUT_NAME "spine42"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # Spine 4.1 standalone module (spine-c)
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-4.1")
        file(GLOB_RECURSE SPINE41_MODULE_SOURCES
            "${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-4.1/spine-c/spine-c/src/spine/*.c"
        )
        add_executable(spine_module_41
            src/esengine/bindings/SpineModuleEntry.cpp
            ${SPINE41_MODULE_SOURCES}
        )
        target_include_directories(spine_module_41 PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-4.1/spine-c/spine-c/include
        )
        target_compile_definitions(spine_module_41 PRIVATE ES_SPINE_41)
        es_apply_spine_module_settings(spine_module_41)
        set_target_properties(spine_module_41 PROPERTIES
            OUTPUT_NAME "spine41"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # Spine 3.8 standalone module (spine-c)
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-3.8")
        file(GLOB_RECURSE SPINE38_MODULE_SOURCES
            "${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-3.8/spine-c/spine-c/src/spine/*.c"
        )
        add_executable(spine_module_38
            src/esengine/bindings/SpineModuleEntry.cpp
            ${SPINE38_MODULE_SOURCES}
        )
        target_include_directories(spine_module_38 PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-3.8/spine-c/spine-c/include
        )
        target_compile_definitions(spine_module_38 PRIVATE ES_SPINE_38)
        es_apply_spine_module_settings(spine_module_38)
        set_target_properties(spine_module_38 PROPERTIES
            OUTPUT_NAME "spine38"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # Basis Universal KTX2 transcoder module (compressed textures — RC6)
    if(ES_ENABLE_BASIS)
        add_executable(basis_module
            src/esengine/bindings/BasisModuleEntry.cpp
            third_party/basis_universal/transcoder/basisu_transcoder.cpp
        )
        target_include_directories(basis_module PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/basis_universal/transcoder
        )
        # ETC1S works without zstd; disabling it avoids the zstd dependency. UASTC
        # assets must then be encoded without zstd supercompression.
        target_compile_definitions(basis_module PRIVATE
            BASISD_SUPPORT_KTX2=1
            BASISD_SUPPORT_KTX2_ZSTD=0
        )
        es_apply_basis_module_settings(basis_module)
        set_target_properties(basis_module PROPERTIES
            OUTPUT_NAME "basis"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # Physics standalone WASM module
    if(ES_ENABLE_BOX2D)
        add_executable(physics_module
            src/esengine/bindings/PhysicsModuleEntry.cpp
            src/esengine/bindings/PhysicsContext.cpp
            src/esengine/bindings/PhysicsShapes.cpp
            src/esengine/bindings/PhysicsJoints.cpp
            src/esengine/bindings/PhysicsQueries.cpp
        )
        target_link_libraries(physics_module PRIVATE box2d)
        target_include_directories(physics_module PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/box2d/include
        )
        es_apply_physics_module_settings(physics_module)

        set_target_properties(physics_module PROPERTIES
            OUTPUT_NAME "physics"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )

        # ESM variant (EXPORT_ES6=1) for the web editor's estella:// ESM host —
        # imported like esengine.js. Same sources/wasm, no dynamic linking.
        add_executable(physics_module_esm
            src/esengine/bindings/PhysicsModuleEntry.cpp
            src/esengine/bindings/PhysicsContext.cpp
            src/esengine/bindings/PhysicsShapes.cpp
            src/esengine/bindings/PhysicsJoints.cpp
            src/esengine/bindings/PhysicsQueries.cpp
        )
        target_link_libraries(physics_module_esm PRIVATE box2d)
        target_include_directories(physics_module_esm PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/box2d/include
        )
        es_apply_physics_esm_module_settings(physics_module_esm)
        set_target_properties(physics_module_esm PROPERTIES
            OUTPUT_NAME "physics"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # Main module SDK (MAIN_MODULE=2, supports loading side modules)
    if(ES_BUILD_MAIN_MODULE)
        add_executable(esengine_sdk_main ${SDK_BINDING_SOURCES})
        target_link_libraries(esengine_sdk_main PRIVATE esengine)
        es_apply_main_module_settings(esengine_sdk_main)
        set_target_properties(esengine_sdk_main PROPERTIES
            OUTPUT_NAME "esengine"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )

        if(ES_BUILD_WXGAME)
            add_executable(esengine_wxgame_main ${SDK_BINDING_SOURCES})
            target_link_libraries(esengine_wxgame_main PRIVATE esengine)
            es_apply_wxgame_main_module_settings(esengine_wxgame_main)
            set_target_properties(esengine_wxgame_main PROPERTIES
                OUTPUT_NAME "esengine.wxgame"
                RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
            )
        endif()
    endif()

    # Physics side module (SIDE_MODULE=2, pure .wasm, no JS glue)
    if(ES_ENABLE_BOX2D AND ES_BUILD_SIDE_MODULE)
        add_executable(physics_side_module
            src/esengine/bindings/PhysicsModuleEntry.cpp
            src/esengine/bindings/PhysicsContext.cpp
            src/esengine/bindings/PhysicsShapes.cpp
            src/esengine/bindings/PhysicsJoints.cpp
            src/esengine/bindings/PhysicsQueries.cpp
        )
        target_link_libraries(physics_side_module PRIVATE box2d)
        target_include_directories(physics_side_module PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/box2d/include
        )
        es_apply_physics_side_module_settings(physics_side_module)
        set_target_properties(physics_side_module PROPERTIES
            OUTPUT_NAME "physics"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()
endif()

if(ES_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()


install(TARGETS esengine
    EXPORT ESEngineTargets
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
    RUNTIME DESTINATION bin
)

install(DIRECTORY src/esengine/ DESTINATION include/esengine FILES_MATCHING PATTERN "*.hpp")
