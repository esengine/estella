/**
 * @file    SpineRenderer.hpp
 * @brief   Spine skeleton renderer
 * @details Renders Spine skeletons using the batch renderer.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "../ecs/Registry.hpp"
#include "../renderer/RenderContext.hpp"
#include "../resource/ResourceManager.hpp"
#include "SpineSystem.hpp"

#include <spine/spine.h>

#include <vector>

namespace esengine::spine {

// =============================================================================
// SpineRenderVertex
// =============================================================================

/**
 * @brief Vertex data for Spine rendering
 */
struct SpineRenderVertex {
    glm::vec2 position;
    glm::vec2 uv;
    glm::vec4 color;
};

// =============================================================================
// SpineRenderer
// =============================================================================

/**
 * @brief Renders Spine skeletons
 *
 * @details Extracts mesh data from Spine skeletons and submits triangles
 *          to the BatchRenderer2D for efficient rendering.
 *
 * @code
 * SpineRenderer spineRenderer(context, resourceManager, spineSystem);
 * spineRenderer.init();
 *
 * // In render loop
 * spineRenderer.begin(viewProjection);
 * spineRenderer.submit(registry);
 * spineRenderer.end();
 *
 * spineRenderer.shutdown();
 * @endcode
 */
class SpineRenderer {
public:
    SpineRenderer(RenderContext& context,
                  resource::ResourceManager& resourceManager,
                  SpineSystem& spineSystem);
    ~SpineRenderer();

    SpineRenderer(const SpineRenderer&) = delete;
    SpineRenderer& operator=(const SpineRenderer&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    void init();
    void shutdown();

    // =========================================================================
    // Rendering
    // =========================================================================

    /**
     * @brief Begins a render frame
     * @param viewProjection Combined view-projection matrix
     */
    void begin(const glm::mat4& viewProjection);

    /**
     * @brief Submits all Spine entities for rendering
     * @param registry ECS registry containing SpineAnimation components
     */
    void submit(ecs::Registry& registry);

    /**
     * @brief Renders a single skeleton at a transform
     * @param skeleton The skeleton to render
     * @param position World position
     * @param rotation World rotation
     * @param scale World scale
     * @param tintColor Color multiplier
     * @param layer Render layer
     */
    void renderSkeleton(::spine::Skeleton* skeleton,
                        const glm::vec3& position,
                        const glm::quat& rotation,
                        const glm::vec3& scale,
                        const glm::vec4& tintColor,
                        i32 layer);

    /**
     * @brief Ends the render frame and flushes batches
     */
    void end();

    // =========================================================================
    // Statistics
    // =========================================================================

    u32 getTriangleCount() const { return triangle_count_; }
    u32 getDrawCallCount() const { return draw_call_count_; }

private:
    void renderRegionAttachment(::spine::RegionAttachment* attachment,
                                 ::spine::Slot& slot,
                                 const glm::mat4& transform,
                                 const glm::vec4& tintColor);

    void renderMeshAttachment(::spine::MeshAttachment* attachment,
                               ::spine::Slot& slot,
                               const glm::mat4& transform,
                               const glm::vec4& tintColor);

    u32 getTextureId(void* spineTexture);
    void setBlendMode(::spine::BlendMode mode);
    void flushBatch();

    RenderContext& context_;
    resource::ResourceManager& resource_manager_;
    SpineSystem& spine_system_;

    glm::mat4 view_projection_;
    std::vector<SpineRenderVertex> vertices_;
    std::vector<u32> indices_;
    ::spine::SkeletonClipping clipper_;
    std::vector<f32> world_vertices_;

    u32 current_texture_id_ = 0;
    ::spine::BlendMode current_blend_mode_ = ::spine::BlendMode_Normal;
    u32 triangle_count_ = 0;
    u32 draw_call_count_ = 0;
    bool initialized_ = false;
};

}  // namespace esengine::spine
