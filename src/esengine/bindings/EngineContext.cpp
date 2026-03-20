#ifdef ES_PLATFORM_WEB

#include "EngineContext.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../resource/ResourceManager.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#endif
#include <emscripten/html5.h>

namespace esengine {

EngineContext::EngineContext() {
    services_.registerOwned<EngineState>(makeUnique<EngineState>());
    state_ = services_.getService<EngineState>();
}

EngineContext& EngineContext::instance() {
    static EngineContext ctx;
    return ctx;
}

void EngineContext::shutdown() {
    if (!state_->initialized) return;

    if (auto* rf = tryGet<RenderFrame>()) {
        rf->shutdown();
    }

    if (auto* id = tryGet<ImmediateDraw>()) {
        id->shutdown();
    }

#ifdef ES_ENABLE_SPINE
    if (auto* srm = tryGet<spine::SpineResourceManager>()) {
        srm->shutdown();
    }
#endif

    if (auto* rc = tryGet<RenderContext>()) {
        rc->shutdown();
    }

    if (auto* rm = tryGet<resource::ResourceManager>()) {
        rm->shutdown();
    }

    auto webglCtx = state_->webgl_context;

    services_.removeService<EngineState>();
    services_.clear();

    if (webglCtx > 0) {
        emscripten_webgl_destroy_context(webglCtx);
    }

    services_.registerOwned<EngineState>(makeUnique<EngineState>());
    state_ = services_.getService<EngineState>();
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
