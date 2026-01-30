/**
 * @file    RenderPipeline.hpp
 * @brief   Unified 2D render pipeline with batching and sorting
 * @details Provides efficient sprite rendering with layer sorting,
 *          texture batching, and optional frustum culling.
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
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "RenderContext.hpp"
#include "../resource/ResourceManager.hpp"

#include <vector>

namespace esengine {

// =============================================================================
// Forward Declarations
// =============================================================================

class BatchRenderer2D;

// =============================================================================
// RenderItem
// =============================================================================

/**
 * @brief Single renderable item in the pipeline
 */
struct RenderItem {
    Entity entity;              ///< Source entity ID
    glm::vec3 position;         ///< World position
    glm::quat rotation;         ///< World rotation
    glm::vec3 scale;            ///< World scale
    glm::vec2 size;             ///< Sprite size
    glm::vec4 color;            ///< Tint color
    glm::vec2 uv_offset;        ///< UV offset for sprite sheets
    glm::vec2 uv_scale;         ///< UV scale for sprite sheets
    u32 texture_id;             ///< GPU texture handle
    i32 layer;                  ///< Render layer
    f32 depth;                  ///< Z depth for sorting
    bool flip_x;                ///< Horizontal flip
    bool flip_y;                ///< Vertical flip

    /** @brief Generates a 64-bit sort key for efficient sorting */
    u64 sortKey() const;
};

// =============================================================================
// RenderBatch
// =============================================================================

/**
 * @brief Group of render items sharing the same texture
 */
struct RenderBatch {
    u32 texture_id;             ///< Batch texture
    u32 start_index;            ///< Start index in items array
    u32 count;                  ///< Number of items in batch
};

// =============================================================================
// RenderPipeline
// =============================================================================

/**
 * @brief Unified 2D render pipeline
 *
 * @details Provides a collect-cull-sort-batch-render pipeline for efficient
 *          2D sprite rendering. Uses BatchRenderer2D for batching multiple
 *          sprites into single draw calls.
 *
 * @code
 * RenderPipeline pipeline(context, resourceManager);
 *
 * pipeline.begin(viewProjection);
 * pipeline.submit(registry);
 * pipeline.end();
 *
 * auto stats = pipeline.getStats();
 * @endcode
 */
class RenderPipeline {
public:
    // =========================================================================
    // Types
    // =========================================================================

    /**
     * @brief Pipeline statistics
     */
    struct Stats {
        // Rendering
        u32 draw_calls = 0;         ///< Number of draw calls
        u32 batch_count = 0;        ///< Number of batches
        u32 triangles = 0;          ///< Total triangles rendered
        u32 vertices = 0;           ///< Total vertices rendered

        // Objects
        u32 total_items = 0;        ///< Total items submitted
        u32 visible_items = 0;      ///< Items actually rendered
        u32 culled_items = 0;       ///< Items culled by frustum

        // Textures
        u32 unique_textures = 0;    ///< Unique textures used
        u32 texture_switches = 0;   ///< Texture bind changes
    };

    // =========================================================================
    // Constructor / Destructor
    // =========================================================================

    /**
     * @brief Constructs render pipeline
     * @param context Render context for shared resources
     * @param resource_manager Resource manager for texture lookup
     */
    RenderPipeline(RenderContext& context, resource::ResourceManager& resource_manager);
    ~RenderPipeline();

    RenderPipeline(const RenderPipeline&) = delete;
    RenderPipeline& operator=(const RenderPipeline&) = delete;

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * @brief Enables or disables frustum culling
     * @param enabled True to enable culling
     */
    void setCullingEnabled(bool enabled) { culling_enabled_ = enabled; }

    /**
     * @brief Sets the view bounds for frustum culling
     * @param bounds View bounds (left, right, bottom, top in world space)
     */
    void setViewBounds(const glm::vec4& bounds) { view_bounds_ = bounds; }

    // =========================================================================
    // Rendering
    // =========================================================================

    /**
     * @brief Begins a new render frame
     * @param view_projection Combined view-projection matrix
     */
    void begin(const glm::mat4& view_projection);

    /**
     * @brief Submits all sprite entities from registry
     * @param registry ECS registry to collect from
     */
    void submit(ecs::Registry& registry);

    /**
     * @brief Submits a single render item manually
     * @param item The item to render
     */
    void submit(const RenderItem& item);

    /** @brief Ends the frame (sorts, batches, and renders) */
    void end();

    // =========================================================================
    // Statistics
    // =========================================================================

    /** @brief Gets pipeline statistics for the last frame */
    const Stats& getStats() const { return stats_; }

    /** @brief Resets statistics counters */
    void resetStats() { stats_ = Stats{}; }

private:
    void collectFromRegistry(ecs::Registry& registry);
    void cullItems();
    void sortItems();
    void buildBatches();
    void executeBatches();
    void executeNonBatched();
    bool isItemVisible(const RenderItem& item) const;

    RenderContext& context_;
    resource::ResourceManager& resource_manager_;
    Unique<BatchRenderer2D> batcher_;

    std::vector<RenderItem> items_;
    std::vector<RenderBatch> batches_;

    glm::mat4 view_projection_;
    glm::vec4 view_bounds_;
    bool culling_enabled_ = false;
    bool batching_enabled_ = true;

    Stats stats_;
};

}  // namespace esengine
