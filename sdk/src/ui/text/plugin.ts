// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/plugin.ts
 * @brief   TextPlugin — renders the `Text` component via the dynamic glyph
 *          atlas, replacing the legacy Canvas2D-per-entity path. A pre-flush
 *          callback scans Text entities, composes the world transform, places
 *          the text inside its UINode box (no auto-size — the UINode is the
 *          box; rendering never mutates layout) and draws batched glyph quads,
 *          layered to interleave with sibling UI elements.
 *
 *          Two glyph pipelines, routed per Text by {@link resolveTextRenderMode}
 *          (Text.renderMode, default Auto): device-resolution bitmaps when the
 *          text lands 1:1 on screen, SDF + fwidth AA whenever it's scaled by
 *          the design-resolution fit, a camera zoom, or the entity transform.
 */
import type { App, Plugin } from '../../app';
import { Transform, type TransformData, registerComponent } from '../../component';
import { defineSystem, Schedule } from '../../system';
import type { ESEngineModule, CppRegistry } from '../../wasm';
import type { Entity } from '../../types';
import { SdfTextRenderer } from './text-renderer';
import type { RGBA } from './layout';
import { composeTRS, rectTextBox, UI_TEXT_BOLD, UI_TEXT_ITALIC } from './text-transform';
import { Text, TextRenderMode, type TextData } from '../core/text';
import { UINode } from '../core/ui-node';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { getUINodeWidth, getUINodeHeight, ensureUIVisual } from '../util/helpers';
import { platformDevicePixelRatio } from '../../platform';

// Base glyph rasterization size in CSS px; the real source is this × DPR so text
// stays crisp on HiDPI displays. 64 covers common UI sizes at 1:1 or finer.
const GLYPH_BASE_SIZE = 64;

// Matches C++ UIElementPlugin::UI_BASE_LAYER — UI quads use layer = base + uiOrder.
const UI_BASE_LAYER = 1000;

// Auto tolerance: a bitmap glyph still reads as pixel-exact within ±2% of 1:1.
const BITMAP_SCALE_EPSILON = 0.02;

/**
 * Pure: which glyph pipeline a Text draws with. `effectiveScale` is the
 * on-screen texels-per-source-texel ratio of a bitmap glyph (1 = pixel-exact:
 * design→device scale ÷ DPR × entity world scale). Auto keeps the crisp
 * device-resolution bitmaps only while they truly land 1:1; any real scaling
 * switches to SDF, whose fwidth AA is stable at every zoom. Non-finite or
 * unknown scales (no camera yet) keep the bitmap path.
 */
export function resolveTextRenderMode(
    mode: TextRenderMode | undefined,
    effectiveScale: number,
): 'bitmap' | 'sdf' {
    if (mode === TextRenderMode.Bitmap) return 'bitmap';
    if (mode === TextRenderMode.Sdf) return 'sdf';
    if (!Number.isFinite(effectiveScale) || effectiveScale <= 0) return 'bitmap';
    return Math.abs(effectiveScale - 1) <= BITMAP_SCALE_EPSILON ? 'bitmap' : 'sdf';
}

export class TextPlugin implements Plugin {
    name = 'text';

    private bitmapRenderer_: SdfTextRenderer | null = null;
    private sdfRenderer_: SdfTextRenderer | null = null;
    private readonly matrix_ = new Float32Array(16);

