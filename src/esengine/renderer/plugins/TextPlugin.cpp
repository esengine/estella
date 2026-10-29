// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TextPlugin.hpp"
#include "../../ecs/GroupOpacityLookup.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../frame/RenderContext.hpp"
#include "../frame/RenderFrame.hpp"
#include "../rhi/Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Hierarchy.hpp"
#include "../../ecs/FlatGeometry.hpp"
#include "../../ecs/components/BitmapText.hpp"
#include "../../text/BitmapFont.hpp"

#include <cmath>
#include <limits>

namespace esengine {

namespace {
bool containsBox(const Frustum& frustum, const glm::vec3& center, const glm::vec3& half) {
    for (const auto& plane : frustum.planes) {
        const f32 radius = glm::dot(glm::abs(plane.normal), half);
        if (plane.signedDistance(center) < radius) return false;
    }
    return true;
}
}

u32 TextPlugin::decodeUtf8(const char* data, usize length, usize& pos) {
    u8 b0 = static_cast<u8>(data[pos]);
    if (b0 < 0x80) {
        return b0;
    }
    if ((b0 & 0xE0) == 0xC0 && pos + 1 < length) {
        u32 cp = (b0 & 0x1F) << 6;
        cp |= (static_cast<u8>(data[pos + 1]) & 0x3F);
        pos += 1;
        return cp;
    }
    if ((b0 & 0xF0) == 0xE0 && pos + 2 < length) {
        u32 cp = (b0 & 0x0F) << 12;
        cp |= (static_cast<u8>(data[pos + 1]) & 0x3F) << 6;
        cp |= (static_cast<u8>(data[pos + 2]) & 0x3F);
        pos += 2;
        return cp;
    }
    if ((b0 & 0xF8) == 0xF0 && pos + 3 < length) {
        u32 cp = (b0 & 0x07) << 18;
        cp |= (static_cast<u8>(data[pos + 1]) & 0x3F) << 12;
        cp |= (static_cast<u8>(data[pos + 2]) & 0x3F) << 6;
        cp |= (static_cast<u8>(data[pos + 3]) & 0x3F);
        pos += 3;
        return cp;
    }
    return b0;
}

void TextPlugin::rebuildLayout(const text::BitmapFont& font, const ecs::BitmapText& bt,
                               f32 texW, f32 texH, TextLayoutCache& cache) {
    cache.vertices.clear();
    cache.indices.clear();
    cache.blocks.clear();

    cache.min = glm::vec3(std::numeric_limits<f32>::max());
    cache.max = glm::vec3(std::numeric_limits<f32>::lowest());

    const f32 fs = bt.fontSize;
    const f32 spacing = bt.spacing;
    const f32 fontBase = font.getBase();
    const char* textData = bt.text.c_str();
    const usize textLen = bt.text.size();

    f32 totalWidth = 0;
    if (bt.align != ecs::TextAlign::Left) {
        u32 prevChar = 0;
        for (usize j = 0; j < textLen; ++j) {
            u32 charCode = decodeUtf8(textData, textLen, j);
            auto* glyph = font.getGlyph(charCode);
            if (!glyph) continue;
            if (prevChar) {
                totalWidth += font.getKerning(prevChar, charCode) * fs;
            }
            totalWidth += (glyph->xAdvance + spacing) * fs;
            prevChar = charCode;
        }
    }

    f32 cursorX = 0;
    if (bt.align == ecs::TextAlign::Center) {
        cursorX = -totalWidth * 0.5f;
    } else if (bt.align == ecs::TextAlign::Right) {
        cursorX = -totalWidth;
    }

    u32 prevChar = 0;
    for (usize j = 0; j < textLen; ++j) {
        u32 charCode = decodeUtf8(textData, textLen, j);
        auto* glyph = font.getGlyph(charCode);
        if (!glyph) continue;

        if (prevChar) {
            cursorX += font.getKerning(prevChar, charCode) * fs;
        }

        if (glyph->width > 0 && glyph->height > 0) {
            f32 halfW = glyph->width * fs * 0.5f;
            f32 halfH = glyph->height * fs * 0.5f;
            f32 cx = cursorX + (glyph->xOffset + glyph->width * 0.5f) * fs;
            f32 cy = (fontBase - glyph->yOffset - glyph->height * 0.5f) * fs;
            cache.min = glm::min(cache.min, glm::vec3(cx - halfW, cy - halfH, 0.0f));
            cache.max = glm::max(cache.max, glm::vec3(cx + halfW, cy + halfH, 0.0f));
            const glm::vec3 low{cx - halfW, cy - halfH, 0}, high{cx + halfW, cy + halfH, 0};
            if (cache.vertices.size() % (GLYPHS_PER_BLOCK * 4) == 0) {
                cache.blocks.push_back({low, high});
            } else {
                auto& block = cache.blocks.back();
                block.min = glm::min(block.min, low);
                block.max = glm::max(block.max, high);
            }

            // Glyph rows are top-down in the atlas, so v is flipped (top at vMin).
            f32 uMin = glyph->x / texW;
            f32 uMax = (glyph->x + glyph->width) / texW;
            f32 vTop = glyph->y / texH;
            f32 vBottom = (glyph->y + glyph->height) / texH;

            u32 baseVertex = static_cast<u32>(cache.vertices.size());
            cache.vertices.push_back({ {cx - halfW, cy - halfH, 0.0f}, 0, {uMin, vBottom} });
            cache.vertices.push_back({ {cx + halfW, cy - halfH, 0.0f}, 0, {uMax, vBottom} });
            cache.vertices.push_back({ {cx + halfW, cy + halfH, 0.0f}, 0, {uMax, vTop} });
            cache.vertices.push_back({ {cx - halfW, cy + halfH, 0.0f}, 0, {uMin, vTop} });
            for (u32 i = 0; i < 6; ++i) {
                cache.indices.push_back(baseVertex + BATCH_QUAD_INDICES[i]);
            }
        }

        cursorX += (glyph->xAdvance + spacing) * fs;
        prevChar = charCode;
    }
}

void TextPlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    auto textView = registry.activeView<ecs::Transform, ecs::BitmapText>();
    const ecs::GroupOpacityLookup groupOpacity(registry);

