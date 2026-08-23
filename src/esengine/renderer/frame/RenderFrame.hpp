// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../draw/RenderItem.hpp"
#include "../rhi/RenderTarget.hpp"
#include "./RenderContext.hpp"
#include "../store/LightConstants.hpp"
#include "../store/ShadowAtlas.hpp"
#include "../RenderTypePlugin.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "./PostProcessPipeline.hpp"
#endif
#include "./FrameCapture.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../rhi/TransientBufferPool.hpp"
#include "../draw/DrawList.hpp"
#include "../draw/ClipState.hpp"
#include "../../ecs/Registry.hpp"
#include "../../resource/ResourceManager.hpp"

#include <glm/glm.hpp>
#include <vector>
#include <string>
#include <memory>
#include <unordered_map>
#include <unordered_set>

namespace esengine {

namespace ecs { struct Light; }

/// The one shadow texture every map a frame renders shares. One size for every
/// scene: coverage adapts to the camera instead, so texel density is a property of
/// how far a light was asked to reach rather than of a knob nobody can calibrate.
inline constexpr u32 kShadowAtlasSize = 2048;
/// The unit the atlas is handed out in. A cascade takes a 2x2 block of them; the
/// texel snap and the depth bias are derived from the tile that comes back, not
/// from this, so a smaller tile is a smaller answer rather than a wrong one.
inline constexpr u32 kShadowCellSize = 512;
inline constexpr u32 kShadowCascadeCells = 2;

/**
 * @brief The shape a light's map has to cover — the one thing a shadow pass differs by.
 * @details A box of the world for a sun, one cone for a spot, and for a point light six
 *          cones at right angles, because a point lights every direction and no single
 *          projection covers that. Each face is a tile like any other, so the atlas, the
 *          collect, the vertex stage and the depth packing are shared by all three.
 */
enum class ShadowShape : u8 { Box, Cone, Cube };

struct Plane {
    glm::vec3 normal;
    f32 distance;
    f32 signedDistance(const glm::vec3& point) const;
};

struct Frustum {
    Plane planes[6];
    void extractFromMatrix(const glm::mat4& vp);
    bool intersectsAABB(const glm::vec3& center, const glm::vec3& halfExtents) const;
};

// GPU frame timer: a small ring of device timer queries so a frame's result is
// read a few frames later without stalling the CPU on the GPU.
class GpuTimer {
public:
    void begin(GfxDevice& device);
    void end(GfxDevice& device);
    void poll(GfxDevice& device);
    f32 lastMs() const { return last_ms_; }

private:
    static constexpr int kRing = 3;
    u32 queries_[kRing] = {0, 0, 0};
    bool inflight_[kRing] = {false, false, false};
    int write_ = 0;
    int read_ = 0;
    int state_ = 0; // 0 = uninit, 1 = available, 2 = unavailable
    bool active_ = false;
    f32 last_ms_ = -1.0f;
};

class RenderFrame {
public:
    struct Stats {
        u32 draw_calls = 0;
        u32 triangles = 0;
        u32 sprites = 0;
#ifdef ES_ENABLE_SPINE
        u32 spine = 0;
#endif
        u32 meshes = 0;
        u32 text = 0;
        u32 particles = 0;
        u32 shapes = 0;
        u32 culled = 0;
        f32 gpu_time_ms = -1.0f; // -1 when the timer is unavailable
    };

    RenderFrame(GfxDevice& device, RenderContext& context,
                resource::ResourceManager& resource_manager);
    ~RenderFrame();

    RenderFrame(const RenderFrame&) = delete;
    RenderFrame& operator=(const RenderFrame&) = delete;

    void init(u32 width, u32 height);
    void shutdown();
    void resize(u32 width, u32 height);

    /// Rebuilds everything this frame owns after a device loss: the transient
    /// pool, the render targets, the batch program ids and the post-process chain.
    void recreateGpuResources();

    /** @brief The frame's main-pass load-op: which attachments to clear, the color,
     *         and an optional region (w == 0 = full target — per-camera flows clear
     *         only their viewport on the shared default target). */
    struct PassClear {
        bool color = false;
        bool depth = false;
        glm::vec4 colorValue{0.0f, 0.0f, 0.0f, 1.0f};
        i32 x = 0, y = 0;
        u32 w = 0, h = 0;
    };

    /**
     * @brief Opens the FRAME, once, before any of its cameras.
     *
     * @details begin()/end() bracket one CAMERA, so a decision that must hold
     *          steady across a frame cannot be made there. The scene's depth
     *          requirement is rolled forward and applied here
     *          (@ref applySceneDepthNeed), once, for every camera in the frame.
     */
    void beginFrame();

