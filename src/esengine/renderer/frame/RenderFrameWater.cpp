// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "RenderFrame.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "../RenderOrigin.hpp"
#include "../../core/FrameProfiler.hpp"
#include "../../core/Hash.hpp"
#include <cmath>

namespace esengine {

RenderFrame::ReceiverMaps RenderFrame::declareCausticReceivers(ecs::Registry& registry, const MaterialBake& bake,
                                                     const glm::vec4& sun, usize index) {
    // A light-space height map. A flat refracted ray keeps the same xy at every depth;
    // the actual bent rays only travel their difference across this map.
    const glm::dvec4 window(bake.a), levels(bake.b);
    const double span = window.z, level = levels.z, reach = levels.w;
    ReceiverMaps maps;
    if (span <= 0.0 || reach <= 0.0) return maps;
    // A guard band and a snapped origin keep the opaque map valid as the wave window follows the lens.
    const double block = span / 4.0, extent = span + block;
    const auto corner = [span, block, extent](double x) {
        return std::floor((x + span * 0.5) / block + 0.5) * block - extent * 0.5;
    };
    const double x = corner(window.x), z = corner(window.y);
    maps.window = glm::vec4((window.x - x) / extent, (window.y - z) / extent, span / extent, 0);
    const double top = std::max(levels.x + levels.y, level) + 0.01 * reach;
    const double height = top - level + reach;
    const glm::dvec3 ray = -glm::refract(-glm::dvec3(sun), glm::dvec3(0, 1, 0), 1.0 / 1.333);
    const glm::dvec2 slope(ray.x / ray.y, ray.z / ray.y);
    const glm::dvec3 origin = renderOrigin();
    glm::dmat4 matrix(1.0);
    matrix[0][0] = 2.0 / extent;
    matrix[1][0] = -2.0 * slope.x / extent;
    matrix[3][0] = 2.0 * (origin.x - x + slope.x * (level - origin.y)) / extent - 1.0;
    matrix[1][1] = 2.0 * slope.y / extent;
    matrix[2][1] = -2.0 / extent;
    matrix[3][1] = 1.0 - 2.0 * (origin.z - z + slope.y * (level - origin.y)) / extent;
    matrix[1][2] = -1.0 / height;
    matrix[2][2] = 0.0;
    matrix[3][2] = (top - origin.y) / height;
    const glm::mat4 projection(matrix);

    Frustum frustum;
    frustum.extractFromMatrix(projection);
    auto frame = makeContext();
    frame.view_projection = projection;
    frame.purpose = RenderPurpose::ShadowDepth;
    frame.causticReceivers = true;
    // Reuse the renderer's mobility tracking. The fixed map is independently keyed
    // by its draw records so even the first move out of a resting pose is caught.
    for (auto& plugin : plugins_) {
        u64 unused = 0;
        if (plugin->castsShadows()) plugin->castInputs(frame, registry, unused);
    }
    const u32 side = bake.w + bake.w / 4;
    for (u32 group = 0; group < 2; ++group) {
        const bool moving = group == 1;
        const usize slot = index * 2 + group;
        if (slot >= receiver_captures_.size()) receiver_captures_.resize(slot + 1);
        if (!receiver_captures_[slot]) {
            auto record = makeUnique<ReceiverCapture>(device_);
            record->pool.init();
            receiver_captures_[slot] = std::move(record);
        }
        auto& capture = *receiver_captures_[slot];
        capture.bakeTarget = bake.receiver;
        capture.pool.beginFrame();
        capture.draws.clear();
        RenderCollectContext collect{registry, frustum, clip_state_, capture.pool, capture.draws, frame, computeCameraView(projection)};
        collect.screen_ui = screen_domain_;
        collect.ui_tree_layers = ui_tree_layers_;
        collect.lod = {view_id_, &lod_view_state_, nullptr, true};
        collect.casters = moving ? CasterSplit::Movers : CasterSplit::Held;
        for (auto& plugin : plugins_) if (plugin->castsShadows()) plugin->collect(collect);
        capture.draws.finalize(capture.pool);
        if (!capture.draws.commandCount()) { capture.valid = false; continue; }

        if (!capture.target || capture.target->getWidth() != side) {
            FramebufferSpec spec;
            spec.width = spec.height = side;
            spec.linearFilter = false;
            spec.depthStencil = true;
            capture.target = Framebuffer::create(device_, spec);
            capture.valid = false;
        }
        if (!capture.target) continue;
        const auto depth = graph_.importTarget(capture.target->handle(), side, side, false, capture.target->getColorAttachment());
        if (moving) { maps.moving = depth; maps.window.w = 1; }
        else maps.fixed = depth;

        bool trusted = !moving;
        u64 key = hash::combineWords(hash::kFnv64Offset, &projection, sizeof(projection));
        key = hash::combine(key, device_.geometryWrites());
        key = hash::combine(key, device_.deviceGeneration());
        key = hash::combine(key, resource_manager_.meshesRevision());
        if (trusted) key = capture.draws.contentHashOfRecords(key, capture.pool, trusted);
        const auto trackTexture = [&](TextureHandle texture) {
            const u64 revision = device_.trackedTextureRevision(texture);
            trusted &= revision != 0;
            key = hash::combine(key, revision);
        };
        const MaterialStore& materials = context_.materials();
        for (u32 i = 0; trusted && i < capture.draws.commandCount(); ++i) {
            const DrawCommand& draw = capture.draws.command(i);
            if (!draw.material_id) continue;
            const auto* material = materials.find(draw.material_id);
            const auto* layout = material ? materials.layoutFor(material->shaderRef) : nullptr;
            if (!layout) { trusted = false; break; }
            key = hash::combineWords(key, material->uboBytes.data(), material->uboBytes.size());
            if (materials.castsCutoutShadow(draw.material_id) && draw.texture_count) {
                trackTexture(TextureHandle{draw.texture_ids[0]});
            }
            for (const auto& binding : material->textures) {
                if (static_cast<i32>(binding.unit) != layout->depthInputUnit) continue;
                const auto* texture = resource_manager_.getTexture(binding.texture);
                if (texture) trackTexture(texture->handle());
                else trusted = false;
            }
        }
        if (trusted && capture.valid && capture.key == key) continue;
        if (capture.constants == BufferHandle::Invalid) {
            capture.constants = device_.createBuffer({GfxBufferUsage::Uniform, RenderContext::frameConstantsSize(), true},
                                                     GfxContent::transient(), nullptr);
        }
        if (capture.constants == BufferHandle::Invalid) continue;
        capture.pool.upload();
        context_.prepareFrameConstants(capture.constants, projection);
        rg::PassDesc pass;
        pass.name = moving ? "water-caustic-moving-receivers" : "water-caustic-fixed-receivers";
        pass.write = depth;
        pass.clear = pass.clearDepth = true;
        pass.clearColor[3] = 0.0f;
        pass.discardDepth = true;
        pass.execute = [this, &capture, trusted, key](const rg::PassContext&) {
            ES_PROFILE_SCOPE("render.water.causticReceivers");
            context_.bindFrameConstants(capture.constants);
            context_.lights().uploadAndBind();
            capture.draws.execute(device_, capture.pool, context_.materials(), context_.getWhiteTextureId(),
                                  nullptr, context_.perDrawBlocks());
            context_.bindFrameConstants(context_.frameUbo());
            device_.invalidatePipelineCache();
            capture.valid = trusted && capture.draws.skippedForProgram() == 0;
            capture.key = key;
        };
        graph_.addPass(std::move(pass));
    }
    return maps;
}
}  // namespace esengine
#endif
