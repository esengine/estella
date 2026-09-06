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
import type { SceneConfig } from '../scene/sceneManager';
import { defineResource } from '../ecs/resource';
import { log } from '../util/logger';

/**
 * Where a cell is in its lifetime.
 *
 * `prepared` is the one worth naming: fetched, decoded, its assets acquired, and
 * carrying not one runtime entity. Nothing in the world can observe it, because
 * there is nothing there to observe.
 *
 * @experimental
 */
export type CellResidency =
    'unloaded' | 'preparing' | 'prepared' | 'publishing' | 'resident' | 'unloading';

/**
 * The slice of `SceneManager` the streamer drives. `SceneManagerState` satisfies
 * it structurally; a criterion injects a recording stub.
 *
 * @experimental
 */
export interface WorldStreamHost {
    register(config: SceneConfig): void;
    prepare(name: string): Promise<void>;
    discardPrepared(name: string): number;
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
    /** Cells worth readying: what any source is close enough to speculate about. */
    prefetchCells: string[];
    residentCells: string[];
    /** Ready and holding nothing the world can see. */
    preparedCells: string[];
    loadingCells: string[];
    unloadingCells: string[];
    /** Cells brought in since boot, and cells taken out. Churn is the difference. */
    loadCount: number;
    unloadCount: number;
    /** Preparations begun, and preparations thrown away unpublished. */
    prepareCount: number;
    cancelCount: number;
    /** Acquisitions given back by discarding readiness — not by unloading. */
    cancelledRefs: number;
    /**
     * Publications that had a prepared cell waiting, and publications that had to
     * do the preparing themselves. The second is a player arriving early.
     */
    prefetchHits: number;
    prefetchMisses: number;
    /** Demanded to resident, milliseconds — what a prefetch hit is worth. */
    lastDemandToResidentMs: number;
}

interface CellState {
    cell: WorldCell;
    residency: CellResidency;
    /** What the last reconciliation asked for; the async completions re-read it. */
    desired: boolean;
    /** Whether any source is close enough to speculate about it. */
    speculated: boolean;
    /** Where this cell's last load spent its time, phase by phase. */
    phases: Record<string, number>;
    /** When the load was issued, so `delivery` is measured and not guessed. */
    issuedAt: number;
    /** Issue to resident, in wall time. Most of it is not the engine working. */
    delivery: number;
    /** When it became demanded, so the latency a player feels can be measured. */
    demandedAt: number;
    /** Whether the preparation now running was begun because it was ALREADY wanted. */
    preparedUnderDemand: boolean;
}

export class WorldStreamer {
    private readonly host_: WorldStreamHost;
    private manifest_: WorldManifest | null = null;
    /** In manifest order, so every list this produces is stable. */
    private readonly cells_ = new Map<string, CellState>();
    private sourceCount_ = 0;
    private loadCount_ = 0;
    private unloadCount_ = 0;
    private prepareCount_ = 0;
    private cancelCount_ = 0;
    private cancelledRefs_ = 0;
    private prefetchHits_ = 0;
    private prefetchMisses_ = 0;
    private lastDemandToResident_ = 0;

    constructor(host: WorldStreamHost) {
        this.host_ = host;
    }

    /**
     * Adopt a cooked world: its cells become loadable scenes and residency
     * answers for them.
     *
     * Registered here, not beside the game's own scenes: a cell is content
     * residency brings in, and `switchTo('cell_3_2')` is a second author.
     */
    loadManifest(manifest: WorldManifest, sceneConfig?: (cell: WorldCell) => SceneConfig): void {
        this.manifest_ = manifest;
        this.cells_.clear();
        for (const cell of manifest.cells) {
            this.host_.register(sceneConfig?.(cell) ?? { name: cell.name, path: cell.path });
            this.cells_.set(cell.name, {
                cell, residency: 'unloaded', desired: false, speculated: false,
                phases: {}, issuedAt: 0, delivery: 0,
                demandedAt: 0, preparedUnderDemand: false,
            });
        }
    }

    get manifest(): WorldManifest | null {
        return this.manifest_;
    }

    residencyOf(name: string): CellResidency {
        return this.cells_.get(name)?.residency ?? 'unloaded';
    }

    /**
     * Where a cell's load spent its time.
     *
     * Most of a load runs BETWEEN frames — off every system timer there is — so a
     * profiler watching the frame loop sees the cost and cannot name it.
     */
    recordPhase(name: string, phase: string, ms: number): void {
        const state = this.cells_.get(name);
        if (state) state.phases[phase] = (state.phases[phase] ?? 0) + ms;
    }

