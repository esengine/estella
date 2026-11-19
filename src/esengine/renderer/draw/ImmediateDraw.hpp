// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ImmediateDraw.hpp
 * @brief   Immediate mode 2D drawing API
 * @details Provides simple, immediate mode drawing primitives (lines, rectangles,
 *          circles, polygons) with automatic batching for efficient rendering.
 *          All draw commands are cleared each frame.
 *
 *          Backed by the same TransientBufferPool + GfxDevice pipeline machinery
 *          as RenderFrame — there is no separate batch renderer.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"
#include "../rhi/PipelineState.hpp"
#include "../rhi/TransientBufferPool.hpp"
#include "./BatchVertex.hpp"

#include <glm/glm.hpp>
#include <string>
#include <vector>
#include <span>

namespace esengine {

class GfxDevice;
class RenderContext;

namespace resource {
    class ResourceManager;
}

/**
 * @brief Immediate mode 2D drawing API
 *
 * @details Provides a simple API for drawing 2D primitives. All commands
 *          submitted between begin() and end() are batched (per texture) and
 *          drawn in submission order. The buffer is cleared each frame.
 *
 * @code
 * ImmediateDraw draw(device, state, context, resourceManager);
 * draw.init();
 *
 * draw.begin(viewProjection);
 * draw.line({0, 0}, {100, 100}, {1, 0, 0, 1});
 * draw.rect({50, 50}, {30, 30}, {0, 1, 0, 1});
 * draw.circle({150, 150}, 25, {0, 0, 1, 1});
 * draw.end();
 * @endcode
 */
class ImmediateDraw {
public:
    /**
     * @brief Constructs an immediate draw instance
     * @param device  Graphics device (GPU command sink)
     * @param context Render context for shared resources (white texture)
     * @param resource_manager Resource manager for shader access
     */
    ImmediateDraw(GfxDevice& device, RenderContext& context,
                  resource::ResourceManager& resource_manager);
    ~ImmediateDraw();

