// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SkeletalModule.hpp
 * @brief   What every 2D skeletal-animation side module needs, none of which is
 *          about any particular one.
 *
 * @details A module for Spine and a module for DragonBones disagree about almost
 *          everything an animator would name — mix tables against fade-in times,
 *          skins against display lists, which constraint kinds exist. They agree
 *          completely about the parts nobody names: that instances are reached
 *          through integer handles because the caller is on the other side of a
 *          wasm boundary, that posed triangles have to be batched by texture and
 *          blend before they cross it, that a `const char*` returned to JavaScript
 *          must point into storage the module keeps alive, and that events have to
 *          queue until the caller drains them.
 *
 *          So that is what lives here — the second time it was about to be written
 *          rather than the first. Nothing in this header knows what a runtime is;
 *          a module supplies the posing and reads these back.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstdint>
#include <cstring>
#include <iterator>
#include <string>
#include <unordered_map>
#include <vector>

namespace es::skeletal {

/// Interleaved x,y,u,v,r,g,b,a per vertex — the layout the SDK reads back.
constexpr int VERTEX_FLOATS = 8;

/// 16-bit indices, so a batch closes before one would wrap.
constexpr std::size_t MAX_BATCH_VERTICES = 65535;

/**
 * Append-only storage that keeps what it allocated when it is emptied.
 *
 * A vector would do this too, but only through `push_back`'s per-element check
 * or `resize`'s zero-fill of bytes about to be overwritten — and a thousand
 * skeletons write three thousand of these each, every frame.
 */
template <class T>
class Buffer {
public:
    void clear() { size_ = 0; }

    /// Room for `count` more, to write through. The next append invalidates it.
    T* append(std::size_t count) {
        if (size_ + count > storage_.size()) storage_.resize(size_ + count);
        T* at = storage_.data() + size_;
        size_ += count;
        return at;
    }

    std::size_t size() const { return size_; }
    const T* data() const { return storage_.data(); }
    const T& operator[](std::size_t index) const { return storage_[index]; }

    /// What it can take before it allocates again.
    std::size_t capacity() const { return storage_.capacity(); }

private:
    std::vector<T> storage_;
    std::size_t size_ = 0;
};

/// One draw's worth of geometry.
struct MeshBatch {
    Buffer<float> vertices;
    Buffer<std::uint16_t> indices;
    std::uint32_t texture = 0;
    int blendMode = 0;
};

/// Where a runtime pours the triangles it posed.
struct TriangleSink {
    virtual ~TriangleSink() = default;
    virtual void emit(const float* positions, const float* uvs, int vertexCount,
                      const std::uint16_t* indices, int indexCount,
                      std::uint32_t texture, int blendMode, const float rgba[4]) = 0;
};

/**
 * The batches of one extraction, in slots that outlive it: a slot is reopened
 * rather than destroyed, so a frame writes into the capacity the last one grew.
 * That capacity is the high-water mark of the largest extraction ever run here,
 * held until the module goes — trimming it on a small frame is a per-frame free.
 */
class BatchList {
public:
    /// What the list can take before it allocates again.
    struct Capacity {
        std::size_t slots = 0;
        std::size_t vertexFloats = 0;
        std::size_t indices = 0;
    };

    /// Reopens the list for another extraction. A slot is emptied when it is
    /// opened, not here, so a slot past the new extent cannot be read as this
    /// extraction's either — nothing reaches one but `open`.
    void reset() { active_ = 0; }

    /// Starts a batch in this state, in the next slot's storage. The reference
    /// is good until the next `open`, which may move every slot.
    MeshBatch& open(std::uint32_t texture, int blendMode) {
        if (active_ == slots_.size()) slots_.emplace_back();
        MeshBatch& fresh = slots_[active_++];
        fresh.vertices.clear();
        fresh.indices.clear();
        fresh.texture = texture;
        fresh.blendMode = blendMode;
        return fresh;
    }

    /// The batch still open — meaningful only while `size()` is nonzero.
    MeshBatch& back() { return slots_[active_ - 1]; }

    std::size_t size() const { return active_; }
    const MeshBatch& operator[](std::size_t index) const { return slots_[index]; }
    const MeshBatch* begin() const { return slots_.data(); }
    const MeshBatch* end() const { return slots_.data() + active_; }

    /// The whole pool, not what this extraction used: an idle slot keeps its
    /// storage, which is the point.
    Capacity capacity() const {
        Capacity total;
        total.slots = slots_.size();
        for (const MeshBatch& slot : slots_) {
            total.vertexFloats += slot.vertices.capacity();
            total.indices += slot.indices.capacity();
        }
        return total;
    }

private:
    std::vector<MeshBatch> slots_;
    std::size_t active_ = 0;
};

/**
 * Batches what a runtime emits: a texture or blend change starts a new batch, so
 * does filling one, and incoming indices are rebased onto what is already written.
 *
 * Bound to its list rather than reaching for a global, so a module can pose into
 * a scratch list without disturbing the one its getters are serving. A slot is
 * reused for its storage only: batching stays sequential, so a state that comes
 * back after another one starts a new batch rather than rejoining its own, which
 * is what keeps the draw order.
 */
class BatchCollector final : public TriangleSink {
public:
    explicit BatchCollector(BatchList& into) : batches_(into) {}

