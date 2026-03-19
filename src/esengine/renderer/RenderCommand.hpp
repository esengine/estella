/**
 * @file    RenderCommand.hpp
 * @brief   Low-level rendering commands (GfxDevice proxy)
 * @details Provides a static interface that delegates to the active GfxDevice.
 *          Preserves the existing static API so callers need not change.
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
#include "BlendMode.hpp"
#include "GfxDevice.hpp"

namespace esengine {

class VertexArray;

// =============================================================================
// RenderCommand Class
// =============================================================================

/**
 * @brief Static proxy to the active GfxDevice
 *
 * @details All methods delegate to the GfxDevice set via setDevice().
 *          This keeps existing call-sites unchanged.
 */
class RenderCommand {
public:
    /** @brief Sets the GfxDevice that all static methods delegate to */
    static void setDevice(GfxDevice* device);

    /** @brief Gets the current GfxDevice */
    static GfxDevice* getDevice();

    static void init();
    static void shutdown();

    static void setViewport(i32 x, i32 y, u32 width, u32 height);
    static void setClearColor(const glm::vec4& color);
    static void clear();

    static void drawIndexed(const VertexArray& vao, u32 indexCount = 0);
    static void drawArrays(u32 vertexCount);

    static void setDepthTest(bool enabled);
    static void setDepthWrite(bool enabled);

    static void setBlending(bool enabled);
    static void setBlendFunc();
    static void setBlendMode(BlendMode mode);

    static void setCulling(bool enabled);
    static void setCullFace(bool front);

    static void setWireframe(bool enabled);

private:
    static GfxDevice* device_;
};

}  // namespace esengine
