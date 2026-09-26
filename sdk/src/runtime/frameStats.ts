// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frameStats.ts
 * @brief   The last frame's cost and counters, as the editor's profiler reads
 *          them — the same answer from its Play realm and from a device.
 */
import type { App, FrameCosts } from '../app/app';
import { engineApi } from '../ecs/bridge/engineApi';

export interface FrameStatsReport {
    phases: Record<string, number>;
    /** Per-system and per-scope cost with the domain/system attribution the
     *  profile tree is folded from. Null while the app has stats off. */
    costs: FrameCosts | null;
    drawCalls: number;
    triangles: number;
    sprites: number;
    entities: number;
    gpuMs: number;
    cppScopes: Record<string, number>;
    cppCounters: Record<string, number>;
    gpuScopes: Record<string, number>;
    wasmBytes: number;
    vramBytes: number;
}

function jsonMap(json: string | undefined): Record<string, number> {
    if (!json) return {};
    try { return JSON.parse(json) as Record<string, number>; } catch { return {}; }
}

export function frameStatsReport(app: App): FrameStatsReport {
    const m = engineApi(app);
    return {
        phases: Object.fromEntries(app.getPhaseTimings() ?? []),
        costs: app.getFrameCosts(),
        drawCalls: m?.renderer_getDrawCalls?.() ?? 0,
        triangles: m?.renderer_getTriangles?.() ?? 0,
        sprites: m?.renderer_getSprites?.() ?? 0,
        entities: app.world.getAllEntities().length,
        gpuMs: m?.renderer_getGpuTimeMs?.() ?? -1,
        cppScopes: jsonMap(m?.engine_getCpuScopes?.()),
        cppCounters: jsonMap(m?.engine_getCounters?.()),
        gpuScopes: jsonMap(m?.engine_getGpuScopes?.()),
        wasmBytes: app.wasmModule?.HEAPU8?.byteLength ?? 0,
        vramBytes: m?.renderer_getTextureBytes?.() ?? 0,
    };
}
