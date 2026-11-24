// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MeshPlugin.cpp
 * @brief   Collect mesh geometry for scene, shadow, depth and motion passes.
 */
#include "MeshPlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../store/MaterialStore.hpp"
#include "../store/MorphConstants.hpp"
#include "../store/ProbeConstants.hpp"
#include "../frame/RenderFrame.hpp"
#include "../frame/SkinCache.hpp"
#include "../frame/RenderContext.hpp"
#include "../rhi/Texture.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/MeshRenderer.hpp"
#include "../../ecs/components/LODGroup.hpp"
#include "../../ecs/components/LODMember.hpp"
#include "../../ecs/components/Billboard.hpp"
#include "../draw/BillboardFacing.hpp"
#include "../draw/ImpostorFrames.hpp"
#include "../draw/PlacementBounds.hpp"
#include "../draw/MeshGeometry.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../../ecs/components/Impostor.hpp"
#include "../../resource/Mesh.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../../core/Log.hpp"
#include "../../core/FrameProfiler.hpp"
#include "../../core/Hash.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/matrix_inverse.hpp>
#include <glm/gtc/matrix_access.hpp>

#include <algorithm>
#include <cmath>
#include <limits>
#include <string>
#include <vector>

#include <cmath>
#include <cstring>

namespace esengine {

namespace {
// Per-channel RGBA8 multiply, for tinting per-vertex colors.
u32 mulColor(u32 a, u32 b) {
    u32 r = (((a >> 0)  & 0xFF) * ((b >> 0)  & 0xFF)) / 255u;
    u32 g = (((a >> 8)  & 0xFF) * ((b >> 8)  & 0xFF)) / 255u;
    u32 bl = (((a >> 16) & 0xFF) * ((b >> 16) & 0xFF)) / 255u;
    u32 al = (((a >> 24) & 0xFF) * ((b >> 24) & 0xFF)) / 255u;
    return r | (g << 8) | (bl << 16) | (al << 24);
}
/// Which program a draw needs: what the GEOMETRY carries and what the DRAW asked
/// for are separate questions, so they are separate bits.
/**
 * This entity's pose: joint world placement times the mesh's own bind matrix,
 * one per joint. Returns 0 — draw it static — when the two disagree about how
 * many joints there are, since an index resolved against the wrong matrix moves
 * the vertex somewhere arbitrary.
 */
/**
 * @brief How many joints this entity would be posed by; 0 when it draws unskinned.
 *        Separated from posing: the key needs the ANSWER, not the matrices, and a
 *        re-derived one would disagree with the predicate that draws.
 */
/**
 * @brief Whether a mesh posed by @p joints joints draws skinned.
 *
 * @details Takes the joint count from wherever the caller found it: a live
 *          `MeshSkin`, or a prepared document with no entities yet.
 */
u32 skinnedBy(const Mesh& mesh, usize joints, bool& warnedBones) {
    if (!mesh.isSkinned() || joints != mesh.inverseBind.size()) return 0;
    // Posing the first MESH_MAX_BONES leaves the rest indexing a matrix this
    // draw never uploads — the wrong-matrix read the count check above already
    // rejects, so it takes the same answer. A chunked skin is drawn a chunk at a
    // time, each with at most that many, so it may have any number.
    if (joints > MESH_MAX_BONES && !mesh.isChunked()) {
        if (!warnedBones) {
            warnedBones = true;
            ES_LOG_WARN("MeshSkin: {} joints exceeds the {} one draw can be posed by; drawing the"
                        " bind pose", joints, MESH_MAX_BONES);
        }
        return 0;
    }
    return static_cast<u32>(joints);
}

u32 skinJointCount(ecs::Registry& registry, Entity entity, const Mesh& mesh, bool& warnedBones) {
    const auto* skin = registry.tryGet<ecs::MeshSkin>(entity);
    return skin ? skinnedBy(mesh, skin->joints.size(), warnedBones) : 0;
}

/** @brief The facts a PREPARED cell answers with: its document's fields, and the
 *         assets its preparation already decoded. No entity is consulted. */
MeshProgramFacts meshFactsFromDocument(RenderFrameContext& ctx, const MeshDocumentRecord& row,
                                       bool& warnedBones) {
    MeshProgramFacts facts;
    const Mesh* resident = row.meshHandle != 0
        ? ctx.resources.getMesh(resource::MeshHandle(row.meshHandle)) : nullptr;
    facts.hasNormals = resident && resident->hasNormals;
    facts.lit = row.lit != 0;
    facts.materialId = row.materialId;
    if (row.normalMapHandle != 0 && facts.lit && facts.hasNormals) {
        if (Texture* tex = ctx.resources.getTexture(resource::TextureHandle(row.normalMapHandle))) {
            facts.normalTextureId = tex->getId();
        }
    }
    facts.skinned = resident && skinnedBy(*resident, row.jointCount, warnedBones) > 0;
    facts.lightmapped = resident && resident->hasLightmapUV;
    facts.tangents = resident && resident->hasTangents;
    return facts;
}

u32 skinPose(ecs::Registry& registry, Entity entity, const Mesh& mesh,
             std::vector<glm::mat4>& out, bool& warnedBones) {
    const u32 count = skinJointCount(registry, entity, mesh, warnedBones);
    if (count == 0) return 0;
    const auto* skin = registry.tryGet<ecs::MeshSkin>(entity);

    out.resize(count);
    for (u32 i = 0; i < count; ++i) {
        auto* joint = registry.tryGet<ecs::Transform>(skin->joints[i]);
        // A joint that is not there leaves the bind pose, which is the mesh as
        // authored rather than a vertex collapsed onto the origin.
        if (!joint) { out[i] = glm::mat4(1.0f); continue; }
        // Built from the decomposed world fields, the same three every other
        // draw is placed by — the cached matrix is the transform system's own
        // and is not guaranteed current for an entity nothing parents.
        joint->ensureDecomposed();
        const glm::mat4 world = glm::translate(glm::mat4(1.0f), rebased(joint->worldPosition))
                              * glm::mat4_cast(joint->worldRotation)
                              * glm::scale(glm::mat4(1.0f), joint->worldScale);
        out[i] = world * mesh.inverseBind[i];
    }
    return count;
}

/**
 * @brief The world box a skinned mesh can be in, for culling: around its joints, not around its entity.
 *
 * @details A skinned mesh's own transform is not read, so the box its entity would give says nothing once the bones have
 *          carried it elsewhere: an animation that walks a body off its root, or a raised arm, is drawn outside it. A vertex
 *          stays as far from a joint as it was bound, so each joint reaches as far as the bind box does from it.
 *
 * @return False when the entity draws unskinned, and the entity's own box is the answer.
 */
bool skinnedWorldBounds(ecs::Registry& registry, Entity entity, const Mesh& mesh, bool& warnedBones,
                        glm::vec3& centre, glm::vec3& half) {
    const u32 count = skinJointCount(registry, entity, mesh, warnedBones);
    if (count == 0) return false;
    const auto* skin = registry.tryGet<ecs::MeshSkin>(entity);
    const glm::vec3 bindCentre = (mesh.localMin + mesh.localMax) * 0.5f;
    const f32 bindRadius = glm::length(mesh.localMax - mesh.localMin) * 0.5f;
    glm::vec3 lo(std::numeric_limits<f32>::max()), hi(std::numeric_limits<f32>::lowest());
    for (u32 i = 0; i < count; ++i) {
        auto* joint = registry.tryGet<ecs::Transform>(skin->joints[i]);
        if (!joint) continue;
        joint->ensureDecomposed();
        const glm::vec3 scale = glm::abs(joint->worldScale);
        const f32 reach = (glm::length(glm::vec3(mesh.inverseBind[i] * glm::vec4(bindCentre, 1.0f))) + bindRadius)
                        * std::max({scale.x, scale.y, scale.z});
        const glm::vec3 at = rebased(joint->worldPosition);
        lo = glm::min(lo, at - reach);
        hi = glm::max(hi, at + reach);
    }
    if (lo.x > hi.x) return false;
    centre = (lo + hi) * 0.5f;
    half = (hi - lo) * 0.5f;
    return true;
}

/**
 * @brief The shapes this entity is in, as the block one draw is deformed by.
 *
 * @details Only the heaviest MESH_MAX_ACTIVE_MORPHS are taken, and a weight left
 *          out reads as zero — which is what a weight an author never moved
 *          already means. Zero weights are dropped first, so the budget is spent
 *          on shapes that are saying something.
 *
 * @return False when the entity is in the shape the mesh was authored in.
 */
bool morphShapes(ecs::Registry& registry, Entity entity, const Mesh& mesh,
                 MorphConstants& out) {
    if (!mesh.isMorphable()) return false;
    const auto* morph = registry.tryGet<ecs::MeshMorph>(entity);
    if (!morph) return false;

    // Weight i addresses target i, so a list longer than the mesh names shapes
    // it does not have — those entries are not read rather than shifting the rest.
    const u32 count = std::min(static_cast<u32>(morph->weights.size()), mesh.morphTargetCount);
    u32 live = 0;
    for (u32 t = 0; t < count; ++t) {
        const f32 weight = morph->weights[t];
        if (weight == 0.0f) continue;
        if (live < MESH_MAX_ACTIVE_MORPHS) {
            out.shape[live++] = glm::vec4(static_cast<f32>(t), weight, 0.0f, 0.0f);
            continue;
        }
        // Full: the smallest of what is held loses its place, and only to
        // something heavier — so what survives is the heaviest set, whatever
        // order the weights arrived in.
        u32 lightest = 0;
        for (u32 i = 1; i < MESH_MAX_ACTIVE_MORPHS; ++i) {
            if (std::abs(out.shape[i].y) < std::abs(out.shape[lightest].y)) lightest = i;
        }
        if (std::abs(weight) > std::abs(out.shape[lightest].y)) {
            out.shape[lightest] = glm::vec4(static_cast<f32>(t), weight, 0.0f, 0.0f);
        }
    }
    if (live == 0) return false;
    out.info = glm::vec4(static_cast<f32>(live), static_cast<f32>(mesh.vertexCount),
                         mesh.morphHasNormals ? 2.0f : 1.0f,
                         static_cast<f32>(MORPH_TEXTURE_WIDTH));
    return true;
}

/** @brief Says once what a group declares that nothing will ever use. */
void reportLodAuthoring(const LodLevels& levels, bool& warned) {
    if (warned || !(levels.gap || levels.disordered || levels.skinMismatch)) return;
    warned = true;
    if (levels.gap) {
        ES_LOG_WARN("LODGroup: a stand-in slot is empty, so every slot after it is unreachable —"
                    " fill lod1, then lod2, then lod3");
    }
    if (levels.disordered) {
        ES_LOG_WARN("LODGroup: the screen sizes do not descend, so a level is handed over to"
                    " before the one before it");
    }
    if (levels.skinMismatch) {
        ES_LOG_WARN("LODGroup: a stand-in has a different joint count from level 0; every level of"
                    " a skinned group must share the skeleton");
    }
}

u32 meshVariant(bool normals, bool lit, bool normalMapped, bool skinned, bool depthOnly,
                bool envMapped, bool lightmapped, bool weightHeat = false, bool gbuffer = false,
                bool motion = false, bool tangents = false, bool direct = false) {
    return (normals ? 1u : 0u) | (lit ? 2u : 0u) | (normalMapped ? 4u : 0u)
         | (skinned ? 8u : 0u) | (depthOnly ? 16u : 0u) | (envMapped ? 32u : 0u)
         | (lightmapped ? 64u : 0u) | (weightHeat ? 128u : 0u) | (gbuffer ? 256u : 0u)
         | (motion ? 512u : 0u) | (tangents ? 1024u : 0u) | (direct ? 2048u : 0u);
}

/**
 * @brief The variant one renderable will be asked for, under this frame's
 *        configuration and this pass's purpose.
 *
 * @details The single derivation, and it hands back the normal-map id it resolved
 *          so the caller does not resolve it twice. A second copy of these facts
 *          drifts the day the key gains another.
 */
/// The surface of a wireframe view and the ink of its edges. Neutral, so a wireframe says
/// nothing about anyone's colours.
constexpr glm::vec4 kWireFill{0.075f, 0.075f, 0.08f, 1.0f};
constexpr glm::vec4 kWireInk{0.9f, 0.9f, 0.9f, 1.0f};
/// How far behind the edges the surface is pushed, in depth units (positive is away). Level with
/// them it would win every pixel and the wireframe would be a handful of dashes.
constexpr i16 kWireFillBias = 4;

/**
 * @brief What a mesh is drawn as when its view overrides the look: the authored
 *        material, normal map and (for clay) texture and colour are set aside, and
 *        the plain description left drives the same draw path as any other mesh.
 * @details One place, so a mode cannot be half-applied: the variant, the draw key and
 *          the instance record all read the SAME overridden description.
 */
void applyShading(ecs::MeshRenderer& mesh, ShadingMode mode) {
    mesh.material = 0;
    mesh.normalMap = {};
    if (mode == ShadingMode::Wireframe) {
        // The surface the edges stand on: dark, unlit, opaque so it hides what is behind it.
        mesh.texture = {};
        mesh.color = kWireFill;
        mesh.lit = false;
        mesh.opaque = true;
    } else if (shadesAsClay(mode) || mode == ShadingMode::Clusters) {
        mesh.texture = {};
        mesh.color = glm::vec4(0.74f, 0.74f, 0.76f, 1.0f);
        mesh.lit = true;
    } else {
        mesh.lit = false;
    }
}

/**
 * @brief The colour the cluster view gives cluster @p id: a hue from its number, so neighbours differ and a cluster keeps
 *        its colour from frame to frame.
 */
glm::vec4 clusterInk(u32 id) {
    u32 h = id * 0x9E3779B1u;
    h ^= h >> 15;
    const f32 hue = static_cast<f32>(h & 0xFFFFu) / 65536.0f * 6.0f;
    const f32 rise = hue - std::floor(hue);
    const f32 low = 0.28f, high = 0.95f;
    const f32 up = low + (high - low) * rise, down = high - (high - low) * rise;
    switch (static_cast<u32>(hue) % 6u) {
        case 0: return {high, up, low, 1.0f};
        case 1: return {down, high, low, 1.0f};
        case 2: return {low, high, up, 1.0f};
        case 3: return {low, down, high, 1.0f};
        case 4: return {up, low, high, 1.0f};
        default: return {high, low, down, 1.0f};
    }
}

struct MeshDrawKeys {
    u32 variant = 0;
    u32 normalTextureId = 0;
};

u32 meshVariantFrom(const MeshProgramFacts& facts, bool envMapped, bool shadowDepth, bool direct, bool weightHeat = false,
                    bool gbuffer = false) {
    // `lightmapped` and `tangents` survive the shadow pass, unlike the three describing shading: each declares a vertex attribute.
    // Weights are read off the surface of a skinned draw and nothing else's: the colour is
    // the shade, so it asks for no light, no normal map and no depth pass of its own.
    const bool heat = weightHeat && facts.skinned && !shadowDepth;
    const bool lit = facts.lit && !shadowDepth && !heat;
    // The surface record is for what takes light: an unlit surface has no normal worth recording.
    return meshVariant(facts.hasNormals, lit,
                       facts.normalTextureId != 0 && !shadowDepth && !heat, facts.skinned, shadowDepth,
                       envMapped, facts.lightmapped, heat, gbuffer && lit, false, facts.tangents, direct && lit);
}

/** @brief The facts a LIVE entity answers with: its components and its mesh. */
MeshProgramFacts meshFactsFromEntity(RenderFrameContext& ctx, ecs::Registry& registry,
                                     Entity entity, const ecs::MeshRenderer& mesh,
                                     const Mesh* resident, bool& warnedBones) {
    MeshProgramFacts facts;
    facts.hasNormals = resident && resident->hasNormals;
    facts.lit = mesh.lit;
    facts.opaque = mesh.opaque;
    facts.materialId = mesh.material;
    // Only meaningful with normals to perturb AND a draw that takes light.
    if (mesh.normalMap.isValid() && mesh.lit && resident && resident->hasNormals) {
        if (Texture* tex = ctx.resources.getTexture(mesh.normalMap)) {
            facts.normalTextureId = tex->getId();
        }
    }
    facts.skinned = resident && skinJointCount(registry, entity, *resident, warnedBones) > 0;
    facts.lightmapped = resident && resident->hasLightmapUV;
    facts.tangents = resident && resident->hasTangents;
    return facts;
}

/** @brief The program a draw with these facts is asked for in this frame and pass: the frame's half of meshDrawFor. */
MeshDrawKeys meshDrawFrom(RenderFrameContext& ctx, Entity entity, const MeshProgramFacts& facts, bool shadowDepth,
                          bool weightHeat = false) {
    return { meshVariantFrom(facts, ctx.environment_texture_id != 0
                || (!shadowDepth && ctx.frame && ctx.frame->planarTextureFor(entity) != 0), shadowDepth, ctx.lighting_direct, weightHeat,
                ctx.gbuffer && !shadowDepth),
             facts.normalTextureId };
}

MeshDrawKeys meshDrawFor(RenderFrameContext& ctx, ecs::Registry& registry, Entity entity,
                         const ecs::MeshRenderer& mesh, const Mesh* resident, bool shadowDepth,
                         bool& warnedBones, bool weightHeat = false) {
    return meshDrawFrom(ctx, entity, meshFactsFromEntity(ctx, registry, entity, mesh, resident, warnedBones), shadowDepth,
                        weightHeat);
}

/** @brief The normal map's id as this frame has it, for facts kept without one: a texture's id is not kept. */
u32 normalTextureOf(RenderFrameContext& ctx, const ecs::MeshRenderer& mesh, const MeshProgramFacts& facts) {
    if (!mesh.normalMap.isValid() || !facts.lit || !facts.hasNormals) return 0;
    Texture* tex = ctx.resources.getTexture(mesh.normalMap);
    return tex ? tex->getId() : 0;
}

/** @brief The levels an LODGroup names by its screen sizes alone: one per size above zero, descending, for a group whose levels
 *         are whole entities (LODMember) and not stand-in meshes. */
lod::LevelSet memberLevelSet(const ecs::LODGroup& group) {
    const f32 sizes[lod::kMaxStandIns] = {group.lod1Size, group.lod2Size, group.lod3Size};
    return lod::levelsFromSizes(sizes, group.cullSize, group.hysteresis);
}

/**
 * @brief The level @p member's group is drawn at in this collect's view.
 *
 * @details Chosen once per view per frame, by whichever member is collected first, and remembered under the GROUP entity as an
 *          LODGroup's level is under its own: every member of the group reads the same answer, a shadow cast for the view follows
 *          what the view settled on, and an editor's preview of the group holds all its members. A collect that does not select
 *          draws level 0, as it draws an LODGroup's own mesh.
 */
template <class Collect, class Context>
u8 memberGroupLevel(ecs::Registry& registry, Collect& collect_ctx, const Context& ctx, const ecs::LODMember& member) {
    const Entity g = Entity::fromRaw(member.group);
    if (!registry.valid(g)) return 0;
    const auto* group = registry.tryGet<ecs::LODGroup>(g);
    auto* placed = registry.tryGet<ecs::Transform>(g);
    if (!group || !group->enabled || !placed) return 0;
    if (!collect_ctx.lod.state) return 0;
    const lod::LevelSet set = memberLevelSet(*group);
    auto& state = *collect_ctx.lod.state;
    const u32 view = collect_ctx.lod.view;
    u8 level = 0;
    if (collect_ctx.lod.follow) {
        if (!state.recent(view, g, 2, level)) level = 0;
        return level == lod::kCulled ? level : state.drawn(view, g, level, set.count);
    }
    if (state.recent(view, g, 0, level)) return level == lod::kCulled ? level : state.drawn(view, g, level, set.count);
    placed->ensureDecomposed();
    const glm::vec3 scale = placed->worldScale;
    const glm::vec3 centre = rebased(placed->worldPosition) + glm::mat3_cast(placed->worldRotation) * (member.boundsCentre * scale);
    const f32 radius = member.boundsRadius * std::max(std::abs(scale.x), std::max(std::abs(scale.y), std::abs(scale.z)));
    const f32 size = lod::screenRelativeSize(ctx.view_projection, centre, radius) * (ctx.frame ? ctx.frame->lodDistanceScale() : 1.0f);
    level = lod::selectLevel(set, size, state.lastLevel(view, g));
    state.remember(view, g, level, lod::selectLevel(set, size, 0), set.count, size);
    if (collect_ctx.lod.counts) collect_ctx.lod.counts->record(level);
    return level == lod::kCulled ? level : state.drawn(view, g, level, set.count);
}

/**
 * @brief The components whose presence keeps a draw from being kept (MeshPlugin::MeshProxy), one bit each: each turns, picks
 *        or poses the mesh per view or per frame. Read where the walk reads them.
 */
u8 ruledOut(ecs::Registry& registry, Entity entity) {
    return (registry.has<ecs::Billboard>(entity) ? 1u : 0u)
         | (registry.has<ecs::MeshInstances>(entity) ? 2u : 0u)
         | (registry.has<ecs::LODGroup>(entity) ? 4u : 0u)
         | (registry.has<ecs::Impostor>(entity) ? 8u : 0u)
         | (registry.has<ecs::MeshSkin>(entity) ? 16u : 0u)
         | (registry.has<ecs::MeshMorph>(entity) ? 32u : 0u)
         | (registry.has<ecs::LODMember>(entity) ? 64u : 0u);
}

/** @brief The latest tick any of ruledOut's components was written, added or removed at. */
u32 ruledOutChangedAt(const ecs::Registry& registry) {
    u32 latest = 0;
    for (const u32 t : {registry.lastChangedTick<ecs::Billboard>(), registry.lastChangedTick<ecs::MeshInstances>(),
                        registry.lastChangedTick<ecs::LODGroup>(), registry.lastChangedTick<ecs::Impostor>(),
                        registry.lastChangedTick<ecs::MeshSkin>(), registry.lastChangedTick<ecs::MeshMorph>(),
                        registry.lastChangedTick<ecs::LODMember>()}) {
        if (latest == 0 || (t != 0 && ecs::tickAfter(t, latest))) latest = t;
    }
    return latest;
}
}  // namespace

void MeshPlugin::scheduleSkins(RenderFrameContext& ctx, ecs::Registry& registry, SkinCache& cache) {
    // Every skinned mesh the cache is asked for: a mesh not drawn this frame costs one dispatch, which is cheaper than finding
    // which views will draw it.
    for (const Entity entity : registry.view<ecs::MeshRenderer, ecs::MeshSkin>()) {
        const auto& skin = registry.get<ecs::MeshSkin>(entity);
        const auto usage = static_cast<SkinCacheUsage>(std::clamp(skin.skinCache, 0, 2));
        if (!cache.wants(usage)) continue;
        const auto& renderer = registry.get<ecs::MeshRenderer>(entity);
        if (!renderer.enabled || !renderer.mesh.isValid()) continue;
        const Mesh* resident = ctx.resources.getMesh(renderer.mesh);
        if (!resident || !resident->isDrawable()) continue;
        // A mesh being reshaped by its morph targets is posed in the vertex stage, where the shapes are applied first.
        if (registry.has<ecs::MeshMorph>(entity) && resident->morphTexture != TextureHandle::Invalid) continue;
        const u32 joints = skinPose(registry, entity, *resident, pose_scratch_, warned_bones_);
        if (joints == 0) continue;
        cache.schedule(entity, *resident, pose_scratch_.data(), joints);
    }
}

void MeshPlugin::init(RenderFrameContext& ctx) {
    // A renderer initialized again runs this on a cache that compiled before. The
    // RESOURCES are released, not just forgotten: a shader nobody holds still
    // sits in the pool and keeps its program alive for good.
    for (auto& shader : mesh_shaders_) {
        if (shader.isValid()) ctx.resources.releaseShader(shader);
        shader = {};
    }
    // Only when something WAS ready: a first boot has no readiness to invalidate,
    // and an epoch that moves on it would age every stamp taken before the first
    // frame. What this call means is "what was ready is not any more".
    if (std::any_of(mesh_compiled_.begin(), mesh_compiled_.end(), [](bool c) { return c; })) {
        ctx.render_context.advanceProgramEpoch();
    }
    mesh_compiled_.fill(false);
    mesh_programs_.fill(0);
    // A renderer rebuilt has resources rebuilt under it: nothing derived before is kept.
    proxies_.clear();
    proxy_slot_.clear();
    ++proxy_epoch_;
    ++cast_serial_;
    // The base variant now, so a broken shader is a boot-time failure rather than
    // one that waits for the first mesh; the rest compile when a draw asks.
    meshProgram(ctx, 0);
}

/**
 * One permutation of the resident-mesh program, compiled on demand.
 *
 * A vertex layout may only declare attributes its shader consumes, so the
 * geometry's own channels pick half of it; the draw's `lit` picks the other half,
 * and unlit geometry carrying normals still has to declare them.
 */
u32 MeshPlugin::meshProgram(RenderFrameContext& ctx, u32 variant) {
    const bool normals = (variant & 1u) != 0, lit = (variant & 2u) != 0;
    const bool normalMapped = (variant & 4u) != 0, skinned = (variant & 8u) != 0;
    const bool depthOnly = (variant & 16u) != 0, envMapped = (variant & 32u) != 0;
    const bool lightmapped = (variant & 64u) != 0, weightHeat = (variant & 128u) != 0;
    const bool gbuffer = (variant & 256u) != 0, motion = (variant & 512u) != 0;
    const bool tangents = (variant & 1024u) != 0, direct = (variant & 2048u) != 0;
    if (mesh_compiled_[variant]) return mesh_programs_[variant];
    mesh_compiled_[variant] = true;
    // Counted because the cost of this function is entirely the times it does
    // NOT return above: every frame asks once per mesh, and only the first frame
    // that needs a variant pays for it. WHICH one is the other half — a readiness
    // that missed a requirement is named by the key that had to be built late.
    ++compiled_this_frame_;
    ++programs_built_;
    last_compiled_variant_ = variant;

    std::vector<std::string> features;
    if (normals) features.emplace_back("MESH_NORMALS");
    if (lit) features.emplace_back("LIT");
    if (normalMapped) features.emplace_back("NORMAL_MAP");
    if (skinned) features.emplace_back("SKINNED");
    if (lightmapped) features.emplace_back("MESH_LIGHTMAP");
    // Only where its vertex stage writes the tangent varying (lit, and not a depth pass): a fragment that declares one it lacks fails to link.
    if (tangents && normals && lit && !depthOnly) features.emplace_back("MESH_TANGENTS");
    if (weightHeat) features.emplace_back("WEIGHT_HEAT");
    if (depthOnly) features.emplace_back("SHADOW_DEPTH");
    if (motion) features.emplace_back("ES_VELOCITY");
    // Resident geometry owns its texture slots, so it is the vertex source that can
    // carry a shadow map and a reflection — the batch stream's are a per-vertex
    // merge product, and a sampler pinned there would read someone's sprite.
    else if (lit) {
        features.emplace_back("ES_RECEIVE_SHADOW");
        if (envMapped) features.emplace_back("ES_ENV_MAP");
        // Resident geometry's world position is the real one whether or not it
        // carries normals: two separate facts, and reading a light's distance in
        // the plane on a surface that HAS depth is the 2D convention misapplied.
        features.emplace_back("ES_SURFACE_3D");
    }
    // After the receiving features, not between them and the `else` they hang from: a lit draw that writes the
    // surface record still receives shadows and reflections.
    if (gbuffer) features.emplace_back("ES_GBUFFER");
    if (direct) features.emplace_back("ES_LIGHT_DIRECT");

    // Authored as mesh.esshader, WGSL twin included. Its vertex stage is the one
    // that reads a model matrix, which is what lets the vertices stay local.
    const auto target = ctx.resources.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::MESH);
    auto compile = [&](std::vector<std::string> features) -> u32 {
        const bool normalMapped = std::find(features.begin(), features.end(), "NORMAL_MAP")
                                != features.end();
        resource::ShaderHandle& handle = mesh_shaders_[variant];
        handle = ctx.resources.createShaderWithBindings(
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features, target),
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features, target),
            {}, ctx.resources.preferredShaderLanguage(), ctx.resources.deferLinks() && !compile_in_place_);
        Shader* shader = ctx.resources.getShader(handle);
        if (!shader || !shader->isValid()) return 0;
        if (shader->language() == GfxShaderLanguage::GLSL_ES300) {
            // After it links: at once, or (where shaders are not waited for) when a draw first needs it.
            shader->whenLinked([normalMapped](Shader& s) {
                s.bind();
                // A depth-only variant has no colour texture to seed.
                if (s.hasUniform("u_texture")) s.setUniform("u_texture", 0);
                // Slot 1 is where a draw's own second texture is bound (see pushBatchDraw).
                if (normalMapped) s.setUniform("u_normalMap", 1);
                s.unbind();
            });
        }
        return shader->getProgramId();
    };
    mesh_programs_[variant] = compile(features);
    // Said to the store the draw list asks, so the pipeline of a draw on this program declares the second output.
    if (gbuffer && mesh_programs_[variant] != 0 && ctx.materials) ctx.materials->markGBufferProgram(mesh_programs_[variant], /*albedo=*/true);
    return mesh_programs_[variant];
}

