// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "BatchPlugin.hpp"
#include "../../resource/TextureMetadata.hpp"

#include <vector>

namespace esengine {

class SpritePlugin : public BatchPlugin {
public:
    // A Sprite parented into a UI tree is laid out and ordered by that tree
    // (UIRenderOrderSystem assigns it a layer), so it is screen content when the
    // tree is — and has to be drawn by the pass that owns those coordinates.
    bool drawsScreenUI() const override { return true; }
    void collect(RenderCollectContext& ctx) override;
    const char* collectScope() const override { return "render.collect.sprite"; }

private:
    void emitTiledQuads(
        TransientBufferPool& buffers, DrawList& draw_list, const ClipState& clips,
        const glm::vec3& position, const glm::vec2& size, const glm::vec2& pivot,
        f32 angle, const glm::vec4& color,
        const glm::vec2& uvOffset, const glm::vec2& uvScale,
        const glm::vec2& tileSize, const glm::vec2& tileSpacing,
        const BatchDrawKey& key
    );

    std::vector<BatchVertex> tile_scratch_;
};

}  // namespace esengine
