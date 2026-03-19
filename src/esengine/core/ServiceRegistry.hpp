/**
 * @file    ServiceRegistry.hpp
 * @brief   Typed service locator for engine subsystems
 * @details Provides a template-based registry where subsystems can be
 *          registered and retrieved by type. Supports both owned and
 *          borrowed services.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "Types.hpp"
#include "Log.hpp"

#include <unordered_map>
#include <vector>

namespace esengine {

// =============================================================================
// ServiceRegistry Class
// =============================================================================

/**
 * @brief Typed service locator for engine subsystems
 *
 * @details Allows registering and retrieving subsystems by their C++ type.
 *          - Borrowed: registerService<T>(ptr) for externally managed lifetimes
 *          - Owned: registerOwned<T>(ptr) for registry-managed lifetimes
 *
 * @code
 * ServiceRegistry services;
 * services.registerOwned<RenderContext>(makeUnique<RenderContext>());
 * auto& ctx = services.require<RenderContext>();
 * @endcode
 */
class ServiceRegistry {
public:
    ServiceRegistry() = default;
    ~ServiceRegistry() { clear(); }

    ServiceRegistry(const ServiceRegistry&) = delete;
    ServiceRegistry& operator=(const ServiceRegistry&) = delete;
    ServiceRegistry(ServiceRegistry&&) noexcept = default;
    ServiceRegistry& operator=(ServiceRegistry&&) noexcept = default;

    /**
     * @brief Registers a borrowed service
     * @tparam T The service type
     * @param service Pointer to the service, caller retains ownership
     */
    template<typename T>
    void registerService(T* service) {
        services_[getTypeId<T>()] = static_cast<void*>(service);
    }

    /**
     * @brief Registers an owned service
     * @tparam T The service type
     * @param service Unique pointer transferred to the registry
     */
    template<typename T>
    void registerOwned(Unique<T> service) {
        T* raw = service.get();
        services_[getTypeId<T>()] = static_cast<void*>(raw);

        auto deleter = [](void* ptr) {
            delete static_cast<T*>(ptr);
        };
        owned_.push_back({service.release(), deleter});
    }

    /**
     * @brief Gets a service by type
     * @tparam T The service type
     * @return Pointer to the service, or nullptr if not registered
     */
    template<typename T>
    T* getService() {
        auto it = services_.find(getTypeId<T>());
        if (it == services_.end()) return nullptr;
        return static_cast<T*>(it->second);
    }

    /**
     * @brief Gets a service by type, asserts non-null
     * @tparam T The service type
     * @return Reference to the service
     */
    template<typename T>
    T& require() {
        T* svc = getService<T>();
        ES_ASSERT(svc != nullptr, "Required service not registered");
        return *svc;
    }

    /**
     * @brief Removes and destroys an owned service by type
     * @tparam T The service type to remove
     */
    template<typename T>
    void removeService() {
        TypeId id = getTypeId<T>();
        auto it = services_.find(id);
        if (it == services_.end()) return;

        void* ptr = it->second;
        services_.erase(it);

        for (auto oit = owned_.begin(); oit != owned_.end(); ++oit) {
            if (oit->ptr == ptr) {
                oit->deleter(oit->ptr);
                owned_.erase(oit);
                return;
            }
        }
    }

    /** @brief Removes all services, destroys owned ones in reverse registration order */
    void clear() {
        for (auto it = owned_.rbegin(); it != owned_.rend(); ++it) {
            it->deleter(it->ptr);
        }
        owned_.clear();
        services_.clear();
    }

private:
    struct OwnedEntry {
        void* ptr;
        void (*deleter)(void*);
    };

    std::unordered_map<TypeId, void*> services_;
    std::vector<OwnedEntry> owned_;
};

}  // namespace esengine
