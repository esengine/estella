// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "MeshPlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../store/MaterialStore.hpp"
#include "../frame/RenderFrame.hpp"
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
u32 skinPose(ecs::Registry& registry, Entity entity, const Mesh& mesh,
             std::vector<glm::mat4>& out, bool& warnedBones) {
    if (!mesh.isSkinned()) return 0;
    const auto* skin = registry.tryGet<ecs::MeshSkin>(entity);
    if (!skin || skin->joints.size() != mesh.inverseBind.size()) return 0;
    // Posing the first MESH_MAX_BONES leaves the rest indexing a matrix this
    // draw never uploads — the wrong-matrix read the count check above already
    // rejects, so it takes the same answer. For files no importer here wrote.
    if (skin->joints.size() > MESH_MAX_BONES) {
        if (!warnedBones) {
            warnedBones = true;
            ES_LOG_WARN("MeshSkin: {} joints exceeds the {} one draw can be posed by; drawing the"
                        " bind pose", skin->joints.size(), MESH_MAX_BONES);
        }
        return 0;
    }
    const u32 count = static_cast<u32>(skin->joints.size());

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
        const glm::mat4 world = glm::translate(glm::mat4(1.0f), joint->worldPosition)
                              * glm::mat4_cast(joint->worldRotation)
                              * glm::scale(glm::mat4(1.0f), joint->worldScale);
        out[i] = world * mesh.inverseBind[i];
    }
    return count;
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
 *        no usable stand-in, which leaves the renderer's own mesh the whole answer.
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
    return out.set.count > 0;
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
                bool envMapped) {
    return (normals ? 1u : 0u) | (lit ? 2u : 0u) | (normalMapped ? 4u : 0u)
         | (skinned ? 8u : 0u) | (depthOnly ? 16u : 0u) | (envMapped ? 32u : 0u);
}
}  // namespace

void MeshPlugin::init(RenderFrameContext& ctx) {
    // A rebuild after a lost device runs this again, and every program minted
    // against the dead context is gone — so the cache empties here rather than
    // handing out ids that name nothing. The RESOURCES are released, not just
    // forgotten: a shader nobody holds still sits in the pool, gets recompiled
    // on the next loss, and keeps a host program object alive for good.
    for (auto& shader : mesh_shaders_) {
        if (shader.isValid()) ctx.resources.releaseShader(shader);
        shader = {};
    }
    mesh_compiled_.fill(false);
    mesh_programs_.fill(0);
    // The base variant now, so a broken shader is a boot-time failure rather than
    // one that waits for the first mesh; the rest compile when a draw asks.
    meshProgram(ctx, false, false, false, false);
}

/**
 * One permutation of the resident-mesh program, compiled on demand.
 *
 * A vertex layout may only declare attributes its shader consumes, so the
 * geometry's own channels pick half of it; the draw's `lit` picks the other half,
 * and unlit geometry carrying normals still has to declare them.
 */
u32 MeshPlugin::meshProgram(RenderFrameContext& ctx, bool normals, bool lit, bool normalMapped,
                            bool skinned, bool depthOnly, bool envMapped) {
    const u32 variant = meshVariant(normals, lit, normalMapped, skinned, depthOnly, envMapped);
    if (mesh_compiled_[variant]) return mesh_programs_[variant];
    mesh_compiled_[variant] = true;
    // Counted because the cost of this function is entirely the times it does
    // NOT return above: every frame asks once per mesh, and only the first frame
    // that needs a variant pays for it.
    ++compiled_this_frame_;

    std::vector<std::string> features;
    if (normals) features.emplace_back("MESH_NORMALS");
    if (lit) features.emplace_back("LIT");
    if (normalMapped) features.emplace_back("NORMAL_MAP");
    if (skinned) features.emplace_back("SKINNED");
    if (depthOnly) features.emplace_back("SHADOW_DEPTH");
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
            {}, ctx.resources.preferredShaderLanguage());
        Shader* shader = ctx.resources.getShader(handle);
        if (!shader || !shader->isValid()) return 0;
        if (shader->language() == GfxShaderLanguage::GLSL_ES300) {
            shader->bind();
            shader->setUniform("u_texture", 0);
            // Slot 1 is where a draw's own second texture is bound (see pushBatchDraw).
            if (normalMapped) shader->setUniform("u_normalMap", 1);
            shader->unbind();
        }
        return shader->getProgramId();
    };
    mesh_programs_[variant] = compile(features);
    return mesh_programs_[variant];
}

void MeshPlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& frustum = collect_ctx.frustum;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    auto meshView = registry.view<ecs::Transform, ecs::MeshRenderer>();
    // Read once: the phase is the same for every mesh this collect walks.
    const bool shadowDepth = ctx.purpose == RenderPurpose::ShadowDepth;

    u32 litProgram = 0;

    // Accumulated, not scoped per mesh: a ScopeTimer pair per phase per entity
    // puts its own cost inside the number it reports. One clock read per
    // boundary, and the end of one phase is the start of the next.
    const bool timing = FrameProfiler::get().enabled();
    f64 phase[5] = {0, 0, 0, 0, 0};
    f64 mark = timing ? es_profile_now_ms() : 0.0;
    u32 walked = 0, coldDecompose = 0, lodGathers = 0, programAsks = 0;
    const auto tick = [&](int slot) {
        if (!timing) return;
        const f64 now = es_profile_now_ms();
        phase[slot] += now - mark;
        mark = now;
    };

    for (auto entity : meshView) {
        ++walked;
        const auto& mesh = meshView.get<ecs::MeshRenderer>(entity);
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
            ? transform.worldPosition
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
        if (shadowDepth && !resident) continue;

        // A collect with no LOD memory must not select: a shadow map's own screen
        // size means nothing to a player, and borrowing a camera's answer would
        // make the answer the entity's rather than each view's.
        LodLevels levels;
        const ecs::LODGroup* group = nullptr;
        if (collect_ctx.lod.state && resident) {
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
        const glm::vec3 localMin = group ? levels.localMin
                                 : resident ? resident->localMin : glm::vec3(mesh.localMin, 0.0f);
        const glm::vec3 localMax = group ? levels.localMax
                                 : resident ? resident->localMax : glm::vec3(mesh.localMax, 0.0f);

        glm::vec3 aabbCenter(0.0f), halfExtents(0.0f);
        orientedWorldAabb(position, rotation, scale, localMin, localMax, aabbCenter, halfExtents);
        if (!frustum.intersectsAABB(aabbCenter, halfExtents)) {
            ++collect_ctx.culled;
            tick(2);
            continue;
        }

        // Nothing visible is worth measuring precisely, so the cull runs first; what
        // survives it is measured on the sphere the whole group shares.
        if (group) {
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
        // Only meaningful with normals to perturb AND a draw that takes light.
        u32 normalTextureId = 0;
        if (mesh.normalMap.isValid() && mesh.lit && resident && resident->hasNormals) {
            if (Texture* tex = ctx.resources.getTexture(mesh.normalMap)) {
                normalTextureId = tex->getId();
            }
        }

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
            if (const MaterialRecord* m = ctx.materials ? ctx.materials->find(mesh.material) : nullptr) {
                key.shaderId = (m->shader != 0) ? m->shader : ctx.batch_shader_id;
                key.blend = m->blend;
                key.materialId = mesh.material;
                key.depthTest = m->depthTest;
                key.depthWrite = m->depthWrite;
                key.cull = static_cast<u8>(m->cull);
            }
        } else if (mesh.lit && ctx.frame) {
            if (litProgram == 0) litProgram = ctx.frame->batchProgram({"LIT"});
            if (litProgram != 0) key.shaderId = litProgram;
        }

        // Casting into a shadow map: opaque and depth-tested whatever the camera's
        // pass makes it, and none of the three ways to describe a surface — lit, a
        // normal map, a material. LAST, so the pass outranks all three.
        if (shadowDepth) {
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
            const u32 residentShader =
                meshProgram(ctx, resident->hasNormals, mesh.lit && !shadowDepth,
                            normalTextureId != 0 && !shadowDepth, skinned, shadowDepth,
                            key.envTextureId != 0);
            tick(3);
            if (resident->isDrawable() && residentShader != 0) {
                const u32 stride = skinned ? MESH_INSTANCE_STRIDE_SKINNED
                                 : resident->hasNormals ? MESH_INSTANCE_STRIDE_LIT
                                 : MESH_INSTANCE_STRIDE;
                u32 instOffset = buffers.allocVertices(LayoutId::MeshInstance, stride);
                auto* dst = buffers.vertexData(LayoutId::MeshInstance) + instOffset;
                u32 tintRGBA = packColor(mesh.color);
                if (skinned) {
                    std::memcpy(dst, &tintRGBA, 4);
                    key.skinOffset = draw_list.addSkinMatrices(pose_scratch_.data(), poseSize);
                    key.skinCount = poseSize;
                } else {
                glm::mat4 model = glm::translate(glm::mat4(1.0f), position)
                                * glm::mat4_cast(rotation)
                                * glm::scale(glm::mat4(1.0f), scale);
                std::memcpy(dst, &model[0][0], 64);
                std::memcpy(dst + 64, &tintRGBA, 4);
                if (resident->hasNormals) {
                    // Written per object rather than derived per vertex: this is
                    // the transform a normal takes under a non-uniform scale.
                    const glm::mat3 nrm = glm::transpose(glm::inverse(glm::mat3(model)));
                    for (u32 row = 0; row < 3; ++row) {
                        std::memcpy(dst + 68 + row * 12, &nrm[row][0], 12);
                    }
                }
                }

                // A material's default program is built for the BATCH vertex
                // source and would draw this at its local origin, so ask for the
                // one compiled for THIS source; a failed variant falls back.
                u32 materialProgram = 0;
                if (key.materialId != 0 && ctx.materials) {
                    materialProgram = ctx.materials->meshProgram(key.materialId, ctx.resources,
                                                                 resident->hasNormals, skinned,
                                                                 key.envTextureId != 0);
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
                key.layoutId = LayoutId::MeshInstance;
                key.instanceCount = 1;
                key.instanceStride = stride;
                key.vertexBuffer = resident->vertexBuffer;
                key.indexBuffer = resident->indexBuffer;
                key.vertexLayout = resident->layout;
                pushBatchDraw(draw_list, clips, instOffset, 0, 0, resident->indexCount, key);
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
    }
    // The counts beside the time, because a phase that grew and one whose UNIT
    // cost grew are different problems and the milliseconds cannot tell them
    // apart. `coldDecompose` is the one that only a first look can be high.
    ES_PROFILE_COUNTER("render.mesh.walked", walked);
    ES_PROFILE_COUNTER("render.mesh.coldDecompose", coldDecompose);
    ES_PROFILE_COUNTER("render.mesh.lodGathers", lodGathers);
    ES_PROFILE_COUNTER("render.mesh.programAsks", programAsks);
    ES_PROFILE_COUNTER("render.mesh.programCompiles", compiled_this_frame_);
    compiled_this_frame_ = 0;
}

}  // namespace esengine
