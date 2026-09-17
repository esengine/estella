// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GfxResourceRegistry.hpp
 * @brief   Every GPU object a device has issued, described well enough to build again.
 *
 * @details The device's one record of what exists. A handle is an id in these
 *          tables, never a backend object, so it outlives any number of device
 *          losses; the backend keeps only a map from id to whatever its API calls
 *          the object this generation. Ids are never reused: a stale handle has to
 *          find nothing rather than someone else's object.
 */
#pragma once

#include "./GfxContent.hpp"
#include "./GfxEnums.hpp"
#include "./PipelineState.hpp"

#include <map>
#include <string>
#include <utility>
#include <vector>

namespace esengine {

/** @brief The last value a program was given for one uniform, replayed after a relink. */
struct GfxUniformValue {
    enum class Type : u8 { None, Int, Float, Vec2, Vec3, Vec4, Mat3, Mat4 };
    Type type = Type::None;
    i32 i = 0;
    f32 f[16] = {};
};

struct GfxBufferRecord {
    GfxBufferRecord(const BufferDesc& d, GfxContent c) : desc(d), content(c) {}

    BufferDesc desc;
    GfxContent content;
    /// Retained content, or the initial bytes of a buffer created while the device was lost.
    std::vector<u8> bytes;
    bool realized = false;
    bool owed = false;
};

struct GfxTextureRecord {
    GfxTextureRecord(const TextureDesc& d, GfxContent c) : desc(d), content(c) {}

    TextureDesc desc;
    GfxContent content;
    /// Retained level-0 pixels in upload order (rows as GL stores them), or the
    /// initial pixels of a texture created while the device was lost.
    std::vector<u8> bytes;
    bool compressed = false;
    GfxCompressedFormat compressedFormat = GfxCompressedFormat::ETC2_RGBA8;
    u32 mipLevels = 1;
    bool realized = false;
    bool owed = false;
};

struct GfxProgramRecord {
    GfxShaderLanguage language = GfxShaderLanguage::GLSL_ES300;
    std::string vertex;
    std::string fragment;
    std::vector<std::pair<u32, std::string>> attribBindings;
    /// A location handed out is an index here; the backend's own is resolved per generation.
    std::vector<std::string> uniformNames;
    std::vector<GfxUniformValue> uniformValues;
    std::vector<std::string> blockNames;
    /// Binding point per block name, or GFX_UNBOUND_BLOCK.
    std::vector<u32> blockBindings;
    bool realized = false;
};

inline constexpr u32 GFX_UNBOUND_BLOCK = 0xFFFFFFFFu;

struct GfxFramebufferRecord {
    FramebufferDesc desc;
    bool realized = false;
};

struct GfxLayoutRecord {
    VertexLayoutDesc desc;
};

struct GfxPipelineRecord {
    PipelineDesc desc;
};

struct GfxTimerQueryRecord {
    bool realized = false;
};

/** @brief One kind of object, by id, in creation order. */
template <typename Record>
class GfxRecordTable {
public:
    u32 insert(Record record) {
        const u32 id = next_++;
        records_.emplace(id, std::move(record));
        return id;
    }

    Record* find(u32 id) {
        auto it = records_.find(id);
        return it != records_.end() ? &it->second : nullptr;
    }

    const Record* find(u32 id) const {
        auto it = records_.find(id);
        return it != records_.end() ? &it->second : nullptr;
    }

    bool erase(u32 id) { return records_.erase(id) != 0; }

    u32 size() const { return static_cast<u32>(records_.size()); }

    std::map<u32, Record>& all() { return records_; }
    const std::map<u32, Record>& all() const { return records_; }

private:
    std::map<u32, Record> records_;
    u32 next_ = 1;
};

/** @brief A Sourced object that has storage again and is waiting for its contents. */
struct GfxOwedContent {
    enum class Kind : u8 { Buffer, Texture };
    Kind kind;
    u32 id;
    u32 provider;
    u32 key;
};

class GfxResourceRegistry {
public:
    GfxRecordTable<GfxBufferRecord> buffers;
    GfxRecordTable<GfxTextureRecord> textures;
    GfxRecordTable<GfxProgramRecord> programs;
    GfxRecordTable<GfxFramebufferRecord> framebuffers;
    GfxRecordTable<GfxLayoutRecord> layouts;
    GfxRecordTable<GfxPipelineRecord> pipelines;
    GfxRecordTable<GfxTimerQueryRecord> timerQueries;

    /** @brief An existing pipeline with this description, or 0. */
    u32 findPipeline(const PipelineDesc& desc) const {
        for (const auto& [id, record] : pipelines.all()) {
            if (record.desc == desc) return id;
        }
        return 0;
    }

    std::vector<GfxOwedContent> owed() const {
        std::vector<GfxOwedContent> out;
        for (const auto& [id, record] : buffers.all()) {
            if (record.owed) {
                out.push_back({GfxOwedContent::Kind::Buffer, id,
                               record.content.provider(), record.content.key()});
            }
        }
        for (const auto& [id, record] : textures.all()) {
            if (record.owed) {
                out.push_back({GfxOwedContent::Kind::Texture, id,
                               record.content.provider(), record.content.key()});
            }
        }
        return out;
    }
};

}  // namespace esengine
