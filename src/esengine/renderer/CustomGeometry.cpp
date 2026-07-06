// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CustomGeometry.cpp
 * @brief   Custom geometry implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "CustomGeometry.hpp"

#include "GfxDevice.hpp"
#include "../core/Log.hpp"

namespace esengine {

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

void CustomGeometry::init(GfxDevice& device, const f32* vertices, u32 vertexCount,
                          const VertexLayout& layout, bool dynamic) {
    device_ = &device;
    dynamic_ = dynamic;
    stride_ = layout.getStride();
    if (stride_ == 0 || layout.getAttributes().size() > MAX_VERTEX_ATTRIBUTES) {
        // An empty vertex layout would make the divide below a divide-by-zero
        // (a wasm trap). Leave the geometry uninitialized: layout_ stays Invalid,
        // so isValid() is false and bind()/draw become no-ops.
        ES_LOG_ERROR("CustomGeometry::init: unusable vertex layout (stride {}, {} attributes); skipping setup",
                     stride_, layout.getAttributes().size());
        return;
    }
    vertexCount_ = vertexCount * sizeof(f32) / stride_;

    if (dynamic) {
        vbo_ = Shared<VertexBuffer>(VertexBuffer::create(device, vertexCount * sizeof(f32)));
        vbo_->setDataRaw(vertices, vertexCount * sizeof(f32));
    } else {
        vbo_ = Shared<VertexBuffer>(VertexBuffer::createRaw(device, vertices, vertexCount * sizeof(f32)));
    }
    vbo_->setLayout(layout);

    VertexLayoutDesc desc;
    desc.strides[0] = stride_;
    for (const auto& attr : layout) {
        GfxVertexAttribute& out = desc.attributes[desc.attributeCount];
        out.location = desc.attributeCount;
        out.components = static_cast<u8>(shaderDataTypeComponentCount(attr.type));
        out.type = toGfxDataType(attr.type);
        out.normalized = attr.normalized || attr.type == ShaderDataType::UByte4N;
        out.offset = attr.offset;
        out.bufferSlot = 0;
        ++desc.attributeCount;
    }
    layout_ = device.createVertexLayout(desc);
}

void CustomGeometry::setIndices(const u16* indices, u32 indexCount) {
    if (!isValid() || !device_) return;
    ibo_ = Shared<IndexBuffer>(IndexBuffer::create(*device_, indices, indexCount));
}

void CustomGeometry::setIndices(const u32* indices, u32 indexCount) {
    if (!isValid() || !device_) return;
    ibo_ = Shared<IndexBuffer>(IndexBuffer::create(*device_, indices, indexCount));
}

void CustomGeometry::updateVertices(const f32* vertices, u32 vertexCount, u32 offset) {
    if (!dynamic_ || !vbo_) {
        ES_LOG_WARN("Cannot update non-dynamic geometry");
        return;
    }

    vbo_->setSubDataRaw(vertices, vertexCount * sizeof(f32), offset * sizeof(f32));

    u32 endOffset = offset + vertexCount;
    u32 newVertexCount = endOffset * sizeof(f32) / stride_;
    if (newVertexCount > vertexCount_) {
        vertexCount_ = newVertexCount;
    }
}

void CustomGeometry::bind(GfxDevice& device) const {
    if (!isValid()) return;
    device.setVertexBuffer(0, vbo_ ? vbo_->handle() : BufferHandle::Invalid, 0);
    device.setIndexBuffer(ibo_ ? ibo_->handle() : BufferHandle::Invalid);
}

u32 CustomGeometry::getIndexCount() const {
    if (ibo_) {
        return ibo_->getCount();
    }
    return 0;
}

bool CustomGeometry::hasIndices() const {
    return ibo_ != nullptr && ibo_->getCount() > 0;
}

// =============================================================================
// GeometryManager Implementation
// =============================================================================

GeometryManager::GeometryHandle GeometryManager::create() {
    GeometryHandle handle;

    if (!freeList_.empty()) {
        handle = freeList_.back();
        freeList_.pop_back();
        geometries_[handle - 1] = makeUnique<CustomGeometry>();
    } else {
        handle = nextHandle_++;
        geometries_.push_back(makeUnique<CustomGeometry>());
    }

    return handle;
}

CustomGeometry* GeometryManager::get(GeometryHandle handle) {
    if (handle == INVALID_HANDLE || handle > geometries_.size()) {
        return nullptr;
    }
    return geometries_[handle - 1].get();
}

const CustomGeometry* GeometryManager::get(GeometryHandle handle) const {
    if (handle == INVALID_HANDLE || handle > geometries_.size()) {
        return nullptr;
    }
    return geometries_[handle - 1].get();
}

void GeometryManager::release(GeometryHandle handle) {
    if (handle == INVALID_HANDLE || handle > geometries_.size()) {
        return;
    }
    geometries_[handle - 1].reset();
    freeList_.push_back(handle);
}

bool GeometryManager::isValid(GeometryHandle handle) const {
    if (handle == INVALID_HANDLE || handle > geometries_.size()) {
        return false;
    }
    return geometries_[handle - 1] != nullptr;
}

}  // namespace esengine
