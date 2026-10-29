// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../draw/RenderItem.hpp"
#include "../rhi/RenderTarget.hpp"
#include "./RenderContext.hpp"
#include "./PlanarReflectionCamera.hpp"
#include "../store/PlanarConstants.hpp"
#include "../store/LightConstants.hpp"
#include "../store/ShadowAtlas.hpp"
#include "../store/ShadowPlan.hpp"
#include "../store/LightPlan.hpp"
#include "../graph/TargetPool.hpp"
#include "../graph/RenderGraph.hpp"
#include "../RenderTypePlugin.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "./PostProcessPipeline.hpp"
#endif
#include "./FrameCapture.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../rhi/TransientBufferPool.hpp"
#include "../draw/DrawList.hpp"
#include "../draw/RetainedText.hpp"
#include "../draw/ClipState.hpp"
#include "../draw/SpriteMaskRange.hpp"
#include "../../ecs/Registry.hpp"
#include "../../resource/ResourceManager.hpp"

#include <glm/glm.hpp>
#include <span>
#include <unordered_map>
#include <vector>
#include <string>
#include <memory>
#include <unordered_map>
#include <unordered_set>

namespace esengine {

class GpuParticles;

namespace ecs { struct Light; }
class ImmediateDraw;

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
        u32 skeletal = 0;
        u32 meshes = 0;
        u32 text = 0;
        u32 particles = 0;
        u32 shapes = 0;
        u32 culled = 0;
        /// Of `culled`, how many an occluder refused rather than the frustum.
        u32 occluded = 0;
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
    void setShadowBudget(u32 atlasSize, u32 cellSize, u32 cascades);
    void setShadowDistance(f32 distance);
    /// How many samples across a light source a soft 2D shadow is drawn with: the quality level's say on the penumbra's smoothness and cost.
    void setShadow2DSoftSamples(u32 samples);
    /// Draws the opaque scene twice, depth alone first (see DrawList::DrawPass). Off unless asked: where a GPU already shades each pixel once
    /// (a tiled one), the second pass is geometry paid for twice.
    void setDepthPrepass(bool on) { depth_prepass_ = on; }
    void setPlanarQuality(f32 scale, u32 maxSize, f32 updatesPerSecond);
    u32 planarTextureFor(Entity entity) const {
        return entity == planar_receiver_ ? planar_texture_ : 0;
    }
    const PlanarConstants& planarConstants() const { return planar_constants_; }
    std::string planarStatus(u32 view, u32 entity) const;

    /** Geometry collected for this camera and drawn after its scene. */
    void setPresentedOverlayDraw(ImmediateDraw* draw) { presented_overlay_draw_ = draw; }

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
    void setPlanarTime(f32 seconds) { planar_elapsed_ = seconds; }

    /**
     * @brief Closes the FRAME, once, after every camera and every overlay.
     *
     * @details The pair of beginFrame, and the only place a backend that borrows
     *          the swapchain image gives it back. Releasing it in end(), which
     *          runs per CAMERA, leaves the post stack and the overlay drawing
     *          into an image the surface has taken away.
     */
    void endFrame();

    void begin(const glm::mat4& view_projection, RenderTargetManager::Handle target = 0);
    void begin(const glm::mat4& view_projection, RenderTargetManager::Handle target,
               const PassClear& clear);
    void flush();
    void end();

    void processMasks(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH);
    /// Same, resolved through @p projection rather than the current camera's —
    /// a scissor rect is pixels, and which pixels a UI box covers is a question
    /// only the projection that draws it can answer.
    void processMasks(ecs::Registry& registry, const glm::mat4& projection,
                      i32 vpX, i32 vpY, i32 vpW, i32 vpH);

    // ---- The screen-space overlay -------------------------------------------
    //
    // One pass a frame, after every camera and after post. The frame's, not a
    // camera's: the projection comes from the layout domain.

    /** @brief The screen's entities (UISystem::screenDomain), borrowed for the
     *         frame. Null partitions nothing — every collect is a world one. */
    void setScreenDomain(const std::unordered_set<u32>* domain) { screen_domain_ = domain; }

    /** @brief Opens the overlay: @p projection maps the layout domain onto the
     *         pixel rect @p vpX/@p vpY/@p vpW/@p vpH of the surface. */
    void beginScreenOverlay(const glm::mat4& projection, i32 vpX, i32 vpY, u32 vpW, u32 vpH);

    /** @brief Collects the screen's renderables. Between this and
     *         endScreenOverlay a host may submit its own screen geometry (the
     *         SDK's glyph quads), which lands in the same list. */
    void submitScreenOverlay(ecs::Registry& registry);

    /** @brief Declares the overlay as a graph pass over @p target and runs it. */
    void endScreenOverlay(RenderTargetManager::Handle target);

    /** @brief Whether the overlay is open — what routes a host's submissions. */
    bool screenOverlayOpen() const { return overlay_active_; }

    void setEntityClipRect(u32 entity, i32 x, i32 y, i32 w, i32 h);
    void clearAllClipRects();

