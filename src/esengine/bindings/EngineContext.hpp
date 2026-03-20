#pragma once

#ifdef ES_PLATFORM_WEB

#include "../core/Types.hpp"
#include "../core/ServiceRegistry.hpp"
#include "EngineState.hpp"

namespace esengine {

class EngineContext {
public:
    static EngineContext& instance();

    EngineContext(const EngineContext&) = delete;
    EngineContext& operator=(const EngineContext&) = delete;

    void shutdown();

    ServiceRegistry& services() { return services_; }

    template<typename T>
    T& require() { return services_.require<T>(); }

    template<typename T>
    T* tryGet() { return services_.getService<T>(); }

    EngineState& state() { return *state_; }
    const EngineState& state() const { return *state_; }

private:
    EngineContext();
    ~EngineContext() = default;

    ServiceRegistry services_;
    EngineState* state_ = nullptr;
};

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
