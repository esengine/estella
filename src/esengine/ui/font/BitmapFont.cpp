/**
 * @file    BitmapFont.cpp
 * @brief   Bitmap font rendering implementation
 *
 * @author  ESEngine Team
 * @date    2026
 */

#include "BitmapFont.hpp"
#include "../../core/Log.hpp"
#include "../../platform/FileSystem.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#define STB_IMAGE_IMPLEMENTATION_INCLUDED
#include <stb_image.h>

#include <cstring>
#include <sstream>

namespace esengine::ui {

// =============================================================================
// Simple JSON Parser (minimal, no external deps)
// =============================================================================

namespace {

std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\n\r");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\n\r");
    return s.substr(start, end - start + 1);
}

std::string extractString(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    auto pos = json.find(search);
    if (pos == std::string::npos) return "";

    pos = json.find(':', pos);
    if (pos == std::string::npos) return "";

    pos = json.find('"', pos + 1);
    if (pos == std::string::npos) return "";

    auto endPos = json.find('"', pos + 1);
    if (endPos == std::string::npos) return "";

    return json.substr(pos + 1, endPos - pos - 1);
}

f32 extractFloat(const std::string& json, const std::string& key, f32 defaultVal = 0.0f) {
    std::string search = "\"" + key + "\"";
    auto pos = json.find(search);
    if (pos == std::string::npos) return defaultVal;

    pos = json.find(':', pos);
    if (pos == std::string::npos) return defaultVal;

    pos++;
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;

    std::string numStr;
    while (pos < json.size() && (std::isdigit(json[pos]) || json[pos] == '.' || json[pos] == '-')) {
        numStr += json[pos++];
    }

    if (numStr.empty()) return defaultVal;
    return std::stof(numStr);
}

i32 extractInt(const std::string& json, const std::string& key, i32 defaultVal = 0) {
    return static_cast<i32>(extractFloat(json, key, static_cast<f32>(defaultVal)));
}

u32 nextCodepoint(const std::string& text, usize& i) {
    u32 codepoint = 0;
    const u8* ptr = reinterpret_cast<const u8*>(text.data()) + i;
    const u8* end = reinterpret_cast<const u8*>(text.data()) + text.size();

    if (ptr >= end) return 0;

    if ((*ptr & 0x80) == 0) {
        codepoint = *ptr;
        i += 1;
    } else if ((*ptr & 0xE0) == 0xC0) {
        codepoint = (*ptr & 0x1F) << 6;
        if (ptr + 1 < end) codepoint |= (*(ptr + 1) & 0x3F);
        i += 2;
    } else if ((*ptr & 0xF0) == 0xE0) {
        codepoint = (*ptr & 0x0F) << 12;
        if (ptr + 1 < end) codepoint |= (*(ptr + 1) & 0x3F) << 6;
        if (ptr + 2 < end) codepoint |= (*(ptr + 2) & 0x3F);
        i += 3;
    } else if ((*ptr & 0xF8) == 0xF0) {
        codepoint = (*ptr & 0x07) << 18;
        if (ptr + 1 < end) codepoint |= (*(ptr + 1) & 0x3F) << 12;
        if (ptr + 2 < end) codepoint |= (*(ptr + 2) & 0x3F) << 6;
        if (ptr + 3 < end) codepoint |= (*(ptr + 3) & 0x3F);
        i += 4;
    } else {
        i += 1;
    }
    return codepoint;
}

}  // namespace

// =============================================================================
// Constructor / Destructor
// =============================================================================

BitmapFont::~BitmapFont() {
    if (textureId_ != 0) {
        glDeleteTextures(1, &textureId_);
        textureId_ = 0;
    }
}

BitmapFont::BitmapFont(BitmapFont&& other) noexcept
    : textureId_(other.textureId_),
      atlasWidth_(other.atlasWidth_),
      atlasHeight_(other.atlasHeight_),
      fontSize_(other.fontSize_),
      lineHeight_(other.lineHeight_),
      ascent_(other.ascent_),
      descent_(other.descent_),
      glyphs_(std::move(other.glyphs_)) {
    other.textureId_ = 0;
}