    void setEntityStencilMask(u32 entity, i32 refValue, bool hierarchical = false);
    void setEntityStencilTest(u32 entity, i32 refValue, bool hierarchical = false);
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

    /// The glyph quads of every label the text system laid out and handed over once, which the engine submits itself each frame.
    RetainedTextStore& retainedText() { return retained_text_; }

    /**
     * @brief One offscreen render's resources, correct only together.
     *
     * @details Loose, they were one slot: two previews in flight overwrote each
     *          other's target, readback and pixels. As an object, a caller with
     *          its own preview owns its own surface.
     */
    struct PreviewSurface {
        RenderTargetManager::Handle target = 0;
        ReadbackHandle readback = ReadbackHandle::Invalid;
        std::vector<u8> pixels;
        u32 width = 0;
        u32 height = 0;
    };

    /**
     * @brief Skeletal geometry a caller holds until it renders, owning its bytes.
     *
     * @details A scene's batches go straight into the frame being built. A
     *          preview's cross the ABI, wait for a render call, and are replayed
     *          — so they cannot be spans into the caller's scratch. Owning the
     *          bytes is what lets `submit` return and the caller reuse its buffer.
     */
    struct PendingSkeletalBatch {
        std::vector<f32> vertices;
        std::vector<u16> indices;
        u32 textureId = 0;
        i32 blendMode = 0;
        bool premultipliedColor = false;
        glm::mat4 transform{1.0f};
        Entity entity{};
        i32 layer = 0;
        f32 depth = 0.0f;
        u32 materialId = 0;
    };

    /**
     * @brief Batch vertices posed by a skeletal runtime, drawn as one entity's geometry.
     * @details Serves every such runtime — Spine and DragonBones both arrive here — and
     *          links none of them: what crosses is x,y,u,v,r,g,b,a per vertex. @p materialId
     *          is the entity's material, resolved the way a Sprite's is (0 = the batch shader).
     */
    void submitSkeletalBatch(
        const f32* vertices, i32 vertexCount,
        const u16* indices, i32 indexCount,
        u32 textureId, i32 blendMode,
        const f32* transform16,
        Entity entity, i32 layer, f32 depth, u32 materialId = 0, bool premultipliedColor = false
    );

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
     * @brief Names the view the camera about to be collected looks from, which is
     *        what its LOD levels are remembered under.
     *
     * @details Reset by begin(), so a camera that names none looks from the shared
     *          default view rather than inheriting the last camera's memory.
     */
    void setViewId(u32 view) { view_id_ = view; }

    /**
     * @brief The LOD decision @p view last made about @p entity: the level, what
     *        the bare thresholds asked for, the stand-ins reachable, the size.
     *
     * @details A read of what was RECORDED where the choice was made: an editor
     *          explaining a level has to agree with the frame that drew it, and
     *          the only way to be sure is to not compute it twice.
     */
    bool lodInspect(u32 view, Entity entity, u8& outLevel, u8& outUnbiased,
                    u8& outLevels, f32& outSize) const {
        return lod_view_state_.inspect(view, entity, outLevel, outUnbiased, outLevels, outSize);
    }

    /**
     * @brief Show @p level for @p entity in @p view instead of the level that
     *        view chose; @ref lod::kNoPreview goes back to choosing.
     *
     * @details View state, never component state: a group is authored policy and
     *          is the same everywhere. The choice is still made and remembered
     *          while a preview stands, so leaving one obeys the selector again.
     */
    void setLodPreview(u32 view, Entity entity, u8 level) {
        lod_view_state_.preview(view, entity, level);
    }

    /** @brief How many (view, entity) pairs are held up for inspection. */
    usize lodPreviewCount() const { return lod_view_state_.previewCount(); }

    /**
     * @brief Shade @p view's meshes as @p mode says instead of as authored.
     *
     * @details View state, like a LOD preview: what the scene IS is the same
     *          everywhere, and what a creator wants to look at is decided by the
     *          window they are looking through.
     */
    void setViewShading(u32 view, ShadingMode mode) { view_shading_.set(view, mode); }

    /**
     * @brief Colour @p entity in @p view by how much @p joint moves each of its vertices.
     * @details View state like the shading beside it; an invalid entity goes back to none.
     */
    void setViewSkinWeights(u32 view, Entity entity, u32 joint) { view_shading_.setWeights(view, entity, joint); }

    /** @brief The mode @p view asked for; Shaded when it never did. */
    ShadingMode viewShading(u32 view) const { return view_shading_.get(view); }

    /**
     * @brief What each caster asked the shadow atlas for last frame, and what it got.
     *
     * @details The answer to "why does this object have no shadow", which the engine
     *          could not give at all: tiles handed out were counted, refusals were not.
     */
    const ShadowPlanReport& shadowPlan() const { return shadow_plan_; }

    /**
     * @brief Which lights the cap turned away last frame, and why.
     *
     * @details The count was logged and the identities were not, so "why is this
     *          light dark" could only be answered by deleting lights until one
     *          came back.
     */
    const LightCapReport& lightCap() const { return light_cap_; }

