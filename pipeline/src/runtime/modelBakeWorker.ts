// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { canBakeAtLoad, shapeModelAtLoad, type ShapedModel } from '../modeling/loadBake';
import { MODEL_MAPS, type BakeStage, type ModelMapName } from '../modeling/loadBakeFile';

export type BakeAsk =
    { id: number; model: number; part: 'shape' | 'maps'; text: string; limit: number };

export type BakeReply =
    | { id: number; stage: BakeStage; done: number; total: number }
    | { id: number; mesh: Uint8Array; kept: boolean }
    | { id: number; maps: { name: ModelMapName; size: number; rgba: Uint8Array }[] }
    | { id: number; error: string };

const scope = self as unknown as { onmessage: ((event: MessageEvent<BakeAsk>) => void) | null; postMessage(reply: BakeReply, transfer?: Transferable[]): void };
let gl: WebGL2RenderingContext | null = null;
let line: Promise<void> = Promise.resolve();
let keeping: Promise<void> = Promise.resolve();
const shaped = new Map<number, Promise<ShapedModel>>();

const context = (): WebGL2RenderingContext => {
    gl ??= new OffscreenCanvas(1, 1).getContext('webgl2', { antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!canBakeAtLoad(gl)) throw new Error('this device cannot bake a model: it has no WebGL2 that draws into float textures');
    return gl;
};

async function answer(ask: BakeAsk): Promise<void> {
    const { id, model, part, text, limit } = ask;
    let said = 0;
    const tick = (stage: BakeStage, done: number, total: number): void => {
        const now = performance.now();
        if (now - said < 40 && done < total) return;
        said = now;
        scope.postMessage({ id, stage, done, total });
    };
    try {
        if (!shaped.has(model)) await keeping;
        const made = shaped.get(model) ?? shapeModelAtLoad(context(), text, limit, tick);
        if (part === 'shape') {
            shaped.set(model, made);
            const { mesh, kept } = await made;
            scope.postMessage({ id, mesh: mesh.slice(), kept });
            return;
        }
        shaped.delete(model);
        const { maps, keep } = await (await made).maps(tick);
        scope.postMessage({ id, maps: MODEL_MAPS.flatMap((name) => { const map = maps[name]; return map ? [{ name, size: map.size, rgba: map.rgba }] : []; }) });
        keeping = keeping.then(keep, keep);
    } catch (error) {
        shaped.delete(model);
        scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
}

scope.onmessage = (event) => {
    const ask = event.data;
    line = line.then(() => answer(ask));
};