BitmapFont& BitmapFont::operator=(BitmapFont&& other) noexcept {
    if (this != &other) {
        if (textureId_ != 0) {
            glDeleteTextures(1, &textureId_);
        }

        textureId_ = other.textureId_;
        atlasWidth_ = other.atlasWidth_;
        atlasHeight_ = other.atlasHeight_;
        fontSize_ = other.fontSize_;
        lineHeight_ = other.lineHeight_;
        ascent_ = other.ascent_;
        descent_ = other.descent_;
        glyphs_ = std::move(other.glyphs_);

        other.textureId_ = 0;
    }
    return *this;
}

// =============================================================================
// Factory Methods
// =============================================================================

Unique<BitmapFont> BitmapFont::load(const std::string& atlasPath,
                                     const std::string& metricsPath) {
    auto font = makeUnique<BitmapFont>();

    if (!font->loadAtlasTexture(atlasPath)) {
        ES_LOG_ERROR("BitmapFont: Failed to load atlas: {}", atlasPath);
        return nullptr;
    }

    std::string metricsJson = FileSystem::readTextFile(metricsPath);
    if (metricsJson.empty()) {
        ES_LOG_ERROR("BitmapFont: Failed to read metrics: {}", metricsPath);
        return nullptr;
    }

    if (!font->parseMetrics(metricsJson)) {
        ES_LOG_ERROR("BitmapFont: Failed to parse metrics: {}", metricsPath);
        return nullptr;
    }

    ES_LOG_INFO("BitmapFont loaded: {} ({} glyphs, {}x{})",
                atlasPath, font->glyphs_.size(), font->atlasWidth_, font->atlasHeight_);

    return font;
}

Unique<BitmapFont> BitmapFont::loadFromMemory(const u8* atlasData, usize atlasSize,
                                               const std::string& metricsJson) {
    auto font = makeUnique<BitmapFont>();

    if (!font->loadAtlasFromMemory(atlasData, atlasSize)) {
        ES_LOG_ERROR("BitmapFont: Failed to load atlas from memory");
        return nullptr;
    }

    if (!font->parseMetrics(metricsJson)) {
        ES_LOG_ERROR("BitmapFont: Failed to parse metrics");
        return nullptr;
    }

    ES_LOG_INFO("BitmapFont loaded from memory ({} glyphs, {}x{})",
                font->glyphs_.size(), font->atlasWidth_, font->atlasHeight_);

    return font;
}

// =============================================================================
// Atlas Loading
// =============================================================================

bool BitmapFont::loadAtlasTexture(const std::string& path) {
    auto data = FileSystem::readBinaryFile(path);
    if (data.empty()) {
        return false;
    }
    return loadAtlasFromMemory(data.data(), data.size());
}

