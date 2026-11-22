// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../rhi/GfxEnums.hpp"
#include <webgpu/webgpu.h>
#include <memory>

namespace esengine {
class WebGPUDevice;

/// Two Dawn devices on the same Metal adapter own distinct MTLCommandQueues.
/// IOSurface textures and MTLSharedEvents transfer ownership without a pixel copy or CPU wait.
class MetalComputeQueue {
public:
    static std::unique_ptr<MetalComputeQueue> create(WebGPUDevice& graphics);
    ~MetalComputeQueue();
    bool available() const;
    bool dispatch(u32 program, const GfxComputeBinding* bindings, u32 count, u32 x, u32 y, u32 z);
    void wait();
    void forgetTexture(WGPUTexture texture);
    void forgetProgram(u32 id);
    void forgetBuffer(u32 id);

private:
    WGPUTexture makeTexture(const WGPUTextureDescriptor& desc);
    bool shareTexture(u32 id);
    WGPUTexture bufferSurface(u32 slot, u32 width, u32 height);
    struct State;
    explicit MetalComputeQueue(std::unique_ptr<State> state);
    std::unique_ptr<State> state_;
};
}  // namespace esengine