    void begin(const glm::mat4& view_projection, RenderTargetManager::Handle target = 0);
    void begin(const glm::mat4& view_projection, RenderTargetManager::Handle target,
               const PassClear& clear);
    void flush();
    void end();

    void processMasks(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH);

    void setEntityClipRect(u32 entity, i32 x, i32 y, i32 w, i32 h);
    void clearEntityClipRect(u32 entity);
    void clearAllClipRects();

    void setEntityStencilMask(u32 entity, i32 refValue);
    void setEntityStencilTest(u32 entity, i32 refValue);
    void clearEntityStencilMask(u32 entity);
    void clearAllStencilMasks();

    void submitTileQuad(
        const glm::vec2& position, const glm::vec2& size,
        const glm::vec2& uvOffset, const glm::vec2& uvScale,
        const glm::vec4& color, u32 textureId,
        Entity entity, i32 layer, f32 depth
    );

    /**
     * Submit a batch of pre-laid-out glyph quads from TS. Same vertex format as
     * submitSpineBatch (x,y,u,v,r,g,b,a per vertex), RenderType::Text, atlas page
     * = `textureId`. `sdf` picks the shader: true → the SDF variant (scalable SDF
     * atlas); false → the plain textured batch (device-resolution bitmap atlas
     * carrying native-AA coverage in alpha).
     */
    void submitTextBatch(
        const f32* vertices, i32 vertexCount,
        const u16* indices, i32 indexCount,
        u32 textureId, const f32* transform16,
        Entity entity, i32 layer, f32 depth, bool sdf, u32 cullBit = 0
    );

#ifdef ES_ENABLE_SPINE
    void submitSpineBatch(
        const f32* vertices, i32 vertexCount,
        const u16* indices, i32 indexCount,
        u32 textureId, i32 blendMode,
        const f32* transform16,
        Entity entity, i32 layer, f32 depth
    );
#endif

    void setStage(RenderStage stage) { current_stage_ = stage; }
    RenderStage getStage() const { return current_stage_; }

#ifdef ES_ENABLE_POSTPROCESS
    PostProcessPipeline* postProcess() { return post_process_.get(); }
#endif
    RenderTargetManager& targetManager() { return target_manager_; }

    const Stats& stats() const { return stats_; }
    FrameCapture& frameCapture() { return frame_capture_; }

    /// Layers (bits 0..31) that sort by world Y within the layer — see DrawList::setYSortMask.
    void setYSortLayers(u32 mask) { draw_list_.setYSortMask(mask); }
    void setDepthLayers(u32 mask) {
        draw_list_.setDepthMask(mask);
        // Through the one applier: the mask is no longer the whole answer, only
        // half of it. Before init there is no pipeline yet, and init asks again.
        applySceneDepthNeed();
    }
    u32 depthLayers() const { return draw_list_.depthMask(); }

    /// Layers the camera about to be collected renders — see DrawList::setCullingMask.
    void setCullingMask(u32 mask) { draw_list_.setCullingMask(mask); }

    /**
     * @brief Switch the frame to linear-light rendering (project colorSpace).
     * @details Sets the global ES_LINEAR shader input, linearizes CPU-side
     *          authored colors (lights, clears), and forces the post-process
     *          capture+blit so the final OETF encode always runs. Call before
     *          shaders compile; a later flip requires a reload.
     */
    void setColorSpace(bool linear);
    bool linearColor() const { return linear_color_; }

    void replayToDrawCall(i32 stopAtDrawCall);
    const u8* getSnapshotPixels() const { return snapshot_pixels_.data(); }
    u32 getSnapshotSize() const { return static_cast<u32>(snapshot_pixels_.size()); }
    u32 getSnapshotWidth() const { return snapshot_w_; }
    u32 getSnapshotHeight() const { return snapshot_h_; }

    /**
     * Lands the replay snapshot's async readback: 0 = still pending (poll again
     * after yielding to the event loop), 1 = pixels are in the snapshot buffer
     * (getSnapshot* serve them), 2 = no readback in flight / it failed.
     * GL completes at request time, so the first poll reports 1 — callers use
     * one polling loop for both backends.
     */
    i32 pollSnapshotReadback();

