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
import { WorldStreaming } from './WorldStreamer';
import { stableEntityId } from './identity';
import { renderableComponents } from '../ecs/component';

/** @experimental */
export interface WorldResidencyReport {
    /** False when this build has no cooked world; every other field is empty. */
    streamed: boolean;
    cellCount: number;
    sourceCount: number;
    desiredCells: string[];
    residentCells: string[];
    loadingCells: string[];
    unloadingCells: string[];
    loadCount: number;
    unloadCount: number;
    /** Live entities each resident cell owns. Absent from the map = not resident. */
    cellEntityCounts: Record<string, number>;
    /** Of those, how many draw anything. */
    cellRenderCounts: Record<string, number>;
    /** Acquisitions each resident cell still owes. Zero after it unloads. */
    assetRefsByCell: Record<string, number>;
    /** What the cook put in each cell — the number a live count is checked against. */
    authoredCellEntityCounts: Record<string, number>;
    /** The authored rows each resident cell instantiated; unchanged by a reload. */
    cellStableIds: Record<string, number[]>;
    /** The runtime handles those rows currently have; a reload mints new ones. */
    cellHandles: Record<string, number[]>;
    /** Live entities the persistent world owns; residency never touches these. */
    persistentEntities: number;
    /** Their handles. Unchanged for the life of the world — that is the claim. */
    persistentHandles: number[];
}

const EMPTY: WorldResidencyReport = {
    streamed: false, cellCount: 0, sourceCount: 0,
    desiredCells: [], residentCells: [], loadingCells: [], unloadingCells: [],
    loadCount: 0, unloadCount: 0,
    cellEntityCounts: {}, cellRenderCounts: {}, assetRefsByCell: {},
    authoredCellEntityCounts: {}, cellStableIds: {}, cellHandles: {},
    persistentEntities: 0, persistentHandles: [],
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
    const cellStableIds: Record<string, number[]> = {};
    const cellHandles: Record<string, number[]> = {};
    const drawing = renderableComponents();
    for (const cell of manifest.cells) {
        authoredCellEntityCounts[cell.name] = cell.entityCount;
        const context = scenes.getScene(cell.name);
        // A cell nothing brought in has no row at all, which is the difference
        // between "not here" and "here and empty" that a zero would hide.
        if (context === null) continue;
        let drawn = 0;
        const stable: number[] = [];
        const handles: number[] = [];
        for (const entity of context.entities) {
            if (drawing.some((component) => app.world.has(entity, component))) drawn++;
            const authored = stableEntityId(app, entity);
            if (authored !== undefined) stable.push(authored);
            handles.push(entity);
        }
        cellEntityCounts[cell.name] = context.entities.size;
        cellRenderCounts[cell.name] = drawn;
        cellStableIds[cell.name] = stable.sort((a, b) => a - b);
        cellHandles[cell.name] = handles.sort((a, b) => a - b);
        assetRefsByCell[cell.name] = scenes.assetScopeFor(cell.name)?.size ?? 0;
    }

    const persistent = [...(scenes.getScene(manifest.scene)?.entities ?? [])].sort((a, b) => a - b);
    return {
        streamed: true,
        cellCount: status.cellCount,
        sourceCount: status.sourceCount,
        desiredCells: status.desiredCells,
        residentCells: status.residentCells,
        loadingCells: status.loadingCells,
        unloadingCells: status.unloadingCells,
        loadCount: status.loadCount,
        unloadCount: status.unloadCount,
        cellEntityCounts, cellRenderCounts, assetRefsByCell, authoredCellEntityCounts,
        cellStableIds, cellHandles,
        persistentEntities: persistent.length,
        persistentHandles: persistent,
    };
}