    void emit(const float* positions, const float* uvs, int vertexCount,
              const std::uint16_t* indices, int indexCount,
              std::uint32_t texture, int blendMode, const float rgba[4]) override {
        if (vertexCount <= 0 || indexCount <= 0) return;

        MeshBatch& batch = batchFor(texture, blendMode, vertexCount);
        const auto base = static_cast<std::uint16_t>(batch.vertices.size() / VERTEX_FLOATS);

        float* vertex = batch.vertices.append(
            static_cast<std::size_t>(vertexCount) * VERTEX_FLOATS);
        for (int i = 0; i < vertexCount; ++i, vertex += VERTEX_FLOATS) {
            vertex[0] = positions[i * 2];
            vertex[1] = positions[i * 2 + 1];
            vertex[2] = uvs[i * 2];
            vertex[3] = uvs[i * 2 + 1];
            vertex[4] = rgba[0];
            vertex[5] = rgba[1];
            vertex[6] = rgba[2];
            vertex[7] = rgba[3];
        }

        std::uint16_t* index = batch.indices.append(static_cast<std::size_t>(indexCount));
        for (int i = 0; i < indexCount; ++i) {
            index[i] = static_cast<std::uint16_t>(base + indices[i]);
        }
    }

private:
    MeshBatch& batchFor(std::uint32_t texture, int blendMode, int incomingVertices) {
        if (batches_.size() > 0) {
            MeshBatch& open = batches_.back();
            const bool sameState = texture == open.texture && blendMode == open.blendMode;
            const bool fits =
                open.vertices.size() / VERTEX_FLOATS + static_cast<std::size_t>(incomingVertices)
                <= MAX_BATCH_VERTICES;
            if (sameState && fits) return open;
        }
        return batches_.open(texture, blendMode);
    }

    BatchList& batches_;
};

/**
 * Integer handles to owned objects.
 *
 * Ids are never reused within a run: a caller holding a stale handle gets null
 * rather than somebody else's skeleton, which is the difference between a bug that
 * reports itself and one that renders the wrong character.
 */
template <class T>
class HandleTable {
public:
    int add(T value) {
        const int id = next_++;
        items_.emplace(id, std::move(value));
        return id;
    }

    T* find(int id) {
        auto it = items_.find(id);
        return it == items_.end() ? nullptr : &it->second;
    }

    bool erase(int id) { return items_.erase(id) > 0; }

    /// Drop every entry matching `pred` — how a skeleton takes its instances with
    /// it, since they hold data it owns and must not outlive it.
    template <class Pred>
    void eraseIf(Pred pred) {
        for (auto it = items_.begin(); it != items_.end();) {
            it = pred(it->second) ? items_.erase(it) : std::next(it);
        }
    }

    void clear() { items_.clear(); }

private:
    std::unordered_map<int, T> items_;
    int next_ = 1;
};

/**
 * Storage behind every `const char*` this module returns.
 *
 * One buffer, overwritten per call: the SDK copies what it reads before calling
 * again, which is the contract on both sides of the boundary.
 */
class StringBuffer {
public:
    const char* publish(const char* text) {
        buffer_ = text ? text : "";
        return buffer_.c_str();
    }

    /// `["a","b"]` from an indexed getter — how name lists cross the boundary.
    template <class Fn>
    const char* publishArray(int count, Fn nameAt) {
        buffer_ = "[";
        for (int i = 0; i < count; ++i) {
            if (i > 0) buffer_ += ',';
            const char* name = nameAt(i);
            buffer_ += '"';
            buffer_ += name ? name : "";
            buffer_ += '"';
        }
        buffer_ += ']';
        return buffer_.c_str();
    }

    /// Direct access, for a shape the helpers above do not cover (the constraint
    /// map, say). Assign to it, then return `c_str()` — same lifetime rule.
    std::string& raw() { return buffer_; }

private:
    std::string buffer_;
};

/// The strings one queued event borrowed from its runtime's own data.
struct EventStrings {
    const char* animationName = nullptr;
    const char* eventName = nullptr;
    const char* stringValue = nullptr;
};

/**
 * Events queued for the caller to drain after an update.
 *
 * The numbers ride in a float array because that is the one buffer type that
 * crosses cheaply; the two integers ride as their bit patterns, and the SDK reads
 * them back through the same reinterpretation. Capacity is fixed and overflow is
 * dropped: a frame that produced more events than this had a runaway animation,
 * and growing the buffer would only postpone noticing.
 */
class EventBuffer {
public:
    static constexpr int MAX_PER_UPDATE = 64;

    void clear() {
        values_.clear();
        strings_.clear();
        count_ = 0;
    }

    void push(int kind, int track, float floatValue, int intValue, EventStrings strings) {
        if (count_ >= MAX_PER_UPDATE) return;
        pushBits(kind);
        pushBits(track);
        values_.push_back(floatValue);
        pushBits(intValue);
        strings_.push_back(strings);
        ++count_;
    }

    int count() const { return count_; }
    const float* values() const { return values_.data(); }
    /// Live extent of the float buffer — a caller cannot infer it from the
    /// count without assuming this packing's stride.
    std::size_t byteLength() const { return values_.size() * sizeof(float); }
    const EventStrings* strings(int index) const {
        return index >= 0 && index < count_ ? &strings_[static_cast<std::size_t>(index)] : nullptr;
    }

private:
    void pushBits(int value) {
        float bits;
        std::memcpy(&bits, &value, sizeof(bits));
        values_.push_back(bits);
    }

    std::vector<float> values_;
    std::vector<EventStrings> strings_;
    int count_ = 0;
};

}  // namespace es::skeletal
