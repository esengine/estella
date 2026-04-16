/**
 * @file    EstellaContext.hpp
 * @brief   Instance-based engine context for estella renderer
 * @details Owns all engine subsystems (GfxDevice, RenderContext, RenderFrame,
 *          ResourceManager, etc.) with explicit lifecycle management.
 *          Replaces the EngineContext singleton for multi-instance support.
 *
 * @author  ESEngine Team
 * @date    2026
 */
#pragma once

#include "Types.hpp"
#include "ServiceRegistry.hpp"
#include "../bindings/EngineState.hpp"

namespace esengine {

class GfxDevice;

class EstellaContext {
public:
    EstellaContext();
    ~EstellaContext();

    EstellaContext(const EstellaContext&) = delete;
    EstellaContext& operator=(const EstellaContext&) = delete;

    /**
     * @brief Initialize with an existing WebGL context handle
     * @param webglContextHandle Valid WebGL context (from emscripten_webgl_create_context)
     * @return True on success
     */
    bool init(int webglContextHandle);

    /**
     * @brief Shut down all subsystems and release resources
     */
    void shutdown();

    /** @brief Check if the context is initialized */
    bool isInitialized() const { return state_.initialized; }

    ServiceRegistry& services() { return services_; }

    template<typename T>
    T& require() { return services_.require<T>(); }

    template<typename T>
    T* tryGet() { return services_.getService<T>(); }

    EngineState& state() { return state_; }
    const EngineState& state() const { return state_; }

private:
    void initSubsystems();

    ServiceRegistry services_;
    EngineState state_;
};

}  // namespace esengine
