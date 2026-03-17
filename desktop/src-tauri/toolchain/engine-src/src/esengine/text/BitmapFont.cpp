#include "BitmapFont.hpp"
#include "../core/Log.hpp"
#include "../resource/ResourceManager.hpp"

#include <sstream>
#include <cstdlib>

namespace esengine::text {

static std::string extractValue(const std::string& line, const std::string& key) {
    std::string search = key + "=";
    auto pos = line.find(search);
    if (pos == std::string::npos) {
        return "";
    }

    pos += search.size();
    if (pos < line.size() && line[pos] == '"') {
        pos++;
        auto end = line.find('"', pos);
        if (end == std::string::npos) {
            return "";
        }
        return line.substr(pos, end - pos);
    }

    auto end = line.find(' ', pos);
    if (end == std::string::npos) {
        end = line.size();
    }
    return line.substr(pos, end - pos);
}

static i32 extractInt(const std::string& line, const std::string& key) {
    auto val = extractValue(line, key);
    return val.empty() ? 0 : std::atoi(val.c_str());
}

bool BitmapFont::parseFntContent(const std::string& content) {
    std::istringstream stream(content);
    std::string line;

    while (std::getline(stream, line)) {
        if (line.empty()) {
            continue;
        }

        if (line.compare(0, 7, "common ") == 0) {
            line_height_ = static_cast<f32>(extractInt(line, "lineHeight"));
            base_ = static_cast<f32>(extractInt(line, "base"));
            tex_width_ = static_cast<u32>(extractInt(line, "scaleW"));
            tex_height_ = static_cast<u32>(extractInt(line, "scaleH"));
        } else if (line.compare(0, 5, "page ") == 0) {
            page_file_ = extractValue(line, "file");
        } else if (line.compare(0, 5, "char ") == 0) {
            Glyph glyph;
            glyph.id = static_cast<u32>(extractInt(line, "id"));
            glyph.x = static_cast<f32>(extractInt(line, "x"));
            glyph.y = static_cast<f32>(extractInt(line, "y"));
            glyph.width = static_cast<f32>(extractInt(line, "width"));
            glyph.height = static_cast<f32>(extractInt(line, "height"));
            glyph.xOffset = static_cast<f32>(extractInt(line, "xoffset"));
            glyph.yOffset = static_cast<f32>(extractInt(line, "yoffset"));
            glyph.xAdvance = static_cast<f32>(extractInt(line, "xadvance"));
            glyph.page = static_cast<u32>(extractInt(line, "page"));
            glyphs_[glyph.id] = glyph;
        } else if (line.compare(0, 8, "kerning ") == 0) {
            u32 first = static_cast<u32>(extractInt(line, "first"));
            u32 second = static_cast<u32>(extractInt(line, "second"));
            f32 amount = static_cast<f32>(extractInt(line, "amount"));
            u64 key = (static_cast<u64>(first) << 32) | second;
            kerning_[key] = amount;
        }
    }

    return !glyphs_.empty();
}

bool BitmapFont::loadFromFntText(const std::string& content,
                                  const std::string& basePath,
                                  resource::ResourceManager& rm) {
    if (!parseFntContent(content)) {
        ES_LOG_ERROR("Failed to parse BMFont text content");
        return false;
    }

    if (page_file_.empty()) {
        ES_LOG_ERROR("BMFont has no page file");
        return false;
    }

    std::string texturePath = basePath.empty() ? page_file_ : basePath + "/" + page_file_;
    texture_ = rm.loadTexture(texturePath);

    if (!texture_.isValid()) {
        ES_LOG_ERROR("Failed to load BMFont texture: {}", texturePath);
        return false;
    }

    auto* tex = rm.getTexture(texture_);
    if (tex) {
        tex_width_ = tex->getWidth();
        tex_height_ = tex->getHeight();
    }

    return true;
}

bool BitmapFont::loadFromFntText(const std::string& content,
                                  resource::TextureHandle texture,
                                  u32 texWidth, u32 texHeight) {
    if (!parseFntContent(content)) {
        ES_LOG_ERROR("Failed to parse BMFont text content");
        return false;
    }

    texture_ = texture;
    tex_width_ = texWidth;
    tex_height_ = texHeight;
    return true;
}

void BitmapFont::createLabelAtlas(resource::TextureHandle texture,
                                   u32 texWidth, u32 texHeight,
                                   const std::string& chars,
                                   u32 charWidth, u32 charHeight) {
    texture_ = texture;
    tex_width_ = texWidth;
    tex_height_ = texHeight;
    line_height_ = static_cast<f32>(charHeight);
    base_ = line_height_;

    u32 cols = texWidth / charWidth;

    u32 glyphIndex = 0;
    for (usize i = 0; i < chars.size(); ++i) {
        u8 b0 = static_cast<u8>(chars[i]);
        u32 charCode = b0;
        if (b0 >= 0xF0 && i + 3 < chars.size()) {
            charCode = ((b0 & 0x07) << 18) |
                       ((static_cast<u8>(chars[i + 1]) & 0x3F) << 12) |
                       ((static_cast<u8>(chars[i + 2]) & 0x3F) << 6) |
                        (static_cast<u8>(chars[i + 3]) & 0x3F);
            i += 3;
        } else if (b0 >= 0xE0 && i + 2 < chars.size()) {
            charCode = ((b0 & 0x0F) << 12) |
                       ((static_cast<u8>(chars[i + 1]) & 0x3F) << 6) |
                        (static_cast<u8>(chars[i + 2]) & 0x3F);
            i += 2;
        } else if (b0 >= 0xC0 && i + 1 < chars.size()) {
            charCode = ((b0 & 0x1F) << 6) |
                        (static_cast<u8>(chars[i + 1]) & 0x3F);
            i += 1;
        }

        u32 col = glyphIndex % cols;
        u32 row = glyphIndex / cols;

        Glyph glyph;
        glyph.id = charCode;
        glyph.x = static_cast<f32>(col * charWidth);
        glyph.y = static_cast<f32>(row * charHeight);
        glyph.width = static_cast<f32>(charWidth);
        glyph.height = static_cast<f32>(charHeight);
        glyph.xOffset = 0;
        glyph.yOffset = 0;
        glyph.xAdvance = static_cast<f32>(charWidth);
        glyph.page = 0;
        glyphs_[charCode] = glyph;
        ++glyphIndex;
    }
}

static u32 decodeUtf8Char(const char* data, usize length, usize& pos) {
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
    return 0xFFFD;
}

BitmapFont::TextMetrics BitmapFont::measureText(const std::string& text, f32 fontSize, f32 spacing) const {
    f32 totalWidth = 0;
    u32 prevChar = 0;

    for (usize i = 0; i < text.size(); ++i) {
        u32 charCode = decodeUtf8Char(text.c_str(), text.size(), i);
        auto* glyph = getGlyph(charCode);
        if (!glyph) {
            continue;
        }
        if (prevChar) {
            totalWidth += getKerning(prevChar, charCode);
        }
        totalWidth += glyph->xAdvance + spacing;
        prevChar = charCode;
    }

    return { totalWidth * fontSize, line_height_ * fontSize };
}

const Glyph* BitmapFont::getGlyph(u32 charCode) const {
    auto it = glyphs_.find(charCode);
    return it != glyphs_.end() ? &it->second : nullptr;
}

f32 BitmapFont::getKerning(u32 first, u32 second) const {
    u64 key = (static_cast<u64>(first) << 32) | second;
    auto it = kerning_.find(key);
    return it != kerning_.end() ? it->second : 0.0f;
}

}  // namespace esengine::text