u32 MeshPlugin::previewProgram(RenderFrameContext& ctx, u32 variant) {
    // What the vertex source and the pass's outputs need, and nothing that shades: normals (1), skinning (8), the bake (64)
    // and the surface record (256) stay; lighting (2), normal maps (4), reflections (32), tangents (1024) and direct light
    // (2048) go. A depth or motion variant is never previewed.
    const u32 preview = variant & (1u | 8u | 64u | 256u);
    if (mesh_compiled_[preview]) return mesh_programs_[preview];
    compile_in_place_ = true;
    const u32 program = meshProgram(ctx, preview);
    compile_in_place_ = false;
    return program;
}

RenderPrewarmResult MeshPlugin::prewarmFacts(RenderFrameContext& ctx,
                                             const MeshProgramFacts* facts, u32 count,
                                             bool shadowPasses, bool residentGeometry) {
    RenderPrewarmResult out;
    const u32 materialsBefore = ctx.materials ? ctx.materials->builtVariantCount() : 0;
    const bool envMapped = ctx.environment_texture_id != 0;
    for (u32 i = 0; i < count; ++i) {
        // Both purposes when the scene draws depth too: the same renderable is
        // asked for twice with different keys, and readying only the camera's
        // leaves the first shadow map to pay for the other.
        for (u32 pass = 0; pass < 2; ++pass) {
            const bool shadowDepth = pass == 1;
            if (shadowDepth && (!shadowPasses || !residentGeometry)) continue;
            const u32 variant = meshVariantFrom(facts[i], envMapped, shadowDepth, ctx.lighting_direct);
            ++out.asks;
            if (out.addKey(variant)) ++out.uniqueKeys;
            if (!mesh_compiled_[variant]) ++out.compiles;
            meshProgram(ctx, variant);
        }
        // The second lazily-compiled path. A fixture without materials would let
        // readiness look complete while a material-shaded world still hitched.
        if (facts[i].materialId != 0 && ctx.materials) {
            ++out.materialAsks;
            out.addMaterialKey(RenderPrewarmResult::materialKey(
                facts[i].materialId, facts[i].hasNormals, facts[i].skinned, envMapped,
                facts[i].lightmapped, facts[i].tangents));
            ctx.materials->meshProgram(facts[i].materialId, ctx.resources, facts[i].hasNormals,
                                       facts[i].skinned, envMapped, facts[i].lightmapped, false, facts[i].tangents,
                                       false, facts[i].opaque);
        }
    }
    if (ctx.materials) {
        out.materialCompiles = ctx.materials->builtVariantCount() - materialsBefore;
    }
    compiled_this_frame_ = 0;
    return out;
}

