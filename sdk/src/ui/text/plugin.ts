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
import { UIText, type UITextData, composeTRS } from './ui-text';

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
                this.renderer_.drawText(
                    {
                        text: t.content,
                        fontFamily: t.fontFamily,
                        fontSizePx: t.fontSizePx,
                        color: [t.color.r, t.color.g, t.color.b, t.color.a],
                        style: t.style,
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
