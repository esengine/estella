// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DragonBonesAdapter.hpp
 * @brief   The host types DragonBones requires, implemented for a module that
 *          renders nothing itself and only hands triangles across a boundary.
 *
 * @details DragonBones is written against an engine that owns a scene graph: a
 *          Slot is expected to add, remove and reorder a display object, and to
 *          push a transform onto it. This module has no scene graph — it poses,
 *          reads the geometry back, and forgets. So most of the fourteen methods a
 *          Slot must implement are legitimately empty here, and the two that are
 *          not (`_updateFrame`, `_updateMesh`) build the vertices the render walk
 *          later emits.
 *
 *          THE ONE SUBTLETY IS WHOSE SPACE THE VERTICES ARE IN. A plain image or
 *          an unweighted mesh is posed in slot-local space and needs the slot's
 *          global matrix applied. A WEIGHTED mesh is already in armature space,
 *          because the bones were applied while computing it — DragonBones signals
 *          exactly this by calling `_identityTransform` instead of
 *          `_updateTransform`, and getting it backwards detaches every weighted
 *          mesh from its armature.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstdint>
#include <vector>

#include "dragonBones/DragonBonesHeaders.h"

#include "SkeletalModule.hpp"

DRAGONBONES_NAMESPACE_BEGIN

/// One atlas page: the texture the host bound to it, and its pixel size.
class EsTextureData : public TextureData {
    BIND_CLASS_TYPE_B(EsTextureData);

public:
    std::uint32_t textureId = 0;

    EsTextureData() = default;

    void _onClear() override {
        textureId = 0;
        TextureData::_onClear();
    }
};

class EsTextureAtlasData : public TextureAtlasData {
    BIND_CLASS_TYPE_B(EsTextureAtlasData);

public:
    /// Bound after parsing, once the host has uploaded the page (see setTexture).
    std::uint32_t textureId = 0;

    EsTextureAtlasData() = default;

    void _onClear() override {
        textureId = 0;
        TextureAtlasData::_onClear();
    }

    TextureData* createTexture() const override { return BaseObject::borrowObject<EsTextureData>(); }

    /// Point every page of this atlas at an uploaded texture.
    void setTexture(std::uint32_t id) {
        textureId = id;
        for (const auto& pair : textures) {
            static_cast<EsTextureData*>(pair.second)->textureId = id;
        }
    }
};

/**
 * A slot that keeps its posed geometry instead of drawing it.
 *
 * Positions and UVs are parallel arrays; `armatureSpace` records which space the
 * positions are in, per the header note.
 */
class EsSlot : public Slot {
    BIND_CLASS_TYPE_A(EsSlot);

public:
    std::vector<float> positions;  ///< x,y per vertex
    std::vector<float> uvs;        ///< u,v per vertex
    std::vector<std::uint16_t> indices;
    std::uint32_t textureId = 0;
    bool armatureSpace = false;  ///< positions already have the bones applied

    /// Slot::init takes the two displays as opaque pointers and never dereferences
    /// them; `_display == _meshDisplay` is the only question ever asked of them.
    char rawDisplay = 0;
    char meshDisplay = 0;

    void _onClear() override {
        positions.clear();
        uvs.clear();
        indices.clear();
        textureId = 0;
        armatureSpace = false;
        Slot::_onClear();
    }

    /// Pour this slot's triangles into `sink`, applying its transform if it owes one.
    /// @param tint  RGBA multiplied onto the slot's own colour — the per-entity
    ///              tint on top of what was authored in DragonBones Pro, not
    ///              instead of it.
    void emit(es::skeletal::TriangleSink& sink, const float tint[4]) const;

protected:
    // — Scene-graph duties this module does not have —
    void _initDisplay(void*, bool) override {}
    void _disposeDisplay(void*, bool) override {}
    void _onUpdateDisplay() override {}
    void _addDisplay() override {}
    void _replaceDisplay(void*, bool) override {}
    void _removeDisplay() override {}
    void _updateZOrder() override {}
    void _updateVisible() override {}
    void _updateBlendMode() override {}
    void _updateColor() override {}

    // — The ones that carry geometry —
    void _updateFrame() override;
    void _updateMesh() override;
    void _updateTransform() override { armatureSpace = false; }
    void _identityTransform() override { armatureSpace = true; }
};

/// The armature's "display": nothing, because there is nothing to display into.
class EsArmatureProxy : public IArmatureProxy {
public:
    ~EsArmatureProxy() override = default;

    void dbInit(Armature* armatureValue) override { _armature = armatureValue; }
    void dbClear() override { _armature = nullptr; }
    void dbUpdate() override {}
    void dispose(bool disposeProxy) override;
    Armature* getArmature() const override { return _armature; }
    Animation* getAnimation() const override { return _armature ? _armature->getAnimation() : nullptr; }

    bool hasDBEventListener(const std::string&) const override { return false; }
    void addDBEventListener(const std::string&, const std::function<void(EventObject*)>&) override {}
    void removeDBEventListener(const std::string&, const std::function<void(EventObject*)>&) override {}
    void dispatchDBEvent(const std::string&, EventObject*) override {}

private:
    Armature* _armature = nullptr;
};

/// Nothing listens: events leave through the module's own ABI, not this one.
class EsEventDispatcher : public IEventDispatcher {
public:
    ~EsEventDispatcher() override = default;
    bool hasDBEventListener(const std::string&) const override { return false; }
    void addDBEventListener(const std::string&, const std::function<void(EventObject*)>&) override {}
    void removeDBEventListener(const std::string&, const std::function<void(EventObject*)>&) override {}
    void dispatchDBEvent(const std::string&, EventObject*) override {}
};

class EsFactory : public BaseFactory {
public:
    EsFactory();
    ~EsFactory() override;

    static EsFactory& instance();

    /**
     * Recycle what the last frame retired, and drain the event queue.
     *
     * Not optional. An armature hands a finished animation state back by calling
     * `_dragonBones->bufferObject(…)`, and the buffer is only emptied here — so
     * without this the pool grows for the life of the app, and every queued event
     * with it. The module calls it once per frame, before advancing armatures.
     */
    void advanceTime(float passedTime);

    /// Build an armature by name; null when this data holds no such armature.
    Armature* buildArmature(const std::string& armatureName, const std::string& dragonBonesName);

protected:
    /// The runtime object every armature recycles and buffers events through.
    /// BaseFactory declares `_dragonBones` and leaves it null; nothing in the
    /// vendored tree assigns it, so each integration owns one.
    EsEventDispatcher _eventDispatcher;

    TextureAtlasData* _buildTextureAtlasData(TextureAtlasData* textureAtlasData, void* textureAtlas) const override;
    Armature* _buildArmature(const BuildArmaturePackage& dataPackage) const override;
    Slot* _buildSlot(const BuildArmaturePackage& dataPackage, const SlotData* slotData, Armature* armature) const override;
};

DRAGONBONES_NAMESPACE_END
