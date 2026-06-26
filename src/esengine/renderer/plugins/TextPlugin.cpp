// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TextPlugin.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Texture.hpp"
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

        auto& transform = textView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        const auto& position = transform.worldPosition;
        const auto& scale = transform.worldScale;

        auto textMetrics = font->measureText(bt.text, bt.fontSize, bt.spacing);
        glm::vec3 halfExtents = glm::vec3(
            textMetrics.width * scale.x * 0.5f,
            textMetrics.height * scale.y * 0.5f,
            0.0f
        );
        if (!frustum.intersectsAABB(position, halfExtents)) {
            continue;
        }

        u32 textureId = tex->getId();
        f32 texW = static_cast<f32>(font->getTexWidth());
        f32 texH = static_cast<f32>(font->getTexHeight());
        if (texW == 0 || texH == 0) continue;

        f32 fontScale = bt.fontSize * scale.x;
        f32 spacing = bt.spacing;
        f32 fontBase = font->getBase();

        f32 totalWidth = 0;
        if (bt.align != ecs::TextAlign::Left) {
            u32 prevChar = 0;
            const char* textData = bt.text.c_str();
            u16 textLen = static_cast<u16>(bt.text.size());
            for (u16 j = 0; j < textLen; ++j) {
                u32 charCode = decodeUtf8(textData, textLen, j);
                auto* glyph = font->getGlyph(charCode);
                if (!glyph) continue;
                if (prevChar) {
                    totalWidth += font->getKerning(prevChar, charCode) * fontScale;
                }
                totalWidth += (glyph->xAdvance + spacing) * fontScale;
                prevChar = charCode;
            }
        }

        f32 alignOffset = 0;
        if (bt.align == ecs::TextAlign::Center) {
            alignOffset = -totalWidth * 0.5f;
        } else if (bt.align == ecs::TextAlign::Right) {
            alignOffset = -totalWidth;
        }

        f32 cursorX = position.x + alignOffset;
        f32 baseY = position.y;

        const char* textData = bt.text.c_str();
        u16 textLen = static_cast<u16>(bt.text.size());
        u32 prevChar = 0;

        // Constant across every glyph of this text entity — build the draw key once.
        BatchDrawKey key{
            .stage = ctx.current_stage,
            .layer = bt.layer,
            .shaderId = batch_shader_id_,
            .blend = BlendMode::Normal,
            .textureId = textureId,
            .depth = position.z,
            .entity = entity,
            .type = RenderType::Text,
        };
        constexpr glm::vec2 CENTERED_PIVOT{0.5f, 0.5f};

        for (u16 j = 0; j < textLen; ++j) {
            u32 charCode = decodeUtf8(textData, textLen, j);
            auto* glyph = font->getGlyph(charCode);
            if (!glyph) continue;

            if (prevChar) {
                cursorX += font->getKerning(prevChar, charCode) * fontScale;
            }

            if (glyph->width > 0 && glyph->height > 0) {
                f32 glyphW = glyph->width * fontScale;
                f32 glyphH = glyph->height * fontScale;

                f32 posX = cursorX + (glyph->xOffset + glyph->width * 0.5f) * fontScale;
                f32 posY = baseY + (fontBase - glyph->yOffset - glyph->height * 0.5f) * fontScale;

                f32 uvY = glyph->y / texH;
                f32 uvH = glyph->height / texH;
                glm::vec2 uvOffset(glyph->x / texW, uvY + uvH);
                glm::vec2 uvScale(glyph->width / texW, -uvH);

                // A glyph is an unrotated centered quad; the base emitter packs the
                // BATCH_QUAD_TEX_COORDS (0,0)->(1,1) exactly as the glyph UVs expect.
                emitQuad(buffers, draw_list, clips,
                    glm::vec2(posX, posY), glm::vec2(glyphW, glyphH), CENTERED_PIVOT,
                    0.0f, uvOffset, uvScale, bt.color, key);
            }

            cursorX += (glyph->xAdvance + spacing) * fontScale;
            prevChar = charCode;
        }
    }
}

}  // namespace esengine