    /** Per cell: the phases of its last load, and issue-to-resident wall time. */
    delivery(): Record<string, { phases: Record<string, number>; deliveryMs: number }> {
        const out: Record<string, { phases: Record<string, number>; deliveryMs: number }> = {};
        for (const [name, state] of this.cells_) {
            if (state.delivery === 0 && Object.keys(state.phases).length === 0) continue;
            out[name] = { phases: { ...state.phases }, deliveryMs: state.delivery };
        }
        return out;
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
            // Publishing counts as resident so the decision does not ask twice, and
            // unloading does not, so a source that came back re-issues the load.
            if (state.residency === 'resident' || state.residency === 'publishing') resident.add(name);
        }
        const cells: WorldCell[] = [];
        for (const state of this.cells_.values()) cells.push(state.cell);
        const decision = desiredResidency(cells, sources, resident);

        const target = new Set(decision.target);
        const speculated = new Set(decision.prefetch);
        const now = performance.now();
        for (const [name, state] of this.cells_) {
            const wanted = target.has(name);
            // The moment demand begins, so what a prefetch hit is worth can be
            // measured rather than asserted.
            if (wanted && !state.desired) state.demandedAt = now;
            state.desired = wanted;
            state.speculated = speculated.has(name);
        }
        // Demanded first and nearest first: a place a player is walking into
        // outranks one they might. Then speculation, then what nobody needs.
        for (const name of decision.toLoad) this.step_(name);
        for (const name of decision.prefetch) if (!target.has(name)) this.step_(name);
        for (const name of decision.toUnload) this.step_(name);
        for (const [name, state] of this.cells_) {
            if (state.residency === 'prepared' && !state.desired && !state.speculated) {
                this.step_(name);
            }
        }
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
        const prefetchCells: string[] = [];
        const residentCells: string[] = [];
        const preparedCells: string[] = [];
        const loadingCells: string[] = [];
        const unloadingCells: string[] = [];
        for (const [name, state] of this.cells_) {
            if (state.desired) desiredCells.push(name);
            if (state.speculated) prefetchCells.push(name);
            if (state.residency === 'resident') residentCells.push(name);
            else if (state.residency === 'prepared') preparedCells.push(name);
            else if (state.residency === 'preparing' || state.residency === 'publishing') {
                loadingCells.push(name);
            } else if (state.residency === 'unloading') unloadingCells.push(name);
        }
        return {
            cellCount: this.cells_.size,
            sourceCount: this.sourceCount_,
            desiredCells, prefetchCells, residentCells, preparedCells,
            loadingCells, unloadingCells,
            loadCount: this.loadCount_, unloadCount: this.unloadCount_,
            prepareCount: this.prepareCount_, cancelCount: this.cancelCount_,
            cancelledRefs: this.cancelledRefs_,
            prefetchHits: this.prefetchHits_, prefetchMisses: this.prefetchMisses_,
            lastDemandToResidentMs: this.lastDemandToResident_,
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
        if (state.residency === 'preparing' || state.residency === 'publishing'
            || state.residency === 'unloading') return;
        if (state.residency === 'unloaded' && (state.desired || state.speculated)) {
            this.beginPrepare_(name, state);
        } else if (state.residency === 'prepared' && state.desired) {
            this.beginLoad_(name, state);
        } else if (state.residency === 'prepared' && !state.speculated) {
            // Speculation is not authority. A cell nobody is near any more goes
            // back, receipts included, rather than being published because it
            // happens to be ready.
            this.cancelledRefs_ += this.host_.discardPrepared(name);
            state.residency = 'unloaded';
            this.cancelCount_++;
        } else if (state.residency === 'resident' && !state.desired) {
            this.beginUnload_(name, state);
        }
    }

    private beginPrepare_(name: string, state: CellState): void {
        state.residency = 'preparing';
        state.phases = {};
        state.issuedAt = performance.now();
        state.preparedUnderDemand = state.desired;
        this.prepareCount_++;
        Promise.resolve(this.host_.prepare(name)).then(
            () => {
                state.residency = 'prepared';
                // What finished was begun against a world that has moved. Whether
                // this cell is still wanted — or wanted now when it was not — is
                // asked again here rather than assumed from when it started.
                this.step_(name);
            },
            (err) => {
                state.residency = 'unloaded';
                log.error('residency', `cell "${name}" did not prepare`, err);
            },
        );
    }

    private beginLoad_(name: string, state: CellState): void {
        state.residency = 'publishing';
        if (state.preparedUnderDemand) this.prefetchMisses_++;
        else this.prefetchHits_++;
        this.loadCount_++;
        Promise.resolve(this.host_.loadAdditive(name)).then(
            () => {
                state.residency = 'resident';
                state.delivery = performance.now() - state.issuedAt;
                if (state.demandedAt > 0) {
                    this.lastDemandToResident_ = performance.now() - state.demandedAt;
                }
                this.step_(name);
            },
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
