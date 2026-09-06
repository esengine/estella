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
import {
    sameReadiness, type RenderReadiness, type RenderReadinessStamp,
} from '../render/renderReadiness';
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
    /**
     * Make the render programs a prepared cell requires ready. Absent on a host
     * that predates the obligation, which reads as not applicable — the same
     * answer a headless one gives, and never a claim that succeeded.
     */
    readyRenderPrograms?(name: string): Promise<RenderReadiness>;
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
    /** Of those preparations, the ones begun for a cell nobody had asked for yet. */
    prefetchRequests: number;
    /** Acquisitions given back by discarding readiness — not by unloading. */
    cancelledRefs: number;
    /**
     * Decided the instant a cell is first DEMANDED, by what demand finds there:
     * readiness that already exists is a hit, and anything else — nothing, or a
     * preparation still in flight — is a miss. A preparation that was on its way
     * is not a hit: the player waited for it either way.
     */
    prefetchHits: number;
    prefetchMisses: number;
    /** Demanded to resident, milliseconds — what a prefetch hit is worth. */
    lastDemandToResidentMs: number;
}

interface CellState {
    cell: WorldCell;
    residency: CellResidency;
    /**
     * The obligations preparation owes before this cell may be called prepared.
     * Held here and only READ by the state machine: what a cell's programs are
     * is the renderer's question, and a streamer deriving it would be a second
     * author of the answer.
     */
    assetsReady: boolean;
    /** The claim, once one has been made. Null while it is still owed. */
    renderReadiness: RenderReadinessStamp | null;
    /** Whether a readying attempt is in flight, so a retry does not stack. */
    readinessInFlight: boolean;
    /** How often publication found the claim stale and replaced it. Zero over a
     *  dwell in which nothing moved is the whole point of preparing early. */
    restamps: number;
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
    /** When readiness arrived, so how long it then sat unused is measurable. */
    preparedAt: number;
    /** When publication began, so the wait BEFORE it is not charged to it. */
    publishedAt: number;
    /** Issue to prepared: what a hit takes off the latency a player feels. */
    prepareMs: number;
    /** Publish to resident: what a hit still costs, whatever prefetch does. */
    publishMs: number;
    /** Demanded to resident — the whole of what a player waits through. */
    demandToResidentMs: number;
    /** Prepared to demanded. Only a hit has one; a miss had nothing waiting. */
    dwellMs: number;
    /** What the last demand for this cell found. */
    outcome: 'hit' | 'miss' | '';
}

/** Where one cell's last delivery spent its time. @experimental */
export interface CellDelivery {
    /** Phases of the preparation, which runs between frames and on no system timer. */
    phases: Record<string, number>;
    /** Issue to resident. For a hit this contains the dwell, so it is not a latency. */
    deliveryMs: number;
    prepareMs: number;
    publishMs: number;
    /** The latency a player feels: from wanting the place to standing in it. */
    demandToResidentMs: number;
    /** How long readiness waited to be wanted. Zero on a miss — nothing waited. */
    dwellMs: number;
    outcome: 'hit' | 'miss' | '';
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
    private prefetchRequests_ = 0;
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
                assetsReady: false, renderReadiness: null, readinessInFlight: false,
                restamps: 0,
                phases: {}, issuedAt: 0, delivery: 0,
                demandedAt: 0, preparedAt: 0, publishedAt: 0,
                prepareMs: 0, publishMs: 0, demandToResidentMs: 0, dwellMs: 0, outcome: '',
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
     * The render-program claim a cell holds, or null when it holds none.
     *
     * A cell on a host with no renderer holds NONE — the obligation did not
     * apply, which is a different fact from a claim that succeeded and must stay
     * distinguishable from one. Publication reads this to re-check freshness.
     *
     * @experimental
     */
    renderReadinessOf(name: string): RenderReadinessStamp | null {
        return this.cells_.get(name)?.renderReadiness ?? null;
    }

