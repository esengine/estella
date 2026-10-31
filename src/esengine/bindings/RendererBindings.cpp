// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

#include <cmath>
#include "RendererBindings.hpp"
#include "TestProbeBindings.hpp"

#include <limits>
#include "../resource/ShaderParser.hpp"
#include "ActiveContext.hpp"
#include "BoundarySpan.hpp"
#include "../renderer/rhi/GfxDevice.hpp"
#include "../renderer/frame/RenderFrame.hpp"
#include "../renderer/lod/LodSelection.hpp"
#include "../renderer/store/LightPlan.hpp"
#include "../renderer/store/ShadowPlan.hpp"
#include "../renderer/frame/RenderContext.hpp"
#include "../core/FrameProfiler.hpp"
#include "../renderer/frame/RenderStage.hpp"
#include "../renderer/draw/ImmediateDraw.hpp"
#include "../renderer/draw/CustomGeometry.hpp"
#include "../renderer/draw/TextVertexFormat.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/GroupOpacityLookup.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../core/World.hpp"
#include "../core/EntityPose2D.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/MeshRenderer.hpp"
#include "../ecs/components/Light.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../core/Log.hpp"
// Core, not particles: the seed binding below is unconditional.
#include "../core/RandomSource.hpp"
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif
#include "../trail/TrailSystem.hpp"
#include "../springbone/SpringBoneSystem.hpp"
#include "../ui/UISystem.hpp"
#include "../ecs/FlatGeometry.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/UIVisual.hpp"
#include "../renderer/plugins/UIElementPlugin.hpp"
#include "../renderer/draw/RetainedText.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/val.h>
#endif
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <cstring>
#include <utility>

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }

#define g_device (ctx().tryGet<GfxDevice>())
#define g_initialized (ctx().state().initialized)
#define g_renderFrame (ctx().tryGet<RenderFrame>())
#define g_transformSystem (ctx().tryGet<ecs::TransformSystem>())
#define g_glErrorCheckEnabled (ctx().state().gl_error_check_enabled)
#define g_viewportWidth (ctx().state().viewport_width)
#define g_viewportHeight (ctx().state().viewport_height)
#ifdef ES_ENABLE_PARTICLES
#define g_particleSystem (ctx().tryGet<particle::ParticleSystem>())
#endif
#define g_trailSystem (ctx().tryGet<trail::TrailSystem>())
#define g_springBoneSystem (ctx().tryGet<springbone::SpringBoneSystem>())

namespace {
// The channels the engine's own mesh uploads use, named by semantic so a change
// to the vocabulary moves them rather than leaving two literal 1s behind.
// Byte offsets follow the packed {x,y,z,u,v,rgba8} vertex both callers build.
constexpr GfxVertexAttribute kStandardMeshChannels[3] = {
    {static_cast<u32>(MeshChannel::Position),  3, GfxDataType::Float,        false,  0, 0},
    {static_cast<u32>(MeshChannel::Color),     4, GfxDataType::UnsignedByte, true,  20, 0},
    {static_cast<u32>(MeshChannel::TexCoord0), 2, GfxDataType::Float,        false, 12, 0},
};
}  // namespace

static u32 checkGLErrors(const char* context) {
    if (!g_glErrorCheckEnabled) return 0;
    u32 errorCount = 0;
    u32 err;
    while ((err = g_device->getError()) != 0) {
        ES_LOG_ERROR("[GL Error] 0x{:04X} at: {}", err, context);
        errorCount++;
    }
    return errorCount;
}

// Geometry posed by a skeletal runtime — Spine and DragonBones both come through
// here. Ungated on purpose: the core links neither, so neither runtime's build
// option may decide whether this door exists.
void renderer_submitSkeletalBatchByEntity(
    ecs::Registry& registry,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    u32 entity, f32 skelScale, bool flipX, bool flipY,
    i32 layer, f32 depth, u32 materialId
) {
    renderer_submitSkeletalBatchByEntityEx(registry, verticesPtr, vertexCount, indicesPtr, indexCount, textureId, blendMode, entity, skelScale, flipX, flipY, layer, depth, materialId, blendMode == 4 || blendMode == 5);
}

void renderer_submitSkeletalBatchByEntityEx(
    ecs::Registry& registry,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode,
    u32 entity, f32 skelScale, bool flipX, bool flipY,
    i32 layer, f32 depth, u32 materialId, bool premultipliedColor
) {
    if (!g_initialized || !g_renderFrame) return;
    const Entity ent = Entity::fromRaw(entity);
    if (!registry.isEntityActive(ent) || !registry.has<ecs::Transform>(ent)) return;

    auto& t = registry.get<ecs::Transform>(ent);
    t.ensureDecomposed();

    glm::vec3 s = t.worldScale;
    s.x *= skelScale;
    s.y *= skelScale;
    if (flipX) s.x = -s.x;
    if (flipY) s.y = -s.y;

    glm::mat4 model = glm::translate(glm::mat4(1.0f), t.worldPosition)
                     * glm::mat4_cast(t.worldRotation)
                     * glm::scale(glm::mat4(1.0f), s);

    if (vertexCount < 0 || indexCount < 0) return;
    // Skeletal vertex format is x,y,u,v,r,g,b,a (8 floats per vertex).
    auto* vertices = boundarySpan<f32>(verticesPtr, static_cast<u64>(vertexCount) * 8, "renderer_submitSkeletalBatchByEntity.vertices");
    auto* indices = boundarySpan<u16>(indicesPtr, static_cast<u64>(indexCount), "renderer_submitSkeletalBatchByEntity.indices");
    if (!vertices || !indices) return;
    g_renderFrame->submitSkeletalBatch(
        vertices, vertexCount, indices, indexCount,
        textureId, blendMode, &model[0][0], ent, layer, depth, materialId, premultipliedColor);
}

/**
 * Whether the camera being rendered right now would draw this entity, given the
 * local extent it promises to stay inside. All four corners are transformed,
 * because under rotation the result's corners are not the input's. The frustum
 * and mask are the frame's own — a fact, not a permission.
 */
void renderer_entityVisibleToCamera(
    ecs::Registry& registry, u32 entity, i32 layer,
    f32 minX, f32 minY, f32 maxX, f32 maxY, uintptr_t outVisiblePtr
) {
    auto* out = reinterpret_cast<i32*>(outVisiblePtr);
    if (!out) return;
    *out = 1;
    if (!g_initialized || !g_renderFrame) return;
    const Entity ent = Entity::fromRaw(entity);
    if (!registry.has<ecs::Transform>(ent)) return;

    auto& t = registry.get<ecs::Transform>(ent);
    t.ensureDecomposed();
    const glm::mat4 model = glm::translate(glm::mat4(1.0f), t.worldPosition)
                          * glm::mat4_cast(t.worldRotation)
                          * glm::scale(glm::mat4(1.0f), t.worldScale);

    const glm::vec2 corners[4] = {
        { minX, minY }, { maxX, minY }, { maxX, maxY }, { minX, maxY },
    };
    glm::vec3 lo{std::numeric_limits<f32>::max()};
    glm::vec3 hi{-std::numeric_limits<f32>::max()};
    for (const glm::vec2& corner : corners) {
        const glm::vec4 world = model * glm::vec4(corner.x, corner.y, 0.0f, 1.0f);
        lo = glm::min(lo, glm::vec3(world));
        hi = glm::max(hi, glm::vec3(world));
    }
    *out = g_renderFrame->visibleToCamera(layer, (lo + hi) * 0.5f, (hi - lo) * 0.5f) ? 1 : 0;
}

// TS lays out glyph quads against the dynamic SDF atlas and
// submits them here (ungated — text is core, unlike spine).
void renderer_submitTextBatch(
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, uintptr_t transformPtr,
    u32 entity, i32 layer, f32 depth, i32 glyphMode, u32 cullBit
) {
    if (!g_initialized || !g_renderFrame) return;
    if (vertexCount < 0 || indexCount < 0) return;
    auto* vertices = boundarySpan<f32>(verticesPtr, static_cast<u64>(vertexCount) * TEXT_VERTEX_FLOATS, "renderer_submitTextBatch.vertices");
    auto* indices = boundarySpan<u16>(indicesPtr, static_cast<u64>(indexCount), "renderer_submitTextBatch.indices");
    auto* transform = boundarySpan<f32>(transformPtr, 16, "renderer_submitTextBatch.transform");
    if (!vertices || !indices || !transform) return;
    g_renderFrame->submitTextBatch(
        vertices, vertexCount, indices, indexCount,
        textureId, transform, Entity::fromRaw(entity), layer, depth, textGlyphModeFromRaw(glyphMode), cullBit);
}

void renderer_retainedTextBegin(
    u32 entity, i32 sdf, i32 screen, i32 hasBox, i32 layer, f32 boxWidth, f32 boxHeight, i32 autoKind
) {
    if (!g_initialized || !g_renderFrame) return;
    g_renderFrame->retainedText().begin(entity, sdf != 0, screen != 0, hasBox != 0, layer, boxWidth, boxHeight, autoKind != 0);
}

void renderer_retainedTextBatch(
    u32 entity, uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount, u32 pageId, i32 glyphMode
) {
    if (!g_initialized || !g_renderFrame) return;
    if (vertexCount < 0 || indexCount < 0) return;
    auto* vertices = boundarySpan<f32>(verticesPtr, static_cast<u64>(vertexCount) * TEXT_VERTEX_FLOATS, "renderer_retainedTextBatch.vertices");
    auto* indices = boundarySpan<u16>(indicesPtr, static_cast<u64>(indexCount), "renderer_retainedTextBatch.indices");
    if (!vertices || !indices) return;
    g_renderFrame->retainedText().add(entity, vertices, vertexCount, indices, indexCount, pageId, textGlyphModeFromRaw(glyphMode));
}

void renderer_retainedTextClear(u32 entity) {
    if (!g_initialized || !g_renderFrame) return;
    g_renderFrame->retainedText().clear(entity);
}

i32 renderer_retainedTextStale(ecs::Registry& registry, uintptr_t outPtr, i32 capacity) {
    if (!g_initialized || !g_renderFrame || capacity <= 0) return 0;
    auto* out = boundarySpanMut<u32>(outPtr, static_cast<u64>(capacity), "renderer_retainedTextStale.out");
    if (!out) return 0;
    auto* ui = ctx().tryGet<ecs::UISystem>();
    auto& entries = g_renderFrame->retainedText().entries();
    i32 written = 0;
    for (auto it = entries.begin(); it != entries.end();) {
        const Entity entity = Entity::fromRaw(it->first);
        if (!registry.valid(entity)) {
            it = entries.erase(it);
            continue;
        }
        const RetainedText& text = it->second;
        const auto* node = registry.tryGet<ecs::UINode>(entity);
        const f32 width = node ? node->computed_size_.x : 0.0f;
        const f32 height = node ? node->computed_size_.y : 0.0f;
        const bool screen = ui && ui->isScreenDomain(registry, it->first);
        bool stale = width != text.boxWidth || height != text.boxHeight || screen != text.screen;
        if (!stale && text.autoKind) {
            // The pipeline was chosen from the world scale: the script no longer reads the transform every frame to see whether it moved.
            if (auto* transform = registry.tryGet<ecs::Transform>(entity)) {
                transform->ensureDecomposed();
                stale = retainedTextAutoIsSdf(transform->worldScale.x) != text.sdf;
            }
        }
        if (stale && written < capacity) out[written++] = it->first;
        ++it;
    }
    return written;
}

