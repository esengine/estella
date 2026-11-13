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

#include <deque>
#include <optional>
#include <unordered_map>
#include <functional>
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
    /// What the owner of a program created with GfxShaderSource::deferLink does once it has linked (the block bindings, the pinned samplers). Run once.
    std::function<void()> onLinked;
};

inline constexpr u32 GFX_UNBOUND_BLOCK = 0xFFFFFFFFu;

struct GfxComputeRecord {
    std::string source;
    std::string entry;
    bool realized = false;
};

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

/**
 * @brief One kind of object, by id, in creation order.
 *
 * @details Ids are handed out in order and never reused, so a record lives at the index its id names: finding one is an
 *          index, not a search. A draw finds its pipeline, its layout and its textures by id every time it is issued,
 *          and a tree there cost a pointer chase per level per lookup. A deque, so a record a caller holds stays where
 *          it is while others are added after it, as a map's did; an erased record leaves an empty slot behind.
 */
template <typename Record>
class GfxRecordTable {
public:
    u32 insert(Record record) {
        const u32 id = static_cast<u32>(slots_.size()) + 1;
        slots_.emplace_back(std::move(record));
        ++live_;
        return id;
    }

    Record* find(u32 id) {
        if (id == 0 || id > slots_.size()) return nullptr;
        auto& slot = slots_[id - 1];
        return slot ? &*slot : nullptr;
    }

    const Record* find(u32 id) const {
        if (id == 0 || id > slots_.size()) return nullptr;
        const auto& slot = slots_[id - 1];
        return slot ? &*slot : nullptr;
    }

    bool erase(u32 id) {
        if (id == 0 || id > slots_.size() || !slots_[id - 1]) return false;
        slots_[id - 1].reset();
        --live_;
        return true;
    }

    u32 size() const { return live_; }

    /** Every live record as (id, record), in creation order: what a structured binding over the old map gave. */
    template <typename Slots, typename Ref>
    class View {
    public:
        class iterator {
        public:
            iterator(Slots* slots, size_t at) : slots_(slots), at_(at) { skip(); }
            // An lvalue, so `for (auto& [id, record] : table.all())` binds as it did over the map.
            std::pair<u32, Ref>& operator*() const { current_.emplace(static_cast<u32>(at_ + 1), *(*slots_)[at_]); return *current_; }
            iterator& operator++() { ++at_; skip(); return *this; }
            bool operator!=(const iterator& other) const { return at_ != other.at_; }
            bool operator==(const iterator& other) const { return at_ == other.at_; }
        private:
            void skip() { while (at_ < slots_->size() && !(*slots_)[at_]) ++at_; }
            Slots* slots_;
            size_t at_;
            mutable std::optional<std::pair<u32, Ref>> current_;
        };
        explicit View(Slots* slots) : slots_(slots) {}
        iterator begin() const { return iterator(slots_, 0); }
        iterator end() const { return iterator(slots_, slots_->size()); }
    private:
        Slots* slots_;
    };

    View<std::deque<std::optional<Record>>, Record&> all() { return View<std::deque<std::optional<Record>>, Record&>(&slots_); }
    View<const std::deque<std::optional<Record>>, const Record&> all() const {
        return View<const std::deque<std::optional<Record>>, const Record&>(&slots_);
    }

private:
    std::deque<std::optional<Record>> slots_;
    u32 live_ = 0;
};

/** A pipeline description's hash: every field, as the equality compares them. */
struct PipelineDescHash {
    size_t operator()(const PipelineDesc& d) const noexcept {
        u64 h = 1469598103934665603ull;
        const auto mix = [&h](u64 v) { h = (h ^ v) * 1099511628211ull; };
        mix(static_cast<u32>(d.program));
        mix(static_cast<u32>(d.vertexLayout));
        mix(static_cast<u32>(d.blend));
        mix(static_cast<u32>(d.stencil));
        mix(static_cast<u32>(d.topology));
        mix(static_cast<u16>(d.depthBias));
        mix((u64(d.blendEnabled) << 0) | (u64(d.depthTest) << 1) | (u64(d.depthWrite) << 2) | (u64(d.cullEnabled) << 3)
            | (u64(d.cullFront) << 4) | (u64(d.alphaToCoverage) << 5) | (u64(d.gbuffer) << 6) | (u64(d.albedo) << 7)
            | (u64(d.colorWrite) << 8) | (u64(d.depthEqual) << 9));
        return static_cast<size_t>(h);
    }
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
    GfxRecordTable<GfxComputeRecord> computes;
    GfxRecordTable<GfxFramebufferRecord> framebuffers;
    GfxRecordTable<GfxLayoutRecord> layouts;
    GfxRecordTable<GfxPipelineRecord> pipelines;
    GfxRecordTable<GfxTimerQueryRecord> timerQueries;

    /** @brief An existing pipeline with this description, or 0. A hash lookup: a pipeline is asked for at every change of state. */
    u32 findPipeline(const PipelineDesc& desc) const {
        const auto it = pipelineIndex_.find(desc);
        return it != pipelineIndex_.end() ? it->second : 0;
    }

    /** @brief The pipeline with this description, made if there is none. Pipelines are never erased, so the index only grows. */
    u32 internPipeline(const PipelineDesc& desc) {
        if (const u32 existing = findPipeline(desc)) return existing;
        const u32 id = pipelines.insert(GfxPipelineRecord{desc});
        pipelineIndex_.emplace(desc, id);
        return id;
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

private:
    std::unordered_map<PipelineDesc, u32, PipelineDescHash> pipelineIndex_;
};

}  // namespace esengine
