# Single source of truth for the engine's C++ source list.
#
# Both the web/emscripten build (root CMakeLists.txt) and the native build
# (native/CMakeLists.txt) `include()` this file, so the two can never drift — the
# same reflection-generated bindings, the same shaders, and now the same source
# list. The caller sets ESENGINE_ROOT (repo root) and the ES_* feature options;
# this appends the sources those options select into ESENGINE_SOURCES.

set(ESENGINE_SOURCES
    ${ESENGINE_ROOT}/src/esengine/core/EstellaContext.cpp
    ${ESENGINE_ROOT}/src/esengine/core/Log.cpp
    ${ESENGINE_ROOT}/src/esengine/resource/ResourceManager.cpp
    ${ESENGINE_ROOT}/src/esengine/resource/ShaderParser.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/RenderContext.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/Shader.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/DrawParams.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/Buffer.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/Texture.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/Framebuffer.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/RenderFrame.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/RenderFrameMask.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/RenderFrameSubmit.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/FrameCapture.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/RenderTarget.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/ImmediateDraw.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/CustomGeometry.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/TransientBufferPool.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/DrawList.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/BatchBuilder.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/MaterialStore.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/LightStore.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/BatchPlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/SpritePlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/UIElementPlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/ShapePlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/MeshPlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/TrailPlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/trail/TrailSystem.cpp
    ${ESENGINE_ROOT}/src/esengine/platform/PathResolver.cpp
    ${ESENGINE_ROOT}/src/esengine/animation/TweenSystem.cpp
    ${ESENGINE_ROOT}/src/esengine/ecs/UILayoutSystem.cpp
    ${ESENGINE_ROOT}/src/esengine/ecs/UISystem.cpp
)

# WebGL2 (GLES3) backend — the web/WeChat platform only. A native build renders
# through the WebGPU backend on embedded Dawn, so it drops GLDevice entirely.
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES ${ESENGINE_ROOT}/src/esengine/renderer/GLDevice.cpp)
endif()

# The binding ENTRY POINTS the SDK calls (renderer_begin, renderer_submitAll, …).
# They are not web-specific: they reach the engine through activeCtx() and validate
# JS-supplied spans through BoundarySpan, both portable. The web build compiles
# them as part of SDK_BINDING_SOURCES (with embind registering them); a native
# build compiles the same TU here and registers the same functions on QuickJS from
# generated wrappers — one binding implementation, two registration layers. The
# few entry points that return an `emscripten::val` are gated out natively.
if(NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES
        ${ESENGINE_ROOT}/src/esengine/bindings/RendererBindings.cpp
        ${ESENGINE_ROOT}/src/esengine/bindings/UIBindings.cpp
        # activeCtx()'s unset fallback. A host that installs its own context (the
        # native one does, at boot) never reaches it, but the inline accessor
        # references it, so the definition has to link.
        ${ESENGINE_ROOT}/src/esengine/bindings/EngineContext.cpp)
endif()

if(ES_ENABLE_WEBGPU)
    list(APPEND ESENGINE_SOURCES ${ESENGINE_ROOT}/src/esengine/renderer/webgpu/WebGPUDevice.cpp)
endif()

if(ES_ENABLE_POSTPROCESS)
    list(APPEND ESENGINE_SOURCES ${ESENGINE_ROOT}/src/esengine/renderer/PostProcessPipeline.cpp)
endif()

if(ES_ENABLE_TILEMAP)
    list(APPEND ESENGINE_SOURCES
        ${ESENGINE_ROOT}/src/esengine/renderer/plugins/TilemapRenderPlugin.cpp
        ${ESENGINE_ROOT}/src/esengine/tilemap/TilemapSystem.cpp)
endif()

if(ES_ENABLE_PARTICLES)
    list(APPEND ESENGINE_SOURCES
        ${ESENGINE_ROOT}/src/esengine/renderer/plugins/ParticlePlugin.cpp
        ${ESENGINE_ROOT}/src/esengine/particle/Particle.cpp
        ${ESENGINE_ROOT}/src/esengine/particle/ParticleSystem.cpp)
endif()

# Bitmap/SDF text — freetype/msdfgen-backed. Gated so a build that omits it (e.g.
# native, until those deps are cross-compiled) drops the whole text path; the
# TextPlugin registration in EstellaContext is under the same ES_ENABLE_BITMAP_TEXT.
if(ES_ENABLE_BITMAP_TEXT)
    list(APPEND ESENGINE_SOURCES
        ${ESENGINE_ROOT}/src/esengine/renderer/plugins/TextPlugin.cpp
        ${ESENGINE_ROOT}/src/esengine/text/BitmapFont.cpp
        ${ESENGINE_ROOT}/src/esengine/text/SdfGenerator.cpp)
endif()
