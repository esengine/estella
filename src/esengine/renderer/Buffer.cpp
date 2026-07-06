// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Buffer.cpp
 * @brief   GPU buffer implementations (device-backed)
 * @details VertexBuffer and IndexBuffer delegate every GPU operation to
 *          GfxDevice. This file contains no GL calls.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "Buffer.hpp"
#include "GfxDevice.hpp"
#include "../core/Log.hpp"

namespace esengine {

u32 shaderDataTypeSize(ShaderDataType type) {
    switch (type) {
    case ShaderDataType::Float:  return 4;
    case ShaderDataType::Float2: return 4 * 2;
    case ShaderDataType::Float3: return 4 * 3;
    case ShaderDataType::Float4: return 4 * 4;
    case ShaderDataType::Int:    return 4;
    case ShaderDataType::Int2:   return 4 * 2;
    case ShaderDataType::Int3:   return 4 * 3;
    case ShaderDataType::Int4:   return 4 * 4;
    case ShaderDataType::Bool:   return 1;
    case ShaderDataType::UByte4N: return 4;
    default: return 0;
    }
}

u32 shaderDataTypeComponentCount(ShaderDataType type) {
    switch (type) {
    case ShaderDataType::Float:  return 1;
    case ShaderDataType::Float2: return 2;
    case ShaderDataType::Float3: return 3;
    case ShaderDataType::Float4: return 4;
    case ShaderDataType::Int:    return 1;
    case ShaderDataType::Int2:   return 2;
    case ShaderDataType::Int3:   return 3;
    case ShaderDataType::Int4:   return 4;
    case ShaderDataType::Bool:   return 1;
    case ShaderDataType::UByte4N: return 4;
    default: return 0;
    }
}


// ========================================
// VertexBuffer
// ========================================

VertexBuffer::~VertexBuffer() {
    if (handle_ != BufferHandle::Invalid && device_) {
        device_->deleteBuffer(handle_);
    }
}

VertexBuffer::VertexBuffer(VertexBuffer&& other) noexcept
    : device_(other.device_), handle_(other.handle_), layout_(std::move(other.layout_)) {
    other.handle_ = BufferHandle::Invalid;
}

VertexBuffer& VertexBuffer::operator=(VertexBuffer&& other) noexcept {
    if (this != &other) {
        if (handle_ != BufferHandle::Invalid && device_) {
            device_->deleteBuffer(handle_);
        }
        device_ = other.device_;
        handle_ = other.handle_;
        layout_ = std::move(other.layout_);
        other.handle_ = BufferHandle::Invalid;
    }
    return *this;
}

Unique<VertexBuffer> VertexBuffer::createRaw(GfxDevice& device, const void* data, u32 sizeBytes) {
    auto buffer = makeUnique<VertexBuffer>();
    buffer->device_ = &device;
    buffer->handle_ = device.createBuffer({GfxBufferUsage::Vertex, sizeBytes, /*dynamic=*/false}, data);
    return buffer;
}

Unique<VertexBuffer> VertexBuffer::create(GfxDevice& device, u32 size) {
    auto buffer = makeUnique<VertexBuffer>();
    buffer->device_ = &device;
    buffer->handle_ = device.createBuffer({GfxBufferUsage::Vertex, size, /*dynamic=*/true}, nullptr);
    return buffer;
}

void VertexBuffer::setDataRaw(const void* data, u32 sizeBytes) {
    if (!device_) return;
    device_->updateBuffer(handle_, 0, data, sizeBytes);
}

void VertexBuffer::setSubDataRaw(const void* data, u32 sizeBytes, u32 offsetBytes) {
    if (!device_) return;
    device_->updateBuffer(handle_, offsetBytes, data, sizeBytes);
}

// ========================================
// IndexBuffer
// ========================================

IndexBuffer::~IndexBuffer() {
    if (handle_ != BufferHandle::Invalid && device_) {
        device_->deleteBuffer(handle_);
    }
}

IndexBuffer::IndexBuffer(IndexBuffer&& other) noexcept
    : device_(other.device_), handle_(other.handle_), count_(other.count_), is16Bit_(other.is16Bit_) {
    other.handle_ = BufferHandle::Invalid;
    other.count_ = 0;
}

IndexBuffer& IndexBuffer::operator=(IndexBuffer&& other) noexcept {
    if (this != &other) {
        if (handle_ != BufferHandle::Invalid && device_) {
            device_->deleteBuffer(handle_);
        }
        device_ = other.device_;
        handle_ = other.handle_;
        count_ = other.count_;
        is16Bit_ = other.is16Bit_;
        other.handle_ = BufferHandle::Invalid;
        other.count_ = 0;
    }
    return *this;
}

Unique<IndexBuffer> IndexBuffer::create(GfxDevice& device, const u32* indices, u32 count) {
    auto buffer = makeUnique<IndexBuffer>();
    buffer->device_ = &device;
    buffer->count_ = count;
    buffer->is16Bit_ = false;
    buffer->handle_ = device.createBuffer(
        {GfxBufferUsage::Index, count * static_cast<u32>(sizeof(u32)), /*dynamic=*/false}, indices);
    return buffer;
}

Unique<IndexBuffer> IndexBuffer::create(GfxDevice& device, const u16* indices, u32 count) {
    auto buffer = makeUnique<IndexBuffer>();
    buffer->device_ = &device;
    buffer->count_ = count;
    buffer->is16Bit_ = true;
    buffer->handle_ = device.createBuffer(
        {GfxBufferUsage::Index, count * static_cast<u32>(sizeof(u16)), /*dynamic=*/false}, indices);
    return buffer;
}

}  // namespace esengine
