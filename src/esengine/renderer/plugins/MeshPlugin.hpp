// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <array>
#include "../RenderTypePlugin.hpp"
#include "../draw/BatchVertex.hpp"
#include "../../resource/Handle.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <unordered_map>
#include <vector>

namespace esengine {

class Mesh;
struct MaterialRecord;
class MaterialStore;
namespace ecs {
struct MeshRenderer;
struct Transform;
}  // namespace ecs

/**
 * @brief Scene-level 2D mesh renderer (MeshRenderer component).
 * @details Streams component-local geometry through the unified Batch face each
 *          frame — CPU-transformed like every 2D renderable — so meshes sort, clip,
 *          light, and multi-texture-merge exactly like sprites. The whole plugin is
 *          "vertices + BatchDrawKey + append": no bottom-layer changes.
 */
class MeshPlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    /// Resident geometry is the only thing the engine draws depth-only. A flat
    /// renderable's shadow is ShadowCaster2D's to cast, not the map's.
    bool castsShadows() const override { return true; }
    bool drawsMotion() const override { return true; }
    bool castInputs(RenderFrameContext& ctx, ecs::Registry& registry, u64& key) override;
    void collect(RenderCollectContext& ctx) override;
    RenderPrewarmResult prewarm(RenderFrameContext& ctx, ecs::Registry& registry,
                                const Entity* entities, u32 count, bool shadowPasses) override;
    /** @brief Ready programs from facts already gathered — the door a PREPARED
     *         cell comes through, before any entity of it exists. */
    RenderPrewarmResult prewarmFacts(RenderFrameContext& ctx, const MeshProgramFacts* facts,
                                     u32 count, bool shadowPasses, bool residentGeometry);
    RenderPrewarmResult prewarmDocument(RenderFrameContext& ctx, const MeshDocumentRecord* rows,
                                        u32 count, bool shadowPasses) override;
    const char* collectScope() const override { return "render.collect.mesh"; }

private:
    /** Shader variants compiled during the current collect — see meshProgram. */
    u32 compiled_this_frame_ = 0;
    /** The last one built, so a late compile can be named rather than counted. */
    u32 last_compiled_variant_ = 0;
    std::vector<BatchVertex> scratch_;  ///< Reused per mesh; amortizes the transform buffer.
    /// Resident-geometry programs, indexed by {has normals, lit, normal-mapped,
    /// skinned, depth-only, environment-mapped, lightmapped}: what the geometry
    /// carries and what the draw asked for are separate. Compiled on first use.
    std::array<u32, MESH_VARIANTS> mesh_programs_{};
    std::array<bool, MESH_VARIANTS> mesh_compiled_{};
    /// The shader RESOURCES behind those ids, kept because init() runs again
    /// after a device rebuild: with no handle to release, each rebuild left a
    /// dead shader in the pool and one more program the host never freed.
    std::array<resource::ShaderHandle, MESH_VARIANTS> mesh_shaders_{};
    /// One entity's bone matrices while they are being built; reused per draw.
    std::vector<glm::mat4> pose_scratch_;
    u32 meshProgram(RenderFrameContext& ctx, u32 variant);

