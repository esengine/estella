// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/plugin.ts
 * @brief   TextPlugin — renders the `Text` component via the dynamic SDF glyph
 *          atlas (REARCH_GUI P1.4d), replacing the legacy Canvas2D-per-entity
 *          path. A pre-flush callback scans Text entities, composes the world
 *          transform, places the text inside its UINode box (no auto-size — the
 *          UINode is the box; rendering never mutates layout) and draws batched
 *          SDF glyph quads, layered to interleave with sibling UI elements.
 */
import type { App, Plugin } from '../../app';
import { Transform, type TransformData, registerComponent } from '../../component';
import { defineSystem, Schedule } from '../../system';
import type { ESEngineModule, CppRegistry } from '../../wasm';
import type { Entity } from '../../types';
import { SdfTextRenderer } from './text-renderer';
import type { RGBA } from './layout';
import { composeTRS, rectTextBox, UI_TEXT_BOLD, UI_TEXT_ITALIC } from './text-transform';
import { Text, type TextData } from '../core/text';
import { UINode } from '../core/ui-node';
import { getUINodeWidth, getUINodeHeight, ensureUIVisual } from '../uiHelpers';

// Matches C++ UIElementPlugin::UI_BASE_LAYER — UI quads use layer = base + uiOrder.
const UI_BASE_LAYER = 1000;

export class TextPlugin implements Plugin {
    name = 'text';

    private renderer_: SdfTextRenderer | null = null;
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
            for (const e of world.getEntitiesWithComponents([Text, Transform])) {
                const entity = e as Entity;
                const t = world.get(entity, Text) as TextData;
                if (!t.content) continue;

                if (!this.renderer_) {
                    this.renderer_ = new SdfTextRenderer(app.wasmModule as ESEngineModule);
                }
                const tr = world.get(entity, Transform) as TransformData;
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

                this.renderer_.drawText(
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
}

export const textPlugin = new TextPlugin();