void renderer_retainedTextSubmit(ecs::Registry& registry, i32 screen, uintptr_t projectionPtr) {
    if (!g_initialized || !g_renderFrame) return;
    const f32* projection = projectionPtr ? boundarySpan<f32>(projectionPtr, 16, "renderer_retainedTextSubmit.projection") : nullptr;
    // Scratch that outlives the call: a frame of labels would otherwise allocate them each time.
    static RetainedTextClip clip;
    static std::vector<f32> faded;
    double planes[36];
    const ecs::GroupOpacityLookup groupOpacity(registry);
    for (auto& [raw, text] : g_renderFrame->retainedText().entries()) {
        if (text.screen != (screen != 0)) continue;
        const Entity entity = Entity::fromRaw(raw);
        if (!registry.valid(entity)) continue;
        const auto* node = registry.tryGet<ecs::UINode>(entity);
        if (node && node->hidden_in_tree_) continue;
        const f32 opacity = (node ? node->alpha_in_tree_ : 1.0f) * groupOpacity.of(entity);
        if (opacity <= 0.0f) continue;
        glm::mat4 matrix;
        if (!ecs::copyFlatRenderMatrix(registry, entity, matrix)) continue;
        const auto* visual = registry.tryGet<ecs::UIVisual>(entity);
        i32 layer = text.layer;
        if (text.hasBox) {
            const i32 order = visual ? visual->uiOrder : -1;
            layer = order >= 0 ? UIElementPlugin::UI_BASE_LAYER + order : UIElementPlugin::UI_BASE_LAYER;
        }
        // Screen draws all share one depth: their order is the UI tree's, and a z left on a screen root would outrank a sibling.
        f32 depth = 0.0f;
        if (!text.screen) {
            if (auto* transform = registry.tryGet<ecs::Transform>(entity)) {
                transform->ensureDecomposed();
                depth = transform->worldPosition.z;
            }
        }
        const u32 cullBit = visual ? visual->uiCullBit : 0u;
        const f32* model = glm::value_ptr(matrix);
        const bool clipped = projection && retainedTextClipPlanes(planes, projection, model);
        for (const RetainedTextBatch& batch : text.batches) {
            const RetainedTextKept kept = retainedTextClip(batch, clipped ? planes : nullptr, clip);
            if (kept == RetainedTextKept::None) continue;
            const f32* vertices = kept == RetainedTextKept::All ? batch.vertices.data() : clip.vertices.data();
            const u16* indices = kept == RetainedTextKept::All ? batch.indices.data() : clip.indices.data();
            const usize vertexCount = (kept == RetainedTextKept::All ? batch.vertices.size() : clip.vertices.size()) / TEXT_VERTEX_FLOATS;
            if (opacity != 1.0f) {
                faded.assign(vertices, vertices + vertexCount * TEXT_VERTEX_FLOATS);
                for (usize i = 7; i < faded.size(); i += TEXT_VERTEX_FLOATS) faded[i] *= opacity;
                vertices = faded.data();
            }
            g_renderFrame->submitTextBatch(vertices, static_cast<i32>(vertexCount), indices, static_cast<i32>(vertexCount / 4 * 6),
                                           batch.pageId, model, entity, layer, depth, batch.mode, cullBit);
        }
    }
}

// MeshRenderer geometry upload: interleaved f32 [x,y,u,v] per vertex, optional RGBA8
// colors (null = all white), u32 triangle-list indices. Validated here — the single
// upload entry — so the render path can trust the payload: out-of-range indices or a
// non-triangle count reject the whole upload instead of feeding the GPU garbage.
void meshRenderer_setGeometry(ecs::Registry& registry, u32 entity,
                        uintptr_t posUvPtr, u32 vertexCount,
                        uintptr_t colorsPtr,
                        uintptr_t indicesPtr, u32 indexCount) {
    const Entity ent = Entity::fromRaw(entity);
    auto* mesh = registry.tryGet<ecs::MeshRenderer>(ent);
    if (!mesh) {
        ES_LOG_WARN("meshRenderer_setGeometry: entity {} has no MeshRenderer component", entity);
        return;
    }

    // Empty upload = clear the geometry (a valid state: the mesh renders nothing).
    if (posUvPtr == 0 || indicesPtr == 0 || vertexCount == 0 || indexCount == 0) {
        mesh->vertices.clear();
        mesh->indices.clear();
        mesh->localMin = mesh->localMax = glm::vec2(0.0f);
        return;
    }
    if (indexCount % 3 != 0) {
        ES_LOG_WARN("meshRenderer_setGeometry: indexCount {} is not a triangle list; rejected", indexCount);
        return;
    }

    const f32* posUv = boundarySpan<f32>(posUvPtr, static_cast<u64>(vertexCount) * 4, "meshRenderer_setGeometry.posUv");
    const u32* colors = colorsPtr ? boundarySpan<u32>(colorsPtr, vertexCount, "meshRenderer_setGeometry.colors") : nullptr;
    const u32* indices = boundarySpan<u32>(indicesPtr, indexCount, "meshRenderer_setGeometry.indices");
    if (!posUv || !indices || (colorsPtr && !colors)) return;

    for (u32 i = 0; i < indexCount; ++i) {
        if (indices[i] >= vertexCount) {
            ES_LOG_WARN("meshRenderer_setGeometry: index {} out of range (vertexCount {}); rejected",
                        indices[i], vertexCount);
            return;
        }
    }

    mesh->vertices.resize(vertexCount);
    glm::vec2 mn(posUv[0], posUv[1]);
    glm::vec2 mx = mn;
    for (u32 v = 0; v < vertexCount; ++v) {
        auto& out = mesh->vertices[v];
        out.position = { posUv[v * 4 + 0], posUv[v * 4 + 1] };
        out.uv = { posUv[v * 4 + 2], posUv[v * 4 + 3] };
        out.color = colors ? colors[v] : 0xFFFFFFFFu;
        mn = glm::min(mn, out.position);
        mx = glm::max(mx, out.position);
    }
    mesh->indices.assign(indices, indices + indexCount);
    mesh->localMin = mn;
    mesh->localMax = mx;
}

// The placements of a MeshInstances, copied in and measured: the corners of where the instances stand and the
// greatest scale among them, which with the mesh's reach is what bounds the set. The collect trusts the count.
void meshInstances_set(ecs::Registry& registry, u32 entity, uintptr_t dataPtr, u32 count) {
    const Entity ent = Entity::fromRaw(entity);
    auto* set = registry.tryGet<ecs::MeshInstances>(ent);
    if (!set) {
        ES_LOG_WARN("meshInstances_set: entity {} has no MeshInstances component", entity);
        return;
    }
    constexpr u32 kFloats = 16;
    if (dataPtr == 0 || count == 0) {
        set->transforms.clear();
        set->originMin = set->originMax = glm::vec3(0.0f);
        set->maxScale = 1.0f;
        return;
    }
    const f32* data = boundarySpan<f32>(dataPtr, static_cast<u64>(count) * kFloats, "meshInstances_set.transforms");
    if (!data) return;
    set->transforms.assign(data, data + static_cast<usize>(count) * kFloats);
    glm::vec3 mn(data[3], data[7], data[11]);
    glm::vec3 mx = mn;
    f32 scale = 0.0f;
    for (u32 i = 0; i < count; ++i) {
        const f32* r = data + static_cast<usize>(i) * kFloats;
        const glm::vec3 at(r[3], r[7], r[11]);
        mn = glm::min(mn, at);
        mx = glm::max(mx, at);
        // The longest column of the linear part: how far the instance stretches its mesh.
        const f32 c0 = r[0] * r[0] + r[4] * r[4] + r[8] * r[8];
        const f32 c1 = r[1] * r[1] + r[5] * r[5] + r[9] * r[9];
        const f32 c2 = r[2] * r[2] + r[6] * r[6] + r[10] * r[10];
        scale = std::max(scale, std::max(c0, std::max(c1, c2)));
    }
    set->originMin = mn;
    set->originMax = mx;
    set->maxScale = std::sqrt(scale);
}

// Geometry that STAYS on the GPU: interleaved f32 [x,y,z,u,v] plus optional RGBA8
// colors, validated exactly as the inline path is. createMesh appends the
// per-object transform, so nothing here knows how a mesh reaches the shader.
// Geometry from an .esmesh. The channel table arrives in the file's own layout
// (8 bytes each), so the asset layer owns the FORMAT and the engine owns the
// vertex layout it becomes. A channel's semantic is its attribute location.
namespace {

/** One .esmesh's geometry, marshalled out of wasm memory and validated. */
struct MeshUpload {
    GfxVertexAttribute channels[MAX_VERTEX_ATTRIBUTES];
    u32 channelCount = 0;
    u32 vertexStride = 0;
    const u8* verts = nullptr;
    u32 vertexBytes = 0;
    const u32* indices = nullptr;
    u32 indexCount = 0;
    const f32* bind = nullptr;
    u32 bindFloats = 0;
    MeshMorphSource morph;
    glm::vec3 localMin{0.0f};
    glm::vec3 localMax{0.0f};

