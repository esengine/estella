/**
 * @file    CustomGeometry.cpp
 * @brief   Custom geometry implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "CustomGeometry.hpp"

#include "GfxDevice.hpp"
#include "../core/Log.hpp"

namespace esengine {

void CustomGeometry::init(const f32* vertices, u32 vertexCount, const VertexLayout& layout, bool dynamic) {
    dynamic_ = dynamic;
    stride_ = layout.getStride();
    vertexCount_ = vertexCount * sizeof(f32) / stride_;

    vao_ = VertexArray::create();

    if (dynamic) {
        vbo_ = Shared<VertexBuffer>(VertexBuffer::create(vertexCount * sizeof(f32)));
        vbo_->setDataRaw(vertices, vertexCount * sizeof(f32));
    } else {
        vbo_ = Shared<VertexBuffer>(VertexBuffer::createRaw(vertices, vertexCount * sizeof(f32)));
    }

    vbo_->setLayout(layout);
    vao_->addVertexBuffer(vbo_);
}

void CustomGeometry::setIndices(const u16* indices, u32 indexCount) {
    if (!vao_) return;

    ibo_ = Shared<IndexBuffer>(IndexBuffer::create(indices, indexCount));
    vao_->setIndexBuffer(ibo_);
}

void CustomGeometry::setIndices(const u32* indices, u32 indexCount) {
    if (!vao_) return;

    ibo_ = Shared<IndexBuffer>(IndexBuffer::create(indices, indexCount));
    vao_->setIndexBuffer(ibo_);
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
    if (!vao_) return;

    vao_->bind();

    // Explicitly rebind VBO + attribute pointers + IBO to work around
    // WeChat WebGL VAO state restoration bug
    if (vbo_) {
        vbo_->bind();
        const auto& layout = vbo_->getLayout();
        u32 index = 0;
        for (const auto& attr : layout) {
            GfxDataType gfxType = GfxDataType::Float;
            switch (attr.type) {
            case ShaderDataType::Int:
            case ShaderDataType::Int2:
            case ShaderDataType::Int3:
            case ShaderDataType::Int4:
                gfxType = GfxDataType::Int;
                break;
            case ShaderDataType::Bool:
            case ShaderDataType::UByte4N:
                gfxType = GfxDataType::UnsignedByte;
                break;
            default:
                gfxType = GfxDataType::Float;
                break;
            }
            device.enableVertexAttrib(index);
            device.vertexAttribPointer(
                index,
                static_cast<i32>(shaderDataTypeComponentCount(attr.type)),
                gfxType,
                attr.normalized,
                static_cast<i32>(layout.getStride()),
                attr.offset
            );
            ++index;
        }
    }
    if (ibo_) {
        ibo_->bind();
    }
}

void CustomGeometry::unbind() const {
    if (vao_) {
        vao_->unbind();
    }
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