    build(app: App): void {
        registerComponent('Text', Text);

        const world = app.world;

        // A Text node inside a UINode is a UI render node: ensure it carries a
        // UIVisual (visualType None — not drawn as a quad) so the UI
        // render-order pass assigns it a uiOrder and the SDF glyphs sort with
        // sibling UI elements. Idempotent; runs before the PostUpdate order pass.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            for (const e of world.getEntitiesWithComponents([Text, UINode])) {
                ensureUIVisual(world, e as Entity);
            }
        }, { name: 'TextRenderNodeSystem' }));

        const pipeline = app.pipeline;
        if (!pipeline) return; // logic-only host → nothing to draw

        const module = app.wasmModule as ESEngineModule;
        const registry = world.getCppRegistry() as CppRegistry;

        pipeline.addPreFlushCallback(() => {
            // Design→device scale of one UI px this frame (vpW is device px);
            // ÷DPR gives the bitmap texel:pixel ratio Auto switches on.
            // Resolved per frame — the camera plugin may build after this one.
            const uiCamera = app.getResource(UICameraInfo) as UICameraData | undefined;
            const dpr = platformDevicePixelRatio();
            const span = uiCamera ? uiCamera.worldRight - uiCamera.worldLeft : 0;
            const designToTexel = uiCamera?.valid && span > 0
                ? uiCamera.vpW / (span * dpr)
                : 1;

            for (const e of world.getEntitiesWithComponents([Text, Transform])) {
                const entity = e as Entity;
                const t = world.get(entity, Text) as TextData;
                if (!t.content) continue;

                const tr = world.get(entity, Transform) as TransformData;
                const renderer = this.rendererFor(
                    app,
                    resolveTextRenderMode(t.renderMode, designToTexel * tr.worldScale.x),
                );
                composeTRS(this.matrix_, tr.worldPosition, tr.worldRotation, tr.worldScale);

                const style = (t.bold ? UI_TEXT_BOLD : 0) | (t.italic ? UI_TEXT_ITALIC : 0);
                // Text.lineHeight is a ratio of fontSize (legacy convention).
                const lineHeightPx = t.lineHeight > 0 ? t.lineHeight * t.fontSize : undefined;

                // The layout box: a UINode (CSS box, pivot-centered) or legacy
                // UINode. Text is placed + aligned + wrapped inside it and sorted
                // by the UI render order. No box ⇒ a world-space label at the
                // entity origin, layer 0.
                let originX: number | undefined;
                let originY: number | undefined;
                let maxWidth: number | undefined;
                let boxHeight: number | undefined;
                let layer = 0;
                let w = 0, h = 0, hasBox = false;
                if (world.has(entity, UINode)) {
                    w = getUINodeWidth(entity);
                    h = getUINodeHeight(entity);
                    hasBox = w > 0 || h > 0;
                }
                if (hasBox) {
                    const box = rectTextBox(0.5, 0.5, w, h, t.fontSize);
                    originX = box.originX;
                    originY = box.originY;
                    boxHeight = box.boxHeight;
                    if (t.wordWrap) maxWidth = box.maxWidth;

                    const order = module.ui_getRenderOrder
                        ? module.ui_getRenderOrder(registry, entity as number)
                        : -1;
                    layer = order >= 0 ? UI_BASE_LAYER + order : UI_BASE_LAYER;
                }

                const shadow = t.shadowColor.a > 0 && (t.shadowOffsetX !== 0 || t.shadowOffsetY !== 0)
                    ? {
                        color: [t.shadowColor.r, t.shadowColor.g, t.shadowColor.b, t.shadowColor.a] as RGBA,
                        dx: t.shadowOffsetX,
                        dy: t.shadowOffsetY,
                    }
                    : undefined;
                const outline = t.strokeWidth > 0 && t.strokeColor.a > 0
                    ? {
                        color: [t.strokeColor.r, t.strokeColor.g, t.strokeColor.b, t.strokeColor.a] as RGBA,
                        width: t.strokeWidth,
                    }
                    : undefined;

                renderer.drawText(
                    {
                        text: t.content,
                        fontFamily: t.fontFamily,
                        fontSizePx: t.fontSize,
                        color: [t.color.r, t.color.g, t.color.b, t.color.a],
                        style,
                        richText: t.richText,
                        align: t.align,
                        verticalAlign: t.verticalAlign,
                        lineHeight: lineHeightPx,
                        maxWidth,
                        boxHeight,
                        originX,
                        originY,
                        shadow,
                        outline,
                    },
                    this.matrix_,
                    entity as number,
                    layer,
                    tr.worldPosition.z,
                );
            }
        });
    }

    /**
     * The two glyph pipelines, created lazily and kept for the app's lifetime.
     * Bitmap: per-size rasterization at DPR, Canvas-native AA, blits 1:1.
     * SDF: one fixed-size rasterization per glyph, fwidth-AA in the shader —
     * resolution-independent, so scaled/zoomed text stays crisp. Both share
     * the same layout, page-store, and batch-submit path; only the atlas
     * contents and the shader's coverage derivation differ.
     */
    private rendererFor(app: App, kind: 'bitmap' | 'sdf'): SdfTextRenderer {
        const module = app.wasmModule as ESEngineModule;
        if (kind === 'sdf') {
            if (!this.sdfRenderer_) {
                this.sdfRenderer_ = new SdfTextRenderer(module, { sdf: true });
            }
            return this.sdfRenderer_;
        }
        if (!this.bitmapRenderer_) {
            const dpr = platformDevicePixelRatio();
            this.bitmapRenderer_ = new SdfTextRenderer(module, {
                sdf: false, dpr, renderSize: Math.round(GLYPH_BASE_SIZE * dpr),
            });
        }
        return this.bitmapRenderer_;
    }
}

export const textPlugin = new TextPlugin();