bool BitmapFont::loadAtlasFromMemory(const u8* data, usize size) {
    int width, height, channels;
    stbi_set_flip_vertically_on_load(false);

    u8* pixels = stbi_load_from_memory(data, static_cast<int>(size),
                                        &width, &height, &channels, 4);
    if (!pixels) {
        ES_LOG_ERROR("BitmapFont: Failed to decode atlas image");
        return false;
    }

    atlasWidth_ = static_cast<u32>(width);
    atlasHeight_ = static_cast<u32>(height);

    glGenTextures(1, &textureId_);
    glBindTexture(GL_TEXTURE_2D, textureId_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0,
                 GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    glBindTexture(GL_TEXTURE_2D, 0);

    stbi_image_free(pixels);
    return true;
}

// =============================================================================
// Metrics Parsing
// =============================================================================

bool BitmapFont::parseMetrics(const std::string& json) {
    fontSize_ = extractFloat(json, "fontSize", 32.0f);
    lineHeight_ = extractFloat(json, "lineHeight", fontSize_ * 1.2f);
    ascent_ = extractFloat(json, "ascent", fontSize_ * 0.8f);
    descent_ = extractFloat(json, "descent", fontSize_ * 0.2f);

    // Parse glyphs array
    auto glyphsStart = json.find("\"glyphs\"");
    if (glyphsStart == std::string::npos) {
        ES_LOG_ERROR("BitmapFont: No glyphs array in metrics");
        return false;
    }

    auto arrayStart = json.find('[', glyphsStart);
    if (arrayStart == std::string::npos) return false;

    auto arrayEnd = json.find(']', arrayStart);
    if (arrayEnd == std::string::npos) return false;

    std::string glyphsArray = json.substr(arrayStart + 1, arrayEnd - arrayStart - 1);

    // Parse each glyph object
    usize pos = 0;
    while (pos < glyphsArray.size()) {
        auto objStart = glyphsArray.find('{', pos);
        if (objStart == std::string::npos) break;

        auto objEnd = glyphsArray.find('}', objStart);
        if (objEnd == std::string::npos) break;

        std::string glyphJson = glyphsArray.substr(objStart, objEnd - objStart + 1);

        u32 codepoint = static_cast<u32>(extractInt(glyphJson, "codepoint", 0));
        if (codepoint == 0) {
            // Try "char" field for ASCII character
            std::string charStr = extractString(glyphJson, "char");
            if (!charStr.empty()) {
                usize idx = 0;
                codepoint = nextCodepoint(charStr, idx);
            }
        }

        if (codepoint != 0) {
            BitmapGlyphInfo glyph;
            glyph.width = extractFloat(glyphJson, "width");
            glyph.height = extractFloat(glyphJson, "height");
            glyph.bearingX = extractFloat(glyphJson, "bearingX");
            glyph.bearingY = extractFloat(glyphJson, "bearingY");
            glyph.advance = extractFloat(glyphJson, "advance");
            glyph.u0 = extractFloat(glyphJson, "u0");
            glyph.v0 = extractFloat(glyphJson, "v0");
            glyph.u1 = extractFloat(glyphJson, "u1");
            glyph.v1 = extractFloat(glyphJson, "v1");

            glyphs_[codepoint] = glyph;
        }

        pos = objEnd + 1;
    }

    return !glyphs_.empty();
}

// =============================================================================
// Glyph Access
// =============================================================================

const BitmapGlyphInfo* BitmapFont::getGlyph(u32 codepoint) const {
    auto it = glyphs_.find(codepoint);
    if (it != glyphs_.end()) {
        return &it->second;
    }
    return nullptr;
}

// =============================================================================
// Text Measurement
// =============================================================================

glm::vec2 BitmapFont::measureText(const std::string& text, f32 fontSize) const {
    if (text.empty() || fontSize_ == 0.0f) return {0.0f, 0.0f};

    f32 scale = fontSize / fontSize_;
    f32 width = 0.0f;
    f32 maxWidth = 0.0f;
    i32 lines = 1;

    usize i = 0;
    while (i < text.size()) {
        u32 codepoint = nextCodepoint(text, i);

        if (codepoint == '\n') {
            maxWidth = std::max(maxWidth, width);
            width = 0.0f;
            lines++;
            continue;
        }

        const auto* glyph = getGlyph(codepoint);
        if (glyph) {
            width += glyph->advance * scale;
        }
    }

    maxWidth = std::max(maxWidth, width);
    f32 height = static_cast<f32>(lines) * lineHeight_ * scale;

    return {maxWidth, height};
}

f32 BitmapFont::getCharWidth(u32 codepoint, f32 fontSize) const {
    const auto* glyph = getGlyph(codepoint);
    if (!glyph || fontSize_ == 0.0f) return 0.0f;

    f32 scale = fontSize / fontSize_;
    return glyph->advance * scale;
}

}  // namespace esengine::ui