    ConstSpan<u8> vertexSpan() const { return ConstSpan<u8>(verts, vertexBytes); }
    ConstSpan<u32> indexSpan() const { return ConstSpan<u32>(indices, indexCount); }
    ConstSpan<GfxVertexAttribute> channelSpan() const {
        return ConstSpan<GfxVertexAttribute>(channels, channelCount);
    }
    ConstSpan<f32> bindSpan() const {
        return bind ? ConstSpan<f32>(bind, bindFloats) : ConstSpan<f32>();
    }
};

// Shared by the mint and the rebuild so a mesh cannot be validated one way when
// it arrives and another way when it comes back.
bool marshalMeshChannels(MeshUpload& out, const char* who,
                         uintptr_t channelsPtr, u32 channelCount, u32 vertexStride,
                         uintptr_t vertexPtr, u32 vertexBytes,
                         uintptr_t indexPtr, u32 indexCount,
                         f32 minX, f32 minY, f32 minZ,
                         f32 maxX, f32 maxY, f32 maxZ,
                         uintptr_t bindPtr, u32 bindFloats,
                         uintptr_t morphPtr, u32 morphFloats,
                         u32 morphTargets, u32 morphNormals) {
    if (channelCount == 0 || channelCount > MAX_VERTEX_ATTRIBUTES) return false;
    if (vertexStride == 0 || vertexBytes == 0 || indexCount == 0) return false;
    if (indexCount % 3 != 0) {
        ES_LOG_WARN("{}: indexCount {} is not a triangle list", who, indexCount);
        return false;
    }

    const u8* table = boundarySpan<u8>(channelsPtr, static_cast<u64>(channelCount) * 8, who);
    const u8* verts = boundarySpan<u8>(vertexPtr, vertexBytes, who);
    const u32* indices = boundarySpan<u32>(indexPtr, indexCount, who);
    if (!table || !verts || !indices) return false;

    const u32 vertexCount = vertexBytes / vertexStride;
    for (u32 i = 0; i < indexCount; ++i) {
        if (indices[i] >= vertexCount) {
            ES_LOG_WARN("{}: index {} out of range ({} vertices)", who, indices[i], vertexCount);
            return false;
        }
    }

    // The file's channel type, which is the asset layer's vocabulary, into the
    // device's — the boundary the format crosses as bytes.
    auto channelType = [](u8 code) {
        switch (static_cast<MeshChannelType>(code)) {
        case MeshChannelType::UNorm8: return GfxDataType::UnsignedByte;
        case MeshChannelType::UInt16: return GfxDataType::UnsignedShort;
        default:                      return GfxDataType::Float;
        }
    };
    for (u32 i = 0; i < channelCount; ++i) {
        const u8* c = table + i * 8;
        out.channels[i] = GfxVertexAttribute{
            .location = c[0],
            .components = c[1],
            .type = channelType(c[2]),
            .normalized = c[3] != 0,
            .offset = static_cast<u32>(c[4]) | (static_cast<u32>(c[5]) << 8)
                    | (static_cast<u32>(c[6]) << 16) | (static_cast<u32>(c[7]) << 24),
            .bufferSlot = 0,
        };
    }

    // The bind pose rides beside the vertices because the Joints channel indexes
    // it; a mesh with joints and no matrices is drawn static rather than wrong.
    out.bind = bindFloats > 0 ? boundarySpan<f32>(bindPtr, bindFloats, who) : nullptr;
    out.bindFloats = bindFloats;
    // The shapes ride with the vertices for the reason the bind pose does: a
    // delta is addressed BY a vertex index, so the two are one statement.
    if (morphTargets > 0 && morphFloats > 0) {
        if (const f32* deltas = boundarySpan<f32>(morphPtr, morphFloats, who)) {
            out.morph = {ConstSpan<f32>(deltas, morphFloats), morphTargets, morphNormals != 0};
        }
    }
    out.channelCount = channelCount;
    out.vertexStride = vertexStride;
    out.verts = verts;
    out.vertexBytes = vertexBytes;
    out.indices = indices;
    out.indexCount = indexCount;
    out.localMin = glm::vec3(minX, minY, minZ);
    out.localMax = glm::vec3(maxX, maxY, maxZ);
    return true;
}

}  // namespace

// Geometry from an .esmesh. The channel table arrives in the file's own layout
// (8 bytes each), so the asset layer owns the FORMAT and the engine owns the
// vertex layout it becomes. A channel's semantic is its attribute location.
u32 mesh_createFromChannels(uintptr_t channelsPtr, u32 channelCount, u32 vertexStride,
                            uintptr_t vertexPtr, u32 vertexBytes,
                            uintptr_t indexPtr, u32 indexCount,
                            f32 minX, f32 minY, f32 minZ,
                            f32 maxX, f32 maxY, f32 maxZ,
                            uintptr_t bindPtr, u32 bindFloats,
                            uintptr_t morphPtr, u32 morphFloats,
                            u32 morphTargets, u32 morphNormals) {
    auto* rm = ctx().tryGet<resource::ResourceManager>();
    MeshUpload up;
    if (!rm || !marshalMeshChannels(up, "mesh_createFromChannels",
                                    channelsPtr, channelCount, vertexStride,
                                    vertexPtr, vertexBytes, indexPtr, indexCount,
                                    minX, minY, minZ, maxX, maxY, maxZ, bindPtr, bindFloats,
                                    morphPtr, morphFloats, morphTargets, morphNormals)) {
        return 0;
    }
    auto handle = rm->createMesh(up.vertexSpan(), up.indexSpan(), up.channelSpan(), up.vertexStride,
                                 up.localMin, up.localMax,
                                 MeshRecovery::SourceReplayable, up.bindSpan(), up.morph);
    return handle.id();
}

// The same geometry arriving for a SECOND time, behind a handle that already
// exists: a device generation ended and the asset layer is replaying the source.
// Minting here instead would leave every component pointing at the dead mesh.
u32 mesh_rematerializeFromChannels(u32 targetHandle,
                                   uintptr_t channelsPtr, u32 channelCount, u32 vertexStride,
                                   uintptr_t vertexPtr, u32 vertexBytes,
                                   uintptr_t indexPtr, u32 indexCount,
                                   f32 minX, f32 minY, f32 minZ,
                                   f32 maxX, f32 maxY, f32 maxZ,
                                   uintptr_t bindPtr, u32 bindFloats,
                                   uintptr_t morphPtr, u32 morphFloats,
                                   u32 morphTargets, u32 morphNormals) {
    auto* rm = ctx().tryGet<resource::ResourceManager>();
    MeshUpload up;
    if (!rm || targetHandle == 0
        || !marshalMeshChannels(up, "mesh_rematerializeFromChannels",
                                channelsPtr, channelCount, vertexStride,
                                vertexPtr, vertexBytes, indexPtr, indexCount,
                                minX, minY, minZ, maxX, maxY, maxZ, bindPtr, bindFloats,
                                morphPtr, morphFloats, morphTargets, morphNormals)) {
        return 0;
    }
    return rm->rematerializeMesh(resource::MeshHandle(targetHandle),
                                 up.vertexSpan(), up.indexSpan(), up.channelSpan(),
                                 up.vertexStride, up.localMin, up.localMax, up.bindSpan(),
                                 up.morph)
        ? targetHandle : 0;
}

/** @brief Releases a mesh and the buffers it owns. */
void mesh_release(u32 meshHandle) {
    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        rm->releaseMesh(resource::MeshHandle(meshHandle));
    }
}

/**
 * @brief Registers a baked environment: nine irradiance coefficients and the
 *        prefiltered reflection an ambient light casts.
 * @param shPtr 27 floats — nine RGB coefficients, already convolved and over pi.
 * @param specularHandle The octahedral atlas, or 0 for a diffuse-only environment.
 */
u32 environment_create(uintptr_t shPtr, u32 specularHandle, f32 faceSize, u32 mipCount,
                       f32 maxRange, u32 columns) {
    auto* rm = ctx().tryGet<resource::ResourceManager>();
    if (!rm) return 0;
    const f32* sh = boundarySpan<f32>(shPtr, 27, "environment_create.irradiance");
    if (!sh) return 0;
    return rm->createEnvironment(ConstSpan<f32>(sh, 27),
                                 resource::TextureHandle(specularHandle),
                                 faceSize, mipCount, maxRange, columns).id();
}

/** @brief Gives an environment the panorama its sky is drawn from. */
void environment_setSky(u32 environmentHandle, u32 skyHandle) {
    auto* rm = ctx().tryGet<resource::ResourceManager>();
    if (!rm) return;
    if (Environment* environment = rm->getEnvironment(resource::EnvironmentHandle(environmentHandle))) {
        environment->sky = resource::TextureHandle(skyHandle);
    }
}

/**
 * @brief Gives an environment the sun its importer separated from the sky.
 * @param skyShPtr 27 floats — the irradiance with the sun taken out.
 * @param dx,dy,dz Toward the sun, in the panorama's frame.
 * @param r,g,b The sun's irradiance over pi.
 */
void environment_setSun(u32 environmentHandle, uintptr_t skyShPtr, f32 dx, f32 dy, f32 dz,
                        f32 r, f32 g, f32 b) {
    auto* rm = ctx().tryGet<resource::ResourceManager>();
    if (!rm) return;
    const f32* sh = boundarySpan<f32>(skyShPtr, 27, "environment_setSun.skyIrradiance");
    if (!sh) return;
    Environment* environment = rm->getEnvironment(resource::EnvironmentHandle(environmentHandle));
    if (!environment) return;
    const glm::vec3 toward(dx, dy, dz);
    const f32 length = glm::length(toward);
    if (!(length > 0.0f)) return;
    for (usize i = 0; i < 9; ++i) {
        environment->skyIrradiance[i] = glm::vec3(sh[i * 3], sh[i * 3 + 1], sh[i * 3 + 2]);
    }
    environment->sunDirection = toward / length;
    environment->sunColor = glm::max(glm::vec3(r, g, b), glm::vec3(0.0f));
    environment->hasSun = true;
}

/** @brief Releases an environment. Its atlas is an ordinary texture and outlives it. */
void environment_release(u32 environmentHandle) {
    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        rm->releaseEnvironment(resource::EnvironmentHandle(environmentHandle));
    }
}

/**
 * @brief Registers a grid of baked irradiance — an environment sampled at points.
 * @param shPtr `resX*resY*resZ*27` floats: nine RGB coefficients per probe, in
 *              grid order with x varying fastest.
 */
u32 probe_volume_create(i32 resX, i32 resY, i32 resZ, uintptr_t shPtr) {
    auto* rm = ctx().tryGet<resource::ResourceManager>();
    if (!rm) return 0;
    if (resX <= 0 || resY <= 0 || resZ <= 0) return 0;
    const u64 want = static_cast<u64>(resX) * static_cast<u64>(resY)
                   * static_cast<u64>(resZ) * 27u;
    const f32* sh = boundarySpan<f32>(shPtr, want, "probe_volume_create.irradiance");
    if (!sh) return 0;
    return rm->createProbeVolume({resX, resY, resZ},
                                 ConstSpan<f32>(sh, static_cast<usize>(want))).id();
}

/** @brief Releases a probe volume. */
void probe_volume_release(u32 volumeHandle) {
    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        rm->releaseProbeVolume(resource::ProbeVolumeHandle(volumeHandle));
    }
}

namespace {
// Freezes a MeshRenderer's inline geometry onto the GPU: the same vertices, uploaded
// once and drawn with a per-object transform. The inline payload is cleared, so
// the two can never disagree.
u32 freezeMeshGeometry(ecs::MeshRenderer* mesh) {
    auto* rm = ctx().tryGet<resource::ResourceManager>();
    if (!mesh || !rm || mesh->vertices.empty() || mesh->indices.empty()) return 0;

    struct MeshVertex { f32 x, y, z, u, v; u32 color; };
    std::vector<MeshVertex> verts(mesh->vertices.size());
    for (usize i = 0; i < mesh->vertices.size(); ++i) {
        const auto& in = mesh->vertices[i];
        verts[i] = { in.position.x, in.position.y, 0.0f, in.uv.x, in.uv.y, in.color };
    }

    // HostOnly: the payload below is cleared on the way out, so this geometry
    // exists in no file and a device generation ends it for good.
    auto handle = rm->createMesh(
        ConstSpan<u8>(reinterpret_cast<const u8*>(verts.data()), verts.size() * sizeof(MeshVertex)),
        ConstSpan<u32>(mesh->indices.data(), mesh->indices.size()),
        ConstSpan<GfxVertexAttribute>(kStandardMeshChannels, 3), sizeof(MeshVertex),
        glm::vec3(mesh->localMin, 0.0f), glm::vec3(mesh->localMax, 0.0f),
        MeshRecovery::HostOnly);
    if (!handle.isValid()) return 0;

    mesh->mesh = handle;
    mesh->vertices.clear();
    mesh->indices.clear();
    return handle.id();
}
}  // namespace