    ImmediateDraw(const ImmediateDraw&) = delete;
    ImmediateDraw& operator=(const ImmediateDraw&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    void init();

    void shutdown();

    // =========================================================================
    // Frame Management
    // =========================================================================

    /** @brief Begins a new draw frame */
    void begin(const glm::mat4& viewProjection, i32 viewportWidth = 0, i32 viewportHeight = 0);

    /** @brief Ends the frame and submits all draw commands */
    void end();

    /** Close collection now and submit it when the owning scene pass executes. */
    void deferEnd();

    /** Submit a collection closed by deferEnd inside the active render pass. */
    void flushDeferred();

    /**
     * The same, with every batch drawn through @p program instead of the one it was
     * collected with: a pass that writes the display itself draws a linear frame's
     * colours through the variant that encodes them, as the scene's present did.
     */
    void flushDeferred(ShaderHandle program);

    /** Whether a collection closed by deferEnd is waiting for its pass. */
    bool hasDeferred() const { return deferredGeometry_; }

    /** The view-projection the current or last collection began with. */
    const glm::mat4& viewProjection() const { return viewProjection_; }

    /**
     * @brief Flushes pending draw commands without ending the frame
     * @details Use before operations that change GL state to ensure accumulated
     *          primitives are rendered with the correct state.
     */
    void flush();

    // =========================================================================
    // Line Drawing
    // =========================================================================

    void line(const glm::vec2& from, const glm::vec2& to,
              const glm::vec4& color, f32 thickness = 1.0f);

    /**
     * @brief A line between two points in SPACE, widened across the view.
     * @details Widened along `cross(direction, view forward)` rather than in a
     *          plane, so it reads as a line from wherever the camera is.
     *          Thickness is in WORLD units, so a distant line thins out with the
     *          geometry beside it.
     */
    void line3D(const glm::vec3& from, const glm::vec3& to,
                const glm::vec4& color, f32 thickness = 1.0f);

    /** A world-space line with an explicit framebuffer-pixel thickness. */
    void line3DScreen(const glm::vec3& from, const glm::vec3& to,
                      const glm::vec4& color, f32 thickness = 1.0f);

    /**
     * @brief A framebuffer-sized line attached to one world-space anchor.
     * @details Offsets use framebuffer pixels (+X right, +Y up). The anchor is
     *          projected through the active draw frame, so editor handles keep a
     *          stable size without sampling a second camera.
     */
    void line3DScreenOffset(const glm::vec3& anchor,
                            const glm::vec2& fromOffset,
                            const glm::vec2& toOffset,
                            const glm::vec4& color, f32 thickness = 1.0f);

    void polyline(std::span<const glm::vec2> vertices, const glm::vec4& color,
                  f32 thickness = 1.0f, bool closed = false);

    // =========================================================================
    // Rectangle Drawing
    // =========================================================================

    void rect(const glm::vec2& position, const glm::vec2& size,
              const glm::vec4& color, bool filled = true);

    void rectOutline(const glm::vec2& position, const glm::vec2& size,
                     const glm::vec4& color, f32 thickness = 1.0f);

    // =========================================================================
    // Circle Drawing
    // =========================================================================

    void circle(const glm::vec2& center, f32 radius,
                const glm::vec4& color, bool filled = true, i32 segments = 32);

    void circleOutline(const glm::vec2& center, f32 radius,
                       const glm::vec4& color, f32 thickness = 1.0f, i32 segments = 32);

    // =========================================================================
    // Polygon Drawing
    // =========================================================================

    void polygon(std::span<const glm::vec2> vertices, const glm::vec4& color);

    /**
     * @brief Triangles with a colour at every vertex, in one call: a shape tessellated once and drawn as often as asked.
     *
     * @details `positions` holds an x, y pair a vertex, `colors` an r, g, b, a quadruple a vertex (null: white), `indices` three a
     *          triangle. Every colour is multiplied by `tint`, and every point is moved by the 2D affine `xform`
     *          (x' = xform[0] x + xform[2] y + xform[4], y' = xform[1] x + xform[3] y + xform[5]), so one shape is drawn where and as
     *          faded as this frame says without being built again. A call naming a vertex it does not hold draws nothing.
     */
    void triangles(const f32* positions, u32 vertexCount, const f32* colors, const u32* indices, u32 indexCount,
                   const glm::vec4& tint, const f32 xform[6]);

    /**
     * @brief Puts a shape on the GPU once, for drawMesh to draw any number of times without sending its vertices again.
     *
     * @details The same arrays as triangles(). Returns the mesh's id, or 0 when there is nothing to keep or an index
     *          names a vertex the shape does not hold. Ids outlive frames; destroyMesh gives the GPU memory back.
     */
    u32 createShape(const f32* positions, u32 vertexCount, const f32* colors, const u32* indices, u32 indexCount);

    /** Gives a mesh's GPU memory back. A draw already collected this frame still draws; the id is not drawn again. */
    void destroyMesh(u32 id);

    /**
     * @details The transform is applied on the GPU: a copy costs one 28-byte instance record, and consecutive copies of
     *          one mesh in one state are one instanced draw. Anything else drawn between two copies keeps its place.
     */
    void drawMesh(u32 id, const glm::vec4& tint, const f32 xform[6]);

    /**
     * @brief @p count copies of a mesh in one call: drawMesh for each, without a call a copy.
     *
     * @details @p records holds one 28-byte record a copy, as the instance stream is laid out: six floats (the affine, in
     *          drawMesh's order) and the tint packed as packColor packs it. They are copied into the frame's stream whole.
     */
    void drawMeshMany(u32 id, const void* records, u32 count);

    u32 meshCount() const { return liveMeshes_; }

    // =========================================================================
    // Texture Drawing
    // =========================================================================

    void texture(const glm::vec2& position, const glm::vec2& size,
                 u32 textureId, const glm::vec4& tint = glm::vec4(1.0f));

    void textureRotated(const glm::vec2& position, const glm::vec2& size,
                        f32 rotation, u32 textureId,
                        const glm::vec4& tint = glm::vec4(1.0f));

    // =========================================================================
    // Configuration
    // =========================================================================

    void setLayer(i32 layer) { currentLayer_ = layer; }
    i32 getLayer() const { return currentLayer_; }
    void setDepth(f32 depth) { currentDepth_ = depth; }
    f32 getDepth() const { return currentDepth_; }

    /** Switches the blend mode for subsequent primitives (flushes pending geometry). */
    void setBlendMode(BlendMode mode);
    /** Toggles depth testing for subsequent primitives (flushes pending geometry). */
    void setDepthTest(bool enabled);
    /** Changes depth testing and writes together, flushing the previous batch. */
    void setDepthState(bool test, bool write);
    BlendMode blendMode() const { return current_desc_.blend; }
    bool depthTest() const { return current_desc_.depthTest; }
    bool depthWrite() const { return current_desc_.depthWrite; }
    /** Collects all following primitive batches for the owning scene pass. */
    void deferBegin() { recording_ = true; }

    // =========================================================================
    // Statistics
    // =========================================================================

    u32 getDrawCallCount() const { return drawCallCount_; }
    u32 getPrimitiveCount() const { return primitiveCount_; }

private:
    /** Emits a (optionally rotated) textured quad into the current batch. */
    void emitQuad(const glm::vec2& center, const glm::vec2& size, f32 rotation,
                  const glm::vec4& color, u32 textureId,
                  const glm::vec2& uvOffset = glm::vec2(0.0f),
                  const glm::vec2& uvScale = glm::vec2(1.0f));
    /** Emits a flat triangle (white texture) into the current batch. */
    void emitTriangle(const glm::vec2& p0, const glm::vec2& p1, const glm::vec2& p2,
                      const glm::vec4& color);
    /** Switches the batch texture, flushing first if it changed. */
    void useTexture(u32 textureId);
    /** Ends the run of copies being collected: draws it, or records it for the deferred pass. */
    void flushRun();
    /** The frame's instance records not yet on the GPU, onto it. */
    void uploadInstances();
    /** One instanced draw of @p count copies of @p mesh from record @p first. */
    void drawRun(PipelineHandle pipeline, u32 mesh, u32 first, u32 count);
    /** The instanced variant's pipeline in the current blend and depth state; @p display for a pass that writes the display. */
    PipelineHandle instancedPipeline(const PipelineDesc& state, bool display);
    resource::ShaderHandle compileVariant(const std::vector<std::string>& features);

    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resource_manager_;

    TransientBufferPool pool_;
    /// The handle is the identity; batch_shader_ caches the program id it
    /// currently resolves to, re-read when the device rebuilds the program.
    resource::ShaderHandle batch_shader_ref_;
    ShaderHandle batch_shader_ = ShaderHandle::Invalid;
    PipelineDesc base_desc_{};
    PipelineDesc current_desc_{};
    PipelineHandle pipeline_ = PipelineHandle::Invalid;
    u32 white_texture_id_ = 0;
    u32 currentTexture_ = 0;
    bool pendingGeometry_ = false;
    /** Reused by triangles(): a steady frame of shapes allocates nothing. */
    std::vector<BatchVertex> triangleVertices_;
    std::vector<u32> triangleIndices_;
    bool deferredGeometry_ = false;
    struct DeferredBatch {
        PipelineHandle pipeline;
        u32 texture;
        u32 firstIndex;
        u32 indexCount;
        /// Non-zero: an instanced run of this mesh, `instanceCount` copies from record `firstInstance`.
        u32 mesh = 0;
        u32 firstInstance = 0;
        u32 instanceCount = 0;
    };
    std::vector<DeferredBatch> deferredBatches_;
    u32 recordedIndices_ = 0;
    bool recording_ = false;

    struct ResidentMesh {
        BufferHandle vbo = BufferHandle::Invalid;
        BufferHandle ebo = BufferHandle::Invalid;
        u32 indexCount = 0;
        bool live = false;
    };
    /** One copy: the affine's columns and translation, and a tint packed as the vertex colours are. 28 bytes. */
    struct InstanceRecord {
        f32 xform[6];
        u32 tint;
    };
    std::vector<ResidentMesh> meshes_;          ///< id - 1
    std::vector<u32> freeMeshes_;               ///< ids whose slots can be handed out again
    std::vector<u32> doomedMeshes_;             ///< destroyed, buffers freed at the next begin() (a collected draw may still name them)
    u32 liveMeshes_ = 0;
    std::vector<InstanceRecord> instances_;     ///< the frame's records, in the order they were drawn
    u32 instancesUploaded_ = 0;
    BufferHandle instanceVbo_ = BufferHandle::Invalid;
    u32 instanceCapacity_ = 0;                  ///< records instanceVbo_ holds
    VertexLayoutHandle instanceLayout_ = VertexLayoutHandle::Invalid;
    /// The INSTANCED batch variants, compiled on the first copy drawn, for the colour space they were compiled in.
    resource::ShaderHandle instancedShader_;
    resource::ShaderHandle instancedDisplayShader_;
    bool instancedLinear_ = false;
    bool instancedCompiled_ = false;
    bool instancedDisplayCompiled_ = false;
    struct Run {
        u32 mesh = 0;
        u32 first = 0;
        u32 count = 0;
    };
    Run pendingRun_;

    /// Where the camera looks, from the view-projection this frame began with —
    /// what a 3D line is widened across.
    glm::vec3 viewForward_{0.0f, 0.0f, -1.0f};
    /// Canonical (OpenGL-depth) lens for cutting 3D lines before ribbon expansion.
    glm::mat4 viewProjection_{1.0f};
    glm::mat4 inverseViewProjection_{1.0f};
    f32 viewportWidth_ = 1.0f;
    f32 viewportHeight_ = 1.0f;

    i32 currentLayer_ = 0;
    f32 currentDepth_ = 0.0f;
    u32 primitiveCount_ = 0;
    u32 drawCallCount_ = 0;
    bool initialized_ = false;
    bool inFrame_ = false;
};

}  // namespace esengine
