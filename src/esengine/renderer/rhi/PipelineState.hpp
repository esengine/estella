// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *          backend slot in beside the WebGL2 one.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../draw/BlendMode.hpp"
#include "./GfxEnums.hpp"

namespace esengine {

/**
 * @brief Stencil behaviour baked into a pipeline. The reference value is dynamic
 *        (GfxDevice::setStencilReference), the compare/op/masks are pipeline state.
 */
enum class GfxStencilMode : u8 {
    Off,          ///< No stencil test; full color write.
    Write,        ///< Write the reference where drawn (mask fill): func Always, op Replace, color write off.
    Test,         ///< Draw only INSIDE the mask: func Equal, op Keep.
    TestOutside,  ///< Draw only OUTSIDE it: func NotEqual, op Keep — a hole, not a window.
    Increment,    ///< Enter a nested mask only where the parent reference matches.
    Decrement,    ///< Restore the parent reference on leaving a nested mask.
    Zero,         ///< Retire a root mask without writing color.
};

inline bool writesStencil(GfxStencilMode mode) {
    return mode == GfxStencilMode::Write || mode == GfxStencilMode::Increment
        || mode == GfxStencilMode::Decrement || mode == GfxStencilMode::Zero;
}

/**
 * @brief How a pipeline's indices assemble into primitives. Baked into the pipeline, as WebGPU
 *        bakes it, so a draw call never states it: whoever binds a pipeline has said it.
 */
enum class GfxTopology : u8 {
    Triangles,  ///< Every three indices a triangle: all geometry the engine draws.
    Lines,      ///< Every two indices a line segment: a mesh's edges, for a diagnostic view.
};

/**
 * @brief Immutable description of a draw pipeline. Equality keys the pipeline cache, so
 *        two draws with the same description share one PipelineHandle.
 */
struct PipelineDesc {
    ShaderHandle program = ShaderHandle::Invalid;
    VertexLayoutHandle vertexLayout = VertexLayoutHandle::Invalid;
    BlendMode blend = BlendMode::Normal;
    bool blendEnabled = true;
    bool depthTest = false;
    bool depthWrite = false;
    GfxStencilMode stencil = GfxStencilMode::Off;
    bool cullEnabled = false;
    bool cullFront = false;
    /// How far toward the eye this surface is pushed, in units of the depth
    /// buffer's resolution — the only way to say which of two COPLANAR surfaces
    /// wins. Drives both the constant and the slope-scaled term.
    i16 depthBias = 0;
    /// Output alpha becomes multisample coverage (a cutout's feathered edge). Only
    /// meaningful on an opaque draw into a multisampled target; ignored elsewhere.
    bool alphaToCoverage = false;
    GfxTopology topology = GfxTopology::Triangles;
    /// The shader writes a second colour output (location 1) and the target's second attachment is
    /// to receive it. A pipeline without it draws into a target that has one and leaves it alone:
    /// WebGPU wants that said in the pipeline, and GL wants the draw buffers set to match.
    bool gbuffer = false;
    /// With `gbuffer`: the shader also writes the surface's diffuse colour (location 2) into the target's
    /// third attachment. A gbuffer shader that predates it writes two outputs and leaves the third alone.
    bool albedo = false;
    /// False writes no colour, to either attachment: a depth-only pass, whose surfaces are then drawn again with colour.
    bool colorWrite = true;
    /// Passes where the depth is EQUAL to what the buffer holds, not only where it is less: a surface drawn a second time, after a pass that
    /// wrote its depth, must land on itself.
    bool depthEqual = false;

    bool operator==(const PipelineDesc&) const = default;
};

/** @brief Opaque handle to a cached pipeline; PipelineHandle{0} is the null/invalid handle. */
enum class PipelineHandle : u32 { Invalid = 0 };

}  // namespace esengine