u32 meshRenderer_setMeshAll(ecs::Registry& registry, u32 meshHandle) {
    u32 pointed = 0;
    for (auto entity : registry.view<ecs::MeshRenderer>()) {
        auto* mesh = registry.tryGet<ecs::MeshRenderer>(entity);
        if (!mesh) continue;
        mesh->mesh = resource::MeshHandle(meshHandle);
        // Cleared: an entity carrying both draws the resident geometry, so a
        // leftover payload would hide a mesh that never arrived.
        mesh->vertices.clear();
        mesh->indices.clear();
        ++pointed;
    }
    return pointed;
}

u32 meshRenderer_setMaterialAll(ecs::Registry& registry, u32 materialId) {
    u32 pointed = 0;
    for (auto entity : registry.view<ecs::MeshRenderer>()) {
        if (auto* mesh = registry.tryGet<ecs::MeshRenderer>(entity)) {
            mesh->material = materialId;
            ++pointed;
        }
    }
    return pointed;
}

u32 meshRenderer_makeAllResident(ecs::Registry& registry) {
    u32 frozen = 0;
    for (auto entity : registry.view<ecs::MeshRenderer>()) {
        if (freezeMeshGeometry(registry.tryGet<ecs::MeshRenderer>(entity)) != 0) ++frozen;
    }
    return frozen;
}

/** @brief Points a MeshRenderer at resident geometry; 0 returns it to its inline payload. */
void renderer_init(u32 width, u32 height) {
    if (!g_renderFrame) return;
    ctx().state().viewport_width = width;
    ctx().state().viewport_height = height;
    g_renderFrame->resize(width, height);
}

void renderer_resize(u32 width, u32 height) {
    if (!g_renderFrame) return;
    ctx().state().viewport_width = width;
    ctx().state().viewport_height = height;
    g_renderFrame->resize(width, height);
}

/// The point the next frames are drawn relative to (RenderOrigin.hpp); the view-projection they are begun with is built for the same one.
void renderer_setOrigin(f64 x, f64 y, f64 z) {
    setRenderOrigin(glm::dvec3(x, y, z));
}

void renderer_beginFrame(f32 elapsedSec) {
    // A render frame is not a mutation: composition is invalidated by the
    // producers that write transform inputs. A server has no frames, and one
    // frame may run several fixed steps.

    if (auto* rc = ctx().tryGet<RenderContext>()) {
        rc->setFrameTime(elapsedSec, g_viewportWidth, g_viewportHeight);
    }
    // The frame's own opening, which begin() is not: it runs once per camera.
    if (g_renderFrame) { g_renderFrame->setPlanarTime(elapsedSec); g_renderFrame->beginFrame(); }
}

// The pass's load-op rides begin: clearFlags bit0 = color, bit1 = depth; the color
// value and an optional region (w == 0 = full target) come with it, so no sticky
// clear state exists anywhere between TS and the device.
void renderer_begin(uintptr_t matrixPtr, u32 targetHandle, i32 clearFlags,
                    f32 r, f32 g, f32 b, f32 a,
                    i32 clearX, i32 clearY, u32 clearW, u32 clearH) {
    if (!g_renderFrame) return;

    const f32* matrixData = boundarySpan<f32>(matrixPtr, 16, "renderer_begin.matrix");
    if (!matrixData) return;
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    g_renderFrame->begin(viewProjection, targetHandle,
                         RenderFrame::PassClear{(clearFlags & 1) != 0, (clearFlags & 2) != 0,
                                                glm::vec4(r, g, b, a),
                                                clearX, clearY, clearW, clearH});
}

void renderer_flush() {
    if (!g_renderFrame) return;
    g_renderFrame->flush();
    checkGLErrors("renderer_flush");
}

void renderer_end() {
    if (!g_renderFrame) return;
    g_renderFrame->end();
    checkGLErrors("renderer_end");
}

void renderer_endFrame() {
    if (!g_renderFrame) return;
    g_renderFrame->endFrame();
}

/** Compose if a producer said the inputs moved. The renderer is a consumer of
 *  world transforms, not the authority over when they are computed. */
static void ensureTransformsUpdated(ecs::Registry& registry) {
    if (g_transformSystem) g_transformSystem->ensureComposed(registry);
}

#ifdef ES_ENABLE_BITMAP_TEXT
#endif


#ifdef ES_ENABLE_PARTICLES
#endif

void renderer_updateTransforms(ecs::Registry& registry) {
    ensureTransformsUpdated(registry);
}

// Painter order within a sorting layer is the order the render plugins iterate
// the ECS pools, which is storage order — so a scene draws in its authored entity
// order only because loading it spawns in that order. This is the entry point that
// re-establishes the order on an ALREADY populated registry (the editor moving a
// row in the outliner, a game bringing a card to the front): the same picture a
// reload would produce, without respawning anything.
void renderer_setEntityDrawOrder(ecs::Registry& registry, uintptr_t entitiesPtr, u32 count) {
    if (entitiesPtr == 0 || count == 0) return;
    const u32* raw = boundarySpan<u32>(entitiesPtr, count, "renderer_setEntityDrawOrder.entities");
    if (!raw) return;
    std::vector<Entity> order;
    order.reserve(count);
    for (u32 i = 0; i < count; ++i) order.push_back(Entity::fromRaw(raw[i]));
    ecs::applySceneEntityOrder(registry, order.data(), order.size());
}

/** The screen's entities, as a membership set the renderer can partition by.
 *  Empty when there is no UI system — then every collect is a world one, which
 *  is what a project with no Canvas has always had. */
static const std::unordered_set<u32>* screenDomain() {
    auto* ui = ctx().tryGet<ecs::UISystem>();
    return ui ? &ui->screenDomain() : nullptr;
}

void renderer_beginScreenOverlay(uintptr_t projectionPtr, i32 vpX, i32 vpY, u32 vpW, u32 vpH) {
    if (!g_renderFrame) return;
    const f32* matrixData = boundarySpan<f32>(projectionPtr, 16, "renderer_beginScreenOverlay.matrix");
    if (!matrixData) return;
    g_renderFrame->beginScreenOverlay(glm::make_mat4(matrixData), vpX, vpY, vpW, vpH);
}

void renderer_submitScreenOverlay(ecs::Registry& registry) {
    if (!g_renderFrame) return;
    ensureTransformsUpdated(registry);
    g_renderFrame->setScreenDomain(screenDomain());
    g_renderFrame->submitScreenOverlay(registry);
}

void renderer_endScreenOverlay(u32 targetHandle) {
    if (!g_renderFrame) return;
    g_renderFrame->endScreenOverlay(targetHandle);
    checkGLErrors("renderer_endScreenOverlay");
}

void renderer_submitAll(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    // A frame refused for a lost device draws nothing, so nothing is collected for it.
    if (!g_renderFrame || !g_renderFrame->inFrame()) return;
    ensureTransformsUpdated(registry);
    // What this camera must NOT draw. Set on every collect rather than once a
    // frame: the set is rebuilt by each layout pass, and a camera holding the
    // previous one would draw a just-reparented element in the wrong domain.
    g_renderFrame->setScreenDomain(screenDomain());
    g_renderFrame->processMasks(registry, vpX, vpY, vpW, vpH);

    g_renderFrame->collectAll(registry);
}

#ifdef ES_ENABLE_PARTICLES
void particle_update(ecs::Registry& registry, f32 dt) {
    if (!g_particleSystem) return;
    ensureTransformsUpdated(registry);
    g_particleSystem->update(registry, dt);
}

u32 particle_collisionQueryCount() { return g_particleSystem ? static_cast<u32>(g_particleSystem->collisionQueries().size()) : 0; }
uintptr_t particle_collisionQueries() { return g_particleSystem ? reinterpret_cast<uintptr_t>(g_particleSystem->collisionQueries().data()) : 0; }
u32 particle_collisionEventCount() { return g_particleSystem ? static_cast<u32>(g_particleSystem->collisionEvents().size()) : 0; }
uintptr_t particle_collisionEvents() { return g_particleSystem ? reinterpret_cast<uintptr_t>(g_particleSystem->collisionEvents().data()) : 0; }
u32 particle_collisionStatsCount() { return g_particleSystem ? static_cast<u32>(g_particleSystem->collisionStats().size()) : 0; }
uintptr_t particle_collisionStats() { return g_particleSystem ? reinterpret_cast<uintptr_t>(g_particleSystem->collisionStats().data()) : 0; }
void particle_collisionSetBudget(u32 queries, u32 events, bool debug) { if (g_particleSystem) g_particleSystem->setCollisionBudget(queries,events,debug); }
void particle_collisionResolve(ecs::Registry& registry, uintptr_t ptr, u32 count) {
    if (!g_particleSystem) return;
    const u32 expected = static_cast<u32>(g_particleSystem->collisionQueries().size());
    const auto* replies = count == expected && count <= 65536 ? boundarySpan<particle::CollisionReply>(ptr,count,"particle_collisionResolve") : nullptr;
    g_particleSystem->resolveCollisions(registry,replies,replies ? count : 0);
}

// The entity crosses the wasm boundary as a raw u32 (Embind has no registered
// binding for esengine::Entity — calling with it throws "unbound types"). Rebuild
// the Entity C++-side, matching particle_set_color_lut/set_size_lut below.
void particle_play(ecs::Registry& registry, u32 entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->play(Entity::fromRaw(entity));
}

void particle_stop(ecs::Registry& registry, u32 entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->stop(Entity::fromRaw(entity));
}

void particle_reset(ecs::Registry& registry, u32 entity) {
    if (!g_particleSystem) return;
    (void)registry;
    g_particleSystem->reset(Entity::fromRaw(entity));
}

u32 particle_getAliveCount(u32 entity) {
    if (!g_particleSystem) return 0;
    return g_particleSystem->aliveCount(Entity::fromRaw(entity));
}

void particle_set_color_lut(u32 entity, uintptr_t ptr, i32 count) {
    if (!g_particleSystem) return;
    g_particleSystem->setColorLut(Entity::fromRaw(entity), reinterpret_cast<const f32*>(ptr), count);
}

void particle_set_size_lut(u32 entity, uintptr_t ptr, i32 count) {
    if (!g_particleSystem) return;
    g_particleSystem->setSizeLut(Entity::fromRaw(entity), reinterpret_cast<const f32*>(ptr), count);
}

void particle_set_speed_lut(u32 entity, uintptr_t ptr, i32 count) {
    if (!g_particleSystem) return;
    g_particleSystem->setSpeedLut(Entity::fromRaw(entity), reinterpret_cast<const f32*>(ptr), count);
}

