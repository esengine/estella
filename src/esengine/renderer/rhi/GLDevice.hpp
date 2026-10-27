// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GLDevice.hpp
 * @brief   OpenGL ES / WebGL implementation of GfxDevice
 * @details Implements the backend primitives with OpenGL ES 3.0 calls. A handle is
 *          the registry's id; the GL name behind it belongs to one generation of
 *          the context and lives only in this backend's maps.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "./GfxDevice.hpp"

#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace esengine {

// =============================================================================
// GLDevice Class
// =============================================================================

/**
 * @brief OpenGL ES 3.0 / WebGL 2.0 implementation of GfxDevice
 */
class GLDevice final : public GfxDevice {
public:
    GLDevice() = default;
    ~GLDevice() override = default;

    ClipDepthRange clipDepthRange() const override { return ClipDepthRange::MinusOneToOne; }

    void init() override;
    void shutdown() override;

    bool pollDeviceLost() override;

    void setViewport(i32 x, i32 y, u32 w, u32 h) override;
    void clearStencil(i32 value) override;

    void setScissorTest(bool enabled) override;
    void setScissor(i32 x, i32 y, i32 w, i32 h) override;

    void setVertexBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes) override;
    void setIndexBuffer(BufferHandle buffer) override;

    void bindTexture(u32 slot, TextureHandle texture) override;
    bool supportsCompressedFormat(GfxCompressedFormat format) override;
    bool supportsFloatTargets() override;
    bool supportsUnblendedSurfaceTarget() const override { return indexed_blend_ == 1; }
    u32 maxSamples() override;
    /** A GL blit resolves depth as well as colour. */
    bool resolvesDepth() const override { return true; }

    bool supportsShaderLanguage(GfxShaderLanguage language) const override {
        return language == GfxShaderLanguage::GLSL_ES300;
    }

    /// GL reads a framebuffer from the bottom up.
    bool textureOriginTopLeft() const override { return false; }

    void setStencilReference(i32 ref) override;

    void drawElements(u32 indexCount, GfxDataType indexType, u32 byteOffset) override;
    void drawArrays(u32 first, u32 vertexCount) override;
    void drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 byteOffset, u32 instanceCount) override;

    void beginRenderPass(const RenderPassDesc& desc) override;
    void endRenderPass() override;

    ReadbackHandle requestReadback(FramebufferHandle target, u32 w, u32 h) override;
    GfxReadbackStatus pollReadback(ReadbackHandle handle) override;
    bool takeReadback(ReadbackHandle handle, void* dest, usize destSize) override;
    void discardReadback(ReadbackHandle handle) override;

    void beginTimerQuery(u32 query) override;
    void endTimerQuery() override;
    bool timerDisjoint() override;
    bool getTimerQueryNs(u32 query, u64* outNanoseconds) override;

    void setWireframe(bool enabled) override;
    u32 getError() override;
    std::string getString(GfxStringName name) override;
    i32 getInt(GfxIntParam name) override;

    /** @brief This generation's GL name behind a texture, for a host uploading into it. */
    u32 nativeTextureName(TextureHandle texture) const override { return nameOf(texture_names_, static_cast<u32>(texture)); }

