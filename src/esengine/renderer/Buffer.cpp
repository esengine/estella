// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Buffer.cpp
 * @brief   GPU buffer implementations (device-backed)
 * @details VertexBuffer, IndexBuffer and VertexArray delegate every GPU
 *          operation to GfxDevice. This file contains no GL calls.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the PolyForm Noncommercial License 1.0.0.
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

namespace {

GfxDataType toGfxDataType(ShaderDataType type) {
    switch (type) {
    case ShaderDataType::Int:
    case ShaderDataType::Int2:
    case ShaderDataType::Int3:
    case ShaderDataType::Int4:
        return GfxDataType::Int;
    case ShaderDataType::Bool:
    case ShaderDataType::UByte4N:
        return GfxDataType::UnsignedByte;
    default:
        return GfxDataType::Float;
    }
}

}  // namespace

// ========================================
// VertexBuffer
// ========================================

VertexBuffer::~VertexBuffer() {
    if (bufferId_ != 0 && device_) {
        device_->deleteBuffer(bufferId_);
    }
}

VertexBuffer::VertexBuffer(VertexBuffer&& other) noexcept
    : device_(other.device_), bufferId_(other.bufferId_), layout_(std::move(other.layout_)) {
    other.bufferId_ = 0;
}

VertexBuffer& VertexBuffer::operator=(VertexBuffer&& other) noexcept {
    if (this != &other) {
        if (bufferId_ != 0 && device_) {
            device_->deleteBuffer(bufferId_);
        }
        device_ = other.device_;
        bufferId_ = other.bufferId_;
        layout_ = std::move(other.layout_);
        other.bufferId_ = 0;
    }
    return *this;
}

Unique<VertexBuffer> VertexBuffer::createRaw(GfxDevice& device, const void* data, u32 sizeBytes) {
    auto buffer = makeUnique<VertexBuffer>();
    buffer->device_ = &device;
    buffer->bufferId_ = device.createBuffer();
    device.bindVertexBuffer(buffer->bufferId_);
    device.bufferData(GfxBufferTarget::Vertex, data, sizeBytes, false);
    return buffer;
}

Unique<VertexBuffer> VertexBuffer::create(GfxDevice& device, u32 size) {
    auto buffer = makeUnique<VertexBuffer>();
    buffer->device_ = &device;
    buffer->bufferId_ = device.createBuffer();
    device.bindVertexBuffer(buffer->bufferId_);
    device.bufferData(GfxBufferTarget::Vertex, nullptr, size, true);
    return buffer;
}

void VertexBuffer::bind() const {
    if (device_) device_->bindVertexBuffer(bufferId_);
}

void VertexBuffer::unbind() const {
    if (device_) device_->bindVertexBuffer(0);
}

void VertexBuffer::setDataRaw(const void* data, u32 sizeBytes) {
    if (!device_) return;
    device_->bindVertexBuffer(bufferId_);
    device_->bufferSubData(GfxBufferTarget::Vertex, 0, data, sizeBytes);
}

void VertexBuffer::setSubDataRaw(const void* data, u32 sizeBytes, u32 offsetBytes) {
    if (!device_) return;
    device_->bindVertexBuffer(bufferId_);
    device_->bufferSubData(GfxBufferTarget::Vertex, offsetBytes, data, sizeBytes);
}

// ========================================
// IndexBuffer
// ========================================

IndexBuffer::~IndexBuffer() {
    if (bufferId_ != 0 && device_) {
        device_->deleteBuffer(bufferId_);
    }
}

IndexBuffer::IndexBuffer(IndexBuffer&& other) noexcept
    : device_(other.device_), bufferId_(other.bufferId_), count_(other.count_), is16Bit_(other.is16Bit_) {
    other.bufferId_ = 0;
    other.count_ = 0;
}

IndexBuffer& IndexBuffer::operator=(IndexBuffer&& other) noexcept {
    if (this != &other) {
        if (bufferId_ != 0 && device_) {
            device_->deleteBuffer(bufferId_);
        }
        device_ = other.device_;
        bufferId_ = other.bufferId_;
        count_ = other.count_;
        is16Bit_ = other.is16Bit_;
        other.bufferId_ = 0;
        other.count_ = 0;
    }
    return *this;
}

