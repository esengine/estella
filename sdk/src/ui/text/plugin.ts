/**
 * @file    ui/text/plugin.ts
 * @brief   TextPlugin — renders the `Text` component via the dynamic SDF glyph
 *          atlas (REARCH_GUI P1.4d), replacing the legacy Canvas2D-per-entity
 *          path. A pre-flush callback scans Text entities, composes the world
 *          transform, places the text inside its UIRect box (no auto-size — the
 *          UIRect is the box; rendering never mutates layout) and draws batched
 *          SDF glyph quads. Renderer is created lazily.
 */
import type { App, Plugin } from '../../app';
import { Transform, type TransformData, registerComponent } from '../../component';
import type { ESEngineModule } from '../../wasm';
import type { Entity } from '../../types';
import { SdfTextRenderer } from './text-renderer';
import { composeTRS, rectTextBox, UI_TEXT_BOLD, UI_TEXT_ITALIC } from './text-transform';
import { Text, type TextData } from '../core/text';
import { UIRect, type UIRectData } from '../core/ui-rect';
import { getEffectiveWidth, getEffectiveHeight } from '../uiHelpers';

export class TextPlugin implements Plugin {
    name = 'text';

    private renderer_: SdfTextRenderer | null = null;
    private readonly matrix_ = new Float32Array(16);

    build(app: App): void {
        registerComponent('Text', Text);

        const pipeline = app.pipeline;
        if (!pipeline) return; // logic-only host → nothing to draw

        const world = app.world;
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

                // A UIRect (UI canvas) is the text box: place + align + wrap inside it.
                // No UIRect ⇒ a world-space label anchored at the entity origin.
                let originX: number | undefined;
                let originY: number | undefined;
                let maxWidth: number | undefined;
                let boxHeight: number | undefined;
                if (world.has(entity, UIRect)) {
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const w = getEffectiveWidth(rect, entity);
                    const h = getEffectiveHeight(rect, entity);
                    const box = rectTextBox(rect.pivot.x, rect.pivot.y, w, h, t.fontSize);
                    originX = box.originX;
                    originY = box.originY;
                    boxHeight = box.boxHeight;
                    if (t.wordWrap) maxWidth = box.maxWidth;
                }

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
                    },
                    this.matrix_,
                    entity as number,
                    0, // layer: UI z-order integration with UIElementPlugin is a follow-up
                    tr.worldPosition.z,
                );
            }
        });
    }
}

export const textPlugin = new TextPlugin();
