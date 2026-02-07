#include "RenderTarget.hpp"

namespace esengine {

void RenderTarget::init(u32 width, u32 height, bool depth, bool linearFilter) {
    width_ = width;
    height_ = height;
    has_depth_ = depth;
    linear_filter_ = linearFilter;

    FramebufferSpec spec;
    spec.width = width;
    spec.height = height;
    spec.depthStencil = depth;
    spec.linearFilter = linearFilter;

    framebuffer_ = Framebuffer::create(spec);
}

void RenderTarget::shutdown() {
    framebuffer_.reset();
    width_ = 0;
    height_ = 0;
}

void RenderTarget::bind() {
    if (framebuffer_) {
        framebuffer_->bind();
    }
}

void RenderTarget::unbind() {
    if (framebuffer_) {
        framebuffer_->unbind();
    }
}

void RenderTarget::resize(u32 width, u32 height) {
    if (width == width_ && height == height_) return;

    width_ = width;
    height_ = height;

    if (framebuffer_) {
        framebuffer_->resize(width, height);
    }
}

u32 RenderTarget::getColorTexture() const {
    return framebuffer_ ? framebuffer_->getColorAttachment() : 0;
}

u32 RenderTarget::getDepthTexture() const {
    return framebuffer_ ? framebuffer_->getDepthAttachment() : 0;
}

RenderTargetManager::Handle RenderTargetManager::create(u32 width, u32 height, bool depth, bool linearFilter) {
    Handle handle;

    if (!free_list_.empty()) {
        handle = free_list_.back();
        free_list_.pop_back();
    } else {
        handle = next_handle_++;
        targets_.resize(handle);
    }

    auto target = makeUnique<RenderTarget>();
    target->init(width, height, depth, linearFilter);

    usize index = handle - 1;
    if (index < targets_.size()) {
        targets_[index] = std::move(target);
    }

    return handle;
}

RenderTarget* RenderTargetManager::get(Handle handle) {
    if (handle == INVALID_HANDLE || handle > targets_.size()) {
        return nullptr;
    }
    return targets_[handle - 1].get();
}

void RenderTargetManager::release(Handle handle) {
    if (handle == INVALID_HANDLE || handle > targets_.size()) {
        return;
    }

    auto& target = targets_[handle - 1];
    if (target) {
        target->shutdown();
        target.reset();
        free_list_.push_back(handle);
    }
}

bool RenderTargetManager::isValid(Handle handle) const {
    if (handle == INVALID_HANDLE || handle > targets_.size()) {
        return false;
    }
    return targets_[handle - 1] != nullptr;
}

}  // namespace esengine
