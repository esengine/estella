// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EstellaContext.cpp
 * @brief   Instance-based engine context implementation
 *
 * @author  ESEngine Team
 * @date    2026
 */

#include "EstellaContext.hpp"
#include "Log.hpp"

#ifdef ES_PLATFORM_WEB
#include "../renderer/rhi/GLDevice.hpp"  // WebGL2 backend — web platform only
#endif
#include "../renderer/frame/RenderContext.hpp"
#include "../renderer/frame/RenderFrame.hpp"
#include "../renderer/draw/ImmediateDraw.hpp"
#include "../renderer/draw/CustomGeometry.hpp"
#include "../renderer/plugins/SpritePlugin.hpp"
#include "../renderer/plugins/UIElementPlugin.hpp"
#ifdef ES_ENABLE_BITMAP_TEXT
#include "../renderer/plugins/TextPlugin.hpp"
#endif
#include "../renderer/plugins/ShapePlugin.hpp"
#include "../renderer/plugins/MeshPlugin.hpp"
#ifdef ES_ENABLE_PARTICLES
#include "../renderer/plugins/ParticlePlugin.hpp"
#include "../particle/ParticleSystem.hpp"
#include "RandomSource.hpp"
#endif
#include "../renderer/plugins/TrailPlugin.hpp"
#include "../trail/TrailSystem.hpp"
#ifdef ES_ENABLE_TILEMAP
#include "../renderer/plugins/TilemapRenderPlugin.hpp"
#include "../tilemap/TilemapSystem.hpp"
#endif
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../ui/UISystem.hpp"
#include "../animation/TweenSystem.hpp"

#ifdef ES_PLATFORM_WEB
#include <emscripten/html5.h>
#endif

namespace esengine {

#ifdef ES_ENABLE_TILEMAP
// Forward declaration — defined in TilemapBindings.cpp for web builds,
// needs local instance for non-web. For now we create a fresh system.
#endif

EstellaContext::EstellaContext() {
    // Logic systems must exist even for headless apps that never call init()
    // (e.g. tooling / tests that drive UI layout without a GL context). Without
    // this, the binding's require<UISystem>() returned a null reference and ran
    // against wasm address 0 — silent memory corruption masked by the fact that
    // address 0 is valid linear memory. See registerLogicSystems().
    registerLogicSystems();
}

void EstellaContext::registerLogicSystems() {
    // Idempotent: the constructor and initSubsystems both call this, and a
    // shutdown()+init() cycle clears services_ and re-registers. UISystem is the
    // membership sentinel for the whole logic-system set.
    if (services_.getService<ecs::UISystem>()) return;
    services_.registerOwned<ecs::TransformSystem>(makeUnique<ecs::TransformSystem>());
    services_.registerOwned<ecs::UISystem>(makeUnique<ecs::UISystem>());
    services_.registerOwned<animation::TweenSystem>(makeUnique<animation::TweenSystem>());
}

EstellaContext::~EstellaContext() {
    if (state_.initialized) {
        shutdown();
    }
}

#ifdef ES_PLATFORM_WEB
// The WebGL2 entry: takes an emscripten context handle and drives the GLDevice
// backend. A native build has no WebGL — it enters through init(Unique<GfxDevice>)
// with an injected WebGPUDevice instead, so this overload compiles out entirely.
bool EstellaContext::init(int webglContextHandle) {
    if (state_.initialized) {
        ES_LOG_WARN("EstellaContext already initialized");
        return true;
    }

    state_.webgl_context = webglContextHandle;

    EMSCRIPTEN_RESULT result = emscripten_webgl_make_context_current(
        static_cast<EMSCRIPTEN_WEBGL_CONTEXT_HANDLE>(webglContextHandle));
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        ES_LOG_ERROR("Failed to make WebGL context current: {}", result);
        return false;
    }

    initSubsystems(makeUnique<GLDevice>());
    return true;
}
#endif  // ES_PLATFORM_WEB