    /**
     * Render @p registry once to an offscreen @p w×@p h target with @p viewProjection and read
     * the RGBA pixels back (queried via getPreview*). A self-contained mini-frame (no
     * post-process) reusing the real collect+execute path, so a material preview matches the
     * viewport exactly. Clobbers the transient draw list/pool, which the next real frame rebuilds.
     */
    void renderToTarget(ecs::Registry& registry, const glm::mat4& viewProjection, u32 w, u32 h);
    const u8* getPreviewPixels() const { return preview_pixels_.data(); }
    u32 getPreviewSize() const { return static_cast<u32>(preview_pixels_.size()); }
    u32 getPreviewWidth() const { return preview_w_; }
    u32 getPreviewHeight() const { return preview_h_; }

    /** Lands the preview's async readback; same 0/1/2 contract as pollSnapshotReadback(). */
    i32 pollPreviewReadback();

    void addPlugin(std::unique_ptr<RenderTypePlugin> plugin);
    void collectAll(ecs::Registry& registry, u32 skipFlags = 0);

    /**
     * Compiled program id for a batch-shader feature variant, compiled+cached on
     * first use. `{}` is the default batch program; `{"SDF"}`
     * is the glyph-atlas SDF text variant. Same vertex layout + sampler/UBO setup
     * as the default, so quads of any variant share the batch vertex format.
     */
    u32 batchProgram(const std::vector<std::string>& features);

    static constexpr u32 STAGE_COUNT = 4;

private:
    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resource_manager_;

#ifdef ES_ENABLE_POSTPROCESS
    Unique<PostProcessPipeline> post_process_;
#endif
    RenderTargetManager target_manager_;

    glm::mat4 view_projection_{1.0f};
    Frustum frustum_;
    RenderTargetManager::Handle current_target_ = 0;
    RenderStage current_stage_ = RenderStage::Transparent;

    // Polls + lands one async readback: takes into @p pixels when Ready and
    // resets @p handle. Returns the 0/1/2 contract of the public poll methods.
    i32 pollReadback(ReadbackHandle& handle, std::vector<u8>& pixels, u32 w, u32 h);

    Stats stats_;
    GpuTimer gpu_timer_;
    GpuTimer gpu_timer_pp_;
    FrameCapture frame_capture_;
    std::vector<u8> snapshot_pixels_;
    RenderTargetManager::Handle replay_rt_ = 0;
    ReadbackHandle snapshot_readback_ = ReadbackHandle::Invalid;
    u32 snapshot_w_ = 0;
    u32 snapshot_h_ = 0;
    std::vector<u8> preview_pixels_;
    RenderTargetManager::Handle preview_rt_ = 0;
    ReadbackHandle preview_readback_ = ReadbackHandle::Invalid;
    u32 preview_w_ = 0;
    u32 preview_h_ = 0;
    bool in_frame_ = false;
    bool flushed_ = false;
    /// Depth state for the capture's attachment — see applySceneDepthNeed.
    /// Latched on for good: what once resolved by depth may leave the frustum.
    bool depth_seen_ = false;
    /// This frame's cameras, OR-ed; rolled into depth_seen_ at the next beginFrame.
    bool frame_depth_seen_ = false;
    /// Whether this frame collected at all — an uncollected frame answers nothing,
    /// so it must not be read as "nothing here needs depth".
    bool frame_collected_ = false;
    /// Whether ANY frame has answered yet. Until one has, the answer is "give it one".
    bool depth_answered_ = false;
    u32 width_ = 0;
    u32 height_ = 0;

    std::unordered_map<u32, ScissorRect> clip_rects_;

    struct EntityStencilInfo {
        i32 ref_value = 0;
        bool is_mask = false;
    };
    std::unordered_map<u32, EntityStencilInfo> stencil_masks_;

    u32 batch_shader_id_ = 0;
    // Compiled batch-shader variants keyed by ShaderParser::variantKey(features).
    // {} → default, {"SDF"} → glyph-atlas text.
    /// Variant key -> the shader HANDLE. Not the program id: rebuilding the
    /// device changes every id, and the handle is what stays true across it.
    std::unordered_map<std::string, resource::ShaderHandle> batch_variants_;
    TransientBufferPool pool_;
    DrawList draw_list_;
    bool linear_color_ = false;
    ClipState clip_state_;
    std::vector<std::unique_ptr<RenderTypePlugin>> plugins_;

    RenderFrameContext makeContext();
    void buildClipState();

    /**
     * @brief Tells the capture whether to carry a depth attachment.
     *
     * @details Chosen when the capture is BUILT, before this frame has collected,
     *          so the PREVIOUS frame answers and an unanswered one (boot) gets
     *          depth. Released once a frame proves nothing needs it, latched on
     *          once anything does — culling would make a per-frame answer flap.
     */
    void applySceneDepthNeed();
    /// Gathers the scene's enabled Light components into the per-frame LightConstants UBO
    /// (point/directional into the light array, ambient summed). Run each frame in collectAll;
    /// flush() uploads + binds the result so Lit material shaders read it.
    void collectLights(ecs::Registry& registry);

