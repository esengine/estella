// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "BatchPlugin.hpp"
#include "../draw/BatchVertex.hpp"

#include <string>
#include <unordered_map>
#include <vector>

namespace esengine {
namespace text { class BitmapFont; }
namespace ecs { struct BitmapText; }

class TextPlugin : public BatchPlugin {
public:
    void collect(RenderCollectContext& ctx) override;

private:
    // Glyph quads cached in fontSize-applied, scale-free units relative to the
    // text origin, untinted. Transform scale, world position and color are
    // per-frame linear factors applied at collect, so only a content change
    // ({text, font, fontSize, spacing, align}) re-runs layout — and the whole
    // text is one DrawCommand instead of one per glyph.
    struct TextLayoutCache {
        std::vector<BatchVertex> vertices;
        std::vector<u32> indices;
        f32 width = 0.0f;   // measureText extents at the cached fontSize
        f32 height = 0.0f;
        std::string text;
        u32 font_id = 0;
        f32 font_size = 0.0f;
        f32 spacing = 0.0f;
        u8 align = 0;
    };

    static u32 decodeUtf8(const char* data, u16 length, u16& pos);
    void rebuildLayout(const text::BitmapFont& font, const ecs::BitmapText& bt,
                       f32 texW, f32 texH, TextLayoutCache& cache);

    std::unordered_map<Entity, TextLayoutCache> layout_cache_;
    std::vector<BatchVertex> scratch_;
};

}  // namespace esengine