bool EstellaContext::init(Unique<GfxDevice> device) {
    if (state_.initialized) {
        ES_LOG_WARN("EstellaContext already initialized");
        return true;
    }
    if (!device) {
        ES_LOG_ERROR("EstellaContext::init: no device");
        return false;
    }
    initSubsystems(std::move(device));
    return true;
}

bool EstellaContext::recoverDevice() {
    auto* device = services_.getService<GfxDevice>();
    if (!device || !device->recoverDevice()) return false;

    // The order is the substance. Shaders first: every program id cached
    // downstream is read back from these handles. RenderContext next, because
    // its white texture is the placeholder the textures get swept onto.
    auto* resources = services_.getService<resource::ResourceManager>();
    auto* renderContext = services_.getService<RenderContext>();
    if (!resources || !renderContext) return false;

    resources->recreateGpuShaders();
    renderContext->recreateGpuResources();
    renderContext->materials().refreshShaderPrograms(*resources);

    if (auto* immediateDraw = services_.getService<ImmediateDraw>()) {
        immediateDraw->recreateGpuResources();
    }
    if (auto* renderFrame = services_.getService<RenderFrame>()) {
        renderFrame->recreateGpuResources();
    }

    // Last: the placeholder now exists to park them on. Their CONTENT is still
    // missing, which is why this leaves the device Recovering, not Live.
    resources->invalidateGpuTextures(renderContext->getWhiteTexture());
    return true;
}

