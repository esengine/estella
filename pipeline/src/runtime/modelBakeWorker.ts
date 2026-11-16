// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { canBakeAtLoad, keptModelBake } from '../modeling/loadBake';
import { MODEL_MAPS, type BakeStage, type ModelMapName } from '../modeling/loadBakeFile';

export interface BakeAsk {
    id: number;
    text: string;
    limit: number;
}

export type BakeReply =
    | { id: number; stage: BakeStage; done: number; total: number }
    | { id: number; mesh: Uint8Array; maps: { name: ModelMapName; size: number; rgba: Uint8Array }[]; kept: boolean }
    | { id: number; error: string };

const scope = self as unknown as { onmessage: ((event: MessageEvent<BakeAsk>) => void) | null; postMessage(reply: BakeReply, transfer?: Transferable[]): void };
let gl: WebGL2RenderingContext | null = null;
let line: Promise<void> = Promise.resolve();
let keeping: Promise<void> = Promise.resolve();

async function answer({ id, text, limit }: BakeAsk): Promise<void> {
    try {
        gl ??= new OffscreenCanvas(1, 1).getContext('webgl2', { antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
        if (!canBakeAtLoad(gl)) throw new Error('this device cannot bake a model: it has no WebGL2 that draws into float textures');
        let said = 0;
        const { model, kept, keep } = await keptModelBake(gl, text, limit, (stage, done, total) => {
            const now = performance.now();
            if (now - said < 40 && done < total) return;
            said = now;
            scope.postMessage({ id, stage, done, total });
        });
        const maps = MODEL_MAPS.flatMap((name) => {
            const map = model.maps[name];
            return map ? [{ name, size: map.size, rgba: map.rgba }] : [];
        });
        scope.postMessage({ id, mesh: model.mesh, maps, kept });
        keeping = keeping.then(keep, keep);
    } catch (error) {
        scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
}

scope.onmessage = (event) => {
    line = line.then(() => answer(event.data));
};
