#pragma once

#include "../core/Types.hpp"

namespace esengine::ecs {

// Forward declaration
class Registry;

// Base class for all systems
class System {
public:
    virtual ~System() = default;

    // Called once when system is added
    virtual void init(Registry& registry) { (void)registry; }

    // Called every frame
    virtual void update(Registry& registry, f32 deltaTime) = 0;

    // Called once when system is removed
    virtual void shutdown(Registry& registry) { (void)registry; }

    // Enable/disable system
    void setEnabled(bool enabled) { enabled_ = enabled; }
    bool isEnabled() const { return enabled_; }

    // Priority for ordering (lower = runs first)
    void setPriority(i32 priority) { priority_ = priority; }
    i32 getPriority() const { return priority_; }

protected:
    bool enabled_ = true;
    i32 priority_ = 0;
};

// System group for organizing systems
class SystemGroup {
public:
    void addSystem(Unique<System> system) {
        systems_.push_back(std::move(system));
        sortSystems();
    }

    template<typename T, typename... Args>
    T& createSystem(Args&&... args) {
        auto system = makeUnique<T>(std::forward<Args>(args)...);
        T& ref = *system;
        addSystem(std::move(system));
        return ref;
    }

    void init(Registry& registry) {
        for (auto& system : systems_) {
            system->init(registry);
        }
    }

    void update(Registry& registry, f32 deltaTime) {
        for (auto& system : systems_) {
            if (system->isEnabled()) {
                system->update(registry, deltaTime);
            }
        }
    }

    void shutdown(Registry& registry) {
        for (auto& system : systems_) {
            system->shutdown(registry);
        }
    }

private:
    void sortSystems() {
        std::sort(systems_.begin(), systems_.end(),
            [](const Unique<System>& a, const Unique<System>& b) {
                return a->getPriority() < b->getPriority();
            });
    }

    std::vector<Unique<System>> systems_;
};

}  // namespace esengine::ecs
