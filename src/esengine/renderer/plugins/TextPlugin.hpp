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
    const char* collectScope() const override { return "render.collect.text"; }

private:
    static constexpr u32 GLYPHS_PER_BLOCK = 64;
    struct GlyphBlock { glm::vec3 min, max; };
    // Local glyph quads and ink bounds are cached per content signature.
    // World transforms, parallax and tint apply at collect; the whole text
    // remains one command rather than one per glyph.
    struct TextLayoutCache {
        std::vector<BatchVertex> vertices;
        std::vector<u32> indices;
        std::vector<GlyphBlock> blocks;
        glm::vec3 min{0.0f};
        glm::vec3 max{0.0f};
        std::string text;
        u32 font_id = 0;
        f32 font_size = 0.0f;
        f32 spacing = 0.0f;
        u8 align = 0;
    };

    void rebuildLayout(const text::BitmapFont& font, const ecs::BitmapText& bt,
                       f32 texW, f32 texH, TextLayoutCache& cache);

    std::unordered_map<Entity, TextLayoutCache> layout_cache_;
    std::vector<BatchVertex> scratch_;
    std::vector<u32> index_scratch_;
};

}  // namespace esengine
