// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "BatchPlugin.hpp"
#include "../../resource/TextureMetadata.hpp"

namespace esengine {

class SpritePlugin : public BatchPlugin {
public:
    void collect(RenderCollectContext& ctx) override;

private:
    // Sprite-only: tiling repeats the texture across the quad. UI has no tiled variant,
    // so this stays here rather than in BatchPlugin. Emits one quad per tile via appendQuad.
    void emitTiledQuads(
        TransientBufferPool& buffers, DrawList& draw_list, const ClipState& clips,
        const glm::vec2& position, const glm::vec2& size, const glm::vec2& pivot,
        f32 angle, const glm::vec4& color,
        const glm::vec2& uvOffset, const glm::vec2& uvScale,
        const glm::vec2& tileSize, const glm::vec2& tileSpacing,
        const BatchDrawKey& key
    );
};

}  // namespace esengine