    /**
     * How often publication found this cell's claim stale and made a new one.
     *
     * Zero across a dwell where nothing moved: readying again for content that
     * did not change is the cost prefetching exists to avoid paying twice.
     *
     * @experimental
     */
    restampsOf(name: string): number {
        return this.cells_.get(name)?.restamps ?? 0;
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

    /**
     * Per cell: where its last delivery spent its time.
     *
     * Per CELL and not a running average, because the question prefetch answers
     * is asked one arrival at a time: a mean over hits and misses together
     * describes no arrival that happened.
     */
    delivery(): Record<string, CellDelivery> {
        const out: Record<string, CellDelivery> = {};
        for (const [name, state] of this.cells_) {
            if (state.delivery === 0 && Object.keys(state.phases).length === 0) continue;
            out[name] = {
                phases: { ...state.phases },
                deliveryMs: state.delivery,
                prepareMs: state.prepareMs,
                publishMs: state.publishMs,
                demandToResidentMs: state.demandToResidentMs,
                dwellMs: state.dwellMs,
                outcome: state.outcome,
            };
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
            if (wanted && !state.desired) this.demand_(state, now);
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
            prefetchRequests: this.prefetchRequests_,
            cancelledRefs: this.cancelledRefs_,
            prefetchHits: this.prefetchHits_, prefetchMisses: this.prefetchMisses_,
            lastDemandToResidentMs: this.lastDemandToResident_,
        };
    }

    /**
     * A cell has just been asked for, and what the ask FINDS is the hit.
     *
     * Not judged at publication: "prepared by the time we published it" is true
     * of every cell that ever loads. Only readiness that already existed when
     * the ask arrived took anything off the wait.
     */
    private demand_(state: CellState, now: number): void {
        state.demandedAt = now;
        // Already here, or already on its way in: this ask owes no publication,
        // so there is nothing for speculation to have been early for.
        if (state.residency === 'resident' || state.residency === 'publishing') return;
        if (state.residency === 'prepared') {
            this.prefetchHits_++;
            state.outcome = 'hit';
            state.dwellMs = now - state.preparedAt;
        } else {
            this.prefetchMisses_++;
            state.outcome = 'miss';
            state.dwellMs = 0;
        }
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
        if (state.residency === 'preparing') {
            // Assets are in and only the program obligation is left. Retried
            // here, because a claim refused once (a device that rebuilt mid-
            // readying) costs one more attempt rather than the whole preparation.
            if (state.assetsReady && !state.readinessInFlight) {
                this.settleReadiness_(name, state);
            }
            return;
        }
        if (state.residency === 'publishing' || state.residency === 'unloading') return;
        if (state.residency === 'unloaded' && (state.desired || state.speculated)) {
            this.beginPrepare_(name, state);
        } else if (state.residency === 'prepared' && state.desired) {
            this.publishWhenReady_(name, state);
        } else if (state.residency === 'prepared' && !state.speculated) {
            // Speculation is not authority. A cell nobody is near any more goes
            // back, receipts included, rather than being published because it
            // happens to be ready.
            this.cancelledRefs_ += this.host_.discardPrepared(name);
            state.residency = 'unloaded';
            state.assetsReady = false;
            state.renderReadiness = null;
            this.cancelCount_++;
        } else if (state.residency === 'resident' && !state.desired) {
            this.beginUnload_(name, state);
        }
    }

    private beginPrepare_(name: string, state: CellState): void {
        state.residency = 'preparing';
        state.phases = {};
        state.issuedAt = performance.now();
        state.prepareMs = 0;
        state.publishMs = 0;
        state.demandToResidentMs = 0;
        this.prepareCount_++;
        if (!state.desired) {
            // Speculating afresh about a cell whose last delivery is over. Its
            // verdict belonged to THAT delivery, and carrying it forward would
            // report a hit for an ask nobody has made yet.
            this.prefetchRequests_++;
            state.outcome = '';
            state.dwellMs = 0;
        }
        state.assetsReady = false;
        state.renderReadiness = null;
        Promise.resolve(this.host_.prepare(name)).then(
            () => {
                // One obligation of two. `prepared` is not the end of the assets
                // arriving, it is the end of everything publication requires.
                state.assetsReady = true;
                this.settleReadiness_(name, state);
            },
            (err) => {
                state.residency = 'unloaded';
                state.assetsReady = false;
                log.error('residency', `cell "${name}" did not prepare`, err);
            },
        );
    }

    /**
     * Pay the render-program obligation, or leave it owed.
     *
     * A debt rather than an event: a claim that could not be made leaves the cell
     * in `preparing` with its assets intact, and the next progression tries
     * again. Dropping it would strip a preparation that had almost finished.
     */
    private settleReadiness_(name: string, state: CellState): void {
        const ready = this.host_.readyRenderPrograms;
        if (!ready) { this.markPrepared_(name, state); return; }

        state.readinessInFlight = true;
        this.askReadiness_(name, ready).then(
            (outcome) => {
                state.readinessInFlight = false;
                // Not applicable is an answer, not a claim: a host with no
                // renderer has nothing to ready and owes nothing.
                if (!outcome.applicable) { this.markPrepared_(name, state); return; }
                if (!outcome.stamp) {
                    log.warn('residency',
                             `cell "${name}" readied no render programs; still owed`);
                    return;
                }
                state.renderReadiness = outcome.stamp;
                this.markPrepared_(name, state);
            },
            (err) => {
                state.readinessInFlight = false;
                log.error('residency', `cell "${name}" could not ready its programs`, err);
            },
        );
    }

    /**
     * Ask the host to ready a cell's programs, as a promise either way.
     *
     * A host that throws SYNCHRONOUSLY would otherwise unwind through the
     * progression and leave the streamer mid-step. A failed readying is an
     * outcome this handles, not one it propagates.
     */
    private askReadiness_(
        name: string, ready: NonNullable<WorldStreamHost['readyRenderPrograms']>,
    ): Promise<RenderReadiness> {
        try {
            return Promise.resolve(ready.call(this.host_, name));
        } catch (err) {
            return Promise.reject(err);
        }
    }

    /** Every obligation is satisfied: only now is the cell prepared. */
    private markPrepared_(name: string, state: CellState): void {
        state.residency = 'prepared';
        state.preparedAt = performance.now();
        state.prepareMs = state.preparedAt - state.issuedAt;
        // What finished was begun against a world that has moved. Whether this
        // cell is still wanted — or wanted now when it was not — is asked again
        // here rather than assumed from when it started.
        this.step_(name);
    }

    /**
     * The obligation publication has, which is not the one preparation had.
     *
     * A claim about THEN, so requirements are derived AGAIN rather than inferred
     * from what looks like it moved. A stale one blocks this publication without
     * sending the cell backwards; an unpayable debt leaves it prepared.
     */
    private publishWhenReady_(name: string, state: CellState): void {
        const ready = this.host_.readyRenderPrograms;
        // No claim to keep fresh: the obligation did not apply when this cell was
        // prepared, and nothing since then has given it a renderer.
        if (!ready || !state.renderReadiness) { this.beginLoad_(name, state); return; }
        if (state.readinessInFlight) return;

        state.readinessInFlight = true;
        this.askReadiness_(name, ready).then(
            (outcome) => {
                state.readinessInFlight = false;
                if (!outcome.applicable) { this.beginLoad_(name, state); return; }
                if (!outcome.stamp) {
                    // Publication created a debt of its own — the readying was
                    // refused, most likely by a device that moved underneath it.
                    log.warn('residency',
                             `cell "${name}" cannot publish: its programs are not ready`);
                    return;
                }
                // Compared, not merely overwritten: re-readying is idempotent so
                // both paths publish, but comparing BOTH halves is what keeps
                // either half from silently coming undone.
                if (!sameReadiness(state.renderReadiness!, outcome.stamp)) {
                    state.renderReadiness = outcome.stamp;
                    state.restamps++;
                }
                this.beginLoad_(name, state);
            },
            (err) => {
                state.readinessInFlight = false;
                log.error('residency', `cell "${name}" could not re-ready its programs`, err);
            },
        );
    }

    private beginLoad_(name: string, state: CellState): void {
        state.residency = 'publishing';
        state.publishedAt = performance.now();
        this.loadCount_++;
        Promise.resolve(this.host_.loadAdditive(name)).then(
            () => {
                const now = performance.now();
                state.residency = 'resident';
                state.delivery = now - state.issuedAt;
                state.publishMs = now - state.publishedAt;
                if (state.demandedAt > 0) {
                    state.demandToResidentMs = now - state.demandedAt;
                    this.lastDemandToResident_ = state.demandToResidentMs;
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
