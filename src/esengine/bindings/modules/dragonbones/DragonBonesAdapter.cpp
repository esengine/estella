// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DragonBonesAdapter.cpp
 * @brief   Geometry for the host types in DragonBonesAdapter.hpp.
 */
#include "./DragonBonesAdapter.hpp"

#include <cmath>
#include <cstdlib>

DRAGONBONES_NAMESPACE_BEGIN

namespace {

/// Atlas pixels → 0..1, which is what the renderer samples with.
inline void normalize(float& u, float& v, const TextureAtlasData* page) {
    const float w = page && page->width > 0 ? static_cast<float>(page->width) : 1.0f;
    const float h = page && page->height > 0 ? static_cast<float>(page->height) : 1.0f;
    u /= w;
    v /= h;
}

}  // namespace

void EsSlot::_updateFrame() {
    positions.clear();
    uvs.clear();
    indices.clear();
    textureId = 0;

    const auto* vertices =
        (_deformVertices != nullptr && _display == _meshDisplay) ? _deformVertices->verticesData : nullptr;
    auto* texture = static_cast<EsTextureData*>(_textureData);
    if (_displayIndex < 0 || _display == nullptr || texture == nullptr || texture->textureId == 0) return;

    textureId = texture->textureId;
    const auto& region = texture->region;
    const auto* page = texture->parent;

    if (vertices != nullptr) {
        const auto* data = vertices->data;
        const auto* intArray = data->intArray;
        const auto* floatArray = data->floatArray;
        const unsigned vertexCount = intArray[vertices->offset + static_cast<unsigned>(BinaryOffset::MeshVertexCount)];
        const unsigned triangleCount =
            intArray[vertices->offset + static_cast<unsigned>(BinaryOffset::MeshTriangleCount)];
        int vertexOffset = intArray[vertices->offset + static_cast<unsigned>(BinaryOffset::MeshFloatOffset)];
        // The parser packs this offset as a signed 16-bit value; a mesh far enough
        // into the float array wraps negative and has to be brought back.
        if (vertexOffset < 0) vertexOffset += 65536;
        const unsigned uvOffset = static_cast<unsigned>(vertexOffset) + vertexCount * 2;

        positions.resize(vertexCount * 2);
        uvs.resize(vertexCount * 2);
        for (unsigned i = 0; i < vertexCount * 2; i += 2) {
            positions[i] = floatArray[vertexOffset + i];
            positions[i + 1] = floatArray[vertexOffset + i + 1];

            const float u = floatArray[uvOffset + i];
            const float v = floatArray[uvOffset + i + 1];
            // A rotated atlas entry is stored turned a quarter clockwise, so the
            // mesh's u walks the region's height and its v walks the width.
            float su = texture->rotated ? region.x + (1.0f - v) * region.width : region.x + u * region.width;
            float sv = texture->rotated ? region.y + u * region.height : region.y + v * region.height;
            normalize(su, sv, page);
            uvs[i] = su;
            uvs[i + 1] = sv;
        }

        indices.resize(triangleCount * 3);
        for (unsigned i = 0; i < triangleCount * 3; ++i) {
            indices[i] = static_cast<std::uint16_t>(
                intArray[vertices->offset + static_cast<unsigned>(BinaryOffset::MeshVertexIndices) + i]);
        }

        // A weighted mesh is posed in ARMATURE space by _updateMesh, so its
        // vertices must not be run through the slot transform as well.
        if (vertices->weight != nullptr) _identityTransform();
        return;
    }

    // A plain image: one quad, sized in the same scaled units the pivot is in
    // (Slot::_updateDisplayData multiplies the pivot by width * scale).
    const float scale = texture->parent->scale * _armature->_armatureData->scale;
    const float w = std::abs(region.width) * scale;
    const float h = std::abs(region.height) * scale;

    positions = {0.0f, 0.0f, 0.0f, h, w, h, w, 0.0f};
    float u0 = region.x, v0 = region.y;
    float u1 = region.x + region.width, v1 = region.y + region.height;
    normalize(u0, v0, page);
    normalize(u1, v1, page);
    uvs = {u0, v0, u0, v1, u1, v1, u1, v0};
    indices = {0, 1, 2, 0, 2, 3};
}