    for (auto entity : textView) {
        const auto& bt = textView.get<ecs::BitmapText>(entity);
        if (!bt.enabled) continue;
        if (bt.text.empty() || !bt.font.isValid()) continue;
        if (!batchEntityVisible(draw_list, clips, entity, bt.layer, 0)) continue;
        auto& transform = textView.get<ecs::Transform>(entity);
        const bool parented = registry.has<ecs::Parent>(entity);
        if (!ecs::hasFlatGeometryArea(registry, entity, transform)) continue;

        auto* font = ctx.resources.getBitmapFont(bt.font);
        if (!font) continue;

        auto* tex = ctx.resources.getTexture(font->getTexture());
        if (!tex) continue;

        f32 texW = static_cast<f32>(font->getTexWidth());
        f32 texH = static_cast<f32>(font->getTexHeight());
        if (texW == 0 || texH == 0) continue;

        auto& cache = layout_cache_[entity];
        if (cache.text != bt.text || cache.font_id != bt.font.id()
            || cache.font_size != bt.fontSize || cache.spacing != bt.spacing
            || cache.align != static_cast<u8>(bt.align)) {
            rebuildLayout(*font, bt, texW, texH, cache);
            cache.text = bt.text;
            cache.font_id = bt.font.id();
            cache.font_size = bt.fontSize;
            cache.spacing = bt.spacing;
            cache.align = static_cast<u8>(bt.align);
        }
        if (cache.indices.empty()) continue;

        glm::vec3 position = parallaxedWorldPosition(transform, bt.parallax, collect_ctx.camera);
        glm::vec3 axisX, axisY;
        if (parented) {
            axisX = glm::vec3(transform.cachedMatrix_[0]);
            axisY = glm::vec3(transform.cachedMatrix_[1]);
        } else {
            const auto rotation = glm::mat3_cast(transform.worldRotation);
            axisX = rotation[0] * transform.worldScale.x;
            axisY = rotation[1] * transform.worldScale.y;
        }
        const glm::vec3 localCenter = (cache.min + cache.max) * 0.5f;
        const glm::vec3 localHalf = (cache.max - cache.min) * 0.5f;
        const glm::vec3 center = position + axisX * localCenter.x + axisY * localCenter.y;
        const glm::vec3 halfExtents = glm::abs(axisX) * localHalf.x + glm::abs(axisY) * localHalf.y;
        if (!collect_ctx.visible(center, halfExtents, false)) {
            ++collect_ctx.culled;
            continue;
        }

        glm::vec4 textColor = bt.color;
        textColor.a *= groupOpacity.of(entity);
        if (textColor.a <= 0.0f) continue;
        u32 packedColor = packColor(textColor);
        scratch_.clear();
        index_scratch_.clear();
        const bool allVisible = collect_ctx.isOverlay() || containsBox(collect_ctx.frustum, center, halfExtents);
        if (allVisible) {
            scratch_.reserve(cache.vertices.size());
            for (const BatchVertex& v : cache.vertices) {
                scratch_.push_back({position + axisX * v.position.x + axisY * v.position.y, packedColor, v.texCoord});
            }
        } else {
            const glm::vec3 absX = glm::abs(axisX), absY = glm::abs(axisY);
            const auto bounds = [&](const glm::vec3& low, const glm::vec3& high) {
                const auto mid = (low + high) * .5f, half = (high - low) * .5f;
                return std::pair{position + axisX * mid.x + axisY * mid.y, absX * half.x + absY * half.y};
            };
            for (u32 blockIndex = 0; blockIndex < cache.blocks.size(); ++blockIndex) {
                const auto& block = cache.blocks[blockIndex];
                const auto [blockCenter, blockHalf] = bounds(block.min, block.max);
                if (!collect_ctx.visible(blockCenter, blockHalf, false)) continue;
                const bool wholeBlock = containsBox(collect_ctx.frustum, blockCenter, blockHalf);
                const u32 first = blockIndex * GLYPHS_PER_BLOCK * 4;
                const u32 end = std::min(first + GLYPHS_PER_BLOCK * 4, static_cast<u32>(cache.vertices.size()));
                for (u32 i = first; i < end; i += 4) {
                    if (!wholeBlock) {
                        const auto [glyphCenter, glyphHalf] = bounds(cache.vertices[i].position, cache.vertices[i + 2].position);
                        if (!collect_ctx.visible(glyphCenter, glyphHalf, false)) continue;
                    }
                    const u32 base = static_cast<u32>(scratch_.size());
                    for (u32 j = 0; j < 4; ++j) {
                        const auto& v = cache.vertices[i + j];
                        scratch_.push_back({position + axisX * v.position.x + axisY * v.position.y, packedColor, v.texCoord});
                    }
                    for (u32 index : BATCH_QUAD_INDICES) index_scratch_.push_back(base + index);
                }
            }
        }
        if (scratch_.empty()) continue;
        const auto& indices = allVisible ? cache.indices : index_scratch_;

        appendIndexedBatch(buffers, draw_list, clips,
            scratch_.data(), static_cast<u32>(scratch_.size()),
            indices.data(), static_cast<u32>(indices.size()),
            BatchDrawKey{
                .stage = ctx.current_stage,
                .layer = bt.layer,
                .shaderId = batch_shader_id_,
                .blend = BlendMode::Normal,
                .textureId = tex->getId(),
                .depth = collect_ctx.camera.viewDepth(position),
                .y = position.y,
                .entity = entity,
                .type = RenderType::Text,
            });
    }

    for (auto it = layout_cache_.begin(); it != layout_cache_.end(); ) {
        if (!registry.valid(it->first) || !registry.has<ecs::BitmapText>(it->first)) {
            it = layout_cache_.erase(it);
        } else {
            ++it;
        }
    }
}

}  // namespace esengine
