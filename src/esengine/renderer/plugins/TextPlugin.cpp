// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TextPlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../frame/RenderContext.hpp"
#include "../frame/RenderFrame.hpp"
#include "../rhi/Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/BitmapText.hpp"
#include "../../text/BitmapFont.hpp"

#include <cmath>

namespace esengine {

u32 TextPlugin::decodeUtf8(const char* data, u16 length, u16& pos) {
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

    auto metrics = font.measureText(bt.text, bt.fontSize, bt.spacing);
    cache.width = metrics.width;
    cache.height = metrics.height;

    const f32 fs = bt.fontSize;
    const f32 spacing = bt.spacing;
    const f32 fontBase = font.getBase();
    const char* textData = bt.text.c_str();
    const u16 textLen = static_cast<u16>(bt.text.size());

    f32 totalWidth = 0;
    if (bt.align != ecs::TextAlign::Left) {
        u32 prevChar = 0;
        for (u16 j = 0; j < textLen; ++j) {
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
    for (u16 j = 0; j < textLen; ++j) {
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

            // Glyph rows are top-down in the atlas, so v is flipped (top at vMin).
            f32 uMin = glyph->x / texW;
            f32 uMax = (glyph->x + glyph->width) / texW;
            f32 vTop = glyph->y / texH;
            f32 vBottom = (glyph->y + glyph->height) / texH;

            u32 baseVertex = static_cast<u32>(cache.vertices.size());
            cache.vertices.push_back({ {cx - halfW, cy - halfH}, 0, {uMin, vBottom} });
            cache.vertices.push_back({ {cx + halfW, cy - halfH}, 0, {uMax, vBottom} });
            cache.vertices.push_back({ {cx + halfW, cy + halfH}, 0, {uMax, vTop} });
            cache.vertices.push_back({ {cx - halfW, cy + halfH}, 0, {uMin, vTop} });
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
    auto& frustum = collect_ctx.frustum;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    auto textView = registry.view<ecs::Transform, ecs::BitmapText>();

    for (auto entity : textView) {
        const auto& bt = textView.get<ecs::BitmapText>(entity);
        if (!bt.enabled) continue;
        if (bt.text.empty() || !bt.font.isValid()) continue;

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

        auto& transform = textView.get<ecs::Transform>(entity);
        glm::vec3 position = parallaxedWorldPosition(transform, bt.parallax, collect_ctx.camera);
        const f32 s = transform.worldScale.x;

        glm::vec3 halfExtents = glm::vec3(
            cache.width * s * 0.5f,
            cache.height * transform.worldScale.y * 0.5f,
            0.0f
        );
        if (!frustum.intersectsAABB(position, halfExtents)) {
            continue;
        }

        u32 packedColor = packColor(bt.color);
        scratch_.clear();
        scratch_.reserve(cache.vertices.size());
        for (const BatchVertex& v : cache.vertices) {
            scratch_.push_back({
                { position.x + v.position.x * s, position.y + v.position.y * s },
                packedColor, v.texCoord });
        }

        appendIndexedBatch(buffers, draw_list, clips,
            scratch_.data(), static_cast<u32>(scratch_.size()),
            cache.indices.data(), static_cast<u32>(cache.indices.size()),
            BatchDrawKey{
                .stage = ctx.current_stage,
                .layer = bt.layer,
                .shaderId = batch_shader_id_,
                .blend = BlendMode::Normal,
                .textureId = tex->getId(),
                .depth = position.z,
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