    /**
     * @brief The editor view's own lighting, in place of the scene's.
     *
     * @details VIEW state, not scene state: nothing here is a component, nothing is
     *          saved, and a host that never calls the setter (every packaged build)
     *          lights the scene by its own lights exactly as before. In studio mode
     *          the frame ignores the scene's lights and lights with a neutral sky,
     *          a key and a fill, so a model the scene left dark can be read. The
     *          scene's environment may still be drawn as the BACKGROUND (`showSky`):
     *          seeing the sky and being lit by it are separate questions.
     */
    struct ViewLighting {
        bool studio = false;
        /// Degrees about +Y that the key and fill turn together.
        f32 rotation = 0.0f;
        f32 keyIntensity = 0.8f;
        f32 fillIntensity = 0.3f;
        /// Scales the neutral sky's light; the scene's own Ambient is not consulted.
        f32 skyIntensity = 1.0f;
        /// Draw the scene's environment as the background while studio-lit.
        bool showSky = false;
    };
    void setViewLighting(const ViewLighting& lighting) { view_lighting_ = lighting; }
    const ViewLighting& viewLighting() const { return view_lighting_; }
    /// Whether the frame found a scene environment it could draw as the background.
    bool sceneSkyAvailable() const { return scene_sky_available_; }

    /**
     * @brief Switch the frame to linear-light rendering (project colorSpace).
     * @details Sets the global ES_LINEAR shader input, linearizes CPU-side
     *          authored colors (lights, clears), and forces the post-process
     *          capture+blit so the final OETF encode always runs. Call before
     *          shaders compile; a later flip requires a reload.
     */
    void setColorSpace(bool linear);
    bool linearColor() const { return linear_color_; }

    /**
     * Asks for the captured frame's draws up to @p drawIndex. The replay runs on a
     * later frame, right after the pass that drew it, so it draws from that pass's
     * own list; the snapshot poll reports pending until then.
     */
    void replayToDrawCall(i32 drawIndex);
    /** Whether the replayed pass made as many draws as the captured one. False means
     *  the scene changed since the capture and the snapshot shows the later frame. */
    bool snapshotMatchesCapture() const { return snapshot_matches_; }
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
    const u8* getPreviewPixels() const { return preview_.pixels.data(); }
    u32 getPreviewSize() const { return static_cast<u32>(preview_.pixels.size()); }
    u32 getPreviewWidth() const { return preview_.width; }
    u32 getPreviewHeight() const { return preview_.height; }

    /** Lands the preview's async readback; same 0/1/2 contract as pollSnapshotReadback(). */
    i32 pollPreviewReadback();

    // — Skeletal previews —————————————————————————————————————————————————————
    // Every call names its handle: no current preview, no mode, no begin/end
    // pair, so two in flight cannot reach each other whatever the call order.

    /** A skeletal preview's id. Carries a generation, so a destroyed one cannot
     *  come back pointing at whatever took its slot. */
    using SkeletalPreviewId = u64;

    /** A preview of @p w×@p h, or 0 when one cannot be made. */
    SkeletalPreviewId createSkeletalPreview(u32 w, u32 h);

    /** Hand one batch to @p id, which COPIES it: the caller may reuse its
     *  buffers the moment this returns. False for an id that is not live — a
     *  stale handle is a mistake worth hearing about, not a no-op. */
    bool submitSkeletalPreviewBatch(
        SkeletalPreviewId id,
        const f32* vertices, i32 vertexCount,
        const u16* indices, i32 indexCount,
        u32 textureId, i32 blendMode, const f32* transform16,
        i32 layer, f32 depth, u32 materialId, bool premultipliedColor = false);

    /**
     * Draw everything handed to @p id, and start its readback. CONSUMES the
     * batches, so a render that fails cannot draw last frame's pose again.
     *
     * Refused while this preview's readback is in flight — one at a time keeps a
     * landed image and the camera it was drawn with together.
     */
    bool renderSkeletalPreview(SkeletalPreviewId id, const glm::mat4& viewProjection);

    /** Lands @p id's readback: 0 pending, 1 pixels available, 2 nothing to read. */
    i32 pollSkeletalPreview(SkeletalPreviewId id);
    const u8* skeletalPreviewPixels(SkeletalPreviewId id) const;
    u32 skeletalPreviewSize(SkeletalPreviewId id) const;
    u32 skeletalPreviewWidth(SkeletalPreviewId id) const;
    u32 skeletalPreviewHeight(SkeletalPreviewId id) const;

    /**
     * End @p id. Ownership ends here and the id stops answering; the target and
     * any readback still in the device's hands are released the way every other
     * one is, so nothing lands in freed memory.
     */
    void destroySkeletalPreview(SkeletalPreviewId id);

    void addPlugin(std::unique_ptr<RenderTypePlugin> plugin);

    /**
     * @brief Make ready the programs @p entities will need, drawing nothing.
     *
     * @details Ordinary renderer code, reachable by anything inside the engine —
     *          a residency lifecycle that wants a cell render-ready before it is
     *          seen would call THIS. The only thing gated to test builds is the
     *          WASM adapter that lets a driver call it from outside.
     */
    RenderPrewarmResult prewarmPrograms(ecs::Registry& registry, const Entity* entities, u32 count);