    /// Where one mesh stood the last two times a view drew it: the motion between them is what a temporal
    /// effect follows. Per view and entity, kept only while a temporal effect asks for it.
    struct Pose {
        glm::mat4 previous{1.0f};
        glm::mat4 current{1.0f};
        /// A skinned mesh's bones are world-space and the entity's own transform says nothing about it, so what
        /// moved is the palette: the one it was drawn with last time and the one it is drawn with now.
        std::vector<glm::mat4> bonesPrevious;
        std::vector<glm::mat4> bonesCurrent;
        u64 frame = 0;
        /// The render origin `current` was placed from.
        glm::dvec3 origin{0.0};
    };
    std::unordered_map<u64, Pose> poses_;
    void trackPose(Pose& pose, const RenderFrameContext& ctx, const glm::mat4& model,
                   const std::vector<glm::mat4>* bones = nullptr);
    static u64 poseKey(const RenderFrameContext& ctx, Entity entity) {
        return ctx.motion_key * 0x9E3779B97F4A7C15ull ^ static_cast<u64>(entity.id());
    }
    /**
     * @brief What one entity's draw is derived from that no view changes: where it stands, its world box and matrices, its
     *        material's say over culling, its program facts. Kept between walks, and rebuilt when what it was derived from
     *        changes: the entity's Transform or MeshRenderer written (their change stamps), its mesh realized again or its
     *        material store changed (their revisions), a component that rules keeping out added or removed, or the render
     *        origin moved.
     *
     * @details Only what draws through resident geometry with nothing that turns, picks or poses it per view or per frame
     *          (a billboard, placements, a level-of-detail group, an impostor, bones, shapes, parallax) is kept; the rest is
     *          derived afresh every walk, as before. What the frame decides (textures by id, the probe a box reads, the
     *          reflection, the program asked for) is still asked every walk.
     */
    struct MeshProxy {
        Entity entity = INVALID_ENTITY;
        /// The registry tick the proxy was derived at (Registry::beginChangeRead): a stamp after it is a write it has not seen.
        u32 builtAt = 0;
        /// When `present` was last confirmed against the components that rule keeping out.
        u32 presentAt = 0;
        u32 epoch = 0;
        /// Which of those components the entity has, one bit each (see ruledOut in MeshPlugin.cpp).
        u8 present = 0;
        /// Whether the draw is derived from what is kept; false, it is derived every walk.
        bool kept = false;
        bool depthTested = false;
        f32 bend = 0.0f;
        u64 meshRevision = 0;
        u64 materialStore = 0;
        u64 materialRevision = 0;
        const Mesh* resident = nullptr;
        const MaterialRecord* material = nullptr;
        glm::vec3 position{0.0f};
        glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};
        glm::vec3 scale{1.0f};
        glm::vec3 boxCentre{0.0f};
        glm::vec3 boxHalf{0.0f};
        glm::mat4 model{1.0f};
        /// The transform a normal takes, as the three rows the instance record holds.
        glm::mat3 normalRows{1.0f};
        /// normalTextureId is left 0: a texture's id is asked every walk.
        MeshProgramFacts facts;
        /// The entity's pose for the view that last asked (poseKey), while poses_ has erased nothing since (pose_generation_):
        /// a pointer into an unordered_map stays good until its node is erased.
        Pose* pose = nullptr;
        u64 poseKey = 0;
        u32 poseGeneration = 0;
    };
    /// Moves whenever poses_ erases a node, so a pose a proxy points at is known to be still there.
    u32 pose_generation_ = 0;
    /** @brief The pose @p entity has in this view, made if @p make; through @p kept's pointer when that is still good. */
    Pose* poseOf(const RenderFrameContext& ctx, Entity entity, MeshProxy* kept, bool make);
    /// Indexed by entity index: where in proxies_ that entity's proxy is, or ~0u.
    std::vector<u32> proxy_slot_;
    std::vector<MeshProxy> proxies_;
    /// Moves when something every proxy was derived from changes: the render origin, the material store object, or the registry
    /// walked (Registry::identity: its ticks and entities are its own, and a scene loaded again is another registry).
    u32 proxy_epoch_ = 1;
    u64 proxy_registry_ = 0;
    glm::dvec3 proxy_origin_{0.0};
    const MaterialStore* proxy_materials_ = nullptr;
    /// Proxies kept and rebuilt this walk, and (with the change audit on) kept ones found to differ from a fresh derivation.
    u32 proxies_kept_ = 0, proxies_built_ = 0;
    u32 proxies_stale_total_ = 0;
    bool warned_stale_ = false;
    /**
     * @brief The proxy for @p entity, rebuilt if anything it was derived from changed since.
     * @return Null when the entity's draw is not one that is kept; it is then derived as it always was.
     */
    MeshProxy* retain(RenderCollectContext& collect, Entity entity, const ecs::MeshRenderer& mesh,
                            ecs::Transform& transform, u32 now, u32 rulesChangedAt);
    void deriveProxy(RenderCollectContext& collect, MeshProxy& proxy, Entity entity, const ecs::MeshRenderer& mesh,
                     ecs::Transform& transform, u8 present, u32 now);
    /// castInputs: the registry and tick it last looked at, and a count it moves whenever what a caster is changed since.
    u64 cast_registry_ = 0;
    u32 cast_tick_ = 0;
    u32 cast_activity_ = 0;
    u64 cast_serial_ = 0;
    /// Programs this plugin has built: a caster asked for one not built before is drawn by another program than last time.
    u32 programs_built_ = 0;
    bool warned_material_ = false;  ///< A material on resident geometry is said once.
    bool warned_bones_ = false;     ///< A skin over the pose budget is said once.
    bool warned_lod_ = false;       ///< A group that cannot be honoured is said once.
};

}  // namespace esengine
