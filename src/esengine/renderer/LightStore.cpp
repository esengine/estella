// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LightStore.cpp
 * @brief   GPU-touching parts of LightStore (the per-frame lighting UBO lifecycle + binding).
 */
#include "LightStore.hpp"

#include "GfxDevice.hpp"
#include "GfxEnums.hpp"

namespace esengine {

void LightStore::uploadAndBind() {
    if (!device_) return;

    if (ubo_ == BufferHandle::Invalid) {
        ubo_ = device_->createBuffer(
            {GfxBufferUsage::Uniform, static_cast<u32>(sizeof(LightConstants)), /*dynamic=*/true}, &data_);
        dirty_ = false;
    } else if (dirty_) {
        device_->updateBuffer(ubo_, 0, &data_, sizeof(LightConstants));
        dirty_ = false;
    }
    device_->setUniformBuffer(LIGHT_CONSTANTS_BINDING, ubo_);
}

void LightStore::free() {
    if (ubo_ != BufferHandle::Invalid && device_) {
        device_->deleteBuffer(ubo_);
        ubo_ = BufferHandle::Invalid;
    }
    dirty_ = true;
}

}  // namespace esengine