    /// Makes this ambient light the frame's environment, when it names one that is
    /// loaded. `scale` is the light's colour times its intensity, folded into the
    /// coefficients — an environment is what the light casts, not a second source.
    /// @return false when it names none, leaving the caller to add a flat term.
    bool collectEnvironment(const ecs::Light& light, const glm::vec3& scale);
    /**
     * @brief Draws the scene's mesh occluders from the shadow-casting light, into a map
     *        the main pass samples.
     * @details Runs at the top of collectAll and re-opens the frame's own target behind
     *          itself. A no-op unless collectLights found a light asking for one. Every
     *          map a frame renders shares one atlas texture, and who owns which square
     *          of it is ShadowAtlas's answer rather than the light type's.
     */
    void renderShadowMap(ecs::Registry& registry);

    /// The world box the resident meshes occupy — what a shadow map must cover.
    /// False when nothing 3D is in the scene.
    bool meshWorldBounds(ecs::Registry& registry, glm::vec3& outMin, glm::vec3& outMax);
    /// Opens the frame's own target with @p clear's load-op. Shared by begin() and the
    /// shadow pass, which re-opens it after drawing through a target of its own.
    void openPass(const PassClear& clear, RenderTargetManager::Handle target);
    u32 initBatchShader();
    resource::ShaderHandle compileBatchVariant(const std::vector<std::string>& features);

    /**
     * @brief What a light needs a shadow map FOR — everything the pass differs by.
     *
     * @details A sun's map covers a stretch of the view, a spot's its cone and a point's
     *          every direction, so the three build different projections and share the
     *          pass after that. A description rather than a flag on the light, because
     *          the cap sort reorders those and this has to survive it.
     */
    struct ShadowCaster {
        u32 slot = 0;
        ShadowShape shape = ShadowShape::Box;
        /// Which way it points — the aim, not the direction light travels. A cube aims
        /// six ways of its own and reads none of it.
        glm::vec3 dir{0.0f, 0.0f, -1.0f};
        /// Where it stands. Cone and cube only; a sun has no position.
        glm::vec3 pos{0.0f};
        /// Box: a fixed reach, or 0 to fit what the camera can see.
        f32 extent = 0.0f;
        /// Cone and cube: how far the falloff reaches, and how wide one cone opens in
        /// degrees — a cube's six are right angles and do not read the angle.
        f32 range = 0.0f;
        f32 outerAngle = 0.0f;
    };
    /// A collected light and the map it asked for, if any. Paired rather than flagged
    /// inside the GPU struct, because the cap sort reorders these and the answer has
    /// to travel with the light.
    struct CollectedLight {
        GpuLight gpu;
        bool castsMeshShadow;
        ShadowCaster caster;
    };
    std::vector<CollectedLight> light_scratch_;  // reused across frames; collectLights only
    /// Every light that asked for a map this frame, in UBO slot order. Written by
    /// collectLights, read by renderShadowMap; empty = nobody asked.
    std::vector<ShadowCaster> shadow_casters_;
    RenderTargetManager::Handle shadow_rt_ = 0;
    /// Who owns which square of it. Rebuilt every frame: a tile means nothing once
    /// the depths in it belong to a frame that is gone.
    ShadowAtlas shadow_atlas_{kShadowAtlasSize, kShadowCellSize};
    /// The map's colour texture, handed to every mesh that receives it. 0 = none this frame.
    u32 shadow_texture_id_ = 0;
    /// The frame environment's reflection atlas, on the same terms. 0 = none this frame.
    u32 environment_texture_id_ = 0;
    /// Whether that environment is also the background this frame.
    bool draw_sky_ = false;
    /// The far-plane quad's program, compiled on first use.
    u32 sky_program_ = 0;
    bool sky_compiled_ = false;
    /// Emits the background quad when an environment asked to be seen behind the scene.
    void collectSky(RenderCollectContext& ctx);

    // processMasks scratch, reused across cameras/frames.
    std::vector<Entity> mask_scissor_scratch_;
    std::vector<Entity> mask_stencil_scratch_;
    std::vector<Entity> mask_root_scratch_;
    std::unordered_set<u32> mask_set_scratch_;
    std::unordered_set<u32> stencil_set_scratch_;
};

}  // namespace esengine
