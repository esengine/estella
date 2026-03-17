#include "Particle.hpp"

namespace esengine::particle {

ParticlePool::ParticlePool(u32 capacity) : capacity_(capacity) {
    particles_.resize(capacity);
    free_list_.reserve(capacity);
    for (u32 i = capacity; i > 0; --i) {
        free_list_.push_back(i - 1);
    }
}

Particle* ParticlePool::allocate() {
    if (free_list_.empty()) {
        return nullptr;
    }
    u32 index = free_list_.back();
    free_list_.pop_back();
    particles_[index] = Particle{};
    particles_[index].alive = true;
    alive_count_++;
    return &particles_[index];
}

void ParticlePool::deallocate(Particle* particle) {
    if (!particle || !particle->alive) {
        return;
    }
    u32 index = static_cast<u32>(particle - particles_.data());
    particle->alive = false;
    free_list_.push_back(index);
    alive_count_--;
}

void ParticlePool::clear() {
    for (auto& p : particles_) {
        p.alive = false;
    }
    free_list_.clear();
    for (u32 i = capacity_; i > 0; --i) {
        free_list_.push_back(i - 1);
    }
    alive_count_ = 0;
}

void ParticlePool::forEachAlive(const std::function<void(Particle&)>& fn) {
    for (auto& p : particles_) {
        if (p.alive) {
            fn(p);
        }
    }
}

void ParticlePool::forEachAlive(const std::function<void(const Particle&)>& fn) const {
    for (const auto& p : particles_) {
        if (p.alive) {
            fn(p);
        }
    }
}

}  // namespace esengine::particle