RenderPrewarmResult MeshPlugin::prewarmDocument(RenderFrameContext& ctx,
                                                const MeshDocumentRecord* rows, u32 count,
                                                bool shadowPasses) {
    std::vector<MeshProgramFacts> facts;
    facts.reserve(count);
    bool anyResident = false;
    for (u32 i = 0; i < count; ++i) {
        if (rows[i].meshHandle == 0) continue;
        anyResident = anyResident
                   || ctx.resources.getMesh(resource::MeshHandle(rows[i].meshHandle)) != nullptr;
        facts.push_back(meshFactsFromDocument(ctx, rows[i], warned_bones_));
    }
    return prewarmFacts(ctx, facts.data(), static_cast<u32>(facts.size()), shadowPasses,
                        anyResident);
}

RenderPrewarmResult MeshPlugin::prewarm(RenderFrameContext& ctx, ecs::Registry& registry,
                                        const Entity* entities, u32 count, bool shadowPasses) {
    std::vector<MeshProgramFacts> facts;
    facts.reserve(count);
    bool anyResident = false;
    for (u32 i = 0; i < count; ++i) {
        const Entity entity = entities[i];
        const auto* mesh = registry.tryGet<ecs::MeshRenderer>(entity);
        if (!mesh || !mesh->enabled) continue;
        if (mesh->indices.empty() && !mesh->mesh.isValid()) continue;
        const Mesh* resident = mesh->mesh.isValid() ? ctx.resources.getMesh(mesh->mesh) : nullptr;
        anyResident = anyResident || resident != nullptr;
        facts.push_back(
            meshFactsFromEntity(ctx, registry, entity, *mesh, resident, warned_bones_));
    }
    return prewarmFacts(ctx, facts.data(), static_cast<u32>(facts.size()), shadowPasses,
                        anyResident);
}

MeshPlugin::Pose* MeshPlugin::poseOf(const RenderFrameContext& ctx, Entity entity, MeshProxy* kept, bool make) {
    const u64 key = poseKey(ctx, entity);
    if (kept && kept->pose && kept->poseKey == key && kept->poseGeneration == pose_generation_) return kept->pose;
    Pose* pose = nullptr;
    if (make) {
        pose = &poses_[key];
    } else {
        const auto found = poses_.find(key);
        if (found != poses_.end()) pose = &found->second;
    }
    if (kept && pose) {
        kept->pose = pose;
        kept->poseKey = key;
        kept->poseGeneration = pose_generation_;
    }
    return pose;
}

void MeshPlugin::trackPose(Pose& pose, const RenderFrameContext& ctx, const glm::mat4& model,
                           const std::vector<glm::mat4>* bones) {
    // Last frame's, when the view drew this mesh last frame; otherwise it has no past worth following, and
    // standing where it stands says "did not move".
    const bool continued = pose.frame != 0 && pose.frame + 1 == ctx.motion_frame;
    if (continued) {
        // Where it was drawn from the origin of the frame before, as it is placed from the origin now.
        pose.previous = modelFromOrigin(pose.current, pose.origin);
        pose.bonesPrevious = pose.bonesCurrent;
        for (glm::mat4& bone : pose.bonesPrevious) bone = modelFromOrigin(bone, pose.origin);
    } else if (pose.frame != ctx.motion_frame) {
        pose.previous = model;
        if (bones) pose.bonesPrevious = *bones;
        else pose.bonesPrevious.clear();
    }
    pose.current = model;
    if (bones) pose.bonesCurrent = *bones;
    else pose.bonesCurrent.clear();
    pose.frame = ctx.motion_frame;
    pose.origin = renderOrigin();
}

void MeshPlugin::addMover(Entity entity) {
    const u32 index = entity.index();
    if (index >= mover_at_.size()) mover_at_.resize(static_cast<usize>(index) + 1, 0);
    movers_.push_back(entity);
    mover_at_[index] = static_cast<u32>(movers_.size());
}

void MeshPlugin::clearMovers() {
    for (const Entity e : movers_) mover_at_[e.index()] = 0;
    movers_.clear();
}

bool MeshPlugin::dropStillMovers() {
    constexpr u32 kStillLooks = 240;
    bool dropped = false;
    for (usize i = 0; i < movers_.size();) {
        const Entity e = movers_[i];
        const u32 index = e.index();
        const u64 seen = index < cast_changed_at_.size() ? cast_changed_at_[index] : 0;
        const bool same = static_cast<u32>(seen >> 32) == e.id();
        if (same && cast_look_ - static_cast<u32>(seen) < kStillLooks) { ++i; continue; }
        mover_at_[index] = 0;
        movers_[i] = movers_.back();
        movers_.pop_back();
        if (i < movers_.size()) mover_at_[movers_[i].index()] = static_cast<u32>(i + 1);
        dropped = true;
    }
    return dropped;
}

bool MeshPlugin::castHeldInputs(u64& key) const {
    key = cast_held_key_;
    return cast_held_vouched_;
}

bool MeshPlugin::castInputs(RenderFrameContext& ctx, ecs::Registry& registry, u64& key) {
    const u32 now = registry.beginChangeRead();
    if (++cast_look_ == 0) cast_look_ = 1;
    u32 why = 0;
    bool heldMoved = false;
    if (registry.entitySetId() != cast_registry_) {
        why |= 1u;
        clearMovers();
        cast_changed_at_.clear();
    }
    if (registry.activityEpoch() != cast_activity_) why |= 2u;
    if (why == 0) {
        const u32 since = cast_tick_;
        if (registry.anyChangedSince<ecs::MeshRenderer>(since)) why |= 4u;
        if (registry.anyChangedSince<ecs::MeshSkin>(since) || registry.anyChangedSince<ecs::MeshMorph>(since)) why |= 8u;
        if (registry.anyChangedSince<ecs::MeshInstances>(since) || registry.anyChangedSince<ecs::LODGroup>(since)
            || registry.anyChangedSince<ecs::Billboard>(since) || registry.anyChangedSince<ecs::Impostor>(since)
            || registry.anyChangedSince<ecs::MeshLightmap>(since) || registry.anyChangedSince<ecs::LODMember>(since)) {
            why |= 16u;
        }
        if (why == 0 && registry.countOf<ecs::MeshSkin>() > 0) {
            if (registry.anyChangedSince<ecs::Transform>(since)) why |= 32u;
        } else if (why == 0) {
            constexpr u32 kRecentLooks = 8;
            registry.anyChangedSinceWhere<ecs::Transform>(since, [&](Entity e) {
                if (!registry.has<ecs::MeshRenderer>(e)) return false;
                why |= 64u;
                const u32 index = e.index();
                if (index >= cast_changed_at_.size()) cast_changed_at_.resize(static_cast<usize>(index) + 1, 0);
                const u64 seen = cast_changed_at_[index];
                const bool recent = static_cast<u32>(seen >> 32) == e.id() && cast_look_ - static_cast<u32>(seen) <= kRecentLooks;
                cast_changed_at_[index] = (static_cast<u64>(e.id()) << 32) | cast_look_;
                if (isMover(e)) return false;
                heldMoved = true;
                if (recent) addMover(e);
                return false;
            });
        }
    }
    if ((why & 63u) || heldMoved) ++cast_held_serial_;
    if (!movers_.empty() && cast_look_ % 60 == 0 && dropStillMovers()) ++cast_held_serial_;
    if (registry.countOf<ecs::LODGroup>() > 0 || registry.countOf<ecs::LODMember>() > 0) why |= 128u;
    ES_PROFILE_COUNTER("render.mesh.castChanged", why);
    ES_PROFILE_COUNTER("render.mesh.castMovers", static_cast<u32>(movers_.size()));
    if (why & 127u) ++cast_serial_;
    cast_registry_ = registry.entitySetId();
    cast_activity_ = registry.activityEpoch();
    cast_tick_ = now;
    cast_held_vouched_ = false;
    if (registry.countOf<ecs::LODGroup>() > 0 || registry.countOf<ecs::LODMember>() > 0) return false;

    u64 h = hash::kFnv64Offset;
    const auto mix = [&h](u64 v) { h = hash::combine(h, v); };
    mix(registry.entitySetId());
    mix(ctx.materials ? ctx.materials->revision() : 0);
    mix(ctx.materials ? ctx.materials->builtVariantCount() : 0);
    mix(ctx.resources.meshesRevision());
    mix(programs_built_);
    mix(ctx.render_context.programEpoch());
    mix(ctx.environment_texture_id != 0 ? 1u : 0u);
    mix(ctx.batch_shader_id);
    mix(ctx.white_texture_id);
    const glm::dvec3 origin = renderOrigin();
    u64 bits[3];
    std::memcpy(bits, &origin, sizeof(bits));
    mix(bits[0]); mix(bits[1]); mix(bits[2]);
    u32 eye[3];
    std::memcpy(eye, &ctx.view_eye, sizeof(eye));
    mix(ctx.has_view_eye ? (static_cast<u64>(eye[0]) << 32 | eye[1]) ^ (static_cast<u64>(eye[2]) << 16) : 0u);
    key = hash::combine(h, cast_serial_);
    cast_held_key_ = hash::combine(hash::combine(h, 0x48454c44ull), cast_held_serial_);
    cast_held_vouched_ = true;
    return true;
}

void MeshPlugin::deriveProxy(RenderCollectContext& collect, MeshProxy& proxy, Entity entity, const ecs::MeshRenderer& mesh,
                             ecs::Transform& transform, u8 present, u32 now) {
    auto& ctx = collect.frame_context;
    proxy = MeshProxy{};
    proxy.entity = entity;
    proxy.builtAt = now;
    proxy.presentAt = now;
    proxy.epoch = proxy_epoch_;
    proxy.present = present;
    proxy.resident = mesh.mesh.isValid() ? ctx.resources.getMesh(mesh.mesh) : nullptr;
    proxy.meshRevision = proxy.resident ? proxy.resident->revision : 0;
    proxy.materialStore = ctx.materials ? ctx.materials->revision() : 0;
    proxy.material = mesh.material != 0 && ctx.materials ? ctx.materials->find(mesh.material) : nullptr;
    proxy.materialRevision = proxy.material ? proxy.material->revision : 0;
    const ecs::MeshInstances* set = present == 2u ? collect.registry.tryGet<ecs::MeshInstances>(entity) : nullptr;
    proxy.kept = (present == 0 || set != nullptr) && proxy.resident != nullptr && mesh.parallax == glm::vec2(1.0f);
    if (!proxy.kept) return;
    transform.ensureDecomposed();
    proxy.position = rebased(transform.worldPosition);
    proxy.rotation = transform.worldRotation;
    proxy.scale = transform.worldScale;
    proxy.bend = proxy.material ? ctx.materials->vertexBounds(mesh.material) : 0.0f;
    proxy.depthTested = mesh.opaque || (proxy.material && proxy.material->depthTest);
    proxy.model = glm::translate(glm::mat4(1.0f), proxy.position) * glm::mat4_cast(proxy.rotation)
                * glm::scale(glm::mat4(1.0f), proxy.scale);
    proxy.normalRows = glm::transpose(glm::inverse(glm::mat3(proxy.model)));
    proxy.facts = meshFactsFromEntity(ctx, collect.registry, entity, mesh, proxy.resident, warned_bones_);
    proxy.facts.normalTextureId = 0;
    if (!set) {
        const glm::vec3 padding(proxy.bend);
        orientedWorldAabb(proxy.position, proxy.rotation, proxy.scale, proxy.resident->localMin - padding,
                          proxy.resident->localMax + padding, proxy.boxCentre, proxy.boxHalf);
        return;
    }
    proxy.placed = true;
    proxy.coarse = placementCoarseMesh(ctx.resources, *proxy.resident, *set);
    proxy.coarseRevision = proxy.coarse ? proxy.coarse->revision : 0;
    glm::vec3 lo, hi;
    meshLocalBounds(*proxy.resident, proxy.coarse, proxy.bend, lo, hi);
    const f32 placementRadius = placement_bounds::radius(lo, hi, 0.0f);
    const glm::vec3 localCentre = (lo + hi) * 0.5f;
    const glm::vec3 localHalf = (hi - lo) * 0.5f;
    const glm::vec3 reach(placementRadius * set->maxScale);
    orientedWorldAabb(proxy.position, proxy.rotation, proxy.scale, set->originMin - reach, set->originMax + reach,
                      proxy.boxCentre, proxy.boxHalf);
    const glm::mat4& entityModel = proxy.model;
    const glm::mat3 entityLinear(entityModel);
    const u32 count = static_cast<u32>(set->transforms.size() / 16);
    proxy.instances.resize(count);
    proxy.records.assign(static_cast<usize>(count) * MESH_INSTANCE_STRIDE, 0);
    for (u32 i = 0; i < count; ++i) {
        const f32* r = set->transforms.data() + static_cast<usize>(i) * 16;
        PlacedInstance& inst = proxy.instances[i];
        inst.at = glm::vec3(entityModel * glm::vec4(r[3], r[7], r[11], 1.0f));
        placement_bounds::transformedBox(entityLinear, r, inst.at, localCentre, localHalf, inst.centre, inst.half);
        inst.radius = glm::length(inst.half);
        inst.grow = std::sqrt(std::max({r[0] * r[0] + r[4] * r[4] + r[8] * r[8], r[1] * r[1] + r[5] * r[5] + r[9] * r[9],
                                        r[2] * r[2] + r[6] * r[6] + r[10] * r[10]}));
        u8* dst = proxy.records.data() + static_cast<usize>(i) * MESH_INSTANCE_STRIDE;
        glm::mat4 placed(1.0f);
        placed[0] = {r[0], r[4], r[8], 0.0f};
        placed[1] = {r[1], r[5], r[9], 0.0f};
        placed[2] = {r[2], r[6], r[10], 0.0f};
        placed[3] = {r[3], r[7], r[11], 1.0f};
        const glm::mat4 model = entityModel * placed;
        for (u32 row = 0; row < 3; ++row) {
            const glm::vec4 m{model[0][row], model[1][row], model[2][row], model[3][row]};
            std::memcpy(dst + (MESH_INSTANCE_TEXEL_MODEL + row) * 16, &m, 16);
        }
        const glm::vec4 tint = mesh.color * glm::vec4(r[12], r[13], r[14], r[15]);
        std::memcpy(dst + MESH_INSTANCE_TEXEL_TINT * 16, &tint, 16);
        if (proxy.resident->hasNormals) {
            const glm::mat3 nrm = glm::transpose(glm::inverse(glm::mat3(model)));
            for (u32 row = 0; row < 3; ++row) std::memcpy(dst + (MESH_INSTANCE_TEXEL_NORMAL + row) * 16, &nrm[row][0], 12);
        }
    }
}