void particle_set_bursts(u32 entity, uintptr_t ptr, i32 count) {
    if (!g_particleSystem) return;
    g_particleSystem->setBursts(Entity::fromRaw(entity), reinterpret_cast<const f32*>(ptr), count);
}
#endif

void trail_update(ecs::Registry& registry, f32 dt) {
    if (!g_trailSystem) return;
    g_trailSystem->update(registry, dt);
}

// The entity crosses the wasm boundary as a raw u32 (Embind has no Entity binding);
// rebuild it C++-side, matching particle_play/stop above.
void trail_clear(ecs::Registry& registry, u32 entity) {
    if (!g_trailSystem) return;
    (void)registry;
    g_trailSystem->clear(Entity::fromRaw(entity));
}

void springbone_update(ecs::Registry& registry, f32 dt) {
    if (!g_springBoneSystem) return;
    g_springBoneSystem->update(registry, g_transformSystem, dt);
}

void springbone_reset(ecs::Registry& registry, u32 entity) {
    if (!g_springBoneSystem) return;
    (void)registry;
    g_springBoneSystem->reset(Entity::fromRaw(entity));
}

void springbone_release(ecs::Registry& registry, u32 entity) {
    if (!g_springBoneSystem) return;
    g_springBoneSystem->release(registry, Entity::fromRaw(entity));
}

static std::vector<f32>& springBoneSnapshot() {
    static std::vector<f32> data;
    return data;
}

u32 springbone_snapshot(ecs::Registry& registry, u32 entity) {
    (void)registry;
    auto& data = springBoneSnapshot();
    if (!g_springBoneSystem) { data.clear(); return 0; }
    g_springBoneSystem->snapshot(Entity::fromRaw(entity), data);
    return static_cast<u32>(data.size() / 7);
}

u32 springbone_snapshotCount() {
    return static_cast<u32>(springBoneSnapshot().size() / 7);
}

uintptr_t springbone_snapshotData() {
    return reinterpret_cast<uintptr_t>(springBoneSnapshot().data());
}

void renderer_setStage(i32 stage) {
    if (!g_renderFrame) return;
    g_renderFrame->setStage(static_cast<RenderStage>(stage));
}

u32 renderer_createTarget(u32 width, u32 height, i32 flags) {
    if (!g_renderFrame) return 0;
    bool depth = (flags & 1) != 0;
    bool linear = (flags & 2) != 0;
    return g_renderFrame->targetManager().create(width, height, depth, linear);
}

u32 renderer_getTargetDepthTexture(u32 handle) {
    if (!g_renderFrame) return 0;
    auto* target = g_renderFrame->targetManager().get(handle);
    return target ? static_cast<u32>(target->getDepthTexture()) : 0;
}

void renderer_releaseTarget(u32 handle) {
    if (!g_renderFrame) return;
    g_renderFrame->targetManager().release(handle);
}

u32 renderer_getTargetTexture(u32 handle) {
    if (!g_renderFrame) return 0;
    auto* target = g_renderFrame->targetManager().get(handle);
    return target ? static_cast<u32>(target->getColorTexture()) : 0;
}

u32 renderer_getDrawCalls() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().draw_calls;
}

#ifdef __EMSCRIPTEN__
/**
 * The local-space XY box of what a MeshRenderer DRAWS — resident geometry when it has
 * some, else the inline payload. Which of the two is live is the engine's to
 * know: an editor asking the component alone boxes a resident mesh at zero, and
 * then it cannot be clicked.
 */
emscripten::val meshRenderer_localBounds(ecs::Registry& registry, u32 entity) {
    const Entity ent = Entity::fromRaw(entity);
    const auto* mesh = registry.tryGet<ecs::MeshRenderer>(ent);
    if (!mesh) return emscripten::val::null();

    // The inline payload is authored as 2D positions and has no third dimension;
    // resident geometry carries the one it was imported with.
    glm::vec3 mn(mesh->localMin, 0.0f);
    glm::vec3 mx(mesh->localMax, 0.0f);
    if (mesh->mesh.isValid()) {
        if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
            if (const Mesh* res = rm->getMesh(mesh->mesh)) {
                mn = res->localMin;
                mx = res->localMax;
            }
        }
    }
    if (!(mx.x > mn.x) && !(mx.y > mn.y) && !(mx.z > mn.z)) return emscripten::val::null();

    auto out = emscripten::val::object();
    out.set("minX", mn.x);
    out.set("minY", mn.y);
    out.set("minZ", mn.z);
    out.set("maxX", mx.x);
    out.set("maxY", mx.y);
    out.set("maxZ", mx.z);
    return out;
}

emscripten::val renderer_getLiveObjects() {
    auto* device = g_device;
    // Null rather than zeros: with no device there is nothing to report, and a
    // census that recorded 0 live textures would read as "everything was freed".
    if (!device) return emscripten::val::null();
    const GfxLiveObjects live = device->liveObjects();
    auto out = emscripten::val::object();
    out.set("buffers", static_cast<f64>(live.buffers));
    out.set("textures", static_cast<f64>(live.textures));
    out.set("programs", static_cast<f64>(live.programs));
    out.set("layouts", static_cast<f64>(live.layouts));
    out.set("pipelines", static_cast<f64>(live.pipelines));
    out.set("renderTargets", static_cast<f64>(live.renderTargets));
    out.set("readbacks", static_cast<f64>(live.readbacks));
    return out;
}
#endif  // __EMSCRIPTEN__

u32 renderer_getTriangles() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().triangles;
}

u32 renderer_getSprites() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().sprites;
}

u32 renderer_getSkeletal() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().skeletal;
}

u32 renderer_getText() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().text;
}

u32 renderer_getMeshes() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().meshes;
}

u32 renderer_getCulled() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().culled;
}

f32 renderer_getGpuTimeMs() {
    if (!g_renderFrame) return -1.0f;
    return g_renderFrame->stats().gpu_time_ms;
}

void engine_setCpuProfiling(bool on) {
    FrameProfiler::get().setEnabled(on);
}

void engine_setRandomSeed(u32 seed) {
    // Valid pre-init, and it has to be: the SDK sets this beside the colour
    // space, before the context has registered anything. Remembered here, and
    // adopted by EstellaContext when it creates the source.
    setPendingRandomSeed(seed);
    if (auto* source = ctx().tryGet<RandomSource>()) {
        source->reseed(seed);
        // Consumers derive a generator once, so each is re-derived here. One
        // today; this list is where a second one announces itself.
#ifdef ES_ENABLE_PARTICLES
        if (auto* particles = g_particleSystem) particles->reseedFrom(*source);
#endif
    }
}

std::string engine_getCpuScopes() {
    return FrameProfiler::get().lastJson();
}

void engine_prepareMeshPrograms(u32 rowsPtr, u32 count, u32 outPtr) {
    auto* out = reinterpret_cast<u32*>(static_cast<uintptr_t>(outPtr));
    for (u32 i = 0; i < 11; ++i) out[i] = 0;
    if (!g_initialized || !g_renderFrame || !g_device) return;
    const auto* rc = ctx().tryGet<RenderContext>();
    if (!rc) return;

    // Bracketed: a generation or epoch that moved underneath means neither
    // reading describes the live renderer, so no claim is produced rather than
    // one assembled out of two different worlds.
    const u64 generationBefore = g_device->deviceGeneration();
    const u64 epochBefore = rc->programEpoch();

    const auto* rows = reinterpret_cast<const MeshDocumentRecord*>(static_cast<uintptr_t>(rowsPtr));
    const RenderPrewarmResult r = g_renderFrame->prewarmDocument(rows, count);

    const u64 generationAfter = g_device->deviceGeneration();
    const u64 epochAfter = rc->programEpoch();

    out[0] = (generationBefore == generationAfter && epochBefore == epochAfter) ? 1u : 0u;
    out[1] = r.asks;
    out[2] = r.compiles;
    out[3] = r.materialAsks;
    out[4] = r.materialCompiles;
    const u64 digest = r.requirementDigest();
    out[5] = static_cast<u32>(digest & 0xFFFFFFFFull);
    out[6] = static_cast<u32>(digest >> 32);
    out[7] = static_cast<u32>(epochAfter & 0xFFFFFFFFull);
    out[8] = static_cast<u32>(epochAfter >> 32);
    out[9] = static_cast<u32>(generationAfter & 0xFFFFFFFFull);
    out[10] = static_cast<u32>(generationAfter >> 32);
}

#ifdef ES_ENABLE_TEST_PROBES
/** Fifteen words: five counts, the stock key set (a bit per mesh variant, so two
 *  64-bit words), the requirement digest that also covers the material programs,
 *  and the epoch the digest was taken under — a digest without its epoch cannot
 *  say whether it is still true. */
static void writePrewarm(u32* out, const RenderPrewarmResult& r) {
    out[0] = r.asks;
    out[1] = r.compiles;
    out[2] = r.uniqueKeys;
    out[3] = r.materialAsks;
    out[4] = r.materialCompiles;
    for (u32 w = 0; w < 2; ++w) {
        out[5 + w * 2] = static_cast<u32>(r.keys[w] & 0xFFFFFFFFull);
        out[6 + w * 2] = static_cast<u32>(r.keys[w] >> 32);
    }
    const u64 digest = r.requirementDigest();
    out[9] = static_cast<u32>(digest & 0xFFFFFFFFull);
    out[10] = static_cast<u32>(digest >> 32);
    const auto* rc = ctx().tryGet<RenderContext>();
    const u64 epoch = rc ? rc->programEpoch() : 0;
    out[11] = static_cast<u32>(epoch & 0xFFFFFFFFull);
    out[12] = static_cast<u32>(epoch >> 32);
    // Not a third truth in the stamp: the guard that says the two above were
    // read on one device. A generation that moved mid-derivation invalidates the
    // whole readying rather than being recorded alongside it.
    const u64 generation = g_device ? g_device->deviceGeneration() : 0;
    out[13] = static_cast<u32>(generation & 0xFFFFFFFFull);
    out[14] = static_cast<u32>(generation >> 32);
}

void engine_prewarmMeshVariants(ecs::Registry& registry, u32 entitiesPtr, u32 count, u32 outPtr) {
    auto* out = reinterpret_cast<u32*>(static_cast<uintptr_t>(outPtr));
    for (u32 i = 0; i < 13; ++i) out[i] = 0;
    if (!g_initialized || !g_renderFrame) return;
    const auto* entities = reinterpret_cast<const Entity*>(static_cast<uintptr_t>(entitiesPtr));
    writePrewarm(out, g_renderFrame->prewarmPrograms(registry, entities, count));
}

#endif

std::string engine_getCounters() {
    return FrameProfiler::get().lastCountersJson();
}

std::string engine_getGpuScopes() {
    return FrameProfiler::get().lastGpuJson();
}

f64 renderer_getTextureBytes() {
    if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
        return static_cast<f64>(rm->getStats().textureBytes);
    }
    return 0.0;
}

