#pragma once

#include "../core/Types.hpp"
#include <string>

namespace esengine {

enum class TextureFormat {
    None = 0,
    RGB8,
    RGBA8,
    Depth24
};

enum class TextureFilter {
    Nearest,
    Linear
};

enum class TextureWrap {
    Repeat,
    ClampToEdge,
    MirroredRepeat
};

struct TextureSpecification {
    u32 width = 1;
    u32 height = 1;
    TextureFormat format = TextureFormat::RGBA8;
    TextureFilter minFilter = TextureFilter::Linear;
    TextureFilter magFilter = TextureFilter::Linear;
    TextureWrap wrapS = TextureWrap::Repeat;
    TextureWrap wrapT = TextureWrap::Repeat;
    bool generateMips = true;
};

class Texture {
public:
    Texture() = default;
    virtual ~Texture();

    // Non-copyable, movable
    Texture(const Texture&) = delete;
    Texture& operator=(const Texture&) = delete;
    Texture(Texture&& other) noexcept;
    Texture& operator=(Texture&& other) noexcept;

    // Create from specification (empty texture)
    static Unique<Texture> create(const TextureSpecification& spec);

    // Create from raw data
    static Unique<Texture> create(u32 width, u32 height, const void* data,
                                   TextureFormat format = TextureFormat::RGBA8);

    // Create from file (requires file loading implementation)
    static Unique<Texture> createFromFile(const std::string& path);

    // Bind to texture unit
    void bind(u32 slot = 0) const;
    void unbind() const;

    // Update texture data
    void setData(const void* data, u32 size);

    // Getters
    u32 getId() const { return textureId_; }
    u32 getWidth() const { return width_; }
    u32 getHeight() const { return height_; }
    TextureFormat getFormat() const { return format_; }

    bool operator==(const Texture& other) const {
        return textureId_ == other.textureId_;
    }

private:
    bool initialize(const TextureSpecification& spec);

    u32 textureId_ = 0;
    u32 width_ = 0;
    u32 height_ = 0;
    TextureFormat format_ = TextureFormat::None;
};

}  // namespace esengine
