#pragma once

#ifdef ES_PLATFORM_WEB

#include "../core/EstellaContext.hpp"

namespace esengine {

/**
 * @brief Active engine context for the current thread/call
 * @details All binding functions access the engine through this pointer.
 *          Set by initRenderer / setActiveContext before any rendering calls.
 */
inline EstellaContext* g_activeContext = nullptr;

/**
 * @brief Get the active context (asserts non-null in debug)
 */
inline EstellaContext& activeCtx() {
    return *g_activeContext;
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
