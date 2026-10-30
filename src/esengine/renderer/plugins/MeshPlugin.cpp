// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "MeshPlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../store/MaterialStore.hpp"
#include "../store/MorphConstants.hpp"
#include "../store/ProbeConstants.hpp"
#include "../frame/RenderFrame.hpp"
#include "../frame/RenderContext.hpp"
#include "../rhi/Texture.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/MeshRenderer.hpp"
#include "../../ecs/components/LODGroup.hpp"
#include "../../resource/Mesh.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../../core/Log.hpp"
#include "../../core/FrameProfiler.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/matrix_inverse.hpp>
#include <glm/gtc/matrix_access.hpp>

#include <algorithm>
#include <cmath>
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
    // rejects, so it takes the same answer. For files no importer here wrote.
    if (joints > MESH_MAX_BONES) {
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

/**
 * @brief The levels a group can actually be drawn at, in the order they take over.
 *
 * @details Entry 0 is the renderer's own mesh: a group says what may STAND IN for
 *          it. `localMin/Max` are the UNION over every entry, so what is measured
 *          does not change with what is drawn — bounds read off the current level
 *          feed back into the choice that picked it and oscillate.
 */
struct LodLevels {
    const Mesh* mesh[lod::kMaxStandIns + 1]{};
    lod::LevelSet set;
    glm::vec3 localMin{0.0f};
    glm::vec3 localMax{0.0f};
    /// A slot filled after an empty one, which nothing will ever select.
    bool gap = false;
    /// Thresholds that do not descend, or a stand-in the base's skeleton cannot pose.
    bool disordered = false;
    bool skinMismatch = false;
};

/**
 * @brief Reads a group into the levels it can be drawn at. False when it declares
 *        neither a usable stand-in nor a cull size, which leaves the renderer's own
 *        mesh the whole answer. A group with only a cull size is a real one: the
 *        mesh itself to a distance, then nothing (a tuft of grass has no cheaper
 *        version, and still is not worth drawing past sixty metres).
 */
bool gatherLodLevels(resource::ResourceManager& resources, const ecs::LODGroup& group,
                     const Mesh& base, LodLevels& out) {
    out = LodLevels{};
    out.mesh[0] = &base;
    out.localMin = base.localMin;
    out.localMax = base.localMax;
    out.set.cull = group.cullSize;
    out.set.hysteresis = group.hysteresis;

    const resource::MeshHandle handles[lod::kMaxStandIns] = {group.lod1, group.lod2, group.lod3};
    const f32 sizes[lod::kMaxStandIns] = {group.lod1Size, group.lod2Size, group.lod3Size};
    for (u8 i = 0; i < lod::kMaxStandIns; ++i) {
        const Mesh* standIn = handles[i].isValid() ? resources.getMesh(handles[i]) : nullptr;
        if (!standIn || !standIn->isDrawable()) {
            // Ordered slots: a level nothing hands over TO is a level nothing
            // reaches, so the run ends here and a later one is an authoring gap.
            for (u8 j = static_cast<u8>(i + 1); j < lod::kMaxStandIns; ++j) {
                if (handles[j].isValid()) out.gap = true;
            }
            break;
        }
        if (base.isSkinned() && standIn->inverseBind.size() != base.inverseBind.size()) {
            out.skinMismatch = true;
            break;
        }
        if (i > 0 && sizes[i] >= sizes[i - 1]) out.disordered = true;
        out.mesh[i + 1] = standIn;
        out.set.takeOver[i] = sizes[i];
        out.set.count = static_cast<u8>(i + 1);
        out.localMin = glm::min(out.localMin, standIn->localMin);
        out.localMax = glm::max(out.localMax, standIn->localMax);
    }
    // A skin whose stand-in the skeleton cannot pose is refused whole: a cull size alone is not a reason to keep a group that was authored against
    // levels it cannot have.
    return out.set.count > 0 || (out.set.cull > 0.0f && !out.skinMismatch);
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
                bool motion = false, bool tangents = false) {
    return (normals ? 1u : 0u) | (lit ? 2u : 0u) | (normalMapped ? 4u : 0u)
         | (skinned ? 8u : 0u) | (depthOnly ? 16u : 0u) | (envMapped ? 32u : 0u)
         | (lightmapped ? 64u : 0u) | (weightHeat ? 128u : 0u) | (gbuffer ? 256u : 0u)
         | (motion ? 512u : 0u) | (tangents ? 1024u : 0u);
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
    } else if (mode == ShadingMode::Clay) {
        mesh.texture = {};
        mesh.color = glm::vec4(0.74f, 0.74f, 0.76f, 1.0f);
        mesh.lit = true;
    } else {
        mesh.lit = false;
    }
}

