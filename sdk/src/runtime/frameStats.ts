// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frameStats.ts
 * @brief   The last frame's cost and counters, as the editor's profiler reads
 *          them — the same answer from its Play realm and from a device.
 */
import type { App, FrameCosts } from '../app/app';
import { engineApi } from '../ecs/bridge/engineApi';
import { Quality } from '../render/qualityRuntime';
import { Audio } from '../audio/Audio';
import { Assets } from '../asset/AssetPlugin';
import { StaticBatchingRes, type StaticBatchSummary } from '../render/staticBatchPlugin';
import { CompositeBatch, type CompositeBatchData } from '../render/compositeBatchPlugin';
import { TextureStreamingRes } from '../render/textureStreaming';
import type { QualityReport } from '../render/quality';

export interface FrameStatsReport {
    seq?: number;
    frameMs?: number;
    phases: Record<string, number>;
    /** Per-system and per-scope cost with the domain/system attribution the
     *  profile tree is folded from. Null while the app has stats off. */
    costs: FrameCosts | null;
    drawCalls: number;
    /** Every draw the GPU was asked for, every pass included; what `quality.drawCallBudget` is held to. */
    gpuDraws?: number;
    triangles: number;
    sprites: number;
    entities: number;
    gpuMs: number;
    cppScopes: Record<string, number>;
    cppCounters: Record<string, number>;
    gpuScopes: Record<string, number>;
    wasmBytes: number;
    vramBytes: number;
    /** Decoded audio resident (bytes), and how many clips play from their compressed file instead and the PCM that saved (estimate). */
    audioBytes?: number;
    audioStreamedCount?: number;
    audioStreamedSavedBytes?: number;
    /** What static batching merged and left out; absent until a mesh has been marked. */
    staticBatch?: StaticBatchSummary;
    /** Per CompositeBatch root, what it draws now; absent while no root is in the scene. */
    compositeBatch?: { entity: number; parts: number; instanced: number; draws: number; drawsBefore: number; moving: number }[];
    quality?: QualityReport;
    /** What texture streaming holds: how many textures, the megabytes they take and would at full size, and how many moves it has made. */
    textureStreaming?: { enabled: boolean; textures: number; streamedMB: number; fullMB: number; moves: number; failures: number; startedSmall: number };
}

function jsonMap(json: string | undefined): Record<string, number> {
    if (!json) return {};
    try { return JSON.parse(json) as Record<string, number>; } catch { return {}; }
}

function audioStats(app: App): Pick<FrameStatsReport, 'audioBytes' | 'audioStreamedCount' | 'audioStreamedSavedBytes'> {
    if (!app.hasResource(Audio)) return {};
    const stats = app.getResource(Audio).getBufferStats();
    return { audioBytes: stats.bufferBytes, audioStreamedCount: stats.streamedCount, audioStreamedSavedBytes: stats.streamedSavedBytes };
}

export function frameStatsReport(app: App): FrameStatsReport {
    const m = engineApi(app);
    return {
        ...app.getFrameTiming(),
        phases: Object.fromEntries(app.getPhaseTimings() ?? []),
        costs: app.getFrameCosts(),
        drawCalls: m?.renderer_getDrawCalls?.() ?? 0,
        gpuDraws: m?.renderer_getGpuDrawCalls?.() ?? 0,
        triangles: m?.renderer_getTriangles?.() ?? 0,
        sprites: m?.renderer_getSprites?.() ?? 0,
        entities: app.world.getAllEntities().length,
        gpuMs: m?.renderer_getGpuTimeMs?.() ?? -1,
        cppScopes: jsonMap(m?.engine_getCpuScopes?.()),
        cppCounters: jsonMap(m?.engine_getCounters?.()),
        gpuScopes: jsonMap(m?.engine_getGpuScopes?.()),
        wasmBytes: app.wasmModule?.HEAPU8?.byteLength ?? 0,
        vramBytes: m?.renderer_getEstimatedGpuBytes?.() ?? 0,
        ...audioStats(app),
        ...(app.hasResource(StaticBatchingRes) ? (() => { const s = app.getResource(StaticBatchingRes).summary(); return s ? { staticBatch: s } : {}; })() : {}),
        quality: app.hasResource(Quality) ? app.getResource(Quality)?.report() : undefined,
        ...textureStreamingStats(app),
        ...compositeBatchStats(app),
    };
}

/** What each CompositeBatch root says it draws, as the pass last wrote it on the root. */
function compositeBatchStats(app: App): Pick<FrameStatsReport, 'compositeBatch'> {
    const roots = app.world.getEntitiesWithComponents([CompositeBatch]);
    if (roots.length === 0) return {};
    return {
        compositeBatch: roots.map((entity) => {
            const c = app.world.get(entity, CompositeBatch) as CompositeBatchData;
            return { entity, parts: c.parts, instanced: c.instanced, draws: c.draws, drawsBefore: c.drawsBefore, moving: c.moving };
        }),
    };
}

function textureStreamingStats(app: App): Pick<FrameStatsReport, 'textureStreaming'> {
    if (!app.hasResource(TextureStreamingRes)) return {};
    const s = app.getResource(TextureStreamingRes);
    const b = s.bytes();
    const loader = app.hasResource(Assets) ? app.getResource(Assets).getTextureLoader() : null;
    return { textureStreaming: { enabled: s.enabled, textures: s.textures.size, streamedMB: b.now / 1048576, fullMB: b.full / 1048576,
        moves: s.moves, failures: s.failures, startedSmall: loader?.startedSmall ?? 0 } };
}
