// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    report.ts
 * @brief   What residency did, as numbers something outside the frame can check.
 *
 * @details A picture cannot answer this. "The far cell is not drawn" and "the far
 *          cell does not exist" look identical from a camera, and the difference
 *          between them is the whole feature — so what is published is the count
 *          of things that ARE, per cell, beside what the cook said the cell holds.
 *
 *          Read-only, and residency-owned facts only: how many bodies physics
 *          still has is physics' answer, and a residency report that reached for
 *          it would be the second author this design exists to avoid.
 */

import type { App } from '../app/app';
import { SceneManager } from '../scene/sceneManager';
import { WorldStreaming, type CellDelivery } from './WorldStreamer';
import type { RenderReadinessStamp } from '../render/renderReadiness';
import { stableEntityId } from './identity';
import { renderableComponents } from '../ecs/component';

/** @experimental */
export interface WorldResidencyReport {
    /** False when this build has no cooked world; every other field is empty. */
    streamed: boolean;
    cellCount: number;
    /**
     * Where the cells ARE, in manifest order — the ground each name stands for.
     *
     * Every other list here is names, and a name cannot be drawn. A reader that
     * had to find the coordinates elsewhere would be reading a second copy of
     * the partition, which agrees with this one only until one of them moves.
     */
    cells: Array<{ name: string; x: number; z: number }>;
    /** Edge of one grid square, world units — what the coordinates above scale by. */
    cellSize: number;
    sourceCount: number;
    desiredCells: string[];
    /** Cells any source is close enough to speculate about. */
    prefetchCells: string[];
    residentCells: string[];
    /** Ready, owning assets, and holding nothing the world can see. */
    preparedCells: string[];
    /** Of those, the ones holding a render-program claim. A prepared cell with
     *  none was readied by a host that has no renderer to ready. */
    preparedWithRenderClaim: string[];
    /** Each of those claims, and how often publication found one stale. Absent
     *  from the map = that cell holds none. */
    renderClaims: Record<string, RenderReadinessStamp & { restamps: number }>;
    loadingCells: string[];
    unloadingCells: string[];
    loadCount: number;
    unloadCount: number;
    prepareCount: number;
    cancelCount: number;
    /** Of those preparations, the ones begun before anything asked for the cell. */
    prefetchRequests: number;
    /** Acquisitions given back by discarding readiness — not by unloading. */
    cancelledRefs: number;
    /** What demand FOUND, counted the instant it arrived. See `WorldStreamerStatus`. */
    prefetchHits: number;
    prefetchMisses: number;
    lastDemandToResidentMs: number;
    /** Live entities each resident cell owns. Absent from the map = not resident. */
    cellEntityCounts: Record<string, number>;
    /** Of those, how many draw anything. */
    cellRenderCounts: Record<string, number>;
    /** Acquisitions each resident cell still owes. Zero after it unloads. */
    assetRefsByCell: Record<string, number>;
    /** What the cook put in each cell — the number a live count is checked against. */
    authoredCellEntityCounts: Record<string, number>;
    /**
     * Each resident cell's authored rows and the handle each one currently has.
     * The row survives a reload and the handle does not, which is the difference
     * between an identity and a way to reach something that exists.
     */
    cellRows: Record<string, Array<{ id: number; entity: number }>>;
    /** Live entities the persistent world owns; residency never touches these. */
    persistentEntities: number;
    /** Their handles. Unchanged for the life of the world — that is the claim. */
    persistentHandles: number[];
    /**
     * Per cell: where its last delivery spent its time, and whether the ask for
     * it found readiness waiting. The phases run between frames, which is why no
     * frame profiler holds them and why a total is not a hitch.
     */
    delivery: Record<string, CellDelivery>;
}