f64 renderer_getEstimatedGpuBytes() {
    return g_device ? static_cast<f64>(g_device->estimatedGpuBytes()) : 0.0;
}

// f64 rather than u32: the epoch is a counter nothing resets, and a session that
// outlives 4 billion invalidations should not wrap into a stamp that matches.
f64 renderer_programEpoch() {
    if (auto* rc = ctx().tryGet<RenderContext>()) {
        return static_cast<f64>(rc->programEpoch());
    }
    return 0.0;
}

f64 renderer_deviceGeneration() {
    return g_device ? static_cast<f64>(g_device->deviceGeneration()) : 0.0;
}

void renderer_setClearColor(f32 r, f32 g, f32 b, f32 a) {
    ctx().state().clear_color = glm::vec4(r, g, b, a);
}

void renderer_setViewport(i32 x, i32 y, i32 w, i32 h) {
    g_device->setViewport(x, y, static_cast<u32>(w), static_cast<u32>(h));
}

void renderer_setYSortLayers(u32 mask) {
    if (auto* frame = g_renderFrame) frame->setYSortLayers(mask);
}

void renderer_setTreeSortLayers(u32 mask) {
    if (auto* frame = g_renderFrame) frame->setTreeSortLayers(mask);
}

// The 2.5D opt-in, per sorting layer. Same shape as setYSortLayers because it is
// the same kind of declaration: how a layer resolves the draws inside it.
void renderer_setQualityBudgets(u32 atlasSize, u32 cellSize, u32 cascades, u32 particleLimit) {
    if (g_renderFrame) g_renderFrame->setShadowBudget(atlasSize, cellSize, cascades);
#ifdef ES_ENABLE_PARTICLES
    if (g_particleSystem) g_particleSystem->setParticleLimit(particleLimit);
#endif
}

void renderer_setDepthLayers(u32 mask) {
    if (auto* frame = g_renderFrame) frame->setDepthLayers(mask);
}

void renderer_setViewLighting(u32 mode, f32 rotationDegrees, f32 keyIntensity, f32 fillIntensity,
                              f32 skyIntensity, bool showSky) {
    if (!g_renderFrame) return;
    RenderFrame::ViewLighting lighting;
    lighting.studio = mode == 1;
    lighting.rotation = std::isfinite(rotationDegrees) ? rotationDegrees : 0.0f;
    lighting.keyIntensity = std::isfinite(keyIntensity) ? std::max(keyIntensity, 0.0f) : 0.0f;
    lighting.fillIntensity = std::isfinite(fillIntensity) ? std::max(fillIntensity, 0.0f) : 0.0f;
    lighting.skyIntensity = std::isfinite(skyIntensity) ? std::max(skyIntensity, 0.0f) : 0.0f;
    lighting.showSky = showSky;
    g_renderFrame->setViewLighting(lighting);
}

void renderer_setPlanarReflectionQuality(f32 scale, u32 maxSize, f32 updatesPerSecond) {
    if (g_renderFrame) g_renderFrame->setPlanarQuality(scale, maxSize, updatesPerSecond);
}

std::string renderer_getPlanarReflectionStatus(u32 view, u32 entity) {
    return g_renderFrame ? g_renderFrame->planarStatus(view, entity) : "{\"state\":\"unavailable\"}";
}

void renderer_setShadowDistance(f32 distance) {
    if (g_renderFrame) g_renderFrame->setShadowDistance(distance);
}

void renderer_setShadow2DSoftSamples(u32 samples) {
    if (g_renderFrame) g_renderFrame->setShadow2DSoftSamples(samples);
}

void renderer_setDepthPrepass(bool on) {
    if (g_renderFrame) g_renderFrame->setDepthPrepass(on);
}

void renderer_setAsyncShaderCompile(bool on) {
    if (auto* device = g_device) device->setSkipPendingPrograms(on);
}

u32 renderer_getPendingShaders() {
    auto* device = g_device;
    return device ? device->pendingProgramCount() : 0u;
}

// Which layers the NEXT collect draws. Set per camera, before renderer_submitAll.
void renderer_setCullingMask(u32 mask) {
    if (auto* frame = g_renderFrame) frame->setCullingMask(mask);
}

// A camera's own identity, which is what makes a LOD level the VIEW's answer and
// not the entity's: two cameras looking at one object may settle on two levels.
void renderer_setViewId(u32 view) {
    if (auto* frame = g_renderFrame) frame->setViewId(view);
}

i32 renderer_lodInspect(u32 view, u32 entity, uintptr_t outPtr) {
    auto* out = boundarySpanMut<f32>(outPtr, 4, "renderer_lodInspect.out");
    if (!out) return 0;
    out[0] = out[1] = out[2] = out[3] = 0.0f;
    if (!g_renderFrame) return 0;
    u8 level = 0, unbiased = 0, levels = 0;
    f32 size = 0.0f;
    if (!g_renderFrame->lodInspect(view, Entity::fromRaw(entity), level, unbiased, levels, size)) {
        return 0;
    }
    // Culled is a level nothing draws, not a big number: handed over as -1 so a
    // reader that forgets to check it gets an impossible level rather than 255.
    out[0] = level == lod::kCulled ? -1.0f : static_cast<f32>(level);
    out[1] = unbiased == lod::kCulled ? -1.0f : static_cast<f32>(unbiased);
    out[2] = static_cast<f32>(levels);
    out[3] = size;
    return 1;
}

void renderer_setLodPreview(u32 view, u32 entity, i32 level) {
    if (!g_renderFrame) return;
    const u8 held = level < 0 ? lod::kNoPreview : static_cast<u8>(level);
    g_renderFrame->setLodPreview(view, Entity::fromRaw(entity), held);
}

void renderer_setViewShading(u32 view, i32 mode) {
    if (!g_renderFrame) return;
    // An unknown mode is the authored look, not a crash: a newer editor may ask for
    // a mode this engine does not have.
    const ShadingMode known = (mode > 0 && mode < static_cast<i32>(kShadingModeCount))
        ? static_cast<ShadingMode>(mode) : ShadingMode::Shaded;
    g_renderFrame->setViewShading(view, known);
}

void renderer_setViewSkinWeights(u32 view, u32 entity, i32 joint) {
    if (!g_renderFrame) return;
    g_renderFrame->setViewSkinWeights(view, joint < 0 ? INVALID_ENTITY : Entity::fromRaw(entity),
                                      joint < 0 ? 0u : static_cast<u32>(joint));
}

void renderer_setMeshEdgeBuffers(bool enabled) {
    if (auto* resources = ctx().tryGet<resource::ResourceManager>()) resources->setMeshEdgeBuffers(enabled);
}

i32 renderer_lightStatus(u32 entity, uintptr_t outPtr) {
    auto* out = boundarySpanMut<f32>(outPtr, 9, "renderer_lightStatus.out");
    if (!out) return 0;
    for (u32 i = 0; i < 9; ++i) out[i] = 0.0f;
    if (!g_renderFrame) return 0;
    const LightCapReport& cap = g_renderFrame->lightCap();
    if (cap.limit == 0) return 0;  // no frame has decided anything yet
    const LightRefusal why = cap.refusalFor(Entity::fromRaw(entity));
    out[0] = why == LightRefusal::None ? 1.0f : 0.0f;
    out[1] = static_cast<f32>(static_cast<u8>(why));
    out[2] = static_cast<f32>(cap.limit);
    out[3] = static_cast<f32>(cap.requested);
    out[4] = static_cast<f32>(cap.refused.size());
    out[5] = cap.environmentSun ? 1.0f : 0.0f;
    out[6] = cap.environmentSunAim.x;
    out[7] = cap.environmentSunAim.y;
    out[8] = cap.environmentSunAim.z;
    return 1;
}

i32 renderer_shadowStatus(u32 entity, uintptr_t outPtr) {
    auto* out = boundarySpanMut<f32>(outPtr, 5, "renderer_shadowStatus.out");
    if (!out) return 0;
    for (u32 i = 0; i < 5; ++i) out[i] = 0.0f;
    if (!g_renderFrame) return 0;
    const ShadowPlanReport& plan = g_renderFrame->shadowPlan();
    const ShadowGrant* grant = plan.grantFor(Entity::fromRaw(entity));
    if (!grant) return 0;
    out[0] = static_cast<f32>(grant->requested);
    out[1] = static_cast<f32>(grant->granted);
    out[2] = static_cast<f32>(static_cast<u8>(grant->refusal));
    out[3] = static_cast<f32>(plan.deniedCasters());
    out[4] = static_cast<f32>(plan.reducedCasters());
    return 1;
}

void renderer_setColorSpace(u32 linear) {
    // Valid pre-init: the global reaches every later shader compile, and
    // RenderFrame::init adopts it. A live frame applies immediately (editor
    // realms reset it per session, mirroring renderer_setYSortLayers).
    resource::ShaderParser::setLinearColorSpace(linear != 0);
    if (auto* frame = g_renderFrame) frame->setColorSpace(linear != 0);
}

void renderer_diagnose() {
    if (!g_initialized) {
        ES_LOG_ERROR("[Diagnose] Renderer not initialized");
        return;
    }

    ES_LOG_INFO("[Diagnose] GL Version: {}", g_device->getString(GfxStringName::Version));
    ES_LOG_INFO("[Diagnose] GL Renderer: {}", g_device->getString(GfxStringName::Renderer));
    ES_LOG_INFO("[Diagnose] GL Vendor: {}", g_device->getString(GfxStringName::Vendor));
    ES_LOG_INFO("[Diagnose] GLSL Version: {}", g_device->getString(GfxStringName::ShadingLanguageVersion));
    ES_LOG_INFO("[Diagnose] Stored viewport: {}x{}", g_viewportWidth, g_viewportHeight);
    ES_LOG_INFO("[Diagnose] Max texture units: {}", g_device->getInt(GfxIntParam::MaxTextureImageUnits));
    ES_LOG_INFO("[Diagnose] Max vertex attribs: {}", g_device->getInt(GfxIntParam::MaxVertexAttribs));

    while (g_device->getError() != 0) {}
    ES_LOG_INFO("[Diagnose] No pending GL errors (cleared)");
}

void gl_enableErrorCheck(bool enabled) {
    ctx().state().gl_error_check_enabled = enabled;
    if (enabled) {
        while (g_device->getError() != 0) {}
        ES_LOG_INFO("[GL] Error checking enabled");
    }
}

u32 gl_checkErrors(const std::string& context) {
    bool prev = g_glErrorCheckEnabled;
    ctx().state().gl_error_check_enabled = true;
    u32 count = checkGLErrors(context.c_str());
    ctx().state().gl_error_check_enabled = prev;
    if (count == 0 && prev) {
        ES_LOG_INFO("[GL] No errors at: {}", context);
    }
    return count;
}

i32 registry_getCanvasEntity(ecs::Registry& registry) {
    auto view = registry.activeView<ecs::Canvas>();
    for (auto entity : view) {
        return static_cast<i32>(entity.id());
    }
    return -1;
}

