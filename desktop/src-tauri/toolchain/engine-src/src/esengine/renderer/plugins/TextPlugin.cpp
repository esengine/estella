#include "TextPlugin.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/BitmapText.hpp"
#include "../../text/BitmapFont.hpp"

#include <cmath>

namespace esengine {

void TextPlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

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

void TextPlugin::collect(
    ecs::Registry& registry,
    const Frustum& frustum,
    const ClipState& clips,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    RenderFrameContext& ctx
) {
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

                emitGlyphQuad(buffers, draw_list,
                    glm::vec2(posX, posY), glm::vec2(glyphW, glyphH),
                    position.z, textureId, bt.color, uvOffset, uvScale,
                    entity, ctx.current_stage, bt.layer,
                    batch_shader_id_, clips);
            }

            cursorX += (glyph->xAdvance + spacing) * fontScale;
            prevChar = charCode;
        }
    }
}

void TextPlugin::emitGlyphQuad(
    TransientBufferPool& buffers, DrawList& draw_list,
    const glm::vec2& position, const glm::vec2& size,
    f32 depth, u32 textureId,
    const glm::vec4& color,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    Entity entity, RenderStage stage, i32 layer,
    u32 shaderId, const ClipState& clips
) {
    BatchVertex verts[4];
    f32 hw = size.x * 0.5f;
    f32 hh = size.y * 0.5f;

    u32 pc = packColor(color);

    verts[0].position = glm::vec2(position.x - hw, position.y - hh);
    verts[0].color = pc;
    verts[0].texCoord = glm::vec2(0.0f, 0.0f) * uvScale + uvOffset;

    verts[1].position = glm::vec2(position.x + hw, position.y - hh);
    verts[1].color = pc;
    verts[1].texCoord = glm::vec2(1.0f, 0.0f) * uvScale + uvOffset;

    verts[2].position = glm::vec2(position.x + hw, position.y + hh);
    verts[2].color = pc;
    verts[2].texCoord = glm::vec2(1.0f, 1.0f) * uvScale + uvOffset;

    verts[3].position = glm::vec2(position.x - hw, position.y + hh);
    verts[3].color = pc;
    verts[3].texCoord = glm::vec2(0.0f, 1.0f) * uvScale + uvOffset;

    u32 vOff = buffers.appendVertices(verts, sizeof(verts));
    u32 baseVertex = vOff / sizeof(BatchVertex);

    u16 indices[6];
    for (u32 i = 0; i < 6; ++i) {
        indices[i] = static_cast<u16>(baseVertex + QUAD_INDICES[i]);
    }
    u32 iOff = buffers.appendIndices(indices, 6);

    DrawCommand cmd{};
    cmd.sort_key = DrawCommand::buildSortKey(stage, layer, shaderId, BlendMode::Normal, 0, textureId, depth);
    cmd.index_offset = iOff;
    cmd.index_count = 6;
    cmd.vertex_byte_offset = vOff;
    cmd.shader_id = shaderId;
    cmd.blend_mode = BlendMode::Normal;
    cmd.layout_id = LayoutId::Batch;
    cmd.texture_count = 1;
    cmd.texture_ids[0] = textureId;
    cmd.entity = entity;
    cmd.type = RenderType::Text;
    cmd.layer = layer;

    clips.applyTo(entity, cmd);

    draw_list.push(cmd);
}

}  // namespace esengine