    /** @brief The same readiness, from a prepared cell's own description — no
     *         entity of it need exist. */
    RenderPrewarmResult prewarmDocument(const MeshDocumentRecord* rows, u32 count);
    void collectAll(ecs::Registry& registry, bool sceneGBuffer = true);

    /**
     * @brief Whether the camera being rendered right now would draw something of
     *        @p layer at these world bounds.
     *
     * @details The frame's OWN frustum and culling mask, both set by `begin`
     *          for the camera in hand — asked rather than reimplemented, so
     *          geometry from outside `collect` is culled by the same fact.
     */
    bool visibleToCamera(i32 layer, const glm::vec3& center, const glm::vec3& halfExtents) const;

    /**
     * Compiled program id for a batch-shader feature variant, compiled+cached on
     * first use. `{}` is the default batch program; `{"SDF"}`
     * is the glyph-atlas SDF text variant. Same vertex layout + sampler/UBO setup
     * as the default, so quads of any variant share the batch vertex format.
     */
    u32 batchProgram(const std::vector<std::string>& features);
    u32 premultipliedBatchProgram();

    static constexpr u32 STAGE_COUNT = 4;

#ifdef ES_ENABLE_GPU_PARTICLES
    /** Where emitters that simulate on the GPU queue their step, and find the buffer to draw (null before init). */
    GpuParticles* gpuParticles() { return gpu_particles_.get(); }
#endif

private:
    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resource_manager_;
    ImmediateDraw* presented_overlay_draw_ = nullptr;

#ifdef ES_ENABLE_POSTPROCESS
    Unique<PostProcessPipeline> post_process_;
#endif
#ifdef ES_ENABLE_GPU_PARTICLES
    /// The compute-simulated particles' buffers live here, across frames: their state is the point of them.
    Unique<GpuParticles> gpu_particles_;
#endif
    RenderTargetManager target_manager_;

    glm::mat4 view_projection_{1.0f};
    Frustum frustum_;
    /// The other half of this camera's cull, rebuilt from the scene each collect.
    OcclusionView occlusion_;
    RenderTargetManager::Handle current_target_ = 0;
    RenderStage current_stage_ = RenderStage::Transparent;

    // Polls + lands one async readback: takes into @p pixels when Ready and
    // resets @p handle. Returns the 0/1/2 contract of the public poll methods.
    i32 pollReadback(ReadbackHandle& handle, std::vector<u8>& pixels, u32 w, u32 h);

    /**
     * The collect+execute body every preview shares, with an explicit target.
     *
     * @p extraSkeletalBatches replay AFTER `collectAll` — before it the draw
     * list is cleared and they are dropped. A span, not a callback: a hook here
     * would become where every future pass is inserted.
     */
    void renderSurface(ecs::Registry& registry, const glm::mat4& viewProjection,
                       PreviewSurface& surface, u32 w, u32 h,
                       std::span<const PendingSkeletalBatch> extraSkeletalBatches);

    Stats stats_;
    /**
     * ONE per frame, spanning the graph. GL's TIME_ELAPSED has a single global
     * target and WebGPU's timestamps land in one queue, so a timer opened inside
     * this one's span ends this query on GL and steals this reading on WebGPU.
     */
    GpuTimer gpu_timer_;
    /// Per-pass GPU times, made the first frame the profiler is on (it costs a query per pass).
    Unique<rg::PassTimer> pass_timer_;
    /// The profiler keeps a scope's name by pointer: "pass/<name>" per pass name, made once. Keyed by the timer's interned name.
    std::unordered_map<const char*, std::string> pass_scope_names_;
    f32 pass_graph_ms_ = -1.0f;
    /// The graph's timer while it runs, so the scene's draws can be told to it a shader at a time (see drawScene).
    rg::PassTimer* running_pass_timer_ = nullptr;
    bool gpuDetailWanted() const;
    FrameCapture frame_capture_;
    std::vector<u8> snapshot_pixels_;
    RenderTargetManager::Handle replay_rt_ = 0;
    ReadbackHandle snapshot_readback_ = ReadbackHandle::Invalid;
    i32 replay_pass_ = -1;
    i32 replay_draw_ = -1;
    bool snapshot_matches_ = false;
    void runPendingReplay(const glm::mat4& projection, u32 w, u32 h);
    void tallyPass(const DrawList& list);
    void publishFrameCounters();
    u32 frame_merged_ = 0;
    u32 frame_breaks_[static_cast<u32>(BatchBreak::Count)] = {};
    u32 snapshot_w_ = 0;
    u32 snapshot_h_ = 0;
    PreviewSurface preview_;

    /** One editor preview: its own scene, its own surface, its own pending work. */
    struct SkeletalPreview {
        ecs::Registry registry;
        Entity entity{};
        std::vector<PendingSkeletalBatch> pending;
        PreviewSurface surface;
    };
    /// The view an offscreen preview looks from: its own, so a thumbnail neither
    /// reads nor writes the level a camera settled on for the same object.
    static constexpr u32 kPreviewViewId = 0xFFFFFFFEu;