MeshPlugin::MeshProxy* MeshPlugin::retain(RenderCollectContext& collect, Entity entity, const ecs::MeshRenderer& mesh,
                                                 ecs::Transform& transform, u32 now, u32 rulesChangedAt) {
    auto& registry = collect.registry;
    auto& ctx = collect.frame_context;
    const u32 index = entity.index();
    if (index >= proxy_slot_.size()) proxy_slot_.resize(static_cast<usize>(index) + 1, ~0u);
    u32& slot = proxy_slot_[index];
    if (slot == ~0u) {
        slot = static_cast<u32>(proxies_.size());
        proxies_.emplace_back();
    }
    MeshProxy& proxy = proxies_[slot];

    const Mesh* resident = mesh.mesh.isValid() ? ctx.resources.getMesh(mesh.mesh) : nullptr;
    bool stale = proxy.entity != entity || proxy.epoch != proxy_epoch_
              || resident != proxy.resident || (resident && resident->revision != proxy.meshRevision)
              || registry.changedSince<ecs::Transform>(entity, proxy.builtAt)
              || registry.changedSince<ecs::MeshRenderer>(entity, proxy.builtAt)
              || (proxy.placed && registry.changedSince<ecs::MeshInstances>(entity, proxy.builtAt));
    if (!stale && proxy.placed) {
        const auto* set = registry.tryGet<ecs::MeshInstances>(entity);
        const Mesh* coarse = set ? placementCoarseMesh(ctx.resources, *resident, *set) : nullptr;
        stale = !set || coarse != proxy.coarse || (coarse && coarse->revision != proxy.coarseRevision);
    }
    const u64 store = ctx.materials ? ctx.materials->revision() : 0;
    if (!stale && store != proxy.materialStore) {
        const MaterialRecord* material = mesh.material != 0 && ctx.materials ? ctx.materials->find(mesh.material) : nullptr;
        stale = material != proxy.material || (material && material->revision != proxy.materialRevision);
        if (!stale) proxy.materialStore = store;
    }
    // A component that rules keeping out was added or removed somewhere since this one looked: is it this entity's?
    u8 present = proxy.present;
    bool looked = false;
    if (!stale && rulesChangedAt != 0 && ecs::tickAfter(rulesChangedAt, proxy.presentAt)) {
        present = ruledOut(registry, entity);
        looked = true;
        stale = present != proxy.present;
        proxy.presentAt = now;
    }
    if (stale) {
        deriveProxy(collect, proxy, entity, mesh, transform, looked ? present : ruledOut(registry, entity), now);
        ++proxies_built_;
    } else if (proxy.kept) {
        ++proxies_kept_;
        // With the change audit on, what is kept is checked against what the components derive now: a difference is a write
        // that nothing stamped, and a draw that stands where the entity no longer does.
        if (registry.changeAuditEnabled()) {
            MeshProxy fresh;
            deriveProxy(collect, fresh, entity, mesh, transform, ruledOut(registry, entity), now);
            // By bits: a mesh scaled to nothing has a normal matrix of NaN, which equals nothing, itself included, though
            // the same inputs give the same bits.
            const auto bits = [](const auto& a, const auto& b) { return std::memcmp(&a, &b, sizeof(a)) == 0; };
            const bool same = fresh.kept && fresh.resident == proxy.resident && fresh.material == proxy.material
                && bits(fresh.position, proxy.position) && bits(fresh.rotation, proxy.rotation) && bits(fresh.scale, proxy.scale)
                && bits(fresh.boxCentre, proxy.boxCentre) && bits(fresh.boxHalf, proxy.boxHalf) && bits(fresh.model, proxy.model)
                && bits(fresh.normalRows, proxy.normalRows) && bits(fresh.bend, proxy.bend) && fresh.depthTested == proxy.depthTested
                && fresh.facts.hasNormals == proxy.facts.hasNormals && fresh.facts.lit == proxy.facts.lit
                && fresh.facts.skinned == proxy.facts.skinned && fresh.facts.lightmapped == proxy.facts.lightmapped
                && fresh.facts.tangents == proxy.facts.tangents && fresh.facts.opaque == proxy.facts.opaque
                && fresh.facts.materialId == proxy.facts.materialId
                && fresh.placed == proxy.placed && fresh.coarse == proxy.coarse && fresh.records == proxy.records
                && fresh.instances.size() == proxy.instances.size()
                && (fresh.instances.empty()
                    || std::memcmp(fresh.instances.data(), proxy.instances.data(), fresh.instances.size() * sizeof(PlacedInstance)) == 0);
            if (!same) {
                ++proxies_stale_total_;
                if (!warned_stale_) {
                    warned_stale_ = true;
                    ES_LOG_WARN("change audit: a kept mesh draw (entity {}) is not what its components derive now - something it"
                                " is derived from changed without a stamp or a revision", entity.index());
                }
                proxy = fresh;
            }
        }
    }
    return proxy.kept ? &proxy : nullptr;
}

namespace {
/**
 * @brief The card an impostor draws: the picture taken nearest this view's direction to the object, on a square facing that way.
 *
 * @details The card is turned as its picture was taken, in the object's own space: from the frame's direction, with that picture's
 *          up. A view between two frames sees the card a few degrees off square, which is the price of not blending two pictures.
 *          Every impostor sharing an atlas shares this key but for its depth, so a crowd of them merges into a few draws.
 */
void emitImpostorCard(RenderCollectContext& collect, const RenderFrame::ImpostorAtlas& atlas, const ecs::MeshRenderer& mesh,
                      Entity entity, const glm::vec3& centre, f32 radius, const glm::quat& rotation) {
    const glm::vec4 eye = collect.camera.eye;
    glm::vec3 toward = eye.w > 0.5f ? glm::vec3(eye) - centre : glm::vec3(eye);
    if (glm::dot(toward, toward) < 1e-12f) return;
    const glm::vec3 local = glm::inverse(rotation) * glm::normalize(toward);
    const glm::uvec2 frame = impostor::nearestFrame(local, atlas.frames);
    const glm::vec3 d = impostor::frameDirection(frame.x, frame.y, atlas.frames);
    const glm::vec3 upLocal = impostor::pictureUp(d);
    const glm::vec3 up = rotation * upLocal * radius;
    const glm::vec3 right = rotation * glm::cross(upLocal, d) * radius;
    const f32 n = static_cast<f32>(atlas.frames);
    const f32 u0 = static_cast<f32>(frame.x) / n, u1 = static_cast<f32>(frame.x + 1u) / n;
    const f32 v0 = static_cast<f32>(frame.y) / n, v1 = static_cast<f32>(frame.y + 1u) / n;
    const BatchVertex quad[4] = {
        {centre - right - up, 0xFFFFFFFFu, {u0, v0}},
        {centre + right - up, 0xFFFFFFFFu, {u1, v0}},
        {centre + right + up, 0xFFFFFFFFu, {u1, v1}},
        {centre - right + up, 0xFFFFFFFFu, {u0, v1}},
    };
    // Blended over what is behind it, the picture's empty corners being transparent, and depth-tested so a nearer wall hides it.
    BatchDrawKey key{
        .stage = RenderStage::Transparent,
        .layer = mesh.layer,
        .shaderId = collect.frame_context.batch_shader_id,
        .blend = BlendMode::Normal,
        .textureId = atlas.texture,
        .depth = collect.camera.viewDepth(centre),
        .y = centre.y,
        .entity = entity,
        .type = RenderType::Mesh,
    };
    key.depthTest = true;
    key.depthWrite = false;
    appendQuad(collect.buffer_pool, collect.draw_list, collect.clip_state, quad, key);
}

/**
 * @brief Writes the placements of a MeshInstances as instances of one draw per level of detail.
 *
 * @details Each placement is judged on its own: past `drawDistance` from the eye it is not drawn, outside the view it is not drawn, and
 *          past `lodDistance` it is the cheaper mesh. The eye is the SCENE camera's whatever pass this is, so a shadow map is cut
 *          by the distance from the camera and not from the light. What stays is a record each (the entity's model times the
 *          placement, its tint, its normal matrix) and one draw a level.
 */
/**
 * @brief How close the nearest drawn placement of a MeshInstances came, as its size over its distance.
 *
 * @details What the texture streamer needs to know of a set of placements is the one that asks the most texture: the
 *          largest of (how big it is) / (how far the nearest point of it is), over the placements a view drew, kept
 *          apart for the two meshes since each holds its own texture density. Zero where none was drawn or no eye is known.
 */
struct PlacementReach {
    f32 fine = 0.0f;
    f32 coarse = 0.0f;
};

/** @brief A side no texture reaches: what a surface asks for when it cannot say how much it needs. */
constexpr f32 kWholeTexture = 1.0e9f;

/**
 * @brief The texels across a texture needs where a surface of `uvDensity` is seen at `sizeOverDistance`: a texel about a pixel.
 *
 * @details One sum for a single mesh and for each set of placements, so the two can never disagree about what a view needs.
 *          NDC y per world unit is the length of the view-projection's second row under both projections; half the view's
 *          pixels span one unit of NDC.
 */
f32 textureSideFor(const RenderFrameContext& ctx, f32 sizeOverDistance, f32 uvDensity) {
    if (!(sizeOverDistance > 0.0f) || !ctx.frame) return 0.0f;
    // Drawn, but with no density to say how much of a texture it holds: it asks for the whole file. Asking for nothing left a
    // texture that started small at its start size for as long as it was on screen.
    if (!(uvDensity > 0.0f)) return kWholeTexture;
    const glm::mat4& vp = ctx.view_projection;
    const f32 ndcPerUnit = glm::length(glm::vec3(vp[0][1], vp[1][1], vp[2][1]));
    return ndcPerUnit * 0.5f * ctx.frame->viewHeightPx() * sizeOverDistance / uvDensity;
}

/** @brief Ask for a side for every texture `mesh` draws with: its own, its normal map and its material's. */
void wantTexturesOf(const RenderFrameContext& ctx, const ecs::MeshRenderer& mesh, const MaterialRecord* material, f32 side) {
    if (!(side > 0.0f) || !ctx.frame) return;
    if (mesh.texture.isValid()) ctx.frame->wantTextureSide(mesh.texture.id(), side);
    if (mesh.normalMap.isValid()) ctx.frame->wantTextureSide(mesh.normalMap.id(), side);
    if (material) for (const auto& b : material->textures) if (b.texture.isValid()) ctx.frame->wantTextureSide(b.texture.id(), side);
}

template <typename Emit>
void emitPlacements(const RenderFrameContext& ctx, RenderCollectContext& collect, const ecs::MeshInstances& set,
                    const ecs::MeshRenderer& mesh, const glm::vec3& position, const glm::quat& rotation,
                    const glm::vec3& scale, const Mesh& fine, const Mesh* coarse,
                    const glm::vec3& localCentre, const glm::vec3& localHalf, u32& records, PlacementReach& reach,
                    Emit&& emit) {
    static thread_local std::vector<u32> nearList, farList;
    nearList.clear();
    farList.clear();
    const glm::mat4 entityModel = glm::translate(glm::mat4(1.0f), position) * glm::mat4_cast(rotation) * glm::scale(glm::mat4(1.0f), scale);
    const glm::mat3 entityLinear(entityModel);
    const bool eyeKnown = ctx.has_view_eye;
    const u32 count = static_cast<u32>(set.transforms.size() / 16);
    u32 tooFar = 0, outside = 0;
    // Only a scene view's pixels say how much texture is needed; a shadow map's texels are nobody's.
    const bool measuring = eyeKnown && ctx.purpose == RenderPurpose::Scene;
    const f32 entityGrow = std::max({std::abs(scale.x), std::abs(scale.y), std::abs(scale.z)});
    reach = {};
    for (u32 i = 0; i < count; ++i) {
        const f32* r = set.transforms.data() + static_cast<usize>(i) * 16;
        const glm::vec3 at = glm::vec3(entityModel * glm::vec4(r[3], r[7], r[11], 1.0f));
        glm::vec3 centre, half;
        placement_bounds::transformedBox(entityLinear, r, at, localCentre, localHalf, centre, half);
        const f32 radius = glm::length(half);
        f32 distance = 0.0f;
        if (eyeKnown) {
            distance = glm::distance(at, ctx.view_eye);
            const f32 centreDistance = glm::distance(centre, ctx.view_eye);
            if (set.drawDistance > 0.0f && centreDistance - radius > set.drawDistance) { ++tooFar; continue; }
            if (centreDistance + radius < set.minDistance) continue;
            if (ctx.purpose == RenderPurpose::ShadowDepth && set.shadowDistance > 0.0f && centreDistance - radius > set.shadowDistance) continue;
        }
        if (!collect.visible(centre, half, false)) { ++outside; continue; }
        if (ctx.purpose == RenderPurpose::ShadowDepth && !collect.castsIntoView(centre, radius)) { ++outside; continue; }
        const bool far = coarse && eyeKnown && set.lodDistance > 0.0f && distance > set.lodDistance;
        (far ? farList : nearList).push_back(i);
        if (measuring) {
            // The placement's own scale is the longest column of its 3x3, read as the record is written below.
            const f32 placedGrow = std::sqrt(std::max({r[0] * r[0] + r[4] * r[4] + r[8] * r[8],
                                                       r[1] * r[1] + r[5] * r[5] + r[9] * r[9],
                                                       r[2] * r[2] + r[6] * r[6] + r[10] * r[10]}));
            const f32 gap = std::max(glm::distance(centre, ctx.view_eye) - radius, 1e-3f);
            f32& best = far ? reach.coarse : reach.fine;
            best = std::max(best, entityGrow * placedGrow / gap);
        }
    }
    ES_PROFILE_COUNTER("render.placements.seen", count);
    ES_PROFILE_COUNTER("render.placements.tooFar", tooFar);
    ES_PROFILE_COUNTER("render.placements.outside", outside);
    ES_PROFILE_COUNTER("render.placements.coarse", farList.size());
    ES_PROFILE_COUNTER("render.placements.eye", eyeKnown ? 1 : 0);
    // The frame's record texture holds so many; past it the tail would draw unplaced, which is worse than not at all.
    const u32 room = records < MESH_INSTANCE_MAX_RECORDS ? MESH_INSTANCE_MAX_RECORDS - records : 0;
    if (nearList.size() > room) nearList.resize(room);
    if (farList.size() > room - nearList.size()) farList.resize(room - nearList.size());
    records += static_cast<u32>(nearList.size() + farList.size());

    auto& buffers = collect.buffer_pool;
    const auto write = [&](const std::vector<u32>& list, const Mesh& geo) {
        if (list.empty()) return;
        const u32 offset = buffers.allocVertices(LayoutId::MeshInstance, MESH_INSTANCE_STRIDE * static_cast<u32>(list.size()));
        auto* dst = buffers.vertexData(LayoutId::MeshInstance) + offset;
        std::memset(dst, 0, static_cast<usize>(MESH_INSTANCE_STRIDE) * list.size());
        for (const u32 i : list) {
            const f32* r = set.transforms.data() + static_cast<usize>(i) * 16;
            glm::mat4 placed(1.0f);
            placed[0] = {r[0], r[4], r[8], 0.0f};
            placed[1] = {r[1], r[5], r[9], 0.0f};
            placed[2] = {r[2], r[6], r[10], 0.0f};
            placed[3] = {r[3], r[7], r[11], 1.0f};
            const glm::mat4 model = entityModel * placed;
            for (u32 row = 0; row < 3; ++row) {
                const glm::vec4 m{model[0][row], model[1][row], model[2][row], model[3][row]};
                std::memcpy(dst + (MESH_INSTANCE_TEXEL_MODEL + row) * 16, &m, 16);
            }
            const glm::vec4 tint = mesh.color * glm::vec4(r[12], r[13], r[14], r[15]);
            std::memcpy(dst + MESH_INSTANCE_TEXEL_TINT * 16, &tint, 16);
            if (geo.hasNormals) {
                const glm::mat3 nrm = glm::transpose(glm::inverse(glm::mat3(model)));
                for (u32 row = 0; row < 3; ++row) std::memcpy(dst + (MESH_INSTANCE_TEXEL_NORMAL + row) * 16, &nrm[row][0], 12);
            }
            dst += MESH_INSTANCE_STRIDE;
        }
        emit(geo, offset, static_cast<u32>(list.size()));
    };
    write(nearList, fine);
    if (coarse) write(farList, *coarse);
}

template <typename Instance, typename Emit>
void emitKeptPlacements(const RenderFrameContext& ctx, RenderCollectContext& collect, const ecs::MeshInstances& set,
                        const std::vector<Instance>& instances, const std::vector<u8>& cached, const glm::vec3& scale,
                        const Mesh& fine, const Mesh* coarse, u32& records, PlacementReach& reach, Emit&& emit) {
    static thread_local std::vector<u32> nearList, farList;
    nearList.clear();
    farList.clear();
    const bool eyeKnown = ctx.has_view_eye;
    const u32 count = static_cast<u32>(instances.size());
    u32 tooFar = 0, outside = 0;
    const bool measuring = eyeKnown && ctx.purpose == RenderPurpose::Scene;
    const f32 entityGrow = std::max({std::abs(scale.x), std::abs(scale.y), std::abs(scale.z)});
    reach = {};
    for (u32 i = 0; i < count; ++i) {
        const Instance& inst = instances[i];
        f32 distance = 0.0f;
        if (eyeKnown) {
            distance = glm::distance(inst.at, ctx.view_eye);
            const f32 centreDistance = glm::distance(inst.centre, ctx.view_eye);
            if (set.drawDistance > 0.0f && centreDistance - inst.radius > set.drawDistance) { ++tooFar; continue; }
            if (centreDistance + inst.radius < set.minDistance) continue;
            if (ctx.purpose == RenderPurpose::ShadowDepth && set.shadowDistance > 0.0f && centreDistance - inst.radius > set.shadowDistance) continue;
        }
        if (!collect.visible(inst.centre, inst.half, false)) { ++outside; continue; }
        if (ctx.purpose == RenderPurpose::ShadowDepth && !collect.castsIntoView(inst.centre, inst.radius)) { ++outside; continue; }
        const bool far = coarse && eyeKnown && set.lodDistance > 0.0f && distance > set.lodDistance;
        (far ? farList : nearList).push_back(i);
        if (measuring) {
            const f32 gap = std::max(glm::distance(inst.centre, ctx.view_eye) - inst.radius, 1e-3f);
            f32& best = far ? reach.coarse : reach.fine;
            best = std::max(best, entityGrow * inst.grow / gap);
        }
    }
    ES_PROFILE_COUNTER("render.placements.seen", count);
    ES_PROFILE_COUNTER("render.placements.tooFar", tooFar);
    ES_PROFILE_COUNTER("render.placements.outside", outside);
    ES_PROFILE_COUNTER("render.placements.coarse", farList.size());
    ES_PROFILE_COUNTER("render.placements.eye", eyeKnown ? 1 : 0);
    const u32 room = records < MESH_INSTANCE_MAX_RECORDS ? MESH_INSTANCE_MAX_RECORDS - records : 0;
    if (nearList.size() > room) nearList.resize(room);
    if (farList.size() > room - nearList.size()) farList.resize(room - nearList.size());
    records += static_cast<u32>(nearList.size() + farList.size());

    auto& buffers = collect.buffer_pool;
    const auto write = [&](const std::vector<u32>& list, const Mesh& geo) {
        if (list.empty()) return;
        const u32 offset = buffers.allocVertices(LayoutId::MeshInstance, MESH_INSTANCE_STRIDE * static_cast<u32>(list.size()));
        auto* dst = buffers.vertexData(LayoutId::MeshInstance) + offset;
        for (const u32 i : list) {
            std::memcpy(dst, cached.data() + static_cast<usize>(i) * MESH_INSTANCE_STRIDE, MESH_INSTANCE_STRIDE);
            dst += MESH_INSTANCE_STRIDE;
        }
        emit(geo, offset, static_cast<u32>(list.size()));
    };
    write(nearList, fine);
    if (coarse) write(farList, *coarse);
}
}  // namespace

