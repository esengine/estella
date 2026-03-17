#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"

#include <functional>
#include <vector>

namespace esengine::particle {

struct Particle {
    glm::vec2 position{0.0f};
    glm::vec2 velocity{0.0f};
    f32 rotation = 0.0f;
    f32 angular_velocity = 0.0f;
    f32 lifetime = 1.0f;
    f32 age = 0.0f;
    f32 size = 1.0f;
    glm::vec4 color{1.0f};
    f32 start_size = 1.0f;
    f32 end_size = 0.0f;
    glm::vec4 start_color{1.0f};
    glm::vec4 end_color{1.0f, 1.0f, 1.0f, 0.0f};
    u16 sprite_frame = 0;
    bool alive = false;
};

class ParticlePool {
public:
    explicit ParticlePool(u32 capacity);

    Particle* allocate();
    void deallocate(Particle* particle);
    void clear();

    u32 capacity() const { return capacity_; }
    u32 aliveCount() const { return alive_count_; }

    void forEachAlive(const std::function<void(Particle&)>& fn);
    void forEachAlive(const std::function<void(const Particle&)>& fn) const;

private:
    std::vector<Particle> particles_;
    std::vector<u32> free_list_;
    u32 capacity_;
    u32 alive_count_ = 0;
};

}  // namespace esengine::particle