protected:
    void captureDeviceIdentity() override;
    bool recreateDevice() override;
    void onDeviceLost() override;

    bool backendCreateBuffer(u32 id, const BufferDesc& desc, const void* data) override;
    void backendDeleteBuffer(u32 id) override;
    void backendUpdateBuffer(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes) override;
    void backendResizeBuffer(u32 id, const BufferDesc& desc, const void* data) override;
    void backendSetUniformBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes, u32 sizeBytes) override;

    bool backendCreateTexture(u32 id, const TextureDesc& desc, const void* pixels) override;
    bool backendCreateCompressedTexture(u32 id, const TextureDesc& desc, GfxCompressedFormat format,
                                        const void* data, u32 byteLength, u32 mipLevels) override;
    bool backendAdoptTexture(u32 id, u32 nativeId, const TextureDesc& desc) override;
    void backendDeleteTexture(u32 id) override;
    void backendMoveTexture(u32 into, u32 from) override;
    void backendUpdateTexture(u32 id, i32 x, i32 y, u32 width, u32 height,
                              const void* pixels, bool flipY) override;
    void backendSetTextureParams(u32 id, const TextureDesc& desc) override;
    void backendGenerateMipmaps(u32 id) override;

    bool backendCreateProgram(u32 id, const GfxShaderSource& source,
                              const GfxAttribBinding* bindings, u32 bindingCount,
                              std::string* outLog, GfxShaderStage* outFailedStage) override;
    void backendDeleteProgram(u32 id) override;
    void backendUseProgram(u32 id) override;
    i32 backendUniformLocation(u32 program, const char* name) override;
    i32 backendAttribLocation(u32 program, const char* name) override;
    void backendSetUniform(i32 nativeLocation, const GfxUniformValue& value) override;
    std::vector<GfxUniformInfo> backendActiveUniforms(u32 program) override;
    u32 backendUniformBlockIndex(u32 program, const char* name) override;
    void backendUniformBlockBinding(u32 program, u32 nativeBlockIndex, u32 bindingPoint) override;

    void backendDeleteVertexLayout(u32 id) override;
    void backendSetPipeline(u32 id, const PipelineDesc& desc) override;
    /** The GL primitive mode of the bound pipeline's topology. */
    u32 primitiveMode() const;
    void backendInvalidatePipelineCache() override;

    bool supportsDeferredLink() const override { return true; }
    bool backendProgramPending(u32 id) const override { return pending_programs_.count(id) != 0; }
    bool backendFinishProgram(u32 id) override;
    void endFrame() override;
    bool backendProgramReady(u32 id) override;
    u32 backendPendingProgramCount() override;

    bool backendCreateFramebuffer(u32 id, const FramebufferDesc& desc) override;
    void backendDeleteFramebuffer(u32 id) override;

    bool backendCreateTimerQuery(u32 id) override;
    u32 backendReadbackCount() const override { return static_cast<u32>(readbacks_.size()); }

