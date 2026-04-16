#ifdef ES_PLATFORM_WEB

#include "EngineContext.hpp"

namespace esengine {

EngineContext& EngineContext::instance() {
    static EngineContext ctx;
    return ctx;
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
