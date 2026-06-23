/**
 * @file    ui/text/plugin.ts
 * @brief   UITextPlugin — wires the dynamic SDF text path into the frame
 *          (REARCH_GUI P1.3c). A pre-flush callback scans UIText entities,
 *          composes each entity's world transform, and draws it through the
 *          TextRenderer (glyph atlas → batched SDF quads). The renderer is
 *          created lazily, so apps with no UIText pay nothing.
 */
import type { App, Plugin } from '../../app';
import { Transform, type TransformData } from '../../component';
import { registerComponent } from '../../component';
import type { ESEngineModule } from '../../wasm';
import type { Entity } from '../../types';
import { SdfTextRenderer } from './text-renderer';
import { UIText, type UITextData, composeTRS, rectTextBox } from './ui-text';
import { UIRect, type UIRectData } from '../core/ui-rect';
import { getEffectiveWidth, getEffectiveHeight } from '../uiHelpers';

export class UITextPlugin implements Plugin {
    name = 'uiText';

    private renderer_: SdfTextRenderer | null = null;
    private readonly matrix_ = new Float32Array(16);

    build(app: App): void {
        registerComponent('UIText', UIText);

        const pipeline = app.pipeline;
        if (!pipeline) return; // no render pipeline (e.g. logic-only host) → nothing to draw

        const world = app.world;
        pipeline.addPreFlushCallback(() => {
            const entities = world.getEntitiesWithComponents([UIText, Transform]);
            for (const e of entities) {
                const entity = e as Entity;
                const t = world.get(entity, UIText) as UITextData;
                if (!t.content) continue;

                if (!this.renderer_) {
                    this.renderer_ = new SdfTextRenderer(app.wasmModule as ESEngineModule);
                }
                const tr = world.get(entity, Transform) as TransformData;
                composeTRS(this.matrix_, tr.worldPosition, tr.worldRotation, tr.worldScale);

                // In a UIRect (UI canvas), place + align + wrap the text inside the
                // rect box; otherwise it's a world-space label at the entity origin.
                let originX: number | undefined;
                let originY: number | undefined;
                let maxWidth = t.maxWidth || undefined;
                if (world.has(entity, UIRect)) {
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const w = getEffectiveWidth(rect, entity);
                    const h = getEffectiveHeight(rect, entity);
                    const box = rectTextBox(rect.pivot.x, rect.pivot.y, w, h, t.fontSizePx);
                    originX = box.originX;
                    originY = box.originY;
                    if (!maxWidth) maxWidth = box.maxWidth;
                }

                this.renderer_.drawText(
                    {
                        text: t.content,
                        fontFamily: t.fontFamily,
                        fontSizePx: t.fontSizePx,
                        color: [t.color.r, t.color.g, t.color.b, t.color.a],
                        style: t.style,
                        richText: t.richText,
                        align: t.align,
                        lineHeight: t.lineHeight || undefined,
                        maxWidth,
                        originX,
                        originY,
                    },
                    this.matrix_,
                    entity as number,
                    t.layer,
                    tr.worldPosition.z,
                );
            }
        });
    }
}

export const uiTextPlugin = new UITextPlugin();