    u32 view_id_ = 0;
    lod::LodViewState lod_view_state_;
    ViewShading view_shading_;
    lod::SelectionCounts lod_counts_;

    std::unordered_map<SkeletalPreviewId, Unique<SkeletalPreview>> skeletal_previews_;
    /** Never reused, so a destroyed id can only ever be a destroyed id. */
    SkeletalPreviewId next_skeletal_preview_ = 1;

    SkeletalPreview* skeletalPreview(SkeletalPreviewId id);
    const SkeletalPreview* skeletalPreview(SkeletalPreviewId id) const;
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
        bool hierarchical = false;
    };
    std::unordered_map<u32, EntityStencilInfo> stencil_masks_;

    u32 batch_shader_id_ = 0;
    // Compiled batch-shader variants keyed by ShaderParser::variantKey(features).
    // {} → default, {"SDF"} → glyph-atlas text.
    /// Variant key -> the shader HANDLE. Not the program id: rebuilding the
    /// device changes every id, and the handle is what stays true across it.
    std::unordered_map<std::string, resource::ShaderHandle> batch_variants_;
    const resource::ShaderHandle* premultiplied_batch_handle_ = nullptr;
    TransientBufferPool pool_;
    DrawList draw_list_;
    bool linear_color_ = false;
    ClipState clip_state_;
    std::vector<std::unique_ptr<RenderTypePlugin>> plugins_;

    RenderFrameContext makeContext();
    void buildClipState();
    /// Resolves every SpriteMask into the stencil refs the draw path reads.
    void buildSpriteMasks(ecs::Registry& registry);
    /// Resolves every SortingGroup into the per-entity identity the draw path reads.
    void buildSortingGroups(ecs::Registry& registry);
    /// Adds a finalized list's cost to this frame's tally (see the definition).
    void accumulateStats(const DrawList& list);
    /// The overlay pass's body: the projection its geometry was built for, then
    /// the list. Runs inside the graph, like every other pass's draw.
    void drawScreenOverlay();

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
    /// collectLights' studio branch: the view's neutral light in place of the scene's.
    void collectStudioLights(ecs::Registry& registry);

    /** @brief Gathers the frame's LightProbeVolume components into the ProbeStore. */
    void collectProbes(ecs::Registry& registry);

    /**
     * @brief Rasterises the scene's declared occluders into this camera's
     *        @ref occlusion_, which the collect below then tests bounds against.
     */
    void collectOccluders(ecs::Registry& registry);

    /** @brief Gathers the scene's reflection probes and binds the atlas they name. */
    void collectReflections(ecs::Registry& registry);
    void declarePlanarReflection(ecs::Registry& registry);
    void executePlanarReflection(ecs::Registry& registry, u32 view);
    struct PlanarCapture {
        Unique<Framebuffer> target;
        BufferHandle frameUbo = BufferHandle::Invalid;
        Entity receiver = INVALID_ENTITY;
        PlanarReflectionCamera camera;
        u64 lastSeen = 0;
        u64 generation = 0;
        u32 revision = 0;
        u32 mask = 0xFFFFFFFFu;
        f32 lastTime = -1.0f;
        u32 draws = 0;
        u32 rejected = 0;
        bool valid = false;
    };
    std::unordered_map<u32, PlanarCapture> planar_captures_;
    TransientBufferPool planar_pool_{device_};
    DrawList planar_list_;
    u64 planar_frame_ = 0;
    f32 planar_elapsed_ = 0;
    f32 planar_scale_ = 0.5f;
    bool planar_float_refused_ = false;
    u32 planar_max_size_ = 1024;
    f32 planar_rate_ = 0;
    Entity planar_receiver_ = INVALID_ENTITY;
    u32 planar_texture_ = 0;
    PlanarConstants planar_constants_;
    glm::vec4 scene_clear_{0.0f, 0.0f, 0.0f, 1.0f};
    rg::ResourceId planar_resource_ = rg::kNoResource;
    void releasePlanarCaptures();

    /// Makes this ambient light the frame's environment, when it names one that is
    /// loaded; `scale` (colour times intensity) is folded into the coefficients.
    /// @p withoutSun lights with the sky alone, where a light casts its sun.
    /// @return false when it names none, leaving the caller to add a flat term.
    bool collectEnvironment(const ecs::Light& light, const glm::vec3& scale, bool withoutSun);
    /**
     * @brief Decides what the shadow pass will draw, without drawing any of it.
     *
     * @details Runs in collectAll, where nothing may touch the GPU: it allocates
     *          the squares, builds each projection and drops the ones whose frustum
     *          misses the scene. The tiles are published before the scene collects,
     *          because the atlas id travels into every receiving draw's key.
     */
    void buildShadowPlan(ecs::Registry& registry);
    /**
     * @brief Declares the pass that fills the atlas, ahead of the scene that reads it.
     *
     * @details Ordering is the graph's to know, not a matter of this call coming
     *          first: the scene names the atlas, so the graph keeps this pass alive
     *          and runs it before the one that samples it. @p registry is captured
     *          for the collect the pass does, and outlives execute().
     */
    void declareShadowPass(ecs::Registry& registry);
    /// The shadow pass's body: for each planned square, collect the occluders it can
    /// see and draw them. The graph has bound and cleared the atlas.
    void executeShadowPass(ecs::Registry& registry);

    /**
     * @brief Gathers the frame's 2D occluders and hands the casting lights a mask channel.
     *
     * @details Runs inside collectLights, where nothing may touch the GPU: it turns each
     *          enabled ShadowCaster2D into world-space edges and picks which lights the
     *          mask can carry. A light past the cap keeps lighting the scene and stops
     *          shadowing — said out loud in the plan rather than silently.
     */
    void collectShadow2D(ecs::Registry& registry);

    /// Whether some light has a cookie the shape mask will draw, which keeps the texture unit the second shadow mask would take.
    bool hasShape2DLight(ecs::Registry& registry);

    /// Declares the pass that draws the mask, ahead of the scene that samples it.
    void declareShadow2DPass();

    /// The mask pass's body: the shadow each edge casts from each light, drawn with MIN
    /// blending so a fragment keeps the darkest claim on it. The graph cleared the target.
    void executeShadow2DPass(u32 mask);

    /// Fills the vertices of mask @p mask (0: channels 0 to 3, 1: channels 4 to 7) with the geometry its pass draws.
    void buildShadow2DGeometry(u32 mask);

    /// Frees the mask's own GPU objects. Called while the device is still valid.
    void releaseShadow2DResources();

    /// Compiles the mask shader on first use, and says whether it is usable.
    bool ensureShadow2DShader();

    /// Whether this frame drew a mask — what the batch's slot budget and the sampler
    /// binding both key off.
    bool shadow2DActive() const { return shadow_2d_masks_[0].textureId != 0; }

    /**
     * @brief Gathers the frame's SHAPED lights and hands each one a shape-mask channel.
     *
     * @details The sibling of collectShadow2D, in the same no-GPU phase: a light with a
     *          cookie gets a channel, and past the cap a light lights without a shape.
     */
    void collectShape2D(ecs::Registry& registry);

    /// Declares the pass that draws the shape mask, ahead of the scene that samples it.
    void declareShape2DPass();

    /// The shape pass's body: one textured quad per shaped light, into its own channel.
    void executeShape2DPass();

    /// Frees the shape mask's own GPU objects. Called while the device is still valid.
    void releaseShape2DResources();

    /// Compiles the shape shader on first use, and says whether it is usable.
    bool ensureShape2DShader();

    /// Whether this frame drew a shape mask.
    bool shape2DActive() const { return shape_2d_texture_id_ != 0; }

    /// Grows the per-view frame-constant buffers to @p count and no further.
    void ensureShadowFrameUbos(u32 count);

    /// Deletes them. Device loss and shutdown: the handles name nothing afterwards.
    void releaseShadowFrameUbos();
    /// The scene pass's body: the draw, and the constants it needs current.
    void drawScene(DrawList::Phase phase = DrawList::Phase::All);
    /// Drops the atlas texture id the frame published; its target is the graph's
    /// to give back.
    void releaseFrameTargets();

    /// The world box the resident meshes occupy — what a shadow map must cover.
    /// False when nothing 3D is in the scene.
    bool meshWorldBounds(ecs::Registry& registry, glm::vec3& outMin, glm::vec3& outMax);
    /// The box the meshes drawn with a hair-shadow material occupy (MaterialStore::hairShadowDensity above zero), or false when there are none:
    /// what the sun's focus cascade is fitted to.
    bool hairWorldBounds(ecs::Registry& registry, glm::vec3& outMin, glm::vec3& outMax);
    /// Opens the frame's own target with @p clear's load-op, for begin() to bind it
    /// eagerly. Every other pass of the frame is the graph's to open.
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
        /// The light that asked. Carried for the same reason `slot` is — the cap sort
        /// reorders these, and a refusal has to be able to name who was refused.
        Entity light{};
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
    /// collectLights, read by buildShadowPlan; empty = nobody asked.
    std::vector<ShadowCaster> shadow_casters_;
    /// The frame's render targets, borrowed by shape and given back when the
    /// frame is done with them — shared with the post chains, which is what lets
    /// the atlas be a loan rather than a framebuffer held for the whole run.
    rg::TargetPool target_pool_;
    /// Every pass a frame runs, declared in one place and executed in end():
    /// the scene, and the post chains that read it. One per CAMERA, which is
    /// what a chain has always been — begin() opens it, end() runs it.
    rg::RenderGraph graph_;
    /// What the scene draws into, declared at begin(): the post capture when a
    /// chain is engaged, the frame's own target otherwise.
    rg::ResourceId scene_resource_ = rg::kNoResource;
    /// The framebuffer behind it, bound eagerly so a host draw between calls
    /// (the editor's grid) lands in the scene rather than on the screen.
    FramebufferHandle scene_fbo_ = FramebufferHandle::Default;
    /// The camera's rect within its target; the scene pass carries it.
    GfxDevice::Viewport scene_viewport_{};
    /**
     * @brief One occluder's outline in @ref shadow_points_2d_ — what a shadow is cast from.
     *
     * @details A ring rather than loose edges: a shadow is thrown by the SILHOUETTE —
     *          the two points of the outline a light sees the edges of — and what lies
     *          behind it is one shadow. Per edge, the shadows of one box overlap, and
     *          the overlap is a question a ring never raises.
     */
    struct ShadowRing2D {
        u32 first = 0;
        u32 count = 0;
        /// The middle of its points and how far the furthest is from it: what a light tests its reach against.
        glm::vec2 centre{0.0f};
        f32 radius = 0.0f;
    };

    /** @brief A light whose 2D shadows the frame draws, and the mask channel it owns. */
    struct Shadow2DLight {
        /// Where it stands. A directional light has no position and uses @ref dir.
        glm::vec2 pos{0.0f};
        /// The way a directional light's rays travel; zero for the others.
        glm::vec2 dir{0.0f};
        /// How far its shadows reach: a point/spot light's radius, a directional
        /// light's march distance. Past it the light contributes nothing to shadow.
        f32 reach = 0.0f;
        /// Half-extent of the source, in world units — what widens the penumbra.
        f32 softness = 0.0f;
        /// Its slot in the light array (or, for a tiled light, its index in the tiled list), which is what the channel is recorded against.
        u32 slot = 0;
        /// The mask channel it draws into and is read from. Lights that cannot meet share one (see ShadowChannels2D.hpp).
        u32 channel = 0;
        /// A light of the tiled list, past the loop's sixteen.
        bool tiled = false;
        bool directional = false;
    };

    std::vector<glm::vec2> shadow_points_2d_;
    std::vector<ShadowRing2D> shadow_rings_2d_;
    std::vector<Shadow2DLight> shadow_2d_lights_;
    /// How many casting lights the last collect could give no channel.
    u32 shadow_2d_unplaced_ = 0;
    /// The mask as a graph resource: the 2D shadow pass writes it, the scene reads it
    /// through a pinned sampler unit rather than a graph-bound one.
    /// One mask of the shadow channels: [0] carries channels 0 to 3, [1] channels 4 to 7 and exists only when a light holds one of those.
    struct Shadow2DMask {
        rg::ResourceId resource = rg::kNoResource;
        u32 textureId = 0;
        /// Interleaved (x, y, shadow, channel.rgba) — built on the CPU each frame, because
        /// the geometry is a function of where every light stands.
        std::vector<f32> vertices;
        BufferHandle vbo = BufferHandle::Invalid;
        u32 vboBytes = 0;
    };
    Shadow2DMask shadow_2d_masks_[2];
    RetainedTextStore retained_text_;
    VertexLayoutHandle shadow_2d_layout_ = VertexLayoutHandle::Invalid;
    resource::ShaderHandle shadow_2d_shader_{};
    bool shadow_2d_shader_tried_ = false;

    /** @brief A light whose shape the frame draws, and the mask channel it owns. */
    struct Shape2DLight {
        /// The quad's four world corners, in the order the two triangles take them.
        glm::vec2 corners[4]{};
        /// The cookie itself — one draw per light, because each binds its own.
        u32 texture = 0;
        /// Its slot in the light array, which is what the channel is recorded against.
        u32 slot = 0;
    };

    std::vector<Shape2DLight> shape_2d_lights_;
    /// The shape mask as a graph resource, read through its own pinned sampler unit.
    rg::ResourceId shape_2d_resource_ = rg::kNoResource;
    u32 shape_2d_texture_id_ = 0;
    /// Interleaved (x, y, u, v, channel.rgba), six vertices per light.
    std::vector<f32> shape_2d_vertices_;
    BufferHandle shape_2d_vbo_ = BufferHandle::Invalid;
    u32 shape_2d_vbo_bytes_ = 0;
    VertexLayoutHandle shape_2d_layout_ = VertexLayoutHandle::Invalid;
    resource::ShaderHandle shape_2d_shader_{};
    bool shape_2d_shader_tried_ = false;

    /// The atlas as a graph resource: the shadow pass writes it and the scene names
    /// it, which is what orders the two. Borrowed from the pool every other target
    /// comes from. kNoResource = no map this frame.
    rg::ResourceId shadow_resource_ = rg::kNoResource;
    /**
     * @brief One square of the atlas, and what fills it.
     *
     * @details Decided on the CPU: by the time the pass runs, where it draws and what
     *          it looks through are already answered, and all that is left is the draw.
     */
    struct ShadowView {
        glm::mat4 view_projection{1.0f};
        u32 x = 0;
        u32 y = 0;
        u32 size = 0;
        /// A sun's map: the way its rays travel, the lowest height a receiver can stand at and how far a shadow can reach, so a caster whose
        /// shadow falls outside the camera's view is not drawn into it.
        bool sun = false;
        glm::vec3 ray{0.0f, -1.0f, 0.0f};
        f32 floorY = 0.0f;
        f32 reachCap = 0.0f;
    };
    /// Whether a sun's map leaves out the casters whose shadow cannot reach the camera's view.
    bool shadow_receiver_cull_ = true;
    /// What the pass will draw, in atlas order. Empty = nothing asked for a map, and
    /// no pass is declared.
    std::vector<ShadowView> shadow_views_;
    /**
     * @brief The shadow pass's own transient buffers and draw list.
     *
     * @details Not the scene's. By the time the graph runs the pass, flush() has
     *          finalized and uploaded the scene's list, and the scene pass is still to
     *          come — a shadow collect through the same pool would overwrite the
     *          vertices the scene is about to draw from.
     */
    TransientBufferPool shadow_pool_;
    /**
     * @brief The motion pass's own buffers and draw list, for the same reason as the shadow pass's:
     *        the scene's list is finalized and uploaded before this one is collected.
     */
    TransientBufferPool velocity_pool_;
    DrawList velocity_list_;
    /// This frame's shift, kept from the collect so the pass draws through the camera the scene did.
    glm::vec2 velocity_jitter_{0.0f};
    /// Collects the meshes that moved by themselves since the last frame into velocity_list_.
    void collectMotion(ecs::Registry& registry);
    void executeMotionPass();
    /**
     * @brief The scene seen from straight above, depth only, around the camera — what stands over each place.
     *
     * @details Collected like a shadow map (the depth variant of every resident mesh) through a camera of its own, because
     *          what an effect asks of it is whether something is above a point, and a shadow map from the sun answers that for
     *          the sun's direction only. Its own buffers and list, for the same reason as the motion pass's.
     */
    void collectCover(ecs::Registry& registry);
    void executeCoverPass();
    TransientBufferPool cover_pool_;
    DrawList cover_list_;
    BufferHandle cover_frame_ubo_ = BufferHandle::Invalid;
    glm::mat4 cover_view_projection_{1.0f};
    /// The shift the scene was drawn with, so a pass that borrows the frame's constants can hand them back as they were.
    glm::vec2 scene_jitter_{0.0f};
    /// Whether the opaque scene is drawn twice, depth alone first. See DrawList::DrawPass.
    bool depth_prepass_ = false;
    /// One per view, kept across frames for the capacity. The whole pass is collected
    /// before any of it is drawn, so a view's commands have to outlive its collect.
    std::vector<DrawList> shadow_view_lists_;
    /// One FrameConstants buffer per view, grown to the busiest frame and never shrunk.
    /// A buffer write lands on the queue, not between two draws already recorded into
    /// an open pass — so what tells one view from another is which buffer is BOUND.
    std::vector<BufferHandle> shadow_frame_ubos_;
    /// Who owns which square of the atlas. Rebuilt every frame: a tile means
    /// nothing once the depths in it belong to a frame that is gone.
    ShadowAtlas shadow_atlas_{kShadowAtlasSize, kShadowCellSize};
    u32 shadow_atlas_size_ = kShadowAtlasSize;
    u32 shadow_cell_size_ = kShadowCellSize;
    u32 shadow_cascades_ = MAX_SHADOW_CASCADES;
    f32 shadow_distance_ = 0.0f;
    u32 shadow_2d_soft_samples_ = 16;
    ShadowPlanReport shadow_plan_;
    LightCapReport light_cap_;
    ViewLighting view_lighting_;
    bool scene_sky_available_ = false;
    /// The map's colour texture, handed to every mesh that receives it. 0 = none this frame.
    u32 shadow_texture_id_ = 0;
    /// The frame environment's reflection atlas, on the same terms. 0 = none this frame.
    u32 environment_texture_id_ = 0;
    /// Whether that environment is also the background this frame.
    bool draw_sky_ = false;
    /// The far-plane quad's program, compiled on first use.
    u32 sky_texture_id_ = 0;
    /// The atlas variant, then the panorama one; each compiled when first drawn.
    u32 sky_programs_[2] = {};
    bool sky_compiled_[2] = {};
    /// Emits the background quad when an environment asked to be seen behind the scene.
    void collectSky(RenderCollectContext& ctx);

    /// Borrowed from the UI system for the frame (see setScreenDomain).
    const std::unordered_set<u32>* screen_domain_ = nullptr;
    bool overlay_active_ = false;
    glm::mat4 overlay_projection_{1.0f};
    i32 overlay_vp_x_ = 0, overlay_vp_y_ = 0;
    u32 overlay_vp_w_ = 0, overlay_vp_h_ = 0;

    /// buildSpriteMasks scratch, reused across cameras/frames.
    std::vector<ResolvedMask> sprite_mask_scratch_;
    std::vector<Entity> mask_entities_scratch_;
    // processMasks scratch, reused across cameras/frames.
    std::vector<Entity> mask_scissor_scratch_;
    std::vector<Entity> mask_stencil_scratch_;
    std::vector<Entity> mask_root_scratch_;
    std::vector<std::pair<Entity, ScissorRect>> mask_scissor_walk_scratch_;
    std::vector<std::pair<Entity, i32>> mask_stencil_walk_scratch_;
    std::unordered_set<u32> mask_set_scratch_;
    std::unordered_set<u32> stencil_set_scratch_;
};

}  // namespace esengine
