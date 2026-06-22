/**
 * @file    PipelineState.hpp
 * @brief   Immutable GPU pipeline state — the backend-agnostic unit of "how to draw".
 * @details A PipelineState bundles everything that is fixed for a draw and that WebGPU
 *          bakes into an immutable GPURenderPipeline: the shader program, the vertex
 *          layout, blend, depth, stencil compare/op, and culling. The renderer resolves
 *          a PipelineDesc to an opaque PipelineHandle once (cached) and thereafter binds
 *          it with GfxDevice::setPipeline. Per-draw dynamic state — scissor rectangle and
 *          stencil reference — stays out of the pipeline (see setScissor/setStencilReference),
 *          mirroring WebGPU's split. This is the keystone abstraction that lets a WebGPU
 *          backend slot in beside the WebGL2 one (docs/REARCH_RENDER.md P2).
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"
#include "BlendMode.hpp"
#include "GfxEnums.hpp"  // LayoutId

namespace esengine {

/**
 * @brief Stencil behaviour baked into a pipeline. The reference value is dynamic
 *        (GfxDevice::setStencilReference), the compare/op/masks are pipeline state.
 */
enum class GfxStencilMode : u8 {
    Off,    ///< No stencil test; full color write.
    Write,  ///< Write the reference where drawn (mask fill): func Always, op Replace, color write off.
    Test,   ///< Draw only where the stencil equals the reference (mask clip): func Equal, op Keep.
};

/**
 * @brief Immutable description of a draw pipeline. Equality keys the pipeline cache, so
 *        two draws with the same description share one PipelineHandle.
 */
struct PipelineDesc {
    u32 program = 0;
    LayoutId vertexLayout = LayoutId::Batch;
    BlendMode blend = BlendMode::Normal;
    bool blendEnabled = true;
    bool depthTest = false;
    bool depthWrite = false;
    GfxStencilMode stencil = GfxStencilMode::Off;
    bool cullEnabled = false;
    bool cullFront = false;

    bool operator==(const PipelineDesc&) const = default;
};

/** @brief Opaque handle to a cached pipeline; PipelineHandle{0} is the null/invalid handle. */
enum class PipelineHandle : u32 { Invalid = 0 };

}  // namespace esengine
