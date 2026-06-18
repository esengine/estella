
#include "EngineContext.hpp"

namespace esengine {

EngineContext& EngineContext::instance() {
    static EngineContext ctx;
    return ctx;
}

}  // namespace esengine

