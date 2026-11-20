// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SkinCache.cpp
 * @brief   The compute skinning behind SkinCache.hpp.
 */
#include "SkinCache.hpp"

#include "../../core/Log.hpp"
#include "../../resource/Mesh.hpp"
#include "../rhi/GfxDevice.hpp"

#include <algorithm>
#include <cstring>

namespace esengine {

namespace {

/// One vertex an invocation, posed over the same channels of its copy. Normals and tangents take the pose's 3x3 unnormalized,
/// exactly as the vertex stage skins them, or the two paths shade differently. A chunked mesh's joint indices are chunk-local:
/// `base` (per vertex) offsets them into `bones`.
constexpr const char* kSkinKernel = R"WGSL(
struct Params {
    count : u32, stride : u32, position : i32, normal : i32,
    tangent : i32, joints : i32, jointBytes : u32, weights : i32,
    weightKind : u32, chunked : u32, pad0 : u32, pad1 : u32,
};
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> src : array<u32>;
@group(0) @binding(2) var<storage, read_write> dst : array<u32>;
@group(0) @binding(3) var<storage, read> pose : array<mat4x4f>;
@group(0) @binding(4) var<storage, read> base : array<u32>;
@group(0) @binding(5) var<storage, read> bones : array<u32>;

fn byteAt(b : u32) -> u32 { return (src[b >> 2u] >> ((b & 3u) * 8u)) & 0xffu; }
fn halfAt(b : u32) -> u32 { return byteAt(b) | (byteAt(b + 1u) << 8u); }
fn word(w : u32) -> f32 { return bitcast<f32>(src[w]); }

fn jointOf(v : u32, k : u32) -> u32 {
    let at = v * P.stride * 4u + u32(P.joints) + k * P.jointBytes;
    var j = halfAt(at);
    if (P.jointBytes == 1u) { j = byteAt(at); }
    if (P.chunked != 0u) { j = bones[base[v] + j]; }
    return j;
}

fn weightOf(v : u32, k : u32) -> f32 {
    let at = v * P.stride * 4u + u32(P.weights);
    if (P.weightKind == 2u) { return bitcast<f32>(src[(at >> 2u) + k]); }
    if (P.weightKind == 1u) { return f32(halfAt(at + k * 2u)) / 65535.0; }
    return f32(byteAt(at + k)) / 255.0;
}

fn put(w : u32, value : vec3f) {
    dst[w] = bitcast<u32>(value.x);
    dst[w + 1u] = bitcast<u32>(value.y);
    dst[w + 2u] = bitcast<u32>(value.z);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
    let v = id.x;
    if (v >= P.count) { return; }
    var m = mat4x4f(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
    for (var k = 0u; k < 4u; k = k + 1u) {
        let w = weightOf(v, k);
        if (w > 0.0) { m = m + pose[jointOf(v, k)] * w; }
    }
    let row = v * P.stride;
    let r = mat3x3f(m[0].xyz, m[1].xyz, m[2].xyz);
    if (P.position >= 0) {
        let o = row + u32(P.position) / 4u;
        put(o, (m * vec4f(word(o), word(o + 1u), word(o + 2u), 1.0)).xyz);
    }
    if (P.normal >= 0) {
        let o = row + u32(P.normal) / 4u;
        put(o, r * vec3f(word(o), word(o + 1u), word(o + 2u)));
    }
    if (P.tangent >= 0) {
        let o = row + u32(P.tangent) / 4u;
        put(o, r * vec3f(word(o), word(o + 1u), word(o + 2u)));
    }
}
)WGSL";

constexpr u32 kWorkgroup = 64;
/// Frames an entry may go unasked before it is given back: a character out of every view for a moment keeps its copy.
constexpr u64 kIdleFrames = 120;
constexpr u32 kParamsBytes = 48;

}  // namespace

SkinCache::SkinCache(GfxDevice& device) : device_(device) {}

SkinCache::~SkinCache() {
    for (auto& [id, entry] : entries_) release(entry);
    if (kernel_ != ComputeHandle::Invalid) device_.deleteCompute(kernel_);
}

bool SkinCache::active() const {
    return settings_.enabled && device_.supportsCompute() && !kernelFailed_;
}

bool SkinCache::wants(SkinCacheUsage usage) const {
    if (!active() || usage == SkinCacheUsage::Disabled) return false;
    return usage == SkinCacheUsage::Enabled || settings_.behavior == SkinCacheBehavior::Inclusive;
}

void SkinCache::beginFrame(u64 frame) {
    if (frame == frame_) return;
    frame_ = frame;
    scheduled_ = 0;
    refused_ = 0;
    drawn_ = 0;
    for (auto it = entries_.begin(); it != entries_.end();) {
        it->second.scheduled = false;
        if (it->second.lastFrame + kIdleFrames < frame) {
            release(it->second);
            it = entries_.erase(it);
        } else {
            ++it;
        }
    }
    // A budget turned down gives back what is over it, the longest unasked first.
    const u64 budget = static_cast<u64>(std::max(settings_.maxMegabytes, 0.0f) * 1024.0f * 1024.0f);
    while (bytes_ > budget && !entries_.empty()) {
        auto oldest = std::min_element(entries_.begin(), entries_.end(),
                                       [](const auto& a, const auto& b) { return a.second.lastFrame < b.second.lastFrame; });
        release(oldest->second);
        entries_.erase(oldest);
    }
}

void SkinCache::release(Entry& entry) {
    for (BufferHandle* b : {&entry.sourceBuffer, &entry.output, &entry.boneBase, &entry.bones, &entry.pose, &entry.params}) {
        if (*b != BufferHandle::Invalid) device_.deleteBuffer(*b);
        *b = BufferHandle::Invalid;
    }
    bytes_ -= std::min(bytes_, entry.bytes);
    entry.bytes = 0;
}

bool SkinCache::build(Entry& entry, const Mesh& mesh) {
    const MeshSkinLayout& layout = mesh.skinLayout;
    const auto& bytes = *mesh.skinSource;
    const u32 size = static_cast<u32>(bytes.size());
    entry.vertexCount = mesh.vertexCount;
    entry.source = mesh.skinSource;
    entry.meshRevision = mesh.revision;
    // The copy starts as the vertices themselves: what the kernel does not write (uv, colour, the bake's uv) stays theirs.
    entry.sourceBuffer = device_.createBuffer({GfxBufferUsage::Storage, size, false}, GfxContent::transient(), bytes.data());
    entry.output = device_.createBuffer({GfxBufferUsage::Storage, size, false}, GfxContent::transient(), bytes.data());

    // Each vertex's chunk's first bone, where the mesh is chunked: a chunk is a run of indices, and each vertex is in one.
    std::vector<u32> base(std::max<u32>(mesh.vertexCount, 1u), 0u);
    std::vector<u32> bones(1, 0u);
    if (mesh.isChunked() && mesh.skinIndices) {
        const auto& indices = *mesh.skinIndices;
        for (const MeshSkinChunk& chunk : mesh.skinChunks) {
            for (u32 i = chunk.firstIndex; i < chunk.firstIndex + chunk.indexCount && i < indices.size(); ++i) {
                if (indices[i] < base.size()) base[indices[i]] = chunk.boneOffset;
            }
        }
        bones.assign(mesh.skinChunkBones.begin(), mesh.skinChunkBones.end());
    }
    entry.boneBase = device_.createBuffer({GfxBufferUsage::Storage, static_cast<u32>(base.size() * 4), false},
                                          GfxContent::transient(), base.data());
    entry.bones = device_.createBuffer({GfxBufferUsage::Storage, static_cast<u32>(bones.size() * 4), false},
                                       GfxContent::transient(), bones.data());
    const i32 params[12] = {
        static_cast<i32>(mesh.vertexCount), static_cast<i32>(layout.stride / 4), layout.position, layout.normal,
        layout.tangent, layout.joints, static_cast<i32>(layout.jointBytes), layout.weights,
        static_cast<i32>(layout.weightKind), mesh.isChunked() ? 1 : 0, 0, 0,
    };
    entry.params = device_.createBuffer({GfxBufferUsage::Uniform, kParamsBytes, false}, GfxContent::transient(), params);
    entry.bytes = static_cast<u64>(size) * 2 + base.size() * 4 + bones.size() * 4 + kParamsBytes;
    bytes_ += entry.bytes;
    return entry.sourceBuffer != BufferHandle::Invalid && entry.output != BufferHandle::Invalid
        && entry.boneBase != BufferHandle::Invalid && entry.bones != BufferHandle::Invalid && entry.params != BufferHandle::Invalid;
}

BufferHandle SkinCache::schedule(Entity entity, const Mesh& mesh, const glm::mat4* pose, u32 joints) {
    if (!active() || joints == 0 || !mesh.skinSource || mesh.skinLayout.position < 0 || mesh.skinLayout.joints < 0
        || mesh.skinLayout.weights < 0 || mesh.skinLayout.stride % 4 != 0 || mesh.isMorphable()) {
        return BufferHandle::Invalid;
    }
    auto found = entries_.find(entity.raw);
    if (found != entries_.end() && found->second.meshRevision != mesh.revision) {
        // The mesh was realized again (a reload, a device loss): its copy is built anew.
        release(found->second);
        entries_.erase(found);
        found = entries_.end();
    }
    if (found == entries_.end()) {
        const u64 budget = static_cast<u64>(std::max(settings_.maxMegabytes, 0.0f) * 1024.0f * 1024.0f);
        const u64 needs = static_cast<u64>(mesh.skinSource->size()) * 2 + static_cast<u64>(mesh.vertexCount) * 4;
        if (bytes_ + needs > budget) {
            ++refused_;
            return BufferHandle::Invalid;
        }
        Entry entry;
        if (!build(entry, mesh)) {
            release(entry);
            return BufferHandle::Invalid;
        }
        found = entries_.emplace(entity.raw, std::move(entry)).first;
    }
    Entry& entry = found->second;
    if (entry.scheduled) return entry.output;
    entry.pendingPose.assign(pose, pose + joints);
    entry.scheduled = true;
    entry.lastFrame = frame_;
    ++scheduled_;
    return entry.output;
}

BufferHandle SkinCache::bufferFor(Entity entity) const {
    const auto found = entries_.find(entity.raw);
    return found != entries_.end() && found->second.scheduled ? found->second.output : BufferHandle::Invalid;
}

void SkinCache::run() {
    if (scheduled_ == 0) return;
    if (kernel_ == ComputeHandle::Invalid && !kernelFailed_) {
        std::string log;
        kernel_ = device_.createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, kSkinKernel, "main"}, &log);
        if (kernel_ == ComputeHandle::Invalid) {
            kernelFailed_ = true;
            ES_LOG_ERROR("SkinCache: the skinning kernel did not compile, skins are posed in the vertex stage: {}", log);
            return;
        }
    }
    for (auto& [id, entry] : entries_) {
        if (!entry.scheduled || entry.pendingPose.empty()) continue;
        const u32 joints = static_cast<u32>(entry.pendingPose.size());
        if (joints > entry.poseCapacity || entry.pose == BufferHandle::Invalid) {
            if (entry.pose != BufferHandle::Invalid) {
                device_.deleteBuffer(entry.pose);
                entry.bytes -= static_cast<u64>(entry.poseCapacity) * sizeof(glm::mat4);
                bytes_ -= static_cast<u64>(entry.poseCapacity) * sizeof(glm::mat4);
            }
            entry.poseCapacity = joints;
            entry.pose = device_.createBuffer({GfxBufferUsage::Storage, joints * static_cast<u32>(sizeof(glm::mat4)), true},
                                              GfxContent::transient(), nullptr);
            entry.bytes += static_cast<u64>(joints) * sizeof(glm::mat4);
            bytes_ += static_cast<u64>(joints) * sizeof(glm::mat4);
            if (entry.pose == BufferHandle::Invalid) continue;
        }
        device_.updateBuffer(entry.pose, 0, entry.pendingPose.data(), joints * static_cast<u32>(sizeof(glm::mat4)));
        const GfxComputeBinding bindings[6] = {
            GfxComputeBinding::uniform(0, entry.params),
            GfxComputeBinding::storageRead(1, entry.sourceBuffer),
            GfxComputeBinding::storage(2, entry.output),
            GfxComputeBinding::storageRead(3, entry.pose),
            GfxComputeBinding::storageRead(4, entry.boneBase),
            GfxComputeBinding::storageRead(5, entry.bones),
        };
        device_.dispatchCompute(kernel_, bindings, 6, (entry.vertexCount + kWorkgroup - 1) / kWorkgroup);
    }
}

}  // namespace esengine
