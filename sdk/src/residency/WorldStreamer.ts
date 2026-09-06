// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WorldStreamer.ts
 * @brief   The one thing that decides which cells of a cooked world exist.
 *
 * @details Residency has a single author. Renderers do not load places, AI does
 *          not unload them, and an entity never decides it is far enough away to
 *          delete itself — every one of those is a second author, and two authors
 *          of existence is how a world ends up holding entities nobody can name.
 *
 *          A cell is an additively-loaded scene, so bringing one in and taking it
 *          out is the scene lifecycle transaction that already exists: one
 *          teardown protocol, idempotent, with the cell's asset receipts owned by
 *          the cell's own scope. Unloading is a real destroy — not a visibility
 *          flag — which is the whole reason a cell is a scene rather than a list
 *          of things to hide.
 */

import { desiredResidency, type ResidencySource, type WorldCell, type WorldManifest } from './cells';
import { defineResource } from '../ecs/resource';
import { log } from '../util/logger';

/** Where a cell is in its lifetime. @experimental */
export type CellResidency = 'unloaded' | 'loading' | 'resident' | 'unloading';

/**
 * The slice of `SceneManager` the streamer drives. `SceneManagerState` satisfies
 * it structurally; a criterion injects a recording stub.
 *
 * @experimental
 */
export interface WorldStreamHost {
    register(config: { name: string; path: string }): void;
    loadAdditive(name: string): Promise<unknown>;
    unload(name: string, options?: { keepPersistent?: boolean }): Promise<void>;
    isLoaded(name: string): boolean;
}

/** What the streamer is doing, for a report. @experimental */
export interface WorldStreamerStatus {
    cellCount: number;
    sourceCount: number;
    /** Cells that should exist right now, load radius unioned with the kept band. */
    desiredCells: string[];
    residentCells: string[];
    loadingCells: string[];
    unloadingCells: string[];
    /** Cells brought in since boot, and cells taken out. Churn is the difference. */
    loadCount: number;
    unloadCount: number;
}

interface CellState {
    cell: WorldCell;
    residency: CellResidency;
    /** What the last reconciliation asked for; the async completions re-read it. */
    desired: boolean;
}

export class WorldStreamer {
    private readonly host_: WorldStreamHost;
    private manifest_: WorldManifest | null = null;
    /** In manifest order, so every list this produces is stable. */
    private readonly cells_ = new Map<string, CellState>();
    private sourceCount_ = 0;
    private loadCount_ = 0;
    private unloadCount_ = 0;

    constructor(host: WorldStreamHost) {
        this.host_ = host;
    }

    /**
     * Adopt a cooked world: its cells become loadable scenes and residency starts
     * answering for them.
     *
     * Registered here rather than beside the game's own scenes: a cell is content
     * residency brings in, and `switchTo('cell_3_2')` is a second author.
     */
    loadManifest(manifest: WorldManifest): void {
        this.manifest_ = manifest;
        this.cells_.clear();
        for (const cell of manifest.cells) {
            this.host_.register({ name: cell.name, path: cell.path });
            this.cells_.set(cell.name, { cell, residency: 'unloaded', desired: false });
        }
    }

    get manifest(): WorldManifest | null {
        return this.manifest_;
    }

    residencyOf(name: string): CellResidency {
        return this.cells_.get(name)?.residency ?? 'unloaded';
    }

    /**
     * Reconcile residency against where the sources are.
     *
     * The sources arrive as a list and are unioned, never folded: a fold gives
     * the last one written the whole answer, and then a second camera deletes
     * the world the first is standing in.
     */
    update(sources: readonly ResidencySource[]): void {
        this.sourceCount_ = sources.length;
        if (this.cells_.size === 0) return;
        const resident = new Set<string>();
        for (const [name, state] of this.cells_) {
            // Loading counts as resident so the decision does not ask twice, and
            // unloading does not, so a source that came back re-issues the load.
            if (state.residency === 'resident' || state.residency === 'loading') resident.add(name);
        }
        const cells: WorldCell[] = [];
        for (const state of this.cells_.values()) cells.push(state.cell);
        const decision = desiredResidency(cells, sources, resident);

        const target = new Set(decision.target);
        for (const [name, state] of this.cells_) state.desired = target.has(name);
        for (const name of decision.toLoad) this.step_(name);
        for (const name of decision.toUnload) this.step_(name);
    }

    /** Everything goes; the cells stay registered. For a world being torn down. */
    clear(): void {
        for (const [name, state] of this.cells_) {
            state.desired = false;
            if (state.residency === 'resident') this.step_(name);
        }
    }

    status(): WorldStreamerStatus {
        const desiredCells: string[] = [];
        const residentCells: string[] = [];
        const loadingCells: string[] = [];
        const unloadingCells: string[] = [];
        for (const [name, state] of this.cells_) {
            if (state.desired) desiredCells.push(name);
            if (state.residency === 'resident') residentCells.push(name);
            else if (state.residency === 'loading') loadingCells.push(name);
            else if (state.residency === 'unloading') unloadingCells.push(name);
        }
        return {
            cellCount: this.cells_.size,
            sourceCount: this.sourceCount_,
            desiredCells, residentCells, loadingCells, unloadingCells,
            loadCount: this.loadCount_, unloadCount: this.unloadCount_,
        };
    }

    /**
     * Move one cell toward what it should be, or leave it alone while an earlier
     * move is still in flight. Re-entered when that move finishes, which is what
     * lets a source that turned around re-issue the opposite one — without this,
     * a cell whose load was overtaken stays resident forever.
     */
    private step_(name: string): void {
        const state = this.cells_.get(name);
        if (!state) return;
        if (state.residency === 'loading' || state.residency === 'unloading') return;
        if (state.desired && state.residency === 'unloaded') this.beginLoad_(name, state);
        else if (!state.desired && state.residency === 'resident') this.beginUnload_(name, state);
    }

    private beginLoad_(name: string, state: CellState): void {
        state.residency = 'loading';
        this.loadCount_++;
        Promise.resolve(this.host_.loadAdditive(name)).then(
            () => { state.residency = 'resident'; this.step_(name); },
            (err) => {
                // A cell that failed to come up owns nothing (the scene load is a
                // transaction), so it goes back to being absent and may be asked
                // for again rather than being stuck half-present.
                state.residency = 'unloaded';
                log.error('residency', `cell "${name}" did not load`, err);
            },
        );
    }

    private beginUnload_(name: string, state: CellState): void {
        state.residency = 'unloading';
        this.unloadCount_++;
        // `keepPersistent: false` is the contract: a cell's unload takes everything
        // the cell brought. Scene persistence answers a different question, and
        // honouring it here leaves exactly what residency exists to remove.
        Promise.resolve(this.host_.unload(name, { keepPersistent: false })).then(
            () => { state.residency = 'unloaded'; this.step_(name); },
            (err) => {
                state.residency = this.host_.isLoaded(name) ? 'resident' : 'unloaded';
                log.error('residency', `cell "${name}" did not unload`, err);
                this.step_(name);
            },
        );
    }
}

/** The world's residency authority. @experimental */
export const WorldStreaming = defineResource<WorldStreamer>(null!, 'WorldStreaming');