Unique<IndexBuffer> IndexBuffer::create(GfxDevice& device, const u32* indices, u32 count) {
    auto buffer = makeUnique<IndexBuffer>();
    buffer->device_ = &device;
    buffer->count_ = count;
    buffer->is16Bit_ = false;
    buffer->bufferId_ = device.createBuffer();
    device.bindIndexBuffer(buffer->bufferId_);
    device.bufferData(GfxBufferTarget::Index, indices, count * sizeof(u32), false);
    return buffer;
}

Unique<IndexBuffer> IndexBuffer::create(GfxDevice& device, const u16* indices, u32 count) {
    auto buffer = makeUnique<IndexBuffer>();
    buffer->device_ = &device;
    buffer->count_ = count;
    buffer->is16Bit_ = true;
    buffer->bufferId_ = device.createBuffer();
    device.bindIndexBuffer(buffer->bufferId_);
    device.bufferData(GfxBufferTarget::Index, indices, count * sizeof(u16), false);
    return buffer;
}

void IndexBuffer::bind() const {
    if (device_) device_->bindIndexBuffer(bufferId_);
}

void IndexBuffer::unbind() const {
    if (device_) device_->bindIndexBuffer(0);
}

// ========================================
// VertexArray
// ========================================

VertexArray::~VertexArray() {
    if (arrayId_ != 0 && device_) {
        device_->deleteVertexArray(arrayId_);
    }
}

VertexArray::VertexArray(VertexArray&& other) noexcept
    : device_(other.device_)
    , arrayId_(other.arrayId_)
    , vertexAttribIndex_(other.vertexAttribIndex_)
    , vertexBuffers_(std::move(other.vertexBuffers_))
    , indexBuffer_(std::move(other.indexBuffer_)) {
    other.arrayId_ = 0;
    other.vertexAttribIndex_ = 0;
}

VertexArray& VertexArray::operator=(VertexArray&& other) noexcept {
    if (this != &other) {
        if (arrayId_ != 0 && device_) {
            device_->deleteVertexArray(arrayId_);
        }
        device_ = other.device_;
        arrayId_ = other.arrayId_;
        vertexAttribIndex_ = other.vertexAttribIndex_;
        vertexBuffers_ = std::move(other.vertexBuffers_);
        indexBuffer_ = std::move(other.indexBuffer_);
        other.arrayId_ = 0;
        other.vertexAttribIndex_ = 0;
    }
    return *this;
}

Unique<VertexArray> VertexArray::create(GfxDevice& device) {
    auto vao = makeUnique<VertexArray>();
    vao->device_ = &device;
    vao->arrayId_ = device.createVertexArray();
    return vao;
}

void VertexArray::bind() const {
    if (device_) device_->bindVertexArray(arrayId_);
}

void VertexArray::unbind() const {
    if (device_) device_->bindVertexArray(0);
}

void VertexArray::addVertexBuffer(Shared<VertexBuffer> buffer) {
    ES_ASSERT(!buffer->getLayout().getAttributes().empty(), "Vertex buffer has no layout");

    if (device_) {
        device_->bindVertexArray(arrayId_);
        buffer->bind();

        const auto& layout = buffer->getLayout();
        for (const auto& attr : layout) {
            bool normalized = attr.normalized || attr.type == ShaderDataType::UByte4N;
            device_->enableVertexAttrib(vertexAttribIndex_);
            device_->vertexAttribPointer(
                vertexAttribIndex_,
                static_cast<i32>(shaderDataTypeComponentCount(attr.type)),
                toGfxDataType(attr.type),
                normalized,
                static_cast<i32>(layout.getStride()),
                attr.offset
            );
            ++vertexAttribIndex_;
        }
    }
    vertexBuffers_.push_back(std::move(buffer));
}

void VertexArray::setIndexBuffer(Shared<IndexBuffer> buffer) {
    if (device_) {
        device_->bindVertexArray(arrayId_);
        buffer->bind();
    }
    indexBuffer_ = std::move(buffer);
}

}  // namespace esengine
