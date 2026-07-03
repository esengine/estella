// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "RenderItem.hpp"
#include "RenderTarget.hpp"
#include "RenderContext.hpp"
#include "RenderTypePlugin.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "PostProcessPipeline.hpp"
#endif
#include "FrameCapture.hpp"
#include "GfxDevice.hpp"
#include "TransientBufferPool.hpp"
#include "DrawList.hpp"
#include "ClipState.hpp"
#include "../ecs/Registry.hpp"
#include "../resource/ResourceManager.hpp"

#include <glm/glm.hpp>
#include <vector>
#include <string>
#include <memory>
#include <unordered_map>

namespace esengine {

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

// Per-frame GPU timer over EXT_disjoint_timer_query_webgl2 (GL_TIME_ELAPSED). A
// small ring of query objects so readback never stalls the CPU; reports the most
// recent completed frame's GPU ms, or -1 when unavailable. Only POD state lives
// here — the methods (which touch GL / emscripten) are defined in RenderFrame.cpp
// so no GL headers leak through this widely-included header.
class GpuTimer {
public:
    void begin();      // bracket the frame's draw submission (no-op if unavailable)
    void end();
    void poll();       // read back finished queries → last_ms_
    f32 lastMs() const { return last_ms_; }

private:
    void ensureInit(); // lazy: enable the extension + gen queries on first use
    static constexpr int kRing = 3;
    unsigned queries_[kRing] = {0, 0, 0};
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
        // Last completed frame's GPU time (ms) via EXT_disjoint_timer_query, or -1
        // when the timer isn't available (extension missing / driver disjoint).
        f32 gpu_time_ms = -1.0f;
    };

    RenderFrame(GfxDevice& device, RenderContext& context,
                resource::ResourceManager& resource_manager);
    ~RenderFrame();

    RenderFrame(const RenderFrame&) = delete;
    RenderFrame& operator=(const RenderFrame&) = delete;

    void init(u32 width, u32 height);
    void shutdown();
    void resize(u32 width, u32 height);

    void begin(const glm::mat4& view_projection, RenderTargetManager::Handle target = 0);
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
        Entity entity, i32 layer, f32 depth, bool sdf
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

    void replayToDrawCall(i32 stopAtDrawCall);
    const u8* getSnapshotPixels() const { return snapshot_pixels_.data(); }
    u32 getSnapshotSize() const { return static_cast<u32>(snapshot_pixels_.size()); }
    u32 getSnapshotWidth() const { return width_; }
    u32 getSnapshotHeight() const { return height_; }

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

    Stats stats_;
    GpuTimer gpu_timer_;
    FrameCapture frame_capture_;
    std::vector<u8> snapshot_pixels_;
    RenderTargetManager::Handle replay_rt_ = 0;
    std::vector<u8> preview_pixels_;
    RenderTargetManager::Handle preview_rt_ = 0;
    u32 preview_w_ = 0;
    u32 preview_h_ = 0;
    bool in_frame_ = false;
    bool flushed_ = false;
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
    std::unordered_map<std::string, u32> batch_variants_;
    TransientBufferPool pool_;
    DrawList draw_list_;
    ClipState clip_state_;
    std::vector<std::unique_ptr<RenderTypePlugin>> plugins_;

    RenderFrameContext makeContext();
    void buildClipState();
    /// Gathers the scene's enabled Light2D components into the per-frame LightConstants UBO
    /// (point/directional into the light array, ambient summed). Run each frame in collectAll;
    /// flush() uploads + binds the result so Lit2D material shaders read it.
    void collectLights(ecs::Registry& registry);
    u32 initBatchShader();
    u32 compileBatchVariant(const std::vector<std::string>& features);
};

}  // namespace esengine