private:
    static u32 nameOf(const std::vector<u32>& names, u32 id) {
        return id < names.size() ? names[id] : 0u;
    }
    static void setName(std::vector<u32>& names, u32 id, u32 name) {
        if (id >= names.size()) names.resize(static_cast<usize>(id) + 1, 0u);
        names[id] = name;
    }
    /** A multisampled texture is a renderbuffer in WebGL2, in its own GL namespace. */
    bool isRenderbuffer(u32 textureId) const;

    // Clear machinery: backend-internal since RenderPassDesc became the only way
    // to request clears (it carries the values; beginRenderPass applies them).
    void setClearColor(f32 r, f32 g, f32 b, f32 a);
    void setClearStencil(i32 value);
    void clear(bool color, bool depth, bool stencil);

    // The loose state setters a pipeline bundles (blend/depth/stencil/cull/masks):
    // backend-internal since the pipeline became the only way to set them.
    void setBlendEnabled(bool enabled);
    void setBlendMode(BlendMode mode);
    void setDepthTest(bool enabled);
    void setDepthWrite(bool enabled);
    void setStencilTest(bool enabled);
    void setStencilFunc(GfxStencilFunc func, i32 ref, u32 mask);
    void setStencilOp(GfxStencilOp sfail, GfxStencilOp dpfail, GfxStencilOp dppass);
    void setStencilMask(u32 mask);
    void setColorMask(bool r, bool g, bool b, bool a);
    void setCulling(bool enabled);
    void setCullFace(bool front);
    void setDepthBias(i16 bias);

    void applyStencilMode(GfxStencilMode mode);

    void uploadBufferStore(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes, bool respec);

    // Drops every "what is currently bound" cache. Those answers are only valid
    // for the context that was asked; after a restore they would suppress the
    // very binds that re-establish state.
    void resetStateCache();

    // Applies the current pipeline's vertex layout to the pending buffer bindings:
    // the layout's lazily-created VAO is bound, and any slot whose buffer/offset
    // differs from what the VAO has baked is re-pointed. WebGL2 has no explicit
    // vertex-input object, so the VAO is purely a backend cache here.
    void prepareVertexState();

    // Binds a texture on the active unit for a create/update/mipmap edit while
    // keeping the sampler-binding cache coherent, so bindTexture() can skip
    // redundant per-draw binds (every gl* call is a WASM→JS FFI crossing).
    void bindTextureForEdit(u32 name);

    // Detach a texture from every sampler slot it lingers in, keeping the sampler
    // cache coherent. Used by beginRenderPass to break feedback loops: a render
    // target's own attachment must not stay bound to a sampler while it is drawn to.
    void evictSamplerBinding(u32 name);

    /** GL_TEXTURE_2D_ARRAY for a name created as an array, GL_TEXTURE_2D otherwise. */
    u32 textureTarget(u32 name) const;
    /** The GL names of this generation's texture arrays: every bind and edit of one names its target. */
    std::unordered_set<u32> array_names_;

    /** GL names by registry id for this generation; 0 = none. */
    std::vector<u32> buffer_names_;
    std::vector<u32> texture_names_;
    std::vector<u32> program_names_;
    /// A program made with deferLink, until something waits for it: the shader objects to delete once it has linked.
    struct PendingProgram { u32 vertex = 0; u32 fragment = 0; };
    std::unordered_map<u32, PendingProgram> pending_programs_;
    /// The program's GL name, waiting for it first if it was deferred: every use of a program goes through here.
    u32 programName(u32 id);
    /// What the pass now running said of its attachments (RenderPassDesc::discard*), acted on when it is left.
    bool pass_discard_msaa_ = false;
    bool pass_discard_depth_ = false;
    /// What the default framebuffer has to be told to forget at the end of a frame: its depth and its stencil, where it has them (-1 not yet asked).
    i8 default_depth_bits_ = -1;
    i8 default_stencil_bits_ = -1;
    /// The target being left: its depth, if the pass said nothing reads it.
    void discardLeftDepth();
    /// Programs whose link failed, found out when something first asked: never ready, so a draw that skips what is not ready skips them for good.
    std::unordered_set<u32> failed_programs_;
    /// 0 unknown, 1 the browser reports a program's completion without waiting for it (KHR_parallel_shader_compile), 2 it does not.
    i8 completion_status_ = 0;
    std::vector<u32> framebuffer_names_;
    std::vector<u32> query_names_;
    /** Buffer id per uniform binding slot, as the renderer set it. */
    std::vector<u32> uniform_slots_;
    /** The range of that buffer each slot reads; a size of 0 is the whole buffer. */
    struct UniformRange { u32 offset = 0; u32 size = 0; };
    std::vector<UniformRange> uniform_ranges_;
    void bindUniformSlot(u32 slot, u32 name);

    /// What the context is known to hold for the states every draw sets, so one a pipeline sets to what it already is costs no call. A frame of
    /// the terrain and water example made 26,000 GL calls and over half of them said what the context already knew: through the browser each is a
    /// crossing, and on a phone a dear one. -1 is unknown (after init, after a lost context): the next set is made.
    enum Cap : u32 { kCapDepthTest, kCapStencilTest, kCapCull, kCapBlend, kCapCount };
    i8 cap_state_[kCapCount] = {-1, -1, -1, -1};
    i8 depth_mask_ = -1;
    i16 color_mask_ = -1;     ///< the four channels as bits
    i64 stencil_mask_ = -1;
    /// The buffer, offset and size each uniform slot was last bound to. A buffer's deletion forgets the slots that held it.
    struct UniformBound { u32 name = 0; u32 offset = 0; u32 size = 0; bool known = false; };
    std::vector<UniformBound> uniform_bound_;
    void setCap(Cap cap, u32 glCap, bool enabled);  ///< glCap is the GL enum of the capability (this header holds no GL types)
    void resetDrawStateCaches();

    u32 current_pipeline_id_ = 0;
    GfxTopology current_topology_ = GfxTopology::Triangles;
    GfxStencilMode current_stencil_mode_ = GfxStencilMode::Off;
    // Redundant-state caches: a pipeline switch sharing the program or blend func
    // skips the FFI-crossing GL call. 0xFF is an out-of-range BlendMode, so the
    // first real set always issues.
    u32 current_program_name_ = 0;
    BlendMode current_blend_ = static_cast<BlendMode>(0xFF);

    // Redundant-state caches for the two per-draw hot paths. glActiveTexture is
    // the only site that moves the active unit, so active_texture_unit_ is
    // authoritative; bound_texture_[unit] mirrors the sampler bindings by GL name.
    static constexpr u32 kTextureSlots = 16;
    u32 active_texture_unit_ = 0;
    u32 bound_texture_[kTextureSlots] = {};
    i16 current_depth_bias_ = 0;
    i8 depth_equal_ = -1;  ///< -1: unknown. 1 when the depth test passes on equal depth too.
    i8 alpha_to_coverage_ = -1;  ///< -1: unknown, so the next pipeline sets it.
    /// The framebuffer being drawn into carries a second colour attachment, and which of the two draw
    /// buffer sets is live: 0 = colour only, 1 = both, -1 = not yet said for this pass.
    bool current_fbo_has_gbuffer_ = false;
    i8 draw_buffers_ = -1;
    void applyDrawBuffers(bool gbuffer);
    /// OES_draw_buffers_indexed: 1 enabled, 0 absent (asked once at init).
    i8 indexed_blend_ = 0;
    /// Blending is off on the second draw buffer while the first blends (a composing draw writing the surface record).
    bool surface_blend_off_ = false;
    void applySurfaceBlend(bool off);
    int scissor_test_ = -1;  // tri-state: -1 unknown, 0 disabled, 1 enabled
    int float_targets_ = -1;  // supportsFloatTargets(), answered once per context: -1 not asked yet

    struct VaoCache {
        u32 vao = 0;
        bool configured = false;
        u32 bakedVbo[MAX_VERTEX_BUFFER_SLOTS] = {};
        u32 bakedOffset[MAX_VERTEX_BUFFER_SLOTS] = {};
        u32 bakedIbo = 0;
    };
    // A vertex array object per (layout, the buffers it reads from): it holds the attribute pointers, which name their buffer, so one VAO shared by
    // every buffer of a layout re-pointed all of them at each draw that changed buffer (a tilemap's strips, a mesh's own vertices). Slots the
    // layout does not read are 0 in the key, so a stale handle left in one does not make a second VAO. Offsets are not in the key: a draw that
    // moves along a buffer (instance records) re-points just that slot, as before.
    struct VaoKey {
        u32 layout = 0;
        u32 vbo[MAX_VERTEX_BUFFER_SLOTS] = {};
        u32 ibo = 0;
        bool operator==(const VaoKey&) const = default;
    };
    struct VaoKeyHash {
        usize operator()(const VaoKey& key) const {
            usize h = key.layout * 2654435761u;
            for (u32 slot = 0; slot < MAX_VERTEX_BUFFER_SLOTS; ++slot) h = (h ^ key.vbo[slot]) * 1099511628211ull;
            return (h ^ key.ibo) * 1099511628211ull;
        }
    };
    std::unordered_map<VaoKey, VaoCache, VaoKeyHash> vaos_;
    /// Deletes every VAO that reads from a GL buffer name, before the name is deleted and reused.
    void releaseVaosUsing(u32 bufferName);
    u32 current_layout_ = 0;
    u32 pending_vbo_[MAX_VERTEX_BUFFER_SLOTS] = {};
    u32 pending_vbo_offset_[MAX_VERTEX_BUFFER_SLOTS] = {};
    u32 pending_ibo_ = 0;
    u32 bound_vao_ = 0;

    // Where a multisampled framebuffer resolves to, and how big, by framebuffer id.
    // The blit runs whenever the target is left, which is the only reason anything
    // above the RHI can sample a target it drew into multisampled.
    struct ResolvePair {
        u32 destFbo = 0;
        u32 width = 0;
        u32 height = 0;
        bool depth = false;
        bool gbuffer = false;
    };
    std::unordered_map<u32, ResolvePair> framebuffer_resolve_;
    /// Blit a multisampled target into the single-sample one it owns; no-op for
    /// a target that owns none. Called whenever a target is left.
    void resolveFramebuffer(u32 framebufferId);
    /// The framebuffer id a pass is currently drawing into (0 = default).
    u32 current_framebuffer_ = 0;
    /// 0 = unprobed; otherwise GL_MAX_SAMPLES, floored at 1.
    u32 max_samples_ = 0;

    // Completed readbacks parked until taken: GL reads synchronously at request
    // time, so the async contract resolves on the caller's first poll.
    std::unordered_map<u32, std::vector<u8>> readbacks_;
    u32 next_readback_id_ = 1;

    // 0 = unprobed, 1 = timer queries available, 2 = unavailable.
    int timer_query_state_ = 0;
    bool timer_disjoint_pending_ = false;
};

}  // namespace esengine
