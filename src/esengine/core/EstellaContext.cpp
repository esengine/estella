/**
 * @file    EstellaContext.cpp
 * @brief   Instance-based engine context implementation
 *
 * @author  ESEngine Team
 * @date    2026
 */

#include "EstellaContext.hpp"
#include "Log.hpp"

#include "../renderer/GLDevice.hpp"
#include "../renderer/StateTracker.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../renderer/plugins/SpritePlugin.hpp"
#include "../renderer/plugins/UIElementPlugin.hpp"
#include "../renderer/plugins/TextPlugin.hpp"
#include "../renderer/plugins/ShapePlugin.hpp"
#ifdef ES_ENABLE_PARTICLES
#include "../renderer/plugins/ParticlePlugin.hpp"
#include "../particle/ParticleSystem.hpp"
#endif
#ifdef ES_ENABLE_TILEMAP
#include "../renderer/plugins/TilemapRenderPlugin.hpp"
#include "../tilemap/TilemapSystem.hpp"
#include "../tilemap/TiledMapLoader.hpp"
#endif
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../ecs/UISystem.hpp"
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

bool EstellaContext::init(int webglContextHandle) {
    if (state_.initialized) {
        ES_LOG_WARN("EstellaContext already initialized");
        return true;
    }

    state_.webgl_context = webglContextHandle;

#ifdef ES_PLATFORM_WEB
    EMSCRIPTEN_RESULT result = emscripten_webgl_make_context_current(
        static_cast<EMSCRIPTEN_WEBGL_CONTEXT_HANDLE>(webglContextHandle));
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        ES_LOG_ERROR("Failed to make WebGL context current: {}", result);
        return false;
    }
#endif

    initSubsystems();
    return true;
}

void EstellaContext::initSubsystems() {
    // GLDevice is created first: ResourceManager (the GPU-resource factory) and
    // every other renderer subsystem borrow this single device.
    auto gfxDevice = makeUnique<GLDevice>();
    auto* gfxDevicePtr = gfxDevice.get();
    services_.registerOwned<GfxDevice>(std::move(gfxDevice));

    auto resourceManager = makeUnique<resource::ResourceManager>();
    resourceManager->init(*gfxDevicePtr);
    services_.registerOwned<resource::ResourceManager>(std::move(resourceManager));

    auto renderContext = makeUnique<RenderContext>(*gfxDevicePtr);
    renderContext->init();
    services_.registerOwned<RenderContext>(std::move(renderContext));

    // Single per-App GPU state cache. RenderContext::init() above already ran
    // device_.init() (enabling the GL context), so the tracker's initial state
    // sync is valid here. Every renderer subsystem borrows this one instance so
    // the cache stays authoritative across the whole frame.
    auto stateTracker = makeUnique<StateTracker>(*gfxDevicePtr);
    stateTracker->init();
    auto* statePtr = stateTracker.get();
    services_.registerOwned<StateTracker>(std::move(stateTracker));

    // GPU-independent logic systems (Transform/UI/Tween) are registered here too
    // for the shutdown()+init() re-init path; the constructor already registered
    // them for the headless/first-use path. Idempotent, so this is a no-op when
    // they are already present.
    registerLogicSystems();

#ifdef ES_ENABLE_PARTICLES
    services_.registerOwned<particle::ParticleSystem>(makeUnique<particle::ParticleSystem>());
#endif

    auto* rm = services_.getService<resource::ResourceManager>();
    auto* rc = services_.getService<RenderContext>();
    auto immediateDraw = makeUnique<ImmediateDraw>(*gfxDevicePtr, *statePtr, *rc, *rm);
    immediateDraw->init();
    services_.registerOwned<ImmediateDraw>(std::move(immediateDraw));

    services_.registerOwned<GeometryManager>(makeUnique<GeometryManager>());

#ifdef ES_ENABLE_TILEMAP
    services_.registerOwned<tilemap::TilemapSystem>(makeUnique<tilemap::TilemapSystem>());
    services_.registerOwned<tilemap::TiledMapLoader>(makeUnique<tilemap::TiledMapLoader>());
#endif

    auto renderFrame = makeUnique<RenderFrame>(*gfxDevicePtr, *statePtr, *rc, *rm);
    renderFrame->addPlugin(std::make_unique<SpritePlugin>());
    renderFrame->addPlugin(std::make_unique<UIElementPlugin>());
    renderFrame->addPlugin(std::make_unique<TextPlugin>());
    renderFrame->addPlugin(std::make_unique<ShapePlugin>());

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

    state_.initialized = true;

    gfxDevicePtr->setClearColor(
        state_.clear_color.r, state_.clear_color.g,
        state_.clear_color.b, state_.clear_color.a);
    gfxDevicePtr->clear(true, true, false);

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