struct MeshDrawKeys {
    u32 variant = 0;
    u32 normalTextureId = 0;
};

u32 meshVariantFrom(const MeshProgramFacts& facts, bool envMapped, bool shadowDepth, bool weightHeat = false,
                    bool gbuffer = false) {
    // `lightmapped` and `tangents` survive the shadow pass, unlike the three describing shading: each declares a vertex attribute.
    // Weights are read off the surface of a skinned draw and nothing else's: the colour is
    // the shade, so it asks for no light, no normal map and no depth pass of its own.
    const bool heat = weightHeat && facts.skinned && !shadowDepth;
    const bool lit = facts.lit && !shadowDepth && !heat;
    // The surface record is for what takes light: an unlit surface has no normal worth recording.
    return meshVariant(facts.hasNormals, lit,
                       facts.normalTextureId != 0 && !shadowDepth && !heat, facts.skinned, shadowDepth,
                       envMapped, facts.lightmapped, heat, gbuffer && lit, false, facts.tangents);
}

/** @brief The facts a LIVE entity answers with: its components and its mesh. */
MeshProgramFacts meshFactsFromEntity(RenderFrameContext& ctx, ecs::Registry& registry,
                                     Entity entity, const ecs::MeshRenderer& mesh,
                                     const Mesh* resident, bool& warnedBones) {
    MeshProgramFacts facts;
    facts.hasNormals = resident && resident->hasNormals;
    facts.lit = mesh.lit;
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

MeshDrawKeys meshDrawFor(RenderFrameContext& ctx, ecs::Registry& registry, Entity entity,
                         const ecs::MeshRenderer& mesh, const Mesh* resident, bool shadowDepth,
                         bool& warnedBones, bool weightHeat = false) {
    const MeshProgramFacts facts =
        meshFactsFromEntity(ctx, registry, entity, mesh, resident, warnedBones);
    return { meshVariantFrom(facts, ctx.environment_texture_id != 0
                || (!shadowDepth && ctx.frame && ctx.frame->planarTextureFor(entity) != 0), shadowDepth, weightHeat,
                ctx.gbuffer && !shadowDepth),
             facts.normalTextureId };
}
}  // namespace

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
    const bool tangents = (variant & 1024u) != 0;
    if (mesh_compiled_[variant]) return mesh_programs_[variant];
    mesh_compiled_[variant] = true;
    // Counted because the cost of this function is entirely the times it does
    // NOT return above: every frame asks once per mesh, and only the first frame
    // that needs a variant pays for it. WHICH one is the other half — a readiness
    // that missed a requirement is named by the key that had to be built late.
    ++compiled_this_frame_;
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
            {}, ctx.resources.preferredShaderLanguage(), ctx.resources.deferLinks());
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
    if (gbuffer && mesh_programs_[variant] != 0 && ctx.materials) ctx.materials->markGBufferProgram(mesh_programs_[variant]);
    return mesh_programs_[variant];
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
            const u32 variant = meshVariantFrom(facts[i], envMapped, shadowDepth);
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
                                       facts[i].skinned, envMapped, facts[i].lightmapped, false, facts[i].tangents);
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

