// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    blend.ts
 * @brief   Blend mode definitions for rendering
 */

/**
 * Mirrors the engine's `BlendMode` (src/esengine/renderer/draw/BlendMode.hpp) — the
 * values are serialized into material assets, so they are fixed.
 */
export enum BlendMode {
    /** SrcAlpha, OneMinusSrcAlpha — the default. */
    Normal = 0,
    /** SrcAlpha, One — glow, particles. */
    Additive = 1,
    /** DstColor, OneMinusSrcAlpha — shadows, multiply. */
    Multiply = 2,
    /** One, OneMinusSrcColor — lighten. */
    Screen = 3,
    /** One, OneMinusSrcAlpha — for premultiplied-alpha sources. */
    PremultipliedAlpha = 4,
    /** One, One — additive with a premultiplied-alpha source. */
    PmaAdditive = 5,
    /** Takes the brighter pixel (GL_MAX). */
    Lighten = 6,
    /** Takes the darker pixel (GL_MIN). */
    Darken = 7,
    /** Screen on light, Multiply on dark; requires shader support. */
    Overlay = 8,
    /**
     * No blending — the source replaces the destination. An opaque sprite pays
     * nothing to read the destination it would ignore, and this is the only mode
     * a draw may write depth in, since a blended one must stay in painter's order.
     */
    None = 9,
}
