cmake_minimum_required(VERSION 3.16)
project(ESEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ES_BUILD_WEB "Build for Web/Emscripten" OFF)
option(ES_BUILD_WXGAME "Build for WeChat MiniGame" OFF)
option(ES_BUILD_TESTS "Build tests" ON)
option(ES_BUILD_SINGLE_FILE "Build single-file SDK (WASM inlined)" OFF)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(ESEngineConfig)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    include(Emscripten)
endif()

add_subdirectory(third_party)

# =============================================================================
# ESEngine Library
# =============================================================================

set(ESENGINE_SOURCES
    src/esengine/core/Application.cpp
    src/esengine/core/Engine.cpp
    src/esengine/core/Log.cpp
    src/esengine/app/App.cpp
    src/esengine/resource/ResourceManager.cpp
    src/esengine/renderer/RenderContext.cpp
    src/esengine/renderer/Renderer.cpp
    src/esengine/renderer/Shader.cpp
    src/esengine/renderer/Buffer.cpp
    src/esengine/renderer/Texture.cpp
    src/esengine/renderer/Framebuffer.cpp
    src/esengine/renderer/RenderFrame.cpp
    src/esengine/renderer/RenderTarget.cpp
    src/esengine/renderer/ImmediateDraw.cpp
    src/esengine/renderer/CustomGeometry.cpp
    src/esengine/renderer/PostProcessPipeline.cpp
    src/esengine/platform/input/Input.cpp
    src/esengine/platform/PathResolver.cpp
    src/esengine/spine/SpineExtension.cpp
    src/esengine/spine/SpineResourceManager.cpp
    src/esengine/spine/SpineSystem.cpp
    src/esengine/spine/SpineRenderer.cpp
)

set(ESENGINE_HEADERS
    src/esengine/ESEngine.hpp
    src/esengine/core/Types.hpp
    src/esengine/core/Application.hpp
    src/esengine/core/Engine.hpp
    src/esengine/core/Log.hpp
    src/esengine/core/Reflection.hpp
    src/esengine/ecs/Entity.hpp
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
    src/esengine/spine/SpineExtension.hpp
    src/esengine/spine/SpineResourceManager.hpp
    src/esengine/spine/SpineSystem.hpp
    src/esengine/spine/SpineRenderer.hpp
    src/esengine/math/Math.hpp
    src/esengine/resource/Handle.hpp
    src/esengine/resource/ResourcePool.hpp
    src/esengine/resource/ResourceManager.hpp
    src/esengine/resource/Resource.hpp
    src/esengine/renderer/RenderContext.hpp
    src/esengine/renderer/Renderer.hpp
    src/esengine/renderer/Shader.hpp
    src/esengine/renderer/Buffer.hpp
    src/esengine/renderer/Texture.hpp
    src/esengine/renderer/Framebuffer.hpp
    src/esengine/renderer/RenderCommand.hpp
    src/esengine/renderer/RenderStage.hpp
    src/esengine/renderer/RenderItem.hpp
    src/esengine/renderer/RenderTarget.hpp
    src/esengine/renderer/RenderFrame.hpp
    src/esengine/renderer/ImmediateDraw.hpp
    src/esengine/renderer/BlendMode.hpp
    src/esengine/renderer/CustomGeometry.hpp
    src/esengine/renderer/PostProcessPipeline.hpp
    src/esengine/platform/Platform.hpp
    src/esengine/platform/FileSystem.hpp
    src/esengine/platform/input/Input.hpp
    src/esengine/events/Events.hpp
    src/esengine/events/Connection.hpp
    src/esengine/events/Signal.hpp
    src/esengine/events/Sink.hpp
    src/esengine/events/Dispatcher.hpp
)

set(GENERATED_WEB_BINDINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/WebBindings.generated.cpp")
set(GENERATED_TS_DEFINITIONS "${CMAKE_CURRENT_SOURCE_DIR}/sdk/src/wasm.generated.ts")

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/web/WebPlatform.cpp
        src/esengine/platform/web/WebFileSystem.cpp
        ${GENERATED_WEB_BINDINGS}
    )
else()
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/native/NativePlatform.cpp
        src/esengine/platform/native/NativeFileSystem.cpp
        src/esengine/platform/FileDialog.cpp
        src/esengine/renderer/stb_image_impl.cpp
        src/esengine/resource/ShaderParser.cpp
        src/esengine/resource/LoaderJobQueue.cpp
        src/esengine/resource/HotReloadManager.cpp
        src/esengine/resource/loaders/ShaderLoader.cpp
    )
    list(APPEND ESENGINE_HEADERS
        src/esengine/platform/native/NativePlatform.hpp
        src/esengine/platform/FileDialog.hpp
    )
endif()

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

target_link_libraries(esengine PUBLIC glm spine-cpp)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_WEB)
    if(ES_BUILD_WXGAME)
        target_compile_definitions(esengine PUBLIC ES_PLATFORM_WXGAME)
    endif()
else()
    find_package(OpenGL REQUIRED)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_NATIVE ES_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
    target_link_libraries(esengine PUBLIC glfw glad OpenGL::GL nlohmann_json)
    target_include_directories(esengine PUBLIC ${CMAKE_SOURCE_DIR}/third_party/glad/include)
    if(WIN32)
        target_compile_definitions(esengine PUBLIC ES_PLATFORM_WINDOWS)
    endif()
endif()

esengine_set_strict_warnings(esengine)

# =============================================================================
# Web SDK
# =============================================================================

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    add_executable(esengine_sdk src/esengine/bindings/WebSDKEntry.cpp)
    target_link_libraries(esengine_sdk PRIVATE -Wl,--whole-archive esengine -Wl,--no-whole-archive)
    es_apply_sdk_settings(esengine_sdk)

    set_target_properties(esengine_sdk PROPERTIES
        OUTPUT_NAME "esengine"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
    )

    # Single-file SDK (WASM inlined as Base64, for playable ads)
    if(ES_BUILD_SINGLE_FILE)
        add_executable(esengine_single src/esengine/bindings/WebSDKEntry.cpp)
        target_link_libraries(esengine_single PRIVATE -Wl,--whole-archive esengine -Wl,--no-whole-archive)
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

    # WeChat MiniGame SDK (CommonJS compatible)
    if(ES_BUILD_WXGAME)
        add_executable(esengine_wxgame src/esengine/bindings/WebSDKEntry.cpp)
        target_link_libraries(esengine_wxgame PRIVATE -Wl,--whole-archive esengine -Wl,--no-whole-archive)
        es_apply_wxgame_sdk_settings(esengine_wxgame)

        set_target_properties(esengine_wxgame PROPERTIES
            OUTPUT_NAME "esengine.wxgame"
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
