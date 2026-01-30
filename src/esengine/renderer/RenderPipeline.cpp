/**
 * @file    RenderPipeline.cpp
 * @brief   Unified 2D render pipeline implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "RenderPipeline.hpp"
#include "Renderer.hpp"
#include "RenderCommand.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <algorithm>
#include <unordered_set>

namespace esengine {

// =============================================================================
// RenderItem
// =============================================================================

u64 RenderItem::sortKey() const {
    u64 key = 0;

    // Layer: convert signed to unsigned (add 32768 to handle negative layers)
    u64 layerKey = static_cast<u64>(layer + 32768) & 0xFFFF;
    key |= layerKey << 48;

    // Texture ID: for batch optimization
    u64 texKey = static_cast<u64>(texture_id) & 0xFFFFFF;
    key |= texKey << 24;

    // Depth: convert float to sortable integer
    f32 normalizedDepth = (depth + 1000.0f) * 10000.0f;
    u64 depthKey = static_cast<u64>(normalizedDepth) & 0xFFFFFF;
    key |= depthKey;

    return key;
}

// =============================================================================
// Constructor / Destructor
// =============================================================================

RenderPipeline::RenderPipeline(RenderContext& context,
                               resource::ResourceManager& resource_manager)
    : context_(context)
    , resource_manager_(resource_manager)
    , view_bounds_(0.0f) {

    batcher_ = makeUnique<BatchRenderer2D>(context_, resource_manager_);
    batcher_->init();

    items_.reserve(1024);
    batches_.reserve(64);

    ES_LOG_INFO("RenderPipeline initialized");
}

RenderPipeline::~RenderPipeline() {
    if (batcher_) {
        batcher_->shutdown();
    }
    ES_LOG_INFO("RenderPipeline shutdown");
}

// =============================================================================
// Rendering
// =============================================================================

void RenderPipeline::begin(const glm::mat4& view_projection) {
    view_projection_ = view_projection;
    items_.clear();
    batches_.clear();
    stats_ = Stats{};
}

void RenderPipeline::submit(ecs::Registry& registry) {
    collectFromRegistry(registry);
}

void RenderPipeline::submit(const RenderItem& item) {
    items_.push_back(item);
    stats_.total_items++;
}

void RenderPipeline::end() {
    if (items_.empty()) {
        return;
    }

    if (culling_enabled_) {
        cullItems();
    } else {
        stats_.visible_items = static_cast<u32>(items_.size());
    }

    sortItems();
    buildBatches();

    if (batching_enabled_) {
        executeBatches();
    } else {
        executeNonBatched();
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void RenderPipeline::collectFromRegistry(ecs::Registry& registry) {
    auto spriteView = registry.view<ecs::LocalTransform, ecs::Sprite>();

    for (auto entity : spriteView) {
        const auto& transform = spriteView.get<ecs::LocalTransform>(entity);
        const auto& sprite = spriteView.get<ecs::Sprite>(entity);

        RenderItem item;
        item.entity = entity;
        item.position = transform.position;
        item.rotation = transform.rotation;
        item.scale = transform.scale;
        item.size = sprite.size;
        item.color = sprite.color;
        item.uv_offset = sprite.uvOffset;
        item.uv_scale = sprite.uvScale;
        item.layer = sprite.layer;
        item.depth = transform.position.z;
        item.flip_x = sprite.flipX;
        item.flip_y = sprite.flipY;

        item.texture_id = context_.getWhiteTextureId();
        if (sprite.texture.isValid()) {
            Texture* tex = resource_manager_.getTexture(sprite.texture);
            if (tex) {
                item.texture_id = tex->getId();
            }
        }

        items_.push_back(item);
        stats_.total_items++;
    }
}

void RenderPipeline::cullItems() {
    if (view_bounds_ == glm::vec4(0.0f)) {
        stats_.visible_items = static_cast<u32>(items_.size());
        return;
    }

    auto it = std::remove_if(items_.begin(), items_.end(),
        [this](const RenderItem& item) {
            return !isItemVisible(item);
        });

    stats_.culled_items = static_cast<u32>(std::distance(it, items_.end()));
    items_.erase(it, items_.end());
    stats_.visible_items = static_cast<u32>(items_.size());
}

bool RenderPipeline::isItemVisible(const RenderItem& item) const {
    f32 halfWidth = item.size.x * item.scale.x * 0.5f;
    f32 halfHeight = item.size.y * item.scale.y * 0.5f;

    f32 left = item.position.x - halfWidth;
    f32 right = item.position.x + halfWidth;
    f32 bottom = item.position.y - halfHeight;
    f32 top = item.position.y + halfHeight;

    return !(right < view_bounds_.x || left > view_bounds_.y ||
             top < view_bounds_.z || bottom > view_bounds_.w);
}

void RenderPipeline::sortItems() {
    std::sort(items_.begin(), items_.end(),
        [](const RenderItem& a, const RenderItem& b) {
            return a.sortKey() < b.sortKey();
        });
}

void RenderPipeline::buildBatches() {
    batches_.clear();
    if (items_.empty()) {
        return;
    }

    std::unordered_set<u32> uniqueTextures;
    u32 textureSwitch = 0;

    u32 currentTexture = items_[0].texture_id;
    u32 batchStart = 0;
    uniqueTextures.insert(currentTexture);

    for (u32 i = 1; i < items_.size(); ++i) {
        uniqueTextures.insert(items_[i].texture_id);
        if (items_[i].texture_id != currentTexture) {
            batches_.push_back({currentTexture, batchStart, i - batchStart});
            currentTexture = items_[i].texture_id;
            batchStart = i;
            textureSwitch++;
        }
    }

    batches_.push_back({currentTexture, batchStart,
                        static_cast<u32>(items_.size()) - batchStart});

    stats_.batch_count = static_cast<u32>(batches_.size());
    stats_.unique_textures = static_cast<u32>(uniqueTextures.size());
    stats_.texture_switches = textureSwitch;

    stats_.triangles = stats_.visible_items * 2;
    stats_.vertices = stats_.visible_items * 4;
}

void RenderPipeline::executeBatches() {
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    batcher_->setProjection(view_projection_);
    batcher_->beginBatch();

    for (const auto& item : items_) {
        glm::vec2 finalSize = item.size * glm::vec2(item.scale);

        f32 angle = glm::angle(item.rotation);
        glm::vec3 axis = glm::axis(item.rotation);
        if (axis.z < 0) {
            angle = -angle;
        }

        if (std::abs(angle) > 0.001f) {
            batcher_->drawRotatedQuad(
                glm::vec2(item.position),
                finalSize,
                angle,
                item.texture_id,
                item.color
            );
        } else {
            batcher_->drawQuad(
                glm::vec3(item.position.x, item.position.y, item.depth),
                finalSize,
                item.texture_id,
                item.color
            );
        }
    }

    batcher_->endBatch();
    stats_.draw_calls = batcher_->getDrawCallCount();
}

void RenderPipeline::executeNonBatched() {
    Shader* shader = context_.getTextureShader();
    VertexArray* quadVAO = context_.getQuadVAO();

    if (!shader || !quadVAO) {
        return;
    }

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    for (const auto& item : items_) {
        glm::mat4 model = glm::mat4(1.0f);
        model = glm::translate(model, item.position);
        model *= glm::mat4_cast(item.rotation);
        model = glm::scale(model, glm::vec3(
            item.size.x * item.scale.x,
            item.size.y * item.scale.y,
            1.0f
        ));

        shader->bind();
        shader->setUniform("u_projection", view_projection_);
        shader->setUniform("u_model", model);
        shader->setUniform("u_color", item.color);

        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, item.texture_id);
        shader->setUniform("u_texture", 0);

        RenderCommand::drawIndexed(*quadVAO);
        stats_.draw_calls++;
    }
}

}  // namespace esengine
