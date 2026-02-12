#pragma once

#include "../core/Types.hpp"
#include "../resource/Handle.hpp"

#include <string>
#include <unordered_map>

namespace esengine {
namespace resource { class ResourceManager; }
}

namespace esengine::text {

struct Glyph {
    u32 id;
    f32 x, y, width, height;
    f32 xOffset, yOffset;
    f32 xAdvance;
    u32 page;
};

class BitmapFont {
public:
    bool loadFromFntText(const std::string& content,
                         const std::string& basePath,
                         resource::ResourceManager& rm);

    bool loadFromFntText(const std::string& content,
                         resource::TextureHandle texture,
                         u32 texWidth, u32 texHeight);

    void createLabelAtlas(resource::TextureHandle texture,
                          u32 texWidth, u32 texHeight,
                          const std::string& chars,
                          u32 charWidth, u32 charHeight);

    const Glyph* getGlyph(u32 charCode) const;
    f32 getKerning(u32 first, u32 second) const;
    resource::TextureHandle getTexture() const { return texture_; }
    f32 getLineHeight() const { return line_height_; }
    f32 getBase() const { return base_; }
    u32 getTexWidth() const { return tex_width_; }
    u32 getTexHeight() const { return tex_height_; }

private:
    bool parseFntContent(const std::string& content);

    resource::TextureHandle texture_;
    u32 tex_width_ = 0;
    u32 tex_height_ = 0;
    f32 line_height_ = 0;
    f32 base_ = 0;
    std::unordered_map<u32, Glyph> glyphs_;
    std::unordered_map<u64, f32> kerning_;
    std::string page_file_;
};

}  // namespace esengine::text