#ifdef __EMSCRIPTEN__
// Every Canvas, so the caller can pick one that belongs to a RUNNING scene. Scene
// membership (SceneOwner) is an SDK component the engine cannot see, which is why
// this reports rather than decides — the camera query has the same shape.
emscripten::val registry_getCanvasEntities(ecs::Registry& registry) {
    auto view = registry.activeView<ecs::Canvas>();
    auto result = emscripten::val::array();
    u32 idx = 0;
    for (auto entity : view) {
        result.set(idx++, entity.id());
    }
    return result;
}
#endif

#ifdef __EMSCRIPTEN__
emscripten::val registry_getCameraEntities(ecs::Registry& registry) {
    auto cameraView = registry.activeView<ecs::Camera, ecs::Transform>();
    auto result = emscripten::val::array();
    u32 idx = 0;
    for (auto entity : cameraView) {
        auto& camera = registry.get<ecs::Camera>(entity);
        if (camera.isActive) {
            result.set(idx++, entity.id());
        }
    }
    return result;
}

emscripten::val getChildEntities(ecs::Registry& registry, u32 entity) {
    auto result = emscripten::val::array();
    if (!registry.has<ecs::Children>(Entity::fromRaw(entity))) {
        return result;
    }
    const auto& children = registry.get<ecs::Children>(Entity::fromRaw(entity));
    u32 idx = 0;
    for (auto child : children.entities) {
        result.set(idx++, child.id());
    }
    return result;
}
#endif

u32 registry_getGeneration(ecs::Registry& registry, u32 entity) {
    return Entity::fromRaw(entity).generation();
}

u32 registry_watchEntityChanges(ecs::Registry& registry) { return registry.watchEntityChanges(); }
void registry_unwatchEntityChanges(ecs::Registry& registry, u32 reader) { registry.unwatchEntityChanges(reader); }
double registry_entityChangeSequence(ecs::Registry& registry) { return registry.entityChangeSequence(); }
double registry_entityChangeResetEpoch(ecs::Registry& registry) { return registry.entityChangeResetEpoch(); }
double registry_componentMutationRevision(ecs::Registry& registry, u32 component, bool topology) {
    return registry.componentMutationRevision(component, topology);
}
int registry_readEntityChanges(ecs::Registry& registry, double after, uintptr_t outputPtr, int capacity) {
    if (capacity < 0 || capacity > static_cast<int>(ecs::ENTITY_CHANGE_CAPACITY)
        || outputPtr % alignof(ecs::EntityChangeRow)) return -1;
    if (capacity == 0) return registry.readEntityChanges(after, {});
    auto* rows = boundarySpanMut<ecs::EntityChangeRow>(outputPtr, static_cast<u64>(capacity), "registry_readEntityChanges");
    return rows ? registry.readEntityChanges(after, {rows, static_cast<usize>(capacity)}) : -1;
}

int registry_readWorldPoses2D(ecs::Registry& registry, uintptr_t entitiesPtr, int count, uintptr_t outputPtr) {
    if (count <= 0 || entitiesPtr % alignof(u32) || outputPtr % alignof(EntityPose2D)) return 0;
    const auto* ids = boundarySpan<u32>(entitiesPtr, static_cast<u64>(count), "registry_readWorldPoses2D.entities");
    auto* output = boundarySpanMut<EntityPose2D>(outputPtr, static_cast<u64>(count), "registry_readWorldPoses2D.output");
    if (!ids || !output) return 0;
    int written = 0;
    for (int i = 0; i < count; ++i) {
        const auto entity = Entity::fromRaw(ids[i]);
        if (!registry.valid(entity) || !registry.isEntityActive(entity) || !registry.has<ecs::Transform>(entity)) continue;
        auto& tf = registry.get<ecs::Transform>(entity);
        tf.ensureDecomposed();
        const auto& q = tf.worldRotation;
        const f32 angle = std::atan2(2.0f * (q.w * q.z + q.x * q.y), 1.0f - 2.0f * (q.y * q.y + q.z * q.z));
        output[written++] = {entity.id(), tf.worldPosition.x, tf.worldPosition.y, angle};
    }
    return written;
}

void registry_batchSyncPhysicsTransforms(ecs::Registry& registry, uintptr_t bufferPtr, int count, float ppu) {
    // Physics is a producer of transform INPUTS. The composed world fields are
    // TransformSystem's, and writing them here made this a second author of them.
    ecs::invalidateTransformComposition();
    if (count < 0) return;
    const float* buffer = boundarySpan<f32>(bufferPtr, static_cast<u64>(count) * 4, "registry_batchSyncPhysicsTransforms");
    if (!buffer) return;
    for (int i = 0; i < count; i++) {
        const int offset = i * 4;
        uint32_t entityId;
        std::memcpy(&entityId, buffer + offset, sizeof(uint32_t));
        auto entity = Entity::fromRaw(entityId);
        if (!registry.valid(entity)) continue;
        if (!registry.has<ecs::Transform>(entity)) continue;

        auto& transform = registry.get<ecs::Transform>(entity);
        float px = buffer[offset + 1] * ppu;
        float py = buffer[offset + 2] * ppu;
        float angle = buffer[offset + 3];
        float half = angle * 0.5f;
        glm::quat rot(std::cos(half), 0.0f, 0.0f, std::sin(half));

        transform.position.x = px;
        transform.position.y = py;
        transform.rotation = rot;
    }
}

void renderer_captureNextFrame() {
    if (g_renderFrame) {
        g_renderFrame->frameCapture().requestCapture();
    }
}

u32 renderer_getCapturedFrameSize() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->frameCapture().getRecordCount();
}

uintptr_t renderer_getCapturedFrameData() {
    if (!g_renderFrame) return 0;
    return reinterpret_cast<uintptr_t>(g_renderFrame->frameCapture().getRecords());
}

uintptr_t renderer_getCapturedEntities() {
    if (!g_renderFrame) return 0;
    return reinterpret_cast<uintptr_t>(g_renderFrame->frameCapture().getEntities());
}

u32 renderer_getCapturedEntityCount() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->frameCapture().getEntityCount();
}

uintptr_t renderer_getCapturedTextures() {
    if (!g_renderFrame) return 0;
    return reinterpret_cast<uintptr_t>(g_renderFrame->frameCapture().getTextures());
}

u32 renderer_getCapturedTextureCount() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->frameCapture().getTextureCount();
}

u32 renderer_getCapturedPassCount() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->frameCapture().getPassCount();
}

bool renderer_hasCapturedData() {
    if (!g_renderFrame) return false;
    return g_renderFrame->frameCapture().hasCapturedData();
}

void renderer_replayToDrawCall(i32 drawCallIndex) {
    if (!g_renderFrame) return;
    g_renderFrame->replayToDrawCall(drawCallIndex);
}

// Lands the snapshot's async readback: 0 = pending (poll again after yielding
// to the event loop), 1 = getSnapshot* serve the pixels, 2 = none/failed.
bool renderer_snapshotMatchesCapture() {
    return g_renderFrame && g_renderFrame->snapshotMatchesCapture();
}

i32 renderer_pollSnapshotReadback() {
    return g_renderFrame ? g_renderFrame->pollSnapshotReadback() : 2;
}

namespace {
bool copyOut(const void* src, usize bytes, uintptr_t dest, u32 destSize) {
    if (!src || !dest || bytes == 0 || destSize < bytes) return false;
    std::memcpy(reinterpret_cast<void*>(dest), src, bytes);
    return true;
}
}  // namespace

bool renderer_copyCapturedRecords(uintptr_t dest, u32 destSize) {
    if (!g_renderFrame) return false;
    const auto& c = g_renderFrame->frameCapture();
    return copyOut(c.getRecords(), usize(c.getRecordCount()) * sizeof(DrawCallRecord), dest, destSize);
}

bool renderer_copyCapturedEntities(uintptr_t dest, u32 destSize) {
    if (!g_renderFrame) return false;
    const auto& c = g_renderFrame->frameCapture();
    return copyOut(c.getEntities(), usize(c.getEntityCount()) * sizeof(Entity), dest, destSize);
}

bool renderer_copyCapturedTextures(uintptr_t dest, u32 destSize) {
    if (!g_renderFrame) return false;
    const auto& c = g_renderFrame->frameCapture();
    return copyOut(c.getTextures(), usize(c.getTextureCount()) * sizeof(u32), dest, destSize);
}

bool renderer_copySnapshot(uintptr_t dest, u32 destSize) {
    if (!g_renderFrame) return false;
    return copyOut(g_renderFrame->getSnapshotPixels(), g_renderFrame->getSnapshotSize(), dest, destSize);
}

uintptr_t renderer_getSnapshotPtr() {
    if (!g_renderFrame) return 0;
    return reinterpret_cast<uintptr_t>(g_renderFrame->getSnapshotPixels());
}

u32 renderer_getSnapshotSize() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->getSnapshotSize();
}

u32 renderer_getSnapshotWidth() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->getSnapshotWidth();
}

u32 renderer_getSnapshotHeight() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->getSnapshotHeight();
}

// =============================================================================
// Frame readback (what was drawn, from the backend that drew it)
// =============================================================================

/**
 * Books the next completed frame for readback and returns a handle to poll.
 * The one way to ask a running engine what is on screen; a host that reads the
 * page instead gets the display's answer, which is colour managed.
 */
u32 renderer_captureFrame(u32 w, u32 h) {
    auto* device = g_device;
    if (!device) return 0;
    return static_cast<u32>(device->captureNextFrame(w, h));
}

/** 0 = pending (step a frame, poll again), 1 = ready, 2 = failed/unknown. */
i32 renderer_pollFrameCapture(u32 handle) {
    auto* device = g_device;
    if (!device || !handle) return 2;
    switch (device->pollReadback(static_cast<ReadbackHandle>(handle))) {
        case GfxReadbackStatus::Pending: return 0;
        case GfxReadbackStatus::Ready: return 1;
        default: return 2;
    }
}

/**
 * Copies a ready capture into @p dest (w*h*4 bytes, bottom-up RGBA) and releases it.
 *
 * Always RGBA: a surface may be BGRA (which is what a canvas usually prefers, and
 * configuring anything else costs a copy per present), and every consumer of this
 * reads channels by index.
 */
bool renderer_takeFrameCapture(u32 handle, uintptr_t dest, u32 destSize) {
    auto* device = g_device;
    if (!device || !handle || !dest) return false;
    if (!device->takeReadback(static_cast<ReadbackHandle>(handle),
                              reinterpret_cast<void*>(dest), static_cast<usize>(destSize))) {
        return false;
    }
    if (device->frameCaptureIsBGRA()) {
        auto* px = reinterpret_cast<u8*>(dest);
        for (u32 i = 0; i + 3 < destSize; i += 4) std::swap(px[i], px[i + 2]);
    }
    return true;
}

u32 renderer_createSkeletalPreview(i32 w, i32 h) {
    if (!g_renderFrame || w <= 0 || h <= 0) return 0;
    return static_cast<u32>(g_renderFrame->createSkeletalPreview(
        static_cast<u32>(w), static_cast<u32>(h)));
}