void EstellaContext::initSubsystems(Unique<GfxDevice> gfxDevice) {
    // The device arrives first: ResourceManager (the GPU-resource factory) and
    // every other renderer subsystem borrow this single device. Which backend
    // it is was decided at the platform edge (init overloads).
    auto* gfxDevicePtr = gfxDevice.get();

    // The one place a device loss becomes visible. Logged whether or not
    // anything above the engine is listening: a loss nobody recorded is the
    // black screen with no explanation.
    gfxDevicePtr->setDeviceLostHandler([](const GfxDeviceLostInfo& info) {
        ES_LOG_ERROR("{}", gfxFormatDeviceLost(info));
    });

    services_.registerOwned<GfxDevice>(std::move(gfxDevice));

    auto resourceManager = makeUnique<resource::ResourceManager>();
    resourceManager->init(*gfxDevicePtr);
    services_.registerOwned<resource::ResourceManager>(std::move(resourceManager));

    auto renderContext = makeUnique<RenderContext>(*gfxDevicePtr);
    renderContext->init();
    // Materials name their textures by resource handle and resolve them per draw,
    // so the store needs the manager that owns the pool.
    renderContext->materials().setResourceManager(services_.getService<resource::ResourceManager>());
    services_.registerOwned<RenderContext>(std::move(renderContext));

    // GPU state is owned by the device: pipelines (setPipeline) carry program/blend/depth/
    // stencil/cull, so there is no separate per-App state tracker to wire up here.

    // GPU-independent logic systems (Transform/UI/Tween) are registered here too
    // for the shutdown()+init() re-init path; the constructor already registered
    // them for the headless/first-use path. Idempotent, so this is a no-op when
    // they are already present.
    registerLogicSystems();

    // Before the systems that draw from it: a consumer takes its stream at
    // registration, so the seed has to be the engine's before anyone asks.
    auto randomSource = makeUnique<RandomSource>();
    // A seed the SDK set before this context existed (see setPendingRandomSeed).
    if (u32 pending = 0; takePendingRandomSeed(pending)) randomSource->reseed(pending);
    services_.registerOwned<RandomSource>(std::move(randomSource));
#ifdef ES_ENABLE_PARTICLES
    services_.registerOwned<particle::ParticleSystem>(makeUnique<particle::ParticleSystem>());
    services_.getService<particle::ParticleSystem>()->reseedFrom(*services_.getService<RandomSource>());
#endif
    services_.registerOwned<trail::TrailSystem>(makeUnique<trail::TrailSystem>());

    auto* rm = services_.getService<resource::ResourceManager>();
    auto* rc = services_.getService<RenderContext>();
    auto immediateDraw = makeUnique<ImmediateDraw>(*gfxDevicePtr, *rc, *rm);
    immediateDraw->init();
    services_.registerOwned<ImmediateDraw>(std::move(immediateDraw));

    services_.registerOwned<GeometryManager>(makeUnique<GeometryManager>());

#ifdef ES_ENABLE_TILEMAP
    services_.registerOwned<tilemap::TilemapSystem>(makeUnique<tilemap::TilemapSystem>());
#endif

    auto renderFrame = makeUnique<RenderFrame>(*gfxDevicePtr, *rc, *rm);
    renderFrame->addPlugin(std::make_unique<SpritePlugin>());
    renderFrame->addPlugin(std::make_unique<UIElementPlugin>());
#ifdef ES_ENABLE_BITMAP_TEXT
    renderFrame->addPlugin(std::make_unique<TextPlugin>());
#endif
    renderFrame->addPlugin(std::make_unique<ShapePlugin>());
    renderFrame->addPlugin(std::make_unique<MeshPlugin>());
    {
        auto trailPlugin = std::make_unique<TrailPlugin>();
        trailPlugin->setTrailSystem(services_.getService<trail::TrailSystem>());
        renderFrame->addPlugin(std::move(trailPlugin));
    }

#ifdef ES_ENABLE_TILEMAP
    {
        auto tilemapPlugin = std::make_unique<TilemapRenderPlugin>();
        tilemapPlugin->setTilemapSystem(services_.getService<tilemap::TilemapSystem>());
        renderFrame->addPlugin(std::move(tilemapPlugin));
    }
#endif
#ifdef ES_ENABLE_PARTICLES
    {
        auto particlePlugin = std::make_unique<ParticlePlugin>();
        particlePlugin->setParticleSystem(services_.getService<particle::ParticleSystem>());
        renderFrame->addPlugin(std::move(particlePlugin));
    }
#endif

    renderFrame->init(state_.viewport_width, state_.viewport_height);
    services_.registerOwned<RenderFrame>(std::move(renderFrame));

#ifdef ES_ENABLE_POSTPROCESS
    // ONE PostProcessPipeline per App: the postprocess_* bindings and RenderFrame
    // must consult the SAME instance. Registering RenderFrame's pipeline as the
    // service (borrowed — RenderFrame owns it) stops the bindings from lazily
    // creating a second one, whose captures RenderFrame::begin could not see.
    if (auto* pp = services_.getService<RenderFrame>()->postProcess()) {
        services_.registerService<PostProcessPipeline>(pp);
    }
#endif

    state_.initialized = true;

    // First-frame clear as a proper pass load-op (values in the desc, no sticky state).
    RenderPassDesc initPass{};
    initPass.clearColor = true;
    initPass.clearDepth = true;
    initPass.clearColorValue[0] = state_.clear_color.r;
    initPass.clearColorValue[1] = state_.clear_color.g;
    initPass.clearColorValue[2] = state_.clear_color.b;
    initPass.clearColorValue[3] = state_.clear_color.a;
    gfxDevicePtr->beginRenderPass(initPass);
    gfxDevicePtr->endRenderPass();  // a pass never outlives its task (WebGPU submits here)

    ES_LOG_INFO("EstellaContext initialized");
}

void EstellaContext::shutdown() {
    if (!state_.initialized) return;

    if (auto* rf = tryGet<RenderFrame>()) rf->shutdown();
    if (auto* id = tryGet<ImmediateDraw>()) id->shutdown();
    if (auto* rc = tryGet<RenderContext>()) rc->shutdown();
    if (auto* rm = tryGet<resource::ResourceManager>()) rm->shutdown();

    int webglCtx = state_.webgl_context;

    services_.clear();
    state_ = EngineState{};

#ifdef ES_PLATFORM_WEB
    if (webglCtx > 0) {
        emscripten_webgl_destroy_context(
            static_cast<EMSCRIPTEN_WEBGL_CONTEXT_HANDLE>(webglCtx));
    }
#endif

    ES_LOG_INFO("EstellaContext shutdown");
}

}  // namespace esengine