/** @brief The error a clustered mesh may show, in pixels of the scene view, before a finer cluster is drawn. */
constexpr f32 kClusterPixelError = 1.0f;
/** @brief Collects a cut may go undrawn before its buffer is given back. A frame has several: the scene's, each shadow map's. */
constexpr u64 kClusterCutIdleCollects = 2048;
/// How many collects back a cut still says what an entity is drawn with: a few frames of every pass. Older, it was not
/// drawn lately (off screen, hidden), and its count would describe a view that is gone.
constexpr u64 kClusterCutFreshCollects = 64;

bool MeshPlugin::clusterInspect(u32 entityId, u32& triangles, u32& clusters) const {
    const auto it = cluster_cuts_.find(entityId);
    if (it == cluster_cuts_.end() || !it->second.picked || it->second.usedAt + kClusterCutFreshCollects < cluster_serial_) {
        return false;
    }
    triangles = it->second.indexCount / 3;
    clusters = it->second.clusters;
    return true;
}

const MeshPlugin::ClusterCut* MeshPlugin::clusterCut(RenderCollectContext& collect, Entity entity, const Mesh& mesh,
                                                     const glm::vec3& position, const glm::quat& rotation, const glm::vec3& scale) {
    const RenderFrameContext& ctx = collect.frame_context;
    GfxDevice& device = collect.buffer_pool.device();
    const lod::ClusterHierarchy& hierarchy = *mesh.clusters;
    ClusterCut& cut = cluster_cuts_[entity.id()];
    cut.usedAt = cluster_serial_;

    // The eye in the mesh's own space, where the bounds are stored. An error over a distance is the same ratio in either
    // space under one scale for every axis; under three, the largest is the one that shows the most.
    const glm::vec3 grow = glm::max(glm::abs(scale), glm::vec3(1e-12f));
    const f32 largest = std::max({grow.x, grow.y, grow.z});
    lod::ClusterEye eye;
    eye.flat = cluster_flat_;
    eye.scale = cluster_flat_ ? cluster_scale_ * largest : cluster_scale_;
    eye.threshold = kClusterPixelError / std::max(ctx.frame ? ctx.frame->lodDistanceScale() : 1.0f, 1e-3f);
    if (ctx.has_view_eye) {
        const glm::vec3 offset = glm::inverse(rotation) * (ctx.view_eye - position);
        eye.position = glm::vec3(scale.x < 0.0f ? -offset.x : offset.x, scale.y < 0.0f ? -offset.y : offset.y,
                                 scale.z < 0.0f ? -offset.z : offset.z) / grow;
    } else {
        // No eye to measure from: as if it stood on the surface, which asks for the mesh's own triangles.
        eye.flat = true;
        eye.scale = std::numeric_limits<f32>::max();
    }

    const bool stored = cut.buffer != BufferHandle::Invalid && cut.mesh == &mesh && cut.meshRevision == mesh.revision
        && cut.deviceGeneration == device.deviceGeneration();
    if (stored && cut.picked && cut.eye.position == eye.position && cut.eye.scale == eye.scale
        && cut.eye.threshold == eye.threshold && cut.eye.flat == eye.flat) {
        return &cut;
    }

    const u32 indexCount = lod::selectClusters(hierarchy, eye, cluster_picked_);
    const u64 signature = lod::cutSignature(cluster_picked_);
    if (!stored || signature != cut.signature || indexCount != cut.indexCount) {
        lod::assembleCut(hierarchy, cluster_picked_, mesh.arenaFirstVertex, cluster_indices_);
        const u32 bytes = indexCount * static_cast<u32>(sizeof(u32));
        if (cut.buffer != BufferHandle::Invalid && cut.deviceGeneration == device.deviceGeneration() && indexCount <= cut.capacity) {
            device.updateBuffer(cut.buffer, 0, cluster_indices_.data(), bytes);
        } else {
            // Room to spare: an eye that walks toward a mesh asks for a little more each time, and a buffer made to fit
            // would be made again at every step.
            const u32 capacity = std::min(indexCount + indexCount / 2 + 3 * 128, static_cast<u32>(hierarchy.indices.size()));
            cluster_indices_.resize(capacity, 0);
            BufferDesc desc;
            desc.usage = GfxBufferUsage::Index;
            desc.size = capacity * static_cast<u32>(sizeof(u32));
            desc.dynamic = true;
            if (cut.buffer != BufferHandle::Invalid) {
                device.resizeBuffer(cut.buffer, desc.size, cluster_indices_.data());
            } else {
                // Rewritten whenever the pick changes, and again from here after a device loss: nothing has to keep its bytes.
                cut.buffer = device.createBuffer(desc, GfxContent::transient(), cluster_indices_.data());
            }
            if (cut.buffer == BufferHandle::Invalid) {
                cut = ClusterCut{};
                return nullptr;
            }
            cut.capacity = capacity;
        }
        cut.signature = signature;
        cut.indexCount = indexCount;
        cut.clusters = static_cast<u32>(cluster_picked_.size());
        cut.ids = cluster_picked_;
        ++cluster_rebuilt_;
    }
    cut.mesh = &mesh;
    cut.meshRevision = mesh.revision;
    cut.deviceGeneration = device.deviceGeneration();
    cut.eye = eye;
    cut.picked = true;
    return &cut;
}

void MeshPlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    auto meshView = registry.activeView<ecs::Transform, ecs::MeshRenderer>();
    // Read once: the phase is the same for every mesh this collect walks.
    const bool shadowDepth = ctx.purpose == RenderPurpose::ShadowDepth;
    // The motion pass draws the same meshes a second time, only those that moved, with no material and no light
    // — what shadows and motion have in common is that neither is the surface's own look.
    const bool motion = ctx.purpose == RenderPurpose::Motion;
    const bool depthPass = shadowDepth || motion;
    ++cluster_serial_;
    if (ctx.purpose == RenderPurpose::Scene) {
        // What an error measures in this view: NDC y per world unit is the length of the view-projection's second row under
        // both projections, and half the view's pixels span one unit of NDC. An orthographic view's fourth row has no
        // direction in it: nothing there shrinks with distance.
        const glm::mat4& vp = ctx.view_projection;
        cluster_scale_ = glm::length(glm::vec3(vp[0][1], vp[1][1], vp[2][1])) * 0.5f * (ctx.frame ? ctx.frame->viewHeightPx() : 1080.0f);
        cluster_flat_ = glm::length(glm::vec3(vp[0][3], vp[1][3], vp[2][3])) < 1e-12f;
        cluster_meshes_ = cluster_triangles_ = cluster_source_triangles_ = cluster_rebuilt_ = cluster_drawn_ = 0;
        waiting_materials_ = 0;
        if (cluster_serial_ % 256 == 0 && !cluster_cuts_.empty()) {
            GfxDevice& device = buffers.device();
            for (auto it = cluster_cuts_.begin(); it != cluster_cuts_.end();) {
                if (it->second.usedAt + kClusterCutIdleCollects < cluster_serial_) {
                    if (it->second.buffer != BufferHandle::Invalid) device.deleteBuffer(it->second.buffer);
                    it = cluster_cuts_.erase(it);
                } else {
                    ++it;
                }
            }
        }
    }
    if (!motion && ctx.track_motion && ctx.motion_frame % 256 == 0) {
        for (auto it = poses_.begin(); it != poses_.end();) {
            if (it->second.frame + 8 < ctx.motion_frame) {
                it = poses_.erase(it);
                ++pose_generation_;
            } else {
                ++it;
            }
        }
    }

    u32 litProgram = 0;
    // The mesh as this view's mode describes it; one object reused across the walk.
    const ShadingMode shading = depthPass ? ShadingMode::Shaded : collect_ctx.shading;
    ecs::MeshRenderer shaded;

    // What is kept between walks is the look as authored, which every view of it agrees on; a view that overrides it derives
    // afresh. The tick is this walk's look at the change stamps: a proxy derived now has seen every write stamped up to it.
    const bool keeping = shading == ShadingMode::Shaded;
    u32 now = 0, rulesChangedAt = 0;
    proxies_kept_ = proxies_built_ = 0;
    if (keeping) {
        if (renderOrigin() != proxy_origin_ || ctx.materials != proxy_materials_ || registry.entitySetId() != proxy_registry_) {
            if (registry.entitySetId() != proxy_registry_) {
                proxies_.clear();
                proxy_slot_.clear();
            }
            ++proxy_epoch_;
            proxy_origin_ = renderOrigin();
            proxy_materials_ = ctx.materials;
            proxy_registry_ = registry.entitySetId();
        }
        now = registry.beginChangeRead();
        rulesChangedAt = ruledOutChangedAt(registry);
    }

    // The walk is timed whole: two clock reads a walk. A clock read is a call out to the page (performance.now), and read at
    // every phase of every mesh it was four of every ten samples of a profiled frame and most of the time it reported - the
    // collect looked several times dearer than it was. The split by phase is a build option (ES_PROFILE_COLLECT_PHASES) for
    // whoever needs it and accepts that the clock is then in the number; a profile with function names says more.
    const bool timing = FrameProfiler::get().enabled();
#ifdef ES_PROFILE_COLLECT_PHASES
    constexpr bool phases = true;
#else
    constexpr bool phases = false;
