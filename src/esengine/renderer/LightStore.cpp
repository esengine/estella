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

    if (ubo_ == 0) {
        ubo_ = device_->createBuffer();
        dirty_ = true;
    }
    device_->bindUniformBuffer(ubo_);
    if (dirty_) {
        device_->bufferData(GfxBufferTarget::Uniform, &data_, sizeof(LightConstants), /*dynamic=*/true);
        dirty_ = false;
    }
    device_->bindBufferBase(LIGHT_CONSTANTS_BINDING, ubo_);
}

void LightStore::free() {
    if (ubo_ != 0 && device_) {
        device_->deleteBuffer(ubo_);
        ubo_ = 0;
    }
    dirty_ = true;
}

}  // namespace esengine