void EsSlot::_updateMesh() {
    if (_deformVertices == nullptr) return;
    const auto* vertices = _deformVertices->verticesData;
    if (vertices == nullptr) return;

    const float scale = _armature->_armatureData->scale;
    const auto& deform = _deformVertices->vertices;
    const auto& bones = _deformVertices->bones;
    const auto* weight = vertices->weight;
    const bool hasDeform = !deform.empty();

    const auto* data = vertices->data;
    const auto* intArray = data->intArray;
    const auto* floatArray = data->floatArray;
    const auto vertexCount =
        static_cast<std::size_t>(intArray[vertices->offset + static_cast<unsigned>(BinaryOffset::MeshVertexCount)]);
    if (positions.size() < vertexCount * 2) positions.resize(vertexCount * 2);

    if (weight != nullptr) {
        int weightFloatOffset = intArray[weight->offset + static_cast<unsigned>(BinaryOffset::WeigthFloatOffset)];
        if (weightFloatOffset < 0) weightFloatOffset += 65536;

        // Each vertex names its own bone count, then that many (boneIndex, weight)
        // pairs — so the three cursors advance together and none can be derived.
        std::size_t iB = weight->offset + static_cast<unsigned>(BinaryOffset::WeigthBoneIndices) + bones.size();
        std::size_t iV = static_cast<std::size_t>(weightFloatOffset);
        std::size_t iF = 0;

        for (std::size_t i = 0; i < vertexCount; ++i) {
            const auto boneCount = static_cast<std::size_t>(intArray[iB++]);
            float xG = 0.0f, yG = 0.0f;
            for (std::size_t j = 0; j < boneCount; ++j) {
                const auto boneIndex = static_cast<unsigned>(intArray[iB++]);
                const auto* bone = bones[boneIndex];
                if (bone == nullptr) continue;

                const auto& matrix = bone->globalTransformMatrix;
                const float w = floatArray[iV++];
                float xL = floatArray[iV++] * scale;
                float yL = floatArray[iV++] * scale;
                if (hasDeform) {
                    xL += deform[iF++];
                    yL += deform[iF++];
                }
                xG += (matrix.a * xL + matrix.c * yL + matrix.tx) * w;
                yG += (matrix.b * xL + matrix.d * yL + matrix.ty) * w;
            }
            positions[i * 2] = xG;
            positions[i * 2 + 1] = yG;
        }
        return;
    }

    if (!hasDeform) return;

    int vertexOffset = intArray[vertices->offset + static_cast<unsigned>(BinaryOffset::MeshFloatOffset)];
    if (vertexOffset < 0) vertexOffset += 65536;
    for (std::size_t i = 0; i < vertexCount; ++i) {
        positions[i * 2] = floatArray[vertexOffset + i * 2] * scale + deform[i * 2];
        positions[i * 2 + 1] = floatArray[vertexOffset + i * 2 + 1] * scale + deform[i * 2 + 1];
    }
}