#endif
    f64 phase[5] = {0, 0, 0, 0, 0};
    const f64 walkStart = timing ? es_profile_now_ms() : 0.0;
    f64 mark = timing && phases ? walkStart : 0.0;
    u32 walked = 0, coldDecompose = 0, lodGathers = 0, programAsks = 0, instanceRecords = 0;
    // Where the scene's opaque meshes went in the choice of a depth prepass: taken, left out for a cut-out or a bent vertex, or no program to be had.
    u32 prepassTaken = 0, prepassCutout = 0, prepassBent = 0, prepassNoProgram = 0;
    const auto tick = [&](int slot) {
        if (!phases || !timing) return;
        const f64 now = es_profile_now_ms();
        phase[slot] += now - mark;
        mark = now;
    };

    const bool split = collect_ctx.casters != CasterSplit::All;
    const bool wantMovers = collect_ctx.casters == CasterSplit::Movers;
    // The editor's selection mask (a motion collect with a selection): the selected meshes, as they stand.
    const bool selecting = motion && collect_ctx.selection != nullptr;
    for (auto entity : meshView) {
        if (split && !ctx.causticReceivers && isMover(entity) != wantMovers) continue;
        if (selecting && !collect_ctx.selection->count(entity.id())) continue;
        ++walked;
        const auto& authored = meshView.get<ecs::MeshRenderer>(entity);
        const ecs::MeshRenderer* described = &authored;
        const bool heated = !depthPass && collect_ctx.weights.entity == entity;
        if (heated) {
            shaded = authored;
            applyShading(shaded, ShadingMode::Albedo);
            shaded.texture = {};
            shaded.color = glm::vec4(static_cast<f32>(collect_ctx.weights.joint), 0.0f, 0.0f, 1.0f);
            described = &shaded;
        } else if (shading != ShadingMode::Shaded) {
            shaded = authored;
            applyShading(shaded, shading);
            described = &shaded;
        }
        const auto& mesh = *described;
        // Empty indices no longer mean "nothing to draw": a resident mesh keeps
        // its geometry on the GPU and its inline payload deliberately empty.
        if (!mesh.enabled || (mesh.indices.empty() && !mesh.mesh.isValid())) continue;

        auto& transform = meshView.get<ecs::Transform>(entity);
        // Kept from an earlier walk when nothing it was derived from has changed (MeshProxy); null derives it here.
        MeshProxy* kept = keeping && !heated ? retain(collect_ctx, entity, mesh, transform, now, rulesChangedAt) : nullptr;
        glm::vec3 position, scale;
        glm::quat rotation;
        if (kept) {
            // The motion pass draws what moved since the view's last frame, and only what is opaque. A kept draw that did not
            // is passed over here rather than after its cull, which is all the work the walk would have done to reach the same answer.
            if (selecting && kept->placed) continue;
            if (motion && !selecting) {
                if (kept->placed) continue;
                const Pose* pose = poseOf(ctx, entity, kept, false);
                if (!mesh.opaque || !pose || pose->frame != ctx.motion_frame || pose->previous == pose->current) continue;
            }
            position = kept->position;
            rotation = kept->rotation;
            scale = kept->scale;
        } else {
            if (!transform.decomposed_) ++coldDecompose;
            // Parallax is a CAMERA trick — a renderable shifted toward the view centre to
            // scroll slower. A shadow pass looks from a light, whose centre means nothing to
            // it, and its map is fitted to unshifted bounds: a caster stands where it is.
            transform.ensureDecomposed();
            position = shadowDepth
                ? rebased(transform.worldPosition)
                : parallaxedWorldPosition(transform, mesh.parallax, collect_ctx.camera);
            // A card turns to THIS view, whichever it is: the Transform keeps what was authored. Placements are each turned by their own
            // record, so a set of them is left as it stands.
            const ecs::Billboard* card = registry.tryGet<ecs::Billboard>(entity);
            rotation = card && card->enabled && !registry.tryGet<ecs::MeshInstances>(entity)
                ? billboard::facing(card->mode, ctx.view_projection, collect_ctx.camera.eye, position)
                : transform.worldRotation;
            scale = transform.worldScale;
        }
        tick(0);

        // Bounds come from whichever geometry this is: a resident mesh keeps its
        // own, and the inline payload's are recomputed on upload. Reading the
        // component's for a resident mesh would cull it against an empty box.
        const Mesh* resident = kept ? kept->resident : mesh.mesh.isValid() ? ctx.resources.getMesh(mesh.mesh) : nullptr;
        // Only GPU-resident geometry casts: the inline payload takes the CPU path
        // below, which bakes world space into vertices for the BATCH shader — a
        // shader that writes colour, not the depth this pass is here to collect.
        if (depthPass && !resident) continue;
        // Many placements of one mesh, drawn as instances of it. What is placed does not move on its own, so the motion pass has nothing to say.
        const ecs::MeshInstances* placements = resident && (!kept || kept->placed) ? registry.tryGet<ecs::MeshInstances>(entity) : nullptr;
        if (placements && (placements->transforms.empty() || motion)) continue;
        // What light passes through (water) stands in no light's way. Rain's way is another matter: a see-through surface
        // set to cast no shadow (glass) still keeps rain off what is under it, so the rain's cover map takes it. What is
        // opaque and casts no shadow (a held gun, an effect's mesh) stays out of both.
        if (ctx.causticReceivers) {
            if (!mesh.opaque || (ctx.materials && ctx.materials->usesSceneColor(mesh.material))) continue;
            const bool deforming = registry.has<ecs::MeshSkin>(entity) || registry.has<ecs::MeshMorph>(entity)
                || (ctx.materials && ctx.materials->hasUntrackedDepthHook(mesh.material));
            if (split && (isMover(entity) || deforming) != wantMovers) continue;
        } else if (shadowDepth) {
            if (!mesh.castShadows && !(ctx.rainCover && !mesh.opaque)) continue;
            // A drop ends at the captured surface. Drawing that drop into the same capture would sample its own render target.
            if (ctx.rainCover && mesh.material && ctx.materials && ctx.materials->depthReadsRainCover(mesh.material)) continue;
        }
        // Only a surface that draws opaque and unblended has a motion worth writing: what is blended over
        // something has two, and the picture can follow one.
        if (motion && !selecting && !mesh.opaque) continue;

        // A collect with no LOD memory must not select: a shadow map's own screen
        // size means nothing to a player, and borrowing a camera's answer would
        // make the answer the entity's rather than each view's.
        LodLevels levels;
        const ecs::LODGroup* group = nullptr;
        if (collect_ctx.lod.state && resident && !placements && !kept) {
            const auto* declared = registry.tryGet<ecs::LODGroup>(entity);
            if (declared && declared->enabled) {
                ++lodGathers;
                if (gatherLodLevels(ctx.resources, *declared, *resident, levels)) {
                    group = declared;
                    reportLodAuthoring(levels, warned_lod_);
                }
            }
        }
        tick(1);
        // Small enough, and an impostor with its pictures taken: a card facing this view stands in for the mesh. Only the scene's own
        // views draw one: a card casts no shadow, and a picture has no motion to write.
        if (ctx.purpose == RenderPurpose::Scene && resident && !placements && !kept && ctx.frame) {
            const auto* stand = registry.tryGet<ecs::Impostor>(entity);
            const RenderFrame::ImpostorAtlas* atlas = stand && stand->enabled ? ctx.frame->impostorAtlas(entity) : nullptr;
            if (atlas) {
                glm::vec3 centre;
                f32 radius = 0.0f;
                lod::boundingSphere(position, transform.worldRotation, scale, resident->localMin, resident->localMax, centre, radius);
                if (radius > 0.0f && lod::screenRelativeSize(ctx.view_projection, centre, radius) * ctx.frame->lodDistanceScale() < stand->screenSize) {
                    if (collect_ctx.frustum.intersectsAABB(centre, glm::vec3(radius))) {
                        emitImpostorCard(collect_ctx, *atlas, mesh, entity, centre, radius, transform.worldRotation);
                    }
                    continue;
                }
            }
        }
        // BEFORE the cull, because whether this draw depth-tests decides if an
        // occluder may refuse it, and the material is where that is finally said.
        // Reused by the draw key below: two lookups is how the two come to differ.
        const MaterialRecord* material = kept ? kept->material
            : (mesh.material != 0 && ctx.materials) ? ctx.materials->find(mesh.material) : nullptr;
        // A material that bends its vertices can put them outside the mesh's own box; culling the
        // box would drop a bent mesh that is still on screen, so it grows by what the material says.
        const f32 bend = kept ? kept->bend : material ? ctx.materials->vertexBounds(mesh.material) : 0.0f;
        const bool depthTested = kept ? kept->depthTested : mesh.opaque || (material && material->depthTest);

        const Mesh* placementCoarse = !placements ? nullptr : kept ? kept->coarse : placementCoarseMesh(ctx.resources, *resident, *placements);
        f32 placementRadius = 0.0f;
        glm::vec3 placementCentre(0.0f), placementHalf(0.0f);
        if (placements && !kept) {
            glm::vec3 lo, hi;
            meshLocalBounds(*resident, placementCoarse, bend, lo, hi);
            placementRadius = placement_bounds::radius(lo, hi, 0.0f);
            placementCentre = (lo + hi) * 0.5f;
            placementHalf = (hi - lo) * 0.5f;
        }
        // Placements can rotate or shear independently. One origin-centred sphere includes both LODs and local deformation.
        const glm::vec3 reach(placements ? placementRadius * placements->maxScale : 0.0f);
        const glm::vec3 localMin = placements ? placements->originMin - reach
                                 : group ? levels.localMin
                                 : resident ? resident->localMin : glm::vec3(mesh.localMin, 0.0f);
        const glm::vec3 localMax = placements ? placements->originMax + reach
                                 : group ? levels.localMax
                                 : resident ? resident->localMax : glm::vec3(mesh.localMax, 0.0f);
        const glm::vec3 padding(placements ? 0.0f : bend);

        glm::vec3 aabbCenter(0.0f), halfExtents(0.0f);
        if (kept) {
            aabbCenter = kept->boxCentre;
            halfExtents = kept->boxHalf;
        } else {
            orientedWorldAabb(position, rotation, scale, localMin - padding, localMax + padding,
                              aabbCenter, halfExtents);
        }
        if (resident && !placements && !group && !kept) {
            skinnedWorldBounds(registry, entity, *resident, warned_bones_, aabbCenter, halfExtents);
        }
        // The collect's own predicate, not a frustum test of this plugin's: it
        // answers "outside the view" AND "behind something solid", and a mesh is
        // what both were built for.
        if (!collect_ctx.visible(aabbCenter, halfExtents, depthTested)) {
            ++collect_ctx.culled;
            tick(2);
            continue;
        }
        if (shadowDepth && !collect_ctx.castsIntoView(aabbCenter, glm::length(halfExtents))) {
            ++collect_ctx.culled;
            tick(2);
            continue;
        }

        // Nothing visible is worth measuring precisely, so the cull runs first; what
        // survives it is measured on the sphere the whole group shares.
        if (group && collect_ctx.lod.follow) {
            // Cast by what the view draws: the level it settled on last frame (this frame's camera collect comes after the
            // shadows), nothing where it culled, the finest where it has not looked lately.
            u8 settled = 0;
            const auto& state = *collect_ctx.lod.state;
            if (!state.recent(collect_ctx.lod.view, entity, 2, settled)) settled = 0;
            const u8 shown = settled == lod::kCulled ? settled : state.drawn(collect_ctx.lod.view, entity, settled, levels.set.count);
            if (shown == lod::kCulled) { ++collect_ctx.culled; tick(2); continue; }
            resident = levels.mesh[shown];
        } else if (group) {
            glm::vec3 centre(0.0f);
            f32 radius = 0.0f;
            lod::boundingSphere(position, rotation, scale, localMin, localMax, centre, radius);
            const f32 screenSize = lod::screenRelativeSize(ctx.view_projection, centre, radius) * (ctx.frame ? ctx.frame->lodDistanceScale() : 1.0f);
            auto& state = *collect_ctx.lod.state;
            const u32 view = collect_ctx.lod.view;
            const u8 level = lod::selectLevel(levels.set, screenSize, state.lastLevel(view, entity));
            // The same size with no memory behind it. Recorded rather than derived
            // later: the two differing IS hysteresis holding a level, and an editor
            // that recomputed it would be a second selector free to disagree.
            const u8 unbiased = lod::selectLevel(levels.set, screenSize, 0);
            state.remember(view, entity, level, unbiased, levels.set.count, screenSize);
            // The POLICY's answer, not the one a creator is holding up to look at:
            // a preview is an editor's question about this view, and counting it
            // would put it in a shipped frame's profile.
            if (collect_ctx.lod.counts) collect_ctx.lod.counts->record(level);
            const u8 shown = state.drawn(view, entity, level, levels.set.count);
            if (shown == lod::kCulled) { ++collect_ctx.culled; tick(2); continue; }
            resident = levels.mesh[shown];
        }
        // One level of a group whose levels are whole entities: drawn while its group, in this view, is at that level, and while it
        // fades from it or into it (lodFade, which the record's alpha carries: a material whose alpha is coverage dissolves with it).
        f32 lodFade = 1.0f;
        if (const auto* member = registry.tryGet<ecs::LODMember>(entity)) {
            const u8 at = memberGroupLevel(registry, collect_ctx, ctx, *member);
            const u8 mine = static_cast<u8>(member->level);
            if (collect_ctx.lod.state && !collect_ctx.lod.follow && at != lod::kCulled) {
                lodFade = collect_ctx.lod.state->weight(collect_ctx.lod.view, Entity::fromRaw(member->group), mine, lod::kFadeSeconds);
            } else {
                lodFade = at == mine ? 1.0f : 0.0f;
            }
            if (!(lodFade > 0.0f)) { ++collect_ctx.culled; tick(2); continue; }
        }
        tick(2);

        // How big a texture this mesh needs here: a texel about a pixel at the nearest point of its sphere. The scene's own views
        // only — a shadow map's texels are not anyone's pixels — and only where the mesh says how much texture its surface holds.
        // Placements are measured one by one where they are walked (emitPlacements), and asked for below.
        if (ctx.purpose == RenderPurpose::Scene && ctx.frame && resident && !placements) {
            glm::vec3 centre(0.0f);
            f32 radius = 0.0f;
            lod::boundingSphere(position, rotation, scale, resident->localMin, resident->localMax, centre, radius);
            const glm::vec4 eye = collect_ctx.camera.eye;
            const f32 distance = eye.w > 0.5f ? std::max(glm::length(glm::vec3(eye) - centre) - radius, 1e-3f) : 1.0f;
            const f32 grow = std::max({std::abs(scale.x), std::abs(scale.y), std::abs(scale.z)});
            wantTexturesOf(ctx, mesh, material, textureSideFor(ctx, grow / distance, resident->uvDensity));
        }

        u32 textureId = ctx.white_texture_id;
        if (mesh.texture.isValid()) {
            if (Texture* tex = ctx.resources.getTexture(mesh.texture)) {
                textureId = tex->getId();
            }
        }
        MeshDrawKeys keys{};
        if (selecting) {
            // The mask's coverage, through the motion program with no movement in it. A skinned mesh is placed by bones
            // the motion records take from last frame's pose, which a still selection has none of: the editor outlines it itself.
            const MeshProgramFacts facts =
                kept ? kept->facts : meshFactsFromEntity(ctx, registry, entity, mesh, resident, warned_bones_);
            if (facts.skinned || !resident) continue;
            keys = { meshVariant(facts.hasNormals, false, false, false, false, false, false, false, false, true, facts.tangents), 0 };
        } else if (motion) {
            // What was drawn last frame and what is drawn now, for THIS view. Nothing known, or nothing changed,
            // means the camera's own motion says it all and the temporal pass already has that.
            const Pose* pose = poseOf(ctx, entity, kept, false);
            if (!pose || pose->frame != ctx.motion_frame
                || (pose->previous == pose->current && pose->bonesPrevious == pose->bonesCurrent)) {
                continue;
            }
            const MeshProgramFacts facts =
                kept ? kept->facts : meshFactsFromEntity(ctx, registry, entity, mesh, resident, warned_bones_);
            // A palette of a different size than last frame's has no joint-for-joint past to follow.
            if (facts.skinned && pose->bonesPrevious.size() != pose->bonesCurrent.size()) continue;
            keys = { meshVariant(facts.hasNormals, false, false, facts.skinned, false, false, false, false, false, true, facts.tangents), 0 };
        } else if (kept) {
            MeshProgramFacts facts = kept->facts;
            facts.normalTextureId = normalTextureOf(ctx, mesh, facts);
            keys = meshDrawFrom(ctx, entity, facts, shadowDepth);
        } else {
            keys = meshDrawFor(ctx, registry, entity, mesh, resident, shadowDepth, warned_bones_, heated);
        }
        const u32 normalTextureId = keys.normalTextureId;

        BatchDrawKey key{
            .stage = ctx.current_stage,
            .layer = mesh.layer,
            .shaderId = ctx.batch_shader_id,
            .blend = BlendMode::Normal,
            .textureId = textureId,
            .normalTextureId = normalTextureId,
            .shadowTextureId = ctx.shadow_texture_id,
            .envTextureId = ctx.environment_texture_id,
            .depth = collect_ctx.camera.viewDepth(position),
            .y = position.y,
            .entity = entity,
            .type = RenderType::Mesh,
        };

        if (!depthPass && ctx.frame) {
            const u32 reflection = ctx.frame->planarTextureFor(entity);
            if (reflection != 0) {
                key.envTextureId = reflection;
                key.planarIndex = draw_list.addPlanar(ctx.frame->planarConstants());
            }
        }

        // An opaque surface says so itself rather than waiting for a depth layer:
        // no blending, depth written AND tested — the only way one mesh hides
        // another. Opaque sorts ahead of blended within a layer, so 2D stays on top.
        if (mesh.opaque) {
            key.stage = RenderStage::Opaque;
            key.blend = BlendMode::None;
            key.depthTest = true;
            key.depthWrite = true;
        }
        if (mesh.cullBackfaces) key.cull = static_cast<u8>(CullMode::Back);

        // Material resolve mirrors SpritePlugin: an unregistered handle falls back to
        // the default batch shader; a material owns shading fully, so it takes
        // precedence over the lit toggle.
        if (mesh.material != 0) {
            if (const MaterialRecord* m = material) {
                key.shaderId = (m->shader != 0) ? m->shader : ctx.batch_shader_id;
                // An opaque mesh is drawn unblended whatever its material's blend says: the material's 0 is Normal, which
                // every material file names by default, and it left every opaque material surface blending — so it wrote
                // no surface record (screen-space reflections and rain read nothing) and a cut-out lost its alpha-to-coverage.
                key.blend = mesh.opaque ? BlendMode::None : m->blend;
                key.materialId = mesh.material;
                // Depth likewise, or a sphere's far side draws over its near side: a new material says depthTest false, and
                // the surface reads as the inside of a bowl, under light and shadow that look wrong for no reason a person can see.
                key.depthTest = mesh.opaque || m->depthTest;
                key.depthWrite = mesh.opaque || m->depthWrite;
                key.cull = static_cast<u8>(m->cull);
                key.depthBias = m->depthBias;
            }
        } else if (mesh.lit && ctx.frame) {
            if (litProgram == 0) litProgram = ctx.frame->batchProgram(BatchVariant::Lit);
            if (litProgram != 0) key.shaderId = litProgram;
        }

        // Casting into a shadow map: opaque and depth-tested whatever the camera's
        // pass makes it, and none of the three ways to describe a surface — lit, a
        // normal map, a material. LAST, so the pass outranks all three.
        if (depthPass) {
            key.stage = RenderStage::Opaque;
            key.blend = BlendMode::None;
            key.depthTest = true;
            key.depthWrite = true;
            key.materialId = 0;
            key.shadowTextureId = 0;
            key.envTextureId = 0;
        }

        // Resident geometry: only the transform is written for the frame. Its
        // vertices are local-space and untouched, so the CPU loop below — which
        // exists to bake world space into every vertex — is skipped entirely.
        if (resident && mesh_programs_[0] != 0) {
            // The pose, when this entity says what moves it. The bones are
            // world-space, so the entity's own transform is not read — which is
            // what glTF requires of a skinned mesh.
            const u32 poseSize = kept ? 0u : skinPose(registry, entity, *resident, pose_scratch_, warned_bones_);
            // Posed already this frame by the skin cache: the draw reads the posed copy as unskinned geometry in world space,
            // through the program a static mesh has. The motion pass poses in its vertex stage still, with last frame's pose beside it,
            // and so does the weight view, which colours by the joints the posed copy no longer carries to the program.
            BufferHandle cachedSkin = BufferHandle::Invalid;
            if (poseSize > 0 && !motion && !heated && !placements && ctx.frame) {
                if (SkinCache* cache = ctx.frame->skinCache()) {
                    cachedSkin = cache->bufferFor(entity);
                    if (cachedSkin != BufferHandle::Invalid) cache->noteDraw();
                }
            }
            const bool cached = cachedSkin != BufferHandle::Invalid;
            const bool skinned = poseSize > 0 && !cached;
            const u32 drawVariant = cached ? (keys.variant & ~8u) : keys.variant;

            // `lit` is the draw's own word and is honoured either way: geometry
            // with normals can be drawn unlit, and geometry without them takes
            // light off the constant normal a 2D surface has.
            tick(4);
            ++programAsks;
            const u32 residentShader = meshProgram(ctx, drawVariant);
            tick(3);
            if (resident->isDrawable() && residentShader != 0) {
                // The shape the mesh was REALIZED in, not a second derivation:
                // the record is read through that layout, so the fact that built
                // it must pack it. (It already excludes a skinned mesh.)
                const bool lightmapped = resident->hasLightmapUV && !motion;
                // A skinned motion draw carries last frame's palette in the records right behind its own: three
                // texels a bone from texel 8 on, which the shader reaches by index like any other texel.
                // A chunked skin writes each chunk's palette into a record of the chunk's own as it is drawn (below).
                const bool chunked = skinned && resident->isChunked();
                const u32 paletteRecords = motion && skinned && !chunked
                    ? (3 * poseSize + MESH_INSTANCE_TEXELS - 1) / MESH_INSTANCE_TEXELS : 0;
                static thread_local std::vector<u8> unplaced;
                u32 instOffset = 0;
                u8* dst = nullptr;
                if (placements) {
                    unplaced.resize(static_cast<usize>(MESH_INSTANCE_STRIDE) * (1 + paletteRecords));
                    dst = unplaced.data();
                } else {
                    instOffset = buffers.allocVertices(LayoutId::MeshInstance, MESH_INSTANCE_STRIDE * (1 + paletteRecords));
                    dst = buffers.vertexData(LayoutId::MeshInstance) + instOffset;
                }
                // The record is one fixed shape, so every texel this variant
                // does not write still has to say something. Zero is the answer
                // each of them reads as absent.
                std::memset(dst, 0, MESH_INSTANCE_STRIDE * (1 + paletteRecords));
                // The shapes, whether or not bones move it: the two deform the
                // same vertices, and a morph target is what the mesh is BEFORE a
                // pose is applied to it.
                MorphConstants shapes{};
                if (!kept && morphShapes(registry, entity, *resident, shapes)) {
                    key.morphIndex = draw_list.addMorphShapes(shapes);
                    key.morphTextureId = static_cast<u32>(resident->morphTexture);
                }
                const glm::vec4 tint{mesh.color.r, mesh.color.g, mesh.color.b, mesh.color.a * lodFade};
                std::memcpy(dst + MESH_INSTANCE_TEXEL_TINT * 16, &tint, 16);
                if (skinned) {
                    // A chunked skin uploads each chunk's bones with the chunk's draw instead (below).
                    if (!chunked) {
                        key.skinOffset = draw_list.addSkinMatrices(pose_scratch_.data(), poseSize);
                        key.skinCount = poseSize;
                    }
                } else {
                const glm::mat4 model = cached ? glm::mat4(1.0f)
                                      : kept ? kept->model
                                      : glm::translate(glm::mat4(1.0f), position)
                                      * glm::mat4_cast(rotation)
                                      * glm::scale(glm::mat4(1.0f), scale);
                // Three rows, not four columns: the row the shader rebuilds is
                // the one an affine transform never varies.
                for (u32 row = 0; row < 3; ++row) {
                    const glm::vec4 r{model[0][row], model[1][row], model[2][row], model[3][row]};
                    std::memcpy(dst + (MESH_INSTANCE_TEXEL_MODEL + row) * 16, &r, 16);
                }
                if (resident->hasNormals) {
                    // Written per object rather than derived per vertex: this is
                    // the transform a normal takes under a non-uniform scale.
                    const glm::mat3 nrm = cached ? glm::mat3(1.0f)
                                        : kept ? kept->normalRows : glm::transpose(glm::inverse(glm::mat3(model)));
                    for (u32 row = 0; row < 3; ++row) {
                        std::memcpy(dst + (MESH_INSTANCE_TEXEL_NORMAL + row) * 16, &nrm[row][0], 12);
                    }
                }
                if (lightmapped) {
                    // A zero scale where this object has no bake — the shader
                    // reads it as "none" rather than as an atlas of black, which
                    // an unlit surface would wear as darkness it never had.
                    glm::vec4 rect{0.0f};
                    if (const auto* baked = registry.tryGet<ecs::MeshLightmap>(entity)) {
                        if (Texture* atlas = ctx.resources.getTexture(baked->lightmap)) {
                            rect = baked->scaleOffset;
                            key.lightmapTextureId = atlas->getId();
                        }
                    }
                    std::memcpy(dst + MESH_INSTANCE_TEXEL_LIGHTMAP * 16, &rect, 16);
                }
                }
                if (selecting) {
                    // No movement: "last frame" is this frame's camera times where the mesh stands now, so the program
                    // writes zero motion, the depth, and full coverage.
                    const glm::vec4 still{0.0f};
                    std::memcpy(dst + MESH_INSTANCE_TEXEL_TINT * 16, &still, 16);
                    const glm::mat4 model = kept ? kept->model
                        : glm::translate(glm::mat4(1.0f), position) * glm::mat4_cast(rotation) * glm::scale(glm::mat4(1.0f), scale);
                    const glm::mat4 now = ctx.motion_prev_view_projection * model;
                    for (u32 row = 0; row < 4; ++row) {
                        const glm::vec4 r{now[0][row], now[1][row], now[2][row], now[3][row]};
                        std::memcpy(dst + (MESH_INSTANCE_TEXEL_NORMAL + row) * 16, &r, 16);
                    }
                } else if (motion) {
                    // This record is the motion pass's own, so the texels a lit draw keeps its tint, normal
                    // matrix and bake in are free: last frame's shift in the tint's, and last frame's
                    // view-projection times last frame's model — as rows, so the shader dots them with the local position.
                    const Pose& pose = *poseOf(ctx, entity, kept, false);
                    const glm::vec4 jitter{ctx.motion_prev_jitter, 0.0f, 0.0f};
                    std::memcpy(dst + MESH_INSTANCE_TEXEL_TINT * 16, &jitter, 16);
                    // A rigid mesh's last place is its last model, so the matrix is the two together; a skinned
                    // one is placed by its bones, which the shader applies first, so only the camera goes here.
                    const glm::mat4 before = skinned ? ctx.motion_prev_view_projection
                                                     : ctx.motion_prev_view_projection * pose.previous;
                    for (u32 row = 0; row < 4; ++row) {
                        const glm::vec4 r{before[0][row], before[1][row], before[2][row], before[3][row]};
                        std::memcpy(dst + (MESH_INSTANCE_TEXEL_NORMAL + row) * 16, &r, 16);
                    }
                    if (skinned && !chunked) {
                        for (u32 bone = 0; bone < poseSize; ++bone) {
                            const glm::mat4& m = pose.bonesPrevious[bone];
                            for (u32 row = 0; row < 3; ++row) {
                                const glm::vec4 r{m[0][row], m[1][row], m[2][row], m[3][row]};
                                std::memcpy(dst + (MESH_INSTANCE_TEXELS + bone * 3 + row) * 16, &r, 16);
                            }
                        }
                    }
                } else if (ctx.track_motion && !shadowDepth) {
                    trackPose(*poseOf(ctx, entity, kept, true), ctx,
                              poseSize > 0 ? glm::mat4(1.0f)
                              : kept  ? kept->model
                                      : glm::translate(glm::mat4(1.0f), position)
                                            * glm::mat4_cast(rotation)
                                            * glm::scale(glm::mat4(1.0f), scale),
                              poseSize > 0 ? &pose_scratch_ : nullptr);
                }

                // A draw reading its own atlas does not ask for IRRADIANCE, and asks
                // for its reflection either way — a lightmapped wall mirrors the room
                // like anything else. At the ENTITY's position: bones place a skin.
                if (!depthPass) {
                    ProbeConstants probe;
                    // Per pixel where the program can read the atlas: a mesh with lightmap UVs is compiled with
                    // the bake's sampler on that unit, so it keeps the one value its position reads.
                    const ProbeStore& store = ctx.render_context.probes();
                    // By the mesh's world box, not its origin: an imported level's origins are wherever the file put them.
                    const bool volume = key.lightmapTextureId == 0
                        && store.sampleBox(aabbCenter, halfExtents, probe, !resident->hasLightmapUV);
                    if (volume && probe.irradiance[0].w > 1.5f) key.probeGridTextureId = store.atlasTexture();
                    if (volume) store.noteDraw(probe.irradiance[0].w > 1.5f);
                    const u32 slot = ctx.render_context.reflections().slotForBox(aabbCenter, halfExtents);
                    probe.reflection.x = static_cast<f32>(slot);
                    if (volume || slot != 0) key.probeIndex = draw_list.addProbe(probe);
                }

                // A material's default program is built for the BATCH vertex
                // source and would draw this at its local origin, so ask for the
                // one compiled for THIS source; a failed variant falls back.
                u32 materialProgram = 0;
                if (key.materialId != 0 && ctx.materials) {
                    materialProgram = ctx.materials->meshProgram(key.materialId, ctx.resources,
                                                                 resident->hasNormals, skinned,
                                                                 key.envTextureId != 0,
                                                                 resident->hasLightmapUV,
                                                                 ctx.gbuffer && !shadowDepth,
                                                                 resident->hasTangents, false,
                                                                 key.blend == BlendMode::None);
                    if (materialProgram == 0) {
                        if (!warned_material_) {
                            warned_material_ = true;
                            ES_LOG_WARN("MeshRenderer: material {} has no mesh variant; using the mesh shader",
                                        key.materialId);
                        }
                        key.materialId = 0;
                    }
                }
                key.shaderId = materialProgram != 0 ? materialProgram : residentShader;
                // A program still compiling in the background, the material's or the mesh's own: the draw takes the preview
                // program meanwhile (texture, colour and bake, compiled in place), rather than being left out until the compile
                // ends. A scene opens with every shape there, lit by its bake, and each surface takes its own shading the frame its
                // program is ready. It takes no prepass: a prepass left out while its colour draw tests depth for equality is no draw.
                bool previewing = false;
                if (!depthPass && !motion && key.shaderId != 0) {
                    GfxDevice& device = buffers.device();
                    if (device.skipPendingPrograms() && !device.programReady(ShaderHandle{key.shaderId})) {
                        const u32 preview = previewProgram(ctx, drawVariant);
                        if (preview != 0 && device.programReady(ShaderHandle{preview})) {
                            key.shaderId = preview;
                            key.materialId = 0;
                            previewing = true;
                            ES_PROFILE_COUNTER("render.mesh.previewing", ++waiting_materials_);
                        }
                    }
                }
                // A caster whose material bends it casts the bent shape, and one whose alpha is coverage casts
                // only where it is opaque: the depth program gets the material's hook and cutoff, and the draw
                // keeps the material so its params are bound.
                if (shadowDepth && material && ctx.materials
                    && (ctx.materials->hasVertexHook(mesh.material) || ctx.materials->castsCutoutShadow(mesh.material))) {
                    const u32 bentDepth = ctx.materials->shadowProgram(mesh.material, ctx.resources,
                                                                       resident->hasNormals, skinned, resident->hasTangents);
                    if (bentDepth != 0) {
                        key.shaderId = bentDepth;
                        key.materialId = mesh.material;
                    }
                }
                // The scene's depth prepass: an opaque, unblended, depth-writing surface has its depth drawn first by a program on its own vertex stage,
                // and is shaded only where that depth is the nearest. Not what reads the picture behind it, and not the views that change what a
                // surface is drawn as.
                if (!depthPass && !motion && !previewing && ctx.purpose == RenderPurpose::Scene && mesh.opaque && key.stage == RenderStage::Opaque
                    && key.blend == BlendMode::None && key.depthTest && key.depthWrite && shading == ShadingMode::Shaded && !heated) {
                    const bool refracts = key.materialId != 0 && ctx.materials && ctx.materials->usesSceneColor(key.materialId);
                    const bool cutout = key.materialId != 0 && ctx.materials && ctx.materials->alphaIsCoverage(key.materialId);
                    if (refracts) {
                    } else if (cutout) {
                        // Its alpha is coverage: a program that writes the same coverage, under the alpha-to-coverage the colour pass draws with.
                        key.depthShaderId = ctx.materials->prepassCoverageProgram(key.materialId, ctx.resources, resident->hasNormals, skinned,
                                                                                    resident->hasTangents);
                        if (key.depthShaderId != 0) ++prepassTaken; else ++prepassCutout;
                    } else {
                        if (key.materialId != 0 && ctx.materials && ctx.materials->hasVertexHook(key.materialId)) {
                            // A material that bends its vertices: the depth program carries the same bend.
                            key.depthShaderId = ctx.materials->shadowProgram(key.materialId, ctx.resources, resident->hasNormals, skinned,
                                                                              resident->hasTangents);
                            if (key.depthShaderId != 0) ++prepassTaken; else ++prepassBent;
                        } else {
                            u32 depthVariant = kept ? meshDrawFrom(ctx, entity, kept->facts, true).variant
                                                    : meshDrawFor(ctx, registry, entity, mesh, resident, true, warned_bones_).variant;
                            if (cached) depthVariant &= ~8u;
                            key.depthShaderId = meshProgram(ctx, depthVariant);
                            if (key.depthShaderId != 0) ++prepassTaken; else ++prepassNoProgram;
                        }
                    }
                }
                key.layoutId = LayoutId::MeshInstance;
                key.instanceCount = 1;
                key.instanceStride = MESH_INSTANCE_STRIDE;
                const bool wire = shading == ShadingMode::Wireframe;
                if (wire) key.depthBias = kWireFillBias;
                // One draw of `count` records from `offset`, of the geometry `geo`. A cutout that asks for tips gets its soft outer band
                // as a second, blended draw of the same instances: no depth written, sorted with the other blended draws, and no
                // surface record.
                // The indices a draw of `geo` reads: its own, or the cut a clustered mesh is drawn through.
                BufferHandle cutBuffer = BufferHandle::Invalid;
                u32 cutIndexCount = 0;
                // One draw of the run `firstIndex`, `indexCount` of what `emit` would draw: the whole of it, or a skin chunk.
                const auto emitRange = [&](const Mesh& geo, u32 offset, u32 count, u32 firstIndex, u32 indexCount) {
                    BatchDrawKey drawn = key;
                    drawn.instanceCount = count;
                    drawn.vertexBuffer = cached && &geo == resident ? cachedSkin : geo.vertexBuffer;
                    drawn.indexBuffer = cutBuffer != BufferHandle::Invalid ? cutBuffer : geo.indexBuffer;
                    drawn.vertexLayout = geo.layout;
                    pushBatchDraw(draw_list, clips, offset, 0, firstIndex, indexCount, drawn);
                    if (!depthPass && !wire && key.materialId != 0 && ctx.materials && ctx.materials->hasTipPass(key.materialId)) {
                        const u32 tipProgram = ctx.materials->meshProgram(key.materialId, ctx.resources, geo.hasNormals, skinned,
                                                                          key.envTextureId != 0, geo.hasLightmapUV, false,
                                                                          geo.hasTangents, true, false);
                        if (tipProgram != 0) {
                            BatchDrawKey tips = drawn;
                            tips.shaderId = tipProgram;
                            tips.stage = RenderStage::Transparent;
                            tips.blend = BlendMode::Normal;
                            tips.depthWrite = false;
                            pushBatchDraw(draw_list, clips, offset, 0, firstIndex, indexCount, tips);
                        }
                    }
                };
                const auto emit = [&](const Mesh& geo, u32 offset, u32 count) {
                    emitRange(geo, offset, count, cutBuffer != BufferHandle::Invalid ? 0 : geo.firstIndex,
                              cutBuffer != BufferHandle::Invalid ? cutIndexCount : geo.indexCount);
                };
                if (placements) {
                    PlacementReach reach;
                    if (kept) {
                        emitKeptPlacements(ctx, collect_ctx, *placements, kept->instances, kept->records, scale, *resident,
                                           placementCoarse, instanceRecords, reach, emit);
                    } else {
                        emitPlacements(ctx, collect_ctx, *placements, mesh, position, rotation, scale, *resident, placementCoarse,
                                       placementCentre, placementHalf, instanceRecords, reach, emit);
                    }
                    const f32 fineSide = textureSideFor(ctx, reach.fine, resident->uvDensity);
                    const f32 coarseSide = placementCoarse ? textureSideFor(ctx, reach.coarse, placementCoarse->uvDensity) : 0.0f;
                    wantTexturesOf(ctx, mesh, material, std::max(fineSide, coarseSide));
                    continue;
                }
                key.vertexBuffer = cached ? cachedSkin : resident->vertexBuffer;
                key.indexBuffer = resident->indexBuffer;
                key.vertexLayout = resident->layout;
                // A clustered mesh, one entity's own: through the clusters the scene's eye picks. The wireframe view draws
                // the mesh's own edges, which are level 0's, over level 0.
                bool inked = false;
                if (resident->clusters && !wire) {
                    if (const ClusterCut* cut = clusterCut(collect_ctx, entity, *resident, position, rotation, scale)) {
                        cutBuffer = cut->buffer;
                        cutIndexCount = cut->indexCount;
                        if (ctx.purpose == RenderPurpose::Scene) {
                            ++cluster_meshes_;
                            cluster_drawn_ += cut->clusters;
                            cluster_triangles_ += cut->indexCount / 3;
                            cluster_source_triangles_ += resident->indexCount / 3;
                        }
                        if (shading == ShadingMode::Clusters) {
                            // One draw a cluster, each a copy of the entity's record with a colour of its own: a view for
                            // looking at the cut, where a draw a cluster is what is being shown.
                            const lod::ClusterHierarchy& hierarchy = *resident->clusters;
                            u32 first = 0;
                            for (const u32 id : cut->ids) {
                                const u32 count = hierarchy.clusters[id].indexCount;
                                const u32 offset = buffers.allocVertices(LayoutId::MeshInstance, MESH_INSTANCE_STRIDE);
                                auto* records = buffers.vertexData(LayoutId::MeshInstance);
                                std::memcpy(records + offset, records + instOffset, MESH_INSTANCE_STRIDE);
                                const glm::vec4 ink = clusterInk(id);
                                std::memcpy(records + offset + MESH_INSTANCE_TEXEL_TINT * 16, &ink, 16);
                                BatchDrawKey drawn = key;
                                drawn.indexBuffer = cut->buffer;
                                pushBatchDraw(draw_list, clips, offset, 0, first, count, drawn);
                                first += count;
                            }
                            inked = true;
                        }
                    }
                }
                if (!inked && chunked && cutBuffer == BufferHandle::Invalid) {
                    // A skin past one draw's bones, a chunk at a time: each chunk's bones
                    // posed and uploaded alone, its vertices' joints indexing them. A motion draw's record carries last
                    // frame's palette, so each chunk gets a copy of the record with that chunk's bones behind it.
                    static thread_local std::vector<glm::mat4> chunkPose;
                    for (const MeshSkinChunk& chunk : resident->skinChunks) {
                        chunkPose.resize(chunk.boneCount);
                        for (u32 k = 0; k < chunk.boneCount; ++k) {
                            chunkPose[k] = pose_scratch_[resident->skinChunkBones[chunk.boneOffset + k]];
                        }
                        u32 record = instOffset;
                        if (motion) {
                            const u32 palette = (3 * chunk.boneCount + MESH_INSTANCE_TEXELS - 1) / MESH_INSTANCE_TEXELS;
                            record = buffers.allocVertices(LayoutId::MeshInstance, MESH_INSTANCE_STRIDE * (1 + palette));
                            u8* records = buffers.vertexData(LayoutId::MeshInstance);
                            std::memcpy(records + record, records + instOffset, MESH_INSTANCE_STRIDE);
                            std::memset(records + record + MESH_INSTANCE_STRIDE, 0, MESH_INSTANCE_STRIDE * palette);
                            const Pose& pose = *poseOf(ctx, entity, kept, false);
                            for (u32 k = 0; k < chunk.boneCount; ++k) {
                                const glm::mat4& m = pose.bonesPrevious[resident->skinChunkBones[chunk.boneOffset + k]];
                                for (u32 row = 0; row < 3; ++row) {
                                    const glm::vec4 r{m[0][row], m[1][row], m[2][row], m[3][row]};
                                    std::memcpy(records + record + (MESH_INSTANCE_TEXELS + k * 3 + row) * 16, &r, 16);
                                }
                            }
                        }
                        key.skinOffset = draw_list.addSkinMatrices(chunkPose.data(), chunk.boneCount);
                        key.skinCount = chunk.boneCount;
                        emitRange(*resident, record, 1, resident->firstIndex + chunk.firstIndex, chunk.indexCount);
                    }
                } else if (!inked) {
                    emit(*resident, instOffset, 1);
                }
                // The edges, as a second draw of the same instance with its own ink: same
                // vertices, the mesh's line list, tested against the surface just drawn.
                if (wire && resident->hasEdges()) {
                    const u32 edgeOffset = buffers.allocVertices(LayoutId::MeshInstance,
                                                                 MESH_INSTANCE_STRIDE);
                    auto* records = buffers.vertexData(LayoutId::MeshInstance);
                    std::memcpy(records + edgeOffset, records + instOffset, MESH_INSTANCE_STRIDE);
                    std::memcpy(records + edgeOffset + MESH_INSTANCE_TEXEL_TINT * 16, &kWireInk, 16);
                    BatchDrawKey edges = key;
                    edges.indexBuffer = resident->edgeIndexBuffer;
                    edges.topology = GfxTopology::Lines;
                    edges.depthBias = 0;
                    edges.depthTest = true;
                    edges.depthWrite = false;
                    // Blended at full alpha: what puts it in the stage AFTER the surface it
                    // is drawn on (a depth layer derives the stage from the blend, and an
                    // opaque line would sort among the surfaces and write depth).
                    edges.blend = BlendMode::Normal;
                    edges.stage = RenderStage::Transparent;
                    pushBatchDraw(draw_list, clips, edgeOffset, 0, 0, resident->edgeIndexCount, edges);
                }
            }
            continue;
        }

        f32 angle = 2.0f * std::atan2(rotation.z, rotation.w);
        bool rotated = std::abs(angle) > 0.001f;
        f32 cosA = 1.0f, sinA = 0.0f;
        if (rotated) {
            cosA = std::cos(angle);
            sinA = std::sin(angle);
        }

        u32 tint = packColor(mesh.color);
        bool tinted = tint != 0xFFFFFFFFu;

        scratch_.resize(mesh.vertices.size());
        for (usize v = 0; v < mesh.vertices.size(); ++v) {
            const auto& in = mesh.vertices[v];
            glm::vec2 local(in.position.x * scale.x, in.position.y * scale.y);
            glm::vec3 world = rotated
                ? glm::vec3(position.x + local.x * cosA - local.y * sinA,
                            position.y + local.x * sinA + local.y * cosA,
                            position.z)
                : glm::vec3(position.x + local.x, position.y + local.y, position.z);
            scratch_[v] = { world, tinted ? mulColor(in.color, tint) : in.color, in.uv };
        }

        appendIndexedBatch(buffers, draw_list, clips,
                           scratch_.data(), static_cast<u32>(scratch_.size()),
                           mesh.indices.data(), static_cast<u32>(mesh.indices.size()), key);
    }
    tick(4);

    if (timing) {
        auto& profiler = FrameProfiler::get();
        if (phases) {
            profiler.add("render.collect.mesh.decompose", phase[0]);
            profiler.add("render.collect.mesh.lod", phase[1]);
            profiler.add("render.collect.mesh.bounds", phase[2]);
            profiler.add("render.collect.mesh.program", phase[3]);
            profiler.add("render.collect.mesh.emit", phase[4]);
        }
        // Which pass walked, how many times, and what the walk cost it: the same meshes are visited once per view of the frame, and the
        // total above cannot say which view the time belongs to.
        // The profiler keeps the name pointer, so these are literals, one set per purpose.
        const f64 spent = es_profile_now_ms() - walkStart;
        switch (ctx.purpose) {
            case RenderPurpose::Scene:
                profiler.add("render.collect.mesh.scene.walks", 1.0);
                profiler.add("render.collect.mesh.scene.visits", static_cast<f64>(walked));
                profiler.add("render.collect.mesh.scene.ms", spent);
                break;
            case RenderPurpose::ShadowDepth:
                profiler.add("render.collect.mesh.depth.walks", 1.0);
                profiler.add("render.collect.mesh.depth.visits", static_cast<f64>(walked));
                profiler.add("render.collect.mesh.depth.ms", spent);
                break;
            case RenderPurpose::Motion:
                profiler.add("render.collect.mesh.motion.walks", 1.0);
                profiler.add("render.collect.mesh.motion.visits", static_cast<f64>(walked));
                profiler.add("render.collect.mesh.motion.ms", spent);
                break;
            default:
                profiler.add("render.collect.mesh.other.walks", 1.0);
                profiler.add("render.collect.mesh.other.visits", static_cast<f64>(walked));
                profiler.add("render.collect.mesh.other.ms", spent);
                break;
        }
    }
    // The counts beside the time, because a phase that grew and one whose UNIT
    // cost grew are different problems and the milliseconds cannot tell them
    // apart. `coldDecompose` is the one that only a first look can be high.
    ES_PROFILE_COUNTER("render.mesh.walked", walked);
    ES_PROFILE_COUNTER("render.mesh.placements", instanceRecords);
    ES_PROFILE_COUNTER("render.mesh.coldDecompose", coldDecompose);
    ES_PROFILE_COUNTER("render.mesh.lodGathers", lodGathers);
    ES_PROFILE_COUNTER("render.mesh.programAsks", programAsks);
    if (ctx.purpose == RenderPurpose::Scene) {
        // Clustered meshes the scene drew, the clusters and triangles they were drawn with, the triangles they have at
        // level 0, and how many of them had their index buffer rewritten because the pick changed.
        ES_PROFILE_COUNTER("render.cluster.meshes", cluster_meshes_);
        ES_PROFILE_COUNTER("render.cluster.clusters", cluster_drawn_);
        ES_PROFILE_COUNTER("render.cluster.triangles", cluster_triangles_);
        ES_PROFILE_COUNTER("render.cluster.sourceTriangles", cluster_source_triangles_);
        ES_PROFILE_COUNTER("render.cluster.rebuilt", cluster_rebuilt_);
    }
    // The scene's own collect says it; a shadow map's, which comes after, would overwrite it with zeroes.
    if (ctx.purpose == RenderPurpose::Scene) {
        // Draws whose view-independent half was kept from an earlier walk, and those derived again because something changed.
        ES_PROFILE_COUNTER("render.mesh.proxy.kept", proxies_kept_);
        ES_PROFILE_COUNTER("render.mesh.proxy.built", proxies_built_);
        // Kept draws the change audit found differing from a fresh derivation, since the plugin started: anything but 0 is a bug.
        ES_PROFILE_COUNTER("render.mesh.proxy.stale", proxies_stale_total_);
        ES_PROFILE_COUNTER("render.prepass.taken", prepassTaken);
        ES_PROFILE_COUNTER("render.prepass.cutout", prepassCutout);
        ES_PROFILE_COUNTER("render.prepass.bent", prepassBent);
        ES_PROFILE_COUNTER("render.prepass.noProgram", prepassNoProgram);
    }
    ES_PROFILE_COUNTER("render.mesh.programCompiles", compiled_this_frame_);
    // Material-owned programs built so far, CUMULATIVE. Read-only: an observer
    // that had to ask for readiness to see it would be the one paying, and the
    // frame it asked about would be clean because of the asking.
    if (ctx.materials != nullptr) {
        ES_PROFILE_COUNTER("render.mesh.materialPrograms", ctx.materials->builtVariantCount());
    }
    if (compiled_this_frame_ > 0) {
        ES_PROFILE_COUNTER("render.mesh.compiledKey", last_compiled_variant_);
    }
    compiled_this_frame_ = 0;
}

}  // namespace esengine
