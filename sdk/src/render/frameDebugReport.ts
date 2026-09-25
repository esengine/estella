// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frameDebugReport.ts
 * @brief   One captured frame as a frame debugger shows it, and one replayed draw,
 *          built inside the game's own realm and carried out as plain data.
 *
 * The editor's viewport, its Play realm and a device running a debug build all
 * answer the frame debugger through these two functions, so a capture reads the
 * same wherever it was taken.
 */
import type { App } from '../app/app';
import { Assets } from '../asset/AssetPlugin';
import { Name } from '../ecs/component';
import { captureFrame, replayDraw, type CaptureEngine, type DrawCallInfo, type FrameCaptureData, type NextFrame } from './frameCapture';
import { engineApi } from '../ecs/bridge/engineApi';

export interface FrameDebugReport {
    passCount: number;
    draws: DrawCallInfo[];
    /** Every entity a draw lists, by id; absent where the entity has no Name. */
    names: Record<number, string>;
    /** The load paths behind the frame's material and texture ids, where an asset
     *  is behind them. */
    materials: Record<number, string>;
    textures: Record<number, string>;
}

/** How a realm names what a draw bound: its Assets, asked by id. */
export interface FrameAssetNames {
    material(id: number): string | null;
    texture(renderId: number): string | null;
}

/** One replayed draw: the pass up to and including it, as RGBA rows top-down. */
export interface FrameReplayImage {
    width: number;
    height: number;
    pixels: Uint8ClampedArray;
    matchesCapture: boolean;
}

export function frameDebugReport(
    data: FrameCaptureData, nameOf: (entity: number) => string | null, assets?: FrameAssetNames,
): FrameDebugReport {
    const names: Record<number, string> = {};
    const materials: Record<number, string> = {};
    const textures: Record<number, string> = {};
    for (const draw of data.drawCalls) {
        if (assets && draw.materialId !== 0 && !(draw.materialId in materials)) {
            const path = assets.material(draw.materialId);
            if (path) materials[draw.materialId] = path;
        }
        for (const id of draw.textures) {
            if (!assets || id === 0 || id in textures) continue;
            const path = assets.texture(id);
            if (path) textures[id] = path;
        }
        for (const e of draw.entities) {
            if (e in names) continue;
            const name = nameOf(e);
            if (name) names[e] = name;
        }
    }
    return { passCount: data.passCount, draws: data.drawCalls, names, materials, textures };
}

/**
 * Capture @p app's next whole frame; null when it drew nothing. @p pathOf turns an
 * asset's load path into the one its reader knows it by.
 */
export async function captureFrameReport(
    app: App, nextFrame: NextFrame, pathOf: (path: string) => string | null = (p) => p,
): Promise<FrameDebugReport | null> {
    const m = captureEngineOf(app);
    if (!m) return null;
    const cap = await captureFrame(m, nextFrame);
    if (!cap) return null;
    const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
    const path = (p: string | null | undefined): string | null => (p ? pathOf(p) : null);
    return frameDebugReport(cap,
        (e) => (app.world.tryGet(e as never, Name) as { value?: string } | null)?.value || null,
        {
            material: (id) => path(assets?.pathForHandle('material', id)),
            texture: (id) => path(assets?.pathForRenderedTexture(id)),
        });
}

/** The engine surface capture runs on — the wasm module, or a native host's — or
 *  null on a host without one. */
export function captureEngineOf(app: App): CaptureEngine | null {
    const e = engineApi(app) as Partial<CaptureEngine> | null;
    return e && typeof e.renderer_captureNextFrame === 'function' && e.HEAPU8 ? e as CaptureEngine : null;
}

/** The last capture's pass in @p app, drawn up to and including @p drawIndex. */
export async function replayFrameDraw(app: App, drawIndex: number, nextFrame: NextFrame): Promise<FrameReplayImage | null> {
    const m = captureEngineOf(app);
    const snap = m ? await replayDraw(m, drawIndex, nextFrame) : null;
    return snap && {
        width: snap.image.width, height: snap.image.height,
        pixels: snap.image.data, matchesCapture: snap.matchesCapture,
    };
}