void EsSlot::emit(es::skeletal::TriangleSink& sink, const float tint[4]) const {
    if (indices.empty() || textureId == 0 || !_visible) return;

    const std::size_t vertexCount = positions.size() / 2;
    std::vector<float> world(positions.size());

    if (armatureSpace) {
        world = positions;
    } else {
        const auto& m = globalTransformMatrix;
        for (std::size_t i = 0; i < vertexCount; ++i) {
            // The pivot moves the display's origin, and it lives in the same scaled
            // units as the vertices — so it is subtracted before the matrix, not after.
            const float x = positions[i * 2] - _pivotX;
            const float y = positions[i * 2 + 1] - _pivotY;
            world[i * 2] = m.a * x + m.c * y + m.tx;
            world[i * 2 + 1] = m.b * x + m.d * y + m.ty;
        }
    }

    // DragonBones poses in a y-DOWN space (its authoring tool inherits Flash's
    // screen axes); the engine's world is y-up. Flipping here, at the one place
    // geometry leaves the runtime, is what keeps every consumer consistent —
    // db_getBounds reads these same vertices, so the box follows the character
    // instead of describing a mirror of it. Winding is left alone: the 2D
    // pipeline does not cull, and reversing it would only hide the flip if it
    // ever started to.
    for (std::size_t i = 0; i < vertexCount; ++i) {
        world[i * 2 + 1] = -world[i * 2 + 1];
    }

    // The slot's authored colour and the entity's tint multiply. Replacing rather
    // than multiplying would throw away what the artist set in DragonBones Pro the
    // moment a game tinted anything.
    const float rgba[4] = {
        _colorTransform.redMultiplier * tint[0],
        _colorTransform.greenMultiplier * tint[1],
        _colorTransform.blueMultiplier * tint[2],
        _colorTransform.alphaMultiplier * tint[3],
    };
    sink.emit(world.data(), uvs.data(), static_cast<int>(vertexCount), indices.data(),
              static_cast<int>(indices.size()), textureId, static_cast<int>(_blendMode), rgba);
}

void EsArmatureProxy::dispose(bool) {
    if (_armature != nullptr) {
        _armature->dispose();
        _armature = nullptr;
    }
}

// — Factory ------------------------------------------------------------------

/**
 * BaseFactory leaves `_dragonBones` null and never assigns it — every integration
 * is expected to bring its own. Skipping that step does not fail to link and does
 * not fail to draw: it fails the first time an armature retires an animation
 * state, because `Animation::advanceTime` calls `_armature->_dragonBones->
 * bufferObject(state)` unconditionally. On wasm a null dereference lands in
 * readable low memory and passes unnoticed; on a device it is a SIGSEGV. So the
 * bug looked platform-specific and was not.
 */
EsFactory::EsFactory() {
    _dragonBones = new DragonBones(&_eventDispatcher);
}

EsFactory::~EsFactory() {
    delete _dragonBones;
    _dragonBones = nullptr;
}

void EsFactory::advanceTime(float passedTime) {
    if (_dragonBones != nullptr) _dragonBones->advanceTime(passedTime);
}

EsFactory& EsFactory::instance() {
    static EsFactory factory;
    return factory;
}

TextureAtlasData* EsFactory::_buildTextureAtlasData(TextureAtlasData* textureAtlasData, void* textureAtlas) const {
    if (textureAtlasData != nullptr) {
        static_cast<EsTextureAtlasData*>(textureAtlasData)
            ->setTexture(static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(textureAtlas)));
        return textureAtlasData;
    }
    return BaseObject::borrowObject<EsTextureAtlasData>();
}

Armature* EsFactory::_buildArmature(const BuildArmaturePackage& dataPackage) const {
    auto* armature = BaseObject::borrowObject<Armature>();
    // The proxy is an interface, not a pooled BaseObject; the armature owns it for
    // as long as it lives and drops it in dispose().
    auto* proxy = new EsArmatureProxy();
    armature->init(dataPackage.armature, proxy, proxy, _dragonBones);
    return armature;
}

Slot* EsFactory::_buildSlot(const BuildArmaturePackage&, const SlotData* slotData, Armature* armature) const {
    auto* slot = BaseObject::borrowObject<EsSlot>();
    // The armature is not optional: the slot reads its scale and its bones while
    // posing, and a slot built without one silently produces nothing.
    slot->init(slotData, armature, &slot->rawDisplay, &slot->meshDisplay);
    return slot;
}

Armature* EsFactory::buildArmature(const std::string& armatureName, const std::string& dragonBonesName) {
    return BaseFactory::buildArmature(armatureName, dragonBonesName, "", "");
}

DRAGONBONES_NAMESPACE_END
