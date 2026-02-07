#pragma once

#include "../core/Types.hpp"
#include "Framebuffer.hpp"

#include <glm/glm.hpp>
#include <vector>

namespace esengine {

class RenderTarget {
public:
    RenderTarget() = default;
    ~RenderTarget() = default;

    RenderTarget(const RenderTarget&) = delete;
    RenderTarget& operator=(const RenderTarget&) = delete;
    RenderTarget(RenderTarget&&) = default;
    RenderTarget& operator=(RenderTarget&&) = default;

    void init(u32 width, u32 height, bool depth = true, bool linearFilter = false);
    void shutdown();

    void bind();
    void unbind();
    void resize(u32 width, u32 height);

    u32 getColorTexture() const;
    u32 getDepthTexture() const;
    glm::uvec2 getSize() const { return { width_, height_ }; }
    u32 getWidth() const { return width_; }
    u32 getHeight() const { return height_; }

    bool isValid() const { return framebuffer_ != nullptr; }

private:
    Unique<Framebuffer> framebuffer_;
    u32 width_ = 0;
    u32 height_ = 0;
    bool has_depth_ = true;
    bool linear_filter_ = false;
};

class RenderTargetManager {
public:
    using Handle = u32;
    static constexpr Handle INVALID_HANDLE = 0;

    RenderTargetManager() = default;
    ~RenderTargetManager() = default;

    Handle create(u32 width, u32 height, bool depth = true, bool linearFilter = false);
    RenderTarget* get(Handle handle);
    void release(Handle handle);
    bool isValid(Handle handle) const;

private:
    std::vector<Unique<RenderTarget>> targets_;
    std::vector<Handle> free_list_;
    Handle next_handle_ = 1;
};

}  // namespace esengine