void MeshPlugin::trackPose(const RenderFrameContext& ctx, Entity entity, const glm::mat4& model,
                           const std::vector<glm::mat4>* bones) {
    Pose& pose = poses_[poseKey(ctx, entity)];
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

namespace {
/**
 * @brief Writes the placements of a MeshInstances as instances of one draw per level of detail.
 *
 * @details Each placement is judged on its own: past `drawDistance` from the eye it is not drawn, outside the view it is not drawn, and
 *          past `lodDistance` it is the cheaper mesh. The eye is the SCENE camera's whatever pass this is, so a shadow map is cut
 *          by the distance from the camera and not from the light. What stays is a record each (the entity's model times the
 *          placement, its tint, its normal matrix) and one draw a level.
 */
template <typename Emit>
void emitPlacements(const RenderFrameContext& ctx, RenderCollectContext& collect, const ecs::MeshInstances& set,
                    const ecs::MeshRenderer& mesh, const glm::vec3& position, const glm::quat& rotation,
                    const glm::vec3& scale, const Mesh& fine, const Mesh* coarse, u32& records, Emit&& emit) {
    static thread_local std::vector<u32> nearList, farList;
    nearList.clear();
    farList.clear();
    const glm::mat4 entityModel = glm::translate(glm::mat4(1.0f), position) * glm::mat4_cast(rotation) * glm::scale(glm::mat4(1.0f), scale);
    const f32 entityScale = std::max(std::abs(scale.x), std::max(std::abs(scale.y), std::abs(scale.z)));
    const f32 reach = glm::length(glm::max(glm::abs(fine.localMin), glm::abs(fine.localMax)));
    const bool eyeKnown = ctx.has_view_eye;
    const u32 count = static_cast<u32>(set.transforms.size() / 16);
    u32 tooFar = 0, outside = 0;
    for (u32 i = 0; i < count; ++i) {
        const f32* r = set.transforms.data() + static_cast<usize>(i) * 16;
        const glm::vec3 at = glm::vec3(entityModel * glm::vec4(r[3], r[7], r[11], 1.0f));
        const f32 c0 = r[0] * r[0] + r[4] * r[4] + r[8] * r[8];
        const f32 c1 = r[1] * r[1] + r[5] * r[5] + r[9] * r[9];
        const f32 c2 = r[2] * r[2] + r[6] * r[6] + r[10] * r[10];
        const f32 radius = reach * std::sqrt(std::max(c0, std::max(c1, c2))) * entityScale;
        f32 distance = 0.0f;
        if (eyeKnown) {
            distance = glm::distance(at, ctx.view_eye);
            if (set.drawDistance > 0.0f && distance - radius > set.drawDistance) { ++tooFar; continue; }
            if (distance + radius < set.minDistance) continue;
            if (ctx.purpose == RenderPurpose::ShadowDepth && set.shadowDistance > 0.0f && distance - radius > set.shadowDistance) continue;
        }
        if (!collect.visible(at, glm::vec3(radius), false)) { ++outside; continue; }
        if (ctx.purpose == RenderPurpose::ShadowDepth && !collect.castsIntoView(at, radius)) { ++outside; continue; }
        (coarse && eyeKnown && set.lodDistance > 0.0f && distance > set.lodDistance ? farList : nearList).push_back(i);
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
}  // namespace

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
    if (!motion && ctx.track_motion && ctx.motion_frame % 256 == 0) {
        for (auto it = poses_.begin(); it != poses_.end();) {
            it = it->second.frame + 8 < ctx.motion_frame ? poses_.erase(it) : std::next(it);
        }
    }

    u32 litProgram = 0;
    // The mesh as this view's mode describes it; one object reused across the walk.
    const ShadingMode shading = depthPass ? ShadingMode::Shaded : collect_ctx.shading;
    ecs::MeshRenderer shaded;

    // Accumulated, not scoped per mesh: a ScopeTimer pair per phase per entity
    // puts its own cost inside the number it reports. One clock read per
    // boundary, and the end of one phase is the start of the next.
    const bool timing = FrameProfiler::get().enabled();
    f64 phase[5] = {0, 0, 0, 0, 0};
    f64 mark = timing ? es_profile_now_ms() : 0.0;
    u32 walked = 0, coldDecompose = 0, lodGathers = 0, programAsks = 0, instanceRecords = 0;
    // Where the scene's opaque meshes went in the choice of a depth prepass: taken, left out for a cut-out or a bent vertex, or no program to be had.
    u32 prepassTaken = 0, prepassCutout = 0, prepassBent = 0, prepassNoProgram = 0;
    const auto tick = [&](int slot) {
        if (!timing) return;
        const f64 now = es_profile_now_ms();
        phase[slot] += now - mark;
        mark = now;
    };

    for (auto entity : meshView) {
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
        if (!transform.decomposed_) ++coldDecompose;
        // Parallax is a CAMERA trick — a renderable shifted toward the view centre to
        // scroll slower. A shadow pass looks from a light, whose centre means nothing to
        // it, and its map is fitted to unshifted bounds: a caster stands where it is.
        transform.ensureDecomposed();
        const glm::vec3 position = shadowDepth
            ? rebased(transform.worldPosition)
            : parallaxedWorldPosition(transform, mesh.parallax, collect_ctx.camera);
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;
        tick(0);

        // Bounds come from whichever geometry this is: a resident mesh keeps its
        // own, and the inline payload's are recomputed on upload. Reading the
        // component's for a resident mesh would cull it against an empty box.
        const Mesh* resident = mesh.mesh.isValid() ? ctx.resources.getMesh(mesh.mesh) : nullptr;
        // Only GPU-resident geometry casts: the inline payload takes the CPU path
        // below, which bakes world space into vertices for the BATCH shader — a
        // shader that writes colour, not the depth this pass is here to collect.
        if (depthPass && !resident) continue;
        // Many placements of one mesh, drawn as instances of it. What is placed does not move on its own, so the motion pass has nothing to say.
        const ecs::MeshInstances* placements = resident ? registry.tryGet<ecs::MeshInstances>(entity) : nullptr;
        if (placements && (placements->transforms.empty() || motion)) continue;
        // What light passes through (water) stands in no light's way.
        if (shadowDepth && !mesh.castShadows) continue;
        // Only a surface that draws opaque and unblended has a motion worth writing: what is blended over
        // something has two, and the picture can follow one.
        if (motion && !mesh.opaque) continue;

        // A collect with no LOD memory must not select: a shadow map's own screen
        // size means nothing to a player, and borrowing a camera's answer would
        // make the answer the entity's rather than each view's.
        LodLevels levels;
        const ecs::LODGroup* group = nullptr;
        if (collect_ctx.lod.state && resident && !placements) {
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
        // A set of placements is bounded by where they stand, grown by how far the mesh reaches from its origin at the greatest scale.
        const glm::vec3 reach = (placements ? glm::max(glm::abs(resident->localMin), glm::abs(resident->localMax)) * placements->maxScale
                                            : glm::vec3(0.0f));
        const glm::vec3 localMin = placements ? placements->originMin - reach
                                 : group ? levels.localMin
                                 : resident ? resident->localMin : glm::vec3(mesh.localMin, 0.0f);
        const glm::vec3 localMax = placements ? placements->originMax + reach
                                 : group ? levels.localMax
                                 : resident ? resident->localMax : glm::vec3(mesh.localMax, 0.0f);

        // BEFORE the cull, because whether this draw depth-tests decides if an
        // occluder may refuse it, and the material is where that is finally said.
        // Reused by the draw key below: two lookups is how the two come to differ.
        const MaterialRecord* material = (mesh.material != 0 && ctx.materials)
            ? ctx.materials->find(mesh.material) : nullptr;
        // A material that bends its vertices can put them outside the mesh's own box; culling the
        // box would drop a bent mesh that is still on screen, so it grows by what the material says.
        const f32 bend = material ? ctx.materials->vertexBounds(mesh.material) : 0.0f;
        const bool depthTested = material ? material->depthTest : mesh.opaque;

        glm::vec3 aabbCenter(0.0f), halfExtents(0.0f);
        orientedWorldAabb(position, rotation, scale, localMin - glm::vec3(bend), localMax + glm::vec3(bend),
                          aabbCenter, halfExtents);
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
            const f32 screenSize = lod::screenRelativeSize(ctx.view_projection, centre, radius);
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
        tick(2);

        u32 textureId = ctx.white_texture_id;
        if (mesh.texture.isValid()) {
            if (Texture* tex = ctx.resources.getTexture(mesh.texture)) {
                textureId = tex->getId();
            }
        }
        MeshDrawKeys keys{};
        if (motion) {
            // What was drawn last frame and what is drawn now, for THIS view. Nothing known, or nothing changed,
            // means the camera's own motion says it all and the temporal pass already has that.
            const auto pose = poses_.find(poseKey(ctx, entity));
            if (pose == poses_.end() || pose->second.frame != ctx.motion_frame
                || (pose->second.previous == pose->second.current
                    && pose->second.bonesPrevious == pose->second.bonesCurrent)) {
                continue;
            }
            const MeshProgramFacts facts =
                meshFactsFromEntity(ctx, registry, entity, mesh, resident, warned_bones_);
            // A palette of a different size than last frame's has no joint-for-joint past to follow.
            if (facts.skinned && pose->second.bonesPrevious.size() != pose->second.bonesCurrent.size()) continue;
            keys = { meshVariant(facts.hasNormals, false, false, facts.skinned, false, false, false, false, false, true, facts.tangents), 0 };
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
                key.depthTest = m->depthTest;
                key.depthWrite = m->depthWrite;
                key.cull = static_cast<u8>(m->cull);
                key.depthBias = m->depthBias;
            }
        } else if (mesh.lit && ctx.frame) {
            if (litProgram == 0) litProgram = ctx.frame->batchProgram({"LIT"});
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
            const u32 poseSize = skinPose(registry, entity, *resident, pose_scratch_, warned_bones_);
            const bool skinned = poseSize > 0;

            // `lit` is the draw's own word and is honoured either way: geometry
            // with normals can be drawn unlit, and geometry without them takes
            // light off the constant normal a 2D surface has.
            tick(4);
            ++programAsks;
            const u32 residentShader = meshProgram(ctx, keys.variant);
            tick(3);
            if (resident->isDrawable() && residentShader != 0) {
                // The shape the mesh was REALIZED in, not a second derivation:
                // the record is read through that layout, so the fact that built
                // it must pack it. (It already excludes a skinned mesh.)
                const bool lightmapped = resident->hasLightmapUV && !motion;
                // A skinned motion draw carries last frame's palette in the records right behind its own: three
                // texels a bone from texel 8 on, which the shader reaches by index like any other texel.
                const u32 paletteRecords = motion && skinned ? (3 * poseSize + MESH_INSTANCE_TEXELS - 1) / MESH_INSTANCE_TEXELS : 0;
                u32 instOffset = buffers.allocVertices(LayoutId::MeshInstance,
                                                       MESH_INSTANCE_STRIDE * (1 + paletteRecords));
                auto* dst = buffers.vertexData(LayoutId::MeshInstance) + instOffset;
                // The record is one fixed shape, so every texel this variant
                // does not write still has to say something. Zero is the answer
                // each of them reads as absent.
                std::memset(dst, 0, MESH_INSTANCE_STRIDE * (1 + paletteRecords));
                // The shapes, whether or not bones move it: the two deform the
                // same vertices, and a morph target is what the mesh is BEFORE a
                // pose is applied to it.
                MorphConstants shapes{};
                if (morphShapes(registry, entity, *resident, shapes)) {
                    key.morphIndex = draw_list.addMorphShapes(shapes);
                    key.morphTextureId = static_cast<u32>(resident->morphTexture);
                }
                std::memcpy(dst + MESH_INSTANCE_TEXEL_TINT * 16, &mesh.color, 16);
                if (skinned) {
                    key.skinOffset = draw_list.addSkinMatrices(pose_scratch_.data(), poseSize);
                    key.skinCount = poseSize;
                } else {
                glm::mat4 model = glm::translate(glm::mat4(1.0f), position)
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
                    const glm::mat3 nrm = glm::transpose(glm::inverse(glm::mat3(model)));
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
                if (motion) {
                    // This record is the motion pass's own, so the texels a lit draw keeps its tint, normal
                    // matrix and bake in are free: last frame's shift in the tint's, and last frame's
                    // view-projection times last frame's model — as rows, so the shader dots them with the local position.
                    const Pose& pose = poses_.find(poseKey(ctx, entity))->second;
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
                    if (skinned) {
                        for (u32 bone = 0; bone < poseSize; ++bone) {
                            const glm::mat4& m = pose.bonesPrevious[bone];
                            for (u32 row = 0; row < 3; ++row) {
                                const glm::vec4 r{m[0][row], m[1][row], m[2][row], m[3][row]};
                                std::memcpy(dst + (MESH_INSTANCE_TEXELS + bone * 3 + row) * 16, &r, 16);
                            }
                        }
                    }
                } else if (ctx.track_motion && !shadowDepth) {
                    trackPose(ctx, entity,
                              skinned ? glm::mat4(1.0f)
                                      : glm::translate(glm::mat4(1.0f), position)
                                            * glm::mat4_cast(rotation)
                                            * glm::scale(glm::mat4(1.0f), scale),
                              skinned ? &pose_scratch_ : nullptr);
                }

                // A draw reading its own atlas does not ask for IRRADIANCE, and asks
                // for its reflection either way — a lightmapped wall mirrors the room
                // like anything else. At the ENTITY's position: bones place a skin.
                if (!depthPass) {
                    ProbeConstants probe;
                    const bool volume = key.lightmapTextureId == 0
                        && ctx.render_context.probes().sample(position, probe);
                    const u32 slot = ctx.render_context.reflections().slotAt(position);
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
                                                                 resident->hasTangents);
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
                if (!depthPass && !motion && ctx.purpose == RenderPurpose::Scene && mesh.opaque && key.stage == RenderStage::Opaque
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
                            const u32 depthVariant = meshDrawFor(ctx, registry, entity, mesh, resident, true, warned_bones_).variant;
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
                const auto emit = [&](const Mesh& geo, u32 offset, u32 count) {
                    BatchDrawKey drawn = key;
                    drawn.instanceCount = count;
                    drawn.vertexBuffer = geo.vertexBuffer;
                    drawn.indexBuffer = geo.indexBuffer;
                    drawn.vertexLayout = geo.layout;
                    pushBatchDraw(draw_list, clips, offset, 0, 0, geo.indexCount, drawn);
                    if (!depthPass && !wire && key.materialId != 0 && ctx.materials && ctx.materials->hasTipPass(key.materialId)) {
                        const u32 tipProgram = ctx.materials->meshProgram(key.materialId, ctx.resources, geo.hasNormals, skinned,
                                                                          key.envTextureId != 0, geo.hasLightmapUV, false,
                                                                          geo.hasTangents, true);
                        if (tipProgram != 0) {
                            BatchDrawKey tips = drawn;
                            tips.shaderId = tipProgram;
                            tips.stage = RenderStage::Transparent;
                            tips.blend = BlendMode::Normal;
                            tips.depthWrite = false;
                            pushBatchDraw(draw_list, clips, offset, 0, 0, geo.indexCount, tips);
                        }
                    }
                };
                if (placements) {
                    // The record written for the entity above is not drawn: the instances are, each with a record of its own.
                    const Mesh* coarse = placements->lod1Mesh.isValid() ? ctx.resources.getMesh(placements->lod1Mesh) : nullptr;
                    if (coarse && (!coarse->isDrawable() || coarse->hasNormals != resident->hasNormals
                                   || coarse->hasTangents != resident->hasTangents || coarse->hasLightmapUV != resident->hasLightmapUV)) {
                        coarse = nullptr;
                    }
                    emitPlacements(ctx, collect_ctx, *placements, mesh, position, rotation, scale, *resident, coarse, instanceRecords, emit);
                    continue;
                }
                key.vertexBuffer = resident->vertexBuffer;
                key.indexBuffer = resident->indexBuffer;
                key.vertexLayout = resident->layout;
                emit(*resident, instOffset, 1);
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
        profiler.add("render.collect.mesh.decompose", phase[0]);
        profiler.add("render.collect.mesh.lod", phase[1]);
        profiler.add("render.collect.mesh.bounds", phase[2]);
        profiler.add("render.collect.mesh.program", phase[3]);
        profiler.add("render.collect.mesh.emit", phase[4]);
        // Which pass walked, how many times, and what the walk cost it: the same meshes are visited once per view of the frame, and the
        // total above cannot say which view the time belongs to.
        // The profiler keeps the name pointer, so these are literals, one set per purpose.
        const f64 spent = phase[0] + phase[1] + phase[2] + phase[3] + phase[4];
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
    // The scene's own collect says it; a shadow map's, which comes after, would overwrite it with zeroes.
    if (ctx.purpose == RenderPurpose::Scene) {
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