const EMPTY: WorldResidencyReport = {
    streamed: false, cellCount: 0, cells: [], cellSize: 0, sourceCount: 0,
    desiredCells: [], prefetchCells: [], residentCells: [], preparedCells: [],
    preparedWithRenderClaim: [], renderClaims: {},
    loadingCells: [], unloadingCells: [],
    loadCount: 0, unloadCount: 0, prepareCount: 0, cancelCount: 0,
    prefetchRequests: 0, cancelledRefs: 0,
    prefetchHits: 0, prefetchMisses: 0, lastDemandToResidentMs: 0,
    cellEntityCounts: {}, cellRenderCounts: {}, assetRefsByCell: {},
    authoredCellEntityCounts: {}, cellRows: {},
    persistentEntities: 0, persistentHandles: [], delivery: {},
};

/**
 * Residency as it stands this instant.
 *
 * @experimental
 */
export function worldResidencyReport(app: App): WorldResidencyReport {
    if (!app.hasResource(WorldStreaming) || !app.hasResource(SceneManager)) return { ...EMPTY };
    const streamer = app.getResource(WorldStreaming);
    const manifest = streamer.manifest;
    if (manifest === null) return { ...EMPTY };
    const scenes = app.getResource(SceneManager);
    const status = streamer.status();

    const cellEntityCounts: Record<string, number> = {};
    const cellRenderCounts: Record<string, number> = {};
    const assetRefsByCell: Record<string, number> = {};
    const authoredCellEntityCounts: Record<string, number> = {};
    const cellRows: Record<string, Array<{ id: number; entity: number }>> = {};
    const drawing = renderableComponents();
    for (const cell of manifest.cells) {
        authoredCellEntityCounts[cell.name] = cell.entityCount;
        const context = scenes.getScene(cell.name);
        // A cell nothing brought in has no row at all, which is the difference
        // between "not here" and "here and empty" that a zero would hide.
        if (context === null) continue;
        let drawn = 0;
        const rows: Array<{ id: number; entity: number }> = [];
        for (const entity of context.entities) {
            if (drawing.some((component) => app.world.has(entity, component))) drawn++;
            const authored = stableEntityId(app, entity);
            if (authored !== undefined) rows.push({ id: authored, entity });
        }
        cellEntityCounts[cell.name] = context.entities.size;
        cellRenderCounts[cell.name] = drawn;
        cellRows[cell.name] = rows.sort((a, b) => a.id - b.id);
        assetRefsByCell[cell.name] = scenes.assetScopeFor(cell.name)?.size ?? 0;
    }

    const persistent = [...(scenes.getScene(manifest.scene)?.entities ?? [])].sort((a, b) => a - b);
    return {
        streamed: true,
        cellCount: status.cellCount,
        cells: manifest.cells.map((cell) => ({ name: cell.name, x: cell.x, z: cell.z })),
        cellSize: manifest.cellSize,
        sourceCount: status.sourceCount,
        desiredCells: status.desiredCells,
        prefetchCells: status.prefetchCells,
        residentCells: status.residentCells,
        preparedCells: status.preparedCells,
        preparedWithRenderClaim:
            status.preparedCells.filter((c) => streamer.renderReadinessOf(c) !== null),
        renderClaims: Object.fromEntries(
            [...status.preparedCells, ...status.residentCells]
                .map((c) => [c, streamer.renderReadinessOf(c)])
                .filter((row): row is [string, RenderReadinessStamp] => row[1] !== null)
                .map(([c, stamp]) => [c, { ...stamp, restamps: streamer.restampsOf(c) }])),
        loadingCells: status.loadingCells,
        unloadingCells: status.unloadingCells,
        loadCount: status.loadCount,
        unloadCount: status.unloadCount,
        prepareCount: status.prepareCount,
        cancelCount: status.cancelCount,
        prefetchRequests: status.prefetchRequests,
        cancelledRefs: status.cancelledRefs,
        prefetchHits: status.prefetchHits,
        prefetchMisses: status.prefetchMisses,
        lastDemandToResidentMs: status.lastDemandToResidentMs,
        cellEntityCounts, cellRenderCounts, assetRefsByCell, authoredCellEntityCounts,
        cellRows,
        persistentEntities: persistent.length,
        persistentHandles: persistent,
        delivery: streamer.delivery(),
    };
}
