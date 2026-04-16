#pragma once

#ifdef ES_PLATFORM_WEB

#include "../core/Types.hpp"
#include "../core/ServiceRegistry.hpp"
#include "../core/EstellaContext.hpp"

namespace esengine {

/**
 * @brief Legacy singleton wrapper around EstellaContext
 * @details Provides backward compatibility for binding files that use ctx().
 *          Internally delegates to an owned EstellaContext instance.
 *          Will be removed once all bindings switch to direct context access.
 */
class EngineContext {
public:
    static EngineContext& instance();

    EngineContext(const EngineContext&) = delete;
    EngineContext& operator=(const EngineContext&) = delete;

    EstellaContext& context() { return context_; }

    ServiceRegistry& services() { return context_.services(); }

    template<typename T>
    T& require() { return context_.require<T>(); }

    template<typename T>
    T* tryGet() { return context_.tryGet<T>(); }

    EngineState& state() { return context_.state(); }
    const EngineState& state() const { return context_.state(); }

    void shutdown() { context_.shutdown(); }

private:
    EngineContext() = default;
    ~EngineContext() = default;

    EstellaContext context_;
};

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
