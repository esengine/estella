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
#endif
#ifdef ES_ENABLE_SPINE
#include "../renderer/plugins/SpinePlugin.hpp"
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../animation/TweenSystem.hpp"
#ifdef ES_ENABLE_TIMELINE
#include "../animation/TimelineSystem.hpp"
#endif

#ifdef ES_PLATFORM_WEB
#include <emscripten/html5.h>
#endif

namespace esengine {

#ifdef ES_ENABLE_TILEMAP
// Forward declaration — defined in TilemapBindings.cpp for web builds,
// needs local instance for non-web. For now we create a fresh system.
#endif

EstellaContext::EstellaContext() = default;

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
    auto resourceManager = makeUnique<resource::ResourceManager>();
    resourceManager->init();
    services_.registerOwned<resource::ResourceManager>(std::move(resourceManager));

    auto gfxDevice = makeUnique<GLDevice>();
    auto* gfxDevicePtr = gfxDevice.get();
    services_.registerOwned<GfxDevice>(std::move(gfxDevice));

    auto renderContext = makeUnique<RenderContext>(*gfxDevicePtr);
    renderContext->init();
    services_.registerOwned<RenderContext>(std::move(renderContext));

    services_.registerOwned<ecs::TransformSystem>(makeUnique<ecs::TransformSystem>());
    services_.registerOwned<animation::TweenSystem>(makeUnique<animation::TweenSystem>());

#ifdef ES_ENABLE_TIMELINE
    services_.registerOwned<animation::TimelineSystem>(makeUnique<animation::TimelineSystem>());
#endif
#ifdef ES_ENABLE_PARTICLES
    services_.registerOwned<particle::ParticleSystem>(makeUnique<particle::ParticleSystem>());
#endif

#ifdef ES_ENABLE_SPINE
    {
        auto* rm = services_.getService<resource::ResourceManager>();
        auto spineRM = makeUnique<spine::SpineResourceManager>(*rm);
        spineRM->init();
        auto* spineRMPtr = spineRM.get();
        services_.registerOwned<spine::SpineResourceManager>(std::move(spineRM));
        services_.registerOwned<spine::SpineSystem>(makeUnique<spine::SpineSystem>(*spineRMPtr));
    }
#endif

    auto* rm = services_.getService<resource::ResourceManager>();
    auto* rc = services_.getService<RenderContext>();
    auto immediateDraw = makeUnique<ImmediateDraw>(*gfxDevicePtr, *rc, *rm);
    immediateDraw->init();
    services_.registerOwned<ImmediateDraw>(std::move(immediateDraw));

    services_.registerOwned<GeometryManager>(makeUnique<GeometryManager>());

    auto renderFrame = makeUnique<RenderFrame>(*gfxDevicePtr, *rc, *rm);
    renderFrame->addPlugin(std::make_unique<SpritePlugin>());
    renderFrame->addPlugin(std::make_unique<UIElementPlugin>());
    renderFrame->addPlugin(std::make_unique<TextPlugin>());
    renderFrame->addPlugin(std::make_unique<ShapePlugin>());

#ifdef ES_ENABLE_TILEMAP
    {
        auto tilemapPlugin = std::make_unique<TilemapRenderPlugin>();
        auto* ts = services_.getService<tilemap::TilemapSystem>();
        if (ts) tilemapPlugin->setTilemapSystem(ts);
        renderFrame->addPlugin(std::move(tilemapPlugin));
    }
#endif
#ifdef ES_ENABLE_SPINE
    {
        auto spinePlugin = std::make_unique<SpinePlugin>();
        spinePlugin->setSpineSystem(services_.getService<spine::SpineSystem>());
        renderFrame->addPlugin(std::move(spinePlugin));
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
#ifdef ES_ENABLE_SPINE
    if (auto* srm = tryGet<spine::SpineResourceManager>()) srm->shutdown();
#endif
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