i32 renderer_submitSkeletalPreviewBatch(
    u32 preview,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode, uintptr_t transformPtr,
    i32 layer, f32 depth, u32 materialId
) {
    return renderer_submitSkeletalPreviewBatchEx(preview, verticesPtr, vertexCount, indicesPtr, indexCount, textureId, blendMode, transformPtr, layer, depth, materialId, blendMode == 4 || blendMode == 5);
}

i32 renderer_submitSkeletalPreviewBatchEx(
    u32 preview,
    uintptr_t verticesPtr, i32 vertexCount,
    uintptr_t indicesPtr, i32 indexCount,
    u32 textureId, i32 blendMode, uintptr_t transformPtr,
    i32 layer, f32 depth, u32 materialId, bool premultipliedColor
) {
    if (!g_renderFrame || vertexCount < 0 || indexCount < 0) return 0;
    // Skeletal vertex format is x,y,u,v,r,g,b,a (8 floats per vertex).
    auto* vertices = boundarySpan<f32>(verticesPtr, static_cast<u64>(vertexCount) * 8,
                                       "renderer_submitSkeletalPreviewBatch.vertices");
    auto* indices = boundarySpan<u16>(indicesPtr, static_cast<u64>(indexCount),
                                      "renderer_submitSkeletalPreviewBatch.indices");
    auto* transform = boundarySpan<f32>(transformPtr, 16,
                                        "renderer_submitSkeletalPreviewBatch.transform");
    if (!vertices || !indices || !transform) return 0;
    return g_renderFrame->submitSkeletalPreviewBatch(
        preview, vertices, vertexCount, indices, indexCount,
        textureId, blendMode, transform, layer, depth, materialId, premultipliedColor) ? 1 : 0;
}

i32 renderer_renderSkeletalPreview(u32 preview, uintptr_t viewProjectionPtr) {
    if (!g_renderFrame) return 0;
    auto* vp = boundarySpan<f32>(viewProjectionPtr, 16, "renderer_renderSkeletalPreview.vp");
    if (!vp) return 0;
    glm::mat4 viewProjection{1.0f};
    std::memcpy(&viewProjection[0][0], vp, sizeof(f32) * 16);
    return g_renderFrame->renderSkeletalPreview(preview, viewProjection) ? 1 : 0;
}

i32 renderer_pollSkeletalPreview(u32 preview) {
    return g_renderFrame ? g_renderFrame->pollSkeletalPreview(preview) : 2;
}

uintptr_t renderer_getSkeletalPreviewPtr(u32 preview) {
    return g_renderFrame
        ? reinterpret_cast<uintptr_t>(g_renderFrame->skeletalPreviewPixels(preview)) : 0;
}

u32 renderer_getSkeletalPreviewSize(u32 preview) {
    return g_renderFrame ? g_renderFrame->skeletalPreviewSize(preview) : 0;
}

u32 renderer_getSkeletalPreviewWidth(u32 preview) {
    return g_renderFrame ? g_renderFrame->skeletalPreviewWidth(preview) : 0;
}

u32 renderer_getSkeletalPreviewHeight(u32 preview) {
    return g_renderFrame ? g_renderFrame->skeletalPreviewHeight(preview) : 0;
}

void renderer_destroySkeletalPreview(u32 preview) {
    if (g_renderFrame) g_renderFrame->destroySkeletalPreview(preview);
}

void renderer_renderMaterialPreview(u32 materialId, i32 w, i32 h, u32 meshId, u32 textureId) {
    if (!g_renderFrame || w <= 0 || h <= 0) return;

    ecs::Registry reg;
    auto light = reg.create();
    reg.emplace<ecs::Transform>(light);
    reg.emplace<ecs::Light>(light).type = static_cast<i32>(ecs::LightType::Directional);
    // A shape of the caller's choosing: the material on a mesh, seen off-axis and framed to the
    // mesh's own bounds (a ball seen from one side is a disc), lit by one directional light.
    auto* rm = meshId != 0 ? ctx().tryGet<resource::ResourceManager>() : nullptr;
    const Mesh* res = rm ? rm->getMesh(resource::MeshHandle{meshId}) : nullptr;
    if (res) {
        auto entity = reg.create();
        reg.emplace<ecs::Transform>(entity);
        auto& mesh = reg.emplace<ecs::MeshRenderer>(entity);
        mesh.mesh = resource::MeshHandle{meshId};
        mesh.material = materialId;
        mesh.lit = true;
        mesh.opaque = true;
        // By id, not through a reference held across the emplace above: it can have moved.
        reg.get<ecs::Transform>(light).position = glm::vec3(0.0f, 0.0f, 1.0f);

        if (g_transformSystem) {
            esengine::World world{reg, ctx().services(), 0.0f};
            g_transformSystem->update(world);
        }

        const glm::vec3 centre = (res->localMin + res->localMax) * 0.5f;
        const f32 radius = std::max(glm::length(res->localMax - res->localMin) * 0.5f, 1e-4f);
        const glm::vec3 eye = centre + glm::normalize(glm::vec3(0.6f, 0.45f, 1.0f)) * (radius * 4.0f);
        const glm::mat4 view = glm::lookAt(eye, centre, glm::vec3(0.0f, 1.0f, 0.0f));
        f32 half = 1e-4f;
        for (i32 corner = 0; corner < 8; ++corner) {
            const glm::vec3 world{
                (corner & 1) ? res->localMax.x : res->localMin.x,
                (corner & 2) ? res->localMax.y : res->localMin.y,
                (corner & 4) ? res->localMax.z : res->localMin.z,
            };
            const glm::vec3 v = glm::vec3(view * glm::vec4(world, 1.0f));
            half = std::max({half, std::abs(v.x), std::abs(v.y)});
        }
        half *= 1.08f;
        const glm::mat4 proj = math::ortho(-half, half, -half, half, 0.01f, radius * 8.0f);
        g_renderFrame->renderToTarget(reg, proj * view, static_cast<u32>(w), static_cast<u32>(h));
        return;
    }

    // Otherwise a 2×2 quad filling the ortho [-1,1] with the material — a sprite, so a sprite shader
    // gets the picture it samples (`textureId`, 0 = none).
    auto quad = reg.create();
    reg.emplace<ecs::Transform>(quad);
    auto& sprite = reg.emplace<ecs::Sprite>(quad);
    sprite.material = materialId;
    sprite.size = glm::vec2(2.0f, 2.0f);
    if (textureId != 0) sprite.texture = resource::TextureHandle{textureId};

    if (g_transformSystem) {
        esengine::World world{reg, ctx().services(), 0.0f};
        g_transformSystem->update(world);
    }

    const glm::mat4 vp = math::ortho(-1.0f, 1.0f, -1.0f, 1.0f, -1.0f, 1.0f);
    g_renderFrame->renderToTarget(reg, vp, static_cast<u32>(w), static_cast<u32>(h));
}

/**
 * A thumbnail of a loaded mesh, into the same offscreen target the material
 * preview uses and by the same route (a throwaway scene through the real collect
 * path) — so a thumbnail shows what the viewport would. The eye stands off-axis
 * because a model seen head-on is a silhouette.
 */
void renderer_renderMeshPreview(u32 meshId, i32 w, i32 h) {
    if (!g_renderFrame || w <= 0 || h <= 0) return;
    auto* rm = ctx().tryGet<resource::ResourceManager>();
    const Mesh* res = rm ? rm->getMesh(resource::MeshHandle{meshId}) : nullptr;
    if (!res) return;

    ecs::Registry reg;
    auto entity = reg.create();
    reg.emplace<ecs::Transform>(entity);
    auto& mesh = reg.emplace<ecs::MeshRenderer>(entity);
    mesh.mesh = resource::MeshHandle{meshId};
    mesh.lit = true;
    mesh.opaque = true;

    auto light = reg.create();
    auto& lightTransform = reg.emplace<ecs::Transform>(light);
    lightTransform.position = glm::vec3(0.0f, 0.0f, 1.0f);
    reg.emplace<ecs::Light>(light).type = static_cast<i32>(ecs::LightType::Directional);

    if (g_transformSystem) {
        esengine::World world{reg, ctx().services(), 0.0f};
        g_transformSystem->update(world);
    }

    // Frame the mesh's own bounds: an .esmesh is authored at whatever scale its
    // source used, so a fixed box would show one model whole and another as a dot.
    const glm::vec3 centre = (res->localMin + res->localMax) * 0.5f;
    const f32 radius = std::max(glm::length(res->localMax - res->localMin) * 0.5f, 1e-4f);
    const glm::vec3 eye = centre + glm::normalize(glm::vec3(0.6f, 0.45f, 1.0f)) * (radius * 4.0f);
    const glm::mat4 view = glm::lookAt(eye, centre, glm::vec3(0.0f, 1.0f, 0.0f));

    // The box is measured AFTER the turn: a flat model seen off-axis is much
    // smaller than its diagonal, and framing by the diagonal draws it as a stamp
    // in the middle of an empty thumbnail.
    f32 half = 1e-4f;
    for (i32 corner = 0; corner < 8; ++corner) {
        const glm::vec3 world{
            (corner & 1) ? res->localMax.x : res->localMin.x,
            (corner & 2) ? res->localMax.y : res->localMin.y,
            (corner & 4) ? res->localMax.z : res->localMin.z,
        };
        const glm::vec3 v = glm::vec3(view * glm::vec4(world, 1.0f));
        half = std::max({half, std::abs(v.x), std::abs(v.y)});
    }
    half *= 1.08f;
    const glm::mat4 proj = math::ortho(-half, half, -half, half, 0.01f, radius * 8.0f);
    g_renderFrame->renderToTarget(reg, proj * view, static_cast<u32>(w), static_cast<u32>(h));
}

// Same 0/1/2 contract as renderer_pollSnapshotReadback, for the material preview.
i32 renderer_pollPreviewReadback() {
    return g_renderFrame ? g_renderFrame->pollPreviewReadback() : 2;
}

uintptr_t renderer_getPreviewPtr() {
    return g_renderFrame ? reinterpret_cast<uintptr_t>(g_renderFrame->getPreviewPixels()) : 0;
}

u32 renderer_getPreviewSize() {
    return g_renderFrame ? g_renderFrame->getPreviewSize() : 0;
}

u32 renderer_getPreviewWidth() {
    return g_renderFrame ? g_renderFrame->getPreviewWidth() : 0;
}

u32 renderer_getPreviewHeight() {
    return g_renderFrame ? g_renderFrame->getPreviewHeight() : 0;
}

void renderer_setTextureParams(u32 textureId, i32 minFilter, i32 magFilter, i32 wrapS, i32 wrapT) {
    auto* device = g_device;
    if (!device) return;
    device->setTextureParams(
        TextureHandle{textureId},
        static_cast<TextureFilter>(minFilter),
        static_cast<TextureFilter>(magFilter),
        static_cast<TextureWrap>(wrapS),
        static_cast<TextureWrap>(wrapT)
    );
}

}  // namespace esengine

