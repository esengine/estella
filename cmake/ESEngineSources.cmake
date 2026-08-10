# Single source of truth for the engine's C++ source list.
#
# Both the web/emscripten build (root CMakeLists.txt) and the native build
# (native/CMakeLists.txt) `include()` this file, so the two can never drift — the
# same reflection-generated bindings, the same shaders, and now the same source
# list. The caller sets ESENGINE_ROOT (repo root) and the ES_* feature options;
# this appends the sources those options select into ESENGINE_SOURCES.

set(ESENGINE_SOURCES
    ${ESENGINE_ROOT}/src/esengine/core/EstellaContext.cpp
    ${ESENGINE_ROOT}/src/esengine/core/RandomSource.cpp
    ${ESENGINE_ROOT}/src/esengine/core/Log.cpp
    ${ESENGINE_ROOT}/src/esengine/resource/ResourceManager.cpp
    ${ESENGINE_ROOT}/src/esengine/resource/ShaderParser.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/frame/RenderContext.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/rhi/Shader.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/draw/DrawParams.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/rhi/Buffer.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/rhi/Texture.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/rhi/Framebuffer.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/frame/RenderFrame.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/frame/RenderFrameMask.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/frame/RenderFrameSubmit.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/frame/FrameCapture.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/rhi/RenderTarget.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/draw/ImmediateDraw.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/draw/CustomGeometry.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/rhi/TransientBufferPool.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/draw/DrawList.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/draw/BatchBuilder.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/store/MaterialStore.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/store/LightStore.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/BatchPlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/SpritePlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/UIElementPlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/ShapePlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/MeshPlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/renderer/plugins/TrailPlugin.cpp
    ${ESENGINE_ROOT}/src/esengine/trail/TrailSystem.cpp
    ${ESENGINE_ROOT}/src/esengine/platform/PathResolver.cpp
    ${ESENGINE_ROOT}/src/esengine/animation/TweenSystem.cpp
    ${ESENGINE_ROOT}/src/esengine/ui/UILayoutSystem.cpp
    ${ESENGINE_ROOT}/src/esengine/ui/UISystem.cpp
)

# WebGL2 (GLES3) backend — the web/WeChat platform only. A native build renders
# through the WebGPU backend on embedded Dawn, so it drops GLDevice entirely.
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES ${ESENGINE_ROOT}/src/esengine/renderer/rhi/GLDevice.cpp)
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
        # The texture surface the asset pipeline uploads through. Native took a
        # hand-written copy of these for a while, drifting from the web's; it now
        # compiles the same TU and registers the same rm_* entry points.
        ${ESENGINE_ROOT}/src/esengine/bindings/ResourceManagerBindings.cpp
        # Custom geometry (Mesh2D) and the immediate-draw surface: portable C++ the
        # web build compiles into its SDK target, so a device gets them too.
        ${ESENGINE_ROOT}/src/esengine/bindings/GeometryBindings.cpp
        ${ESENGINE_ROOT}/src/esengine/bindings/ImmediateDrawBindings.cpp
        # Tweens: portable C++ that used to live in the emscripten entry TU.
        ${ESENGINE_ROOT}/src/esengine/bindings/AnimationBindings.cpp
        # Materials and .esshader compilation — the surface every custom material
        # and every post-process pass gets its shader from.
        ${ESENGINE_ROOT}/src/esengine/bindings/MaterialBindings.cpp
        # activeCtx()'s unset fallback. A host that installs its own context (the
        # native one does, at boot) never reaches it, but the inline accessor
        # references it, so the definition has to link.
        ${ESENGINE_ROOT}/src/esengine/bindings/EngineContext.cpp)
    # The subsystem entry points, under the same flags that compile the subsystem.
    # On the web these are part of the SDK target instead (SDK_BINDING_SOURCES),
    # because that is where embind registers them; the implementation is the same TU.
    if(ES_ENABLE_TILEMAP)
        list(APPEND ESENGINE_SOURCES ${ESENGINE_ROOT}/src/esengine/bindings/TilemapBindings.cpp)
    endif()
    if(ES_ENABLE_POSTPROCESS)
        list(APPEND ESENGINE_SOURCES ${ESENGINE_ROOT}/src/esengine/bindings/PostProcessBindings.cpp)
    endif()
endif()

if(ES_ENABLE_WEBGPU)
    list(APPEND ESENGINE_SOURCES ${ESENGINE_ROOT}/src/esengine/renderer/webgpu/WebGPUDevice.cpp)
endif()

if(ES_ENABLE_POSTPROCESS)
    list(APPEND ESENGINE_SOURCES ${ESENGINE_ROOT}/src/esengine/renderer/frame/PostProcessPipeline.cpp)
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
