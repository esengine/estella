/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

import type { CppRegistry } from './wasm';
import { Renderer } from './renderer';
import { PostProcess } from './postprocess';
import { Draw } from './draw';
import { getDrawCallbacks, unregisterDrawCallback } from './customDraw';

export interface RenderParams {
    registry: { _cpp: CppRegistry };
    viewProjection: Float32Array;
    width: number;
    height: number;
    elapsed: number;
}

export class RenderPipeline {
    render(params: RenderParams): void {
        const { registry, viewProjection, width, height, elapsed } = params;

        Renderer.resize(width, height);

        if (PostProcess.isInitialized() && PostProcess.getPassCount() > 0 && !PostProcess.isBypassed()) {
            PostProcess.resize(width, height);
        }

        Renderer.begin(viewProjection);
        Renderer.submitSprites(registry);
        Renderer.submitSpine(registry);
        Renderer.flush();

        const cbs = getDrawCallbacks();
        if (cbs.size > 0) {
            Draw.begin(viewProjection);
            const failed: string[] = [];
            for (const [id, fn] of cbs.entries()) {
                try {
                    fn(elapsed);
                } catch (e) {
                    console.error(`[CustomDraw] callback '${id}' error:`, e);
                    failed.push(id);
                }
            }
            Draw.end();
            for (const id of failed) {
                unregisterDrawCallback(id);
            }
        }

        Renderer.end();
    }
}
