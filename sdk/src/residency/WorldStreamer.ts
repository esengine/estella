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

import {
    desiredResidency, distanceToCell, outsideSourceReach, sourceBounds, withinIndividualReach,
    type ResidencySource, type SourceBounds, type WorldCell, type WorldManifest,
} from './cells';
import { farProxySceneName } from './farProxy';
import { assertWorldManifest } from './manifest';
import type { SceneConfig } from '../scene/sceneManager';
import {
    sameReadiness, type RenderReadiness, type RenderReadinessStamp,
} from '../render/renderReadiness';
import { defineResource } from '../ecs/resource';
import type { App } from '../app/app';
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
    unregister?(config: SceneConfig): void;
    prepare(name: string): Promise<void>;
    /**
     * Make the render programs a prepared cell requires ready. Absent on a host
     * that predates the obligation, which reads as not applicable — the same
     * answer a headless one gives, and never a claim that succeeded.
     */
    readyRenderPrograms?(name: string): Promise<RenderReadiness>;
    discardPrepared(name: string): number;
    loadAdditive(name: string): Promise<unknown>;
    unload(name: string, options?: { keepPersistent?: boolean; staggered?: boolean }): Promise<void>;
    isLoaded(name: string): boolean;
    /** Finish, now, what of `name`'s publication or unload is being spread over frames. Absent: nothing is spread. */
    rush?(name: string): void;
    /** Says whether a player would see `name` missing, so its work spread over frames may take more of a frame. */
    urge?(name: string, urgent: boolean): void;
}

/**
 * What the streamer does when a world cannot keep up with a source that is upon it (default `wait`):
 * - `wait`: an urgent cell is published the frame it turns urgent, the game held (streaming on) till all are in: never a hole.
 * - `publish`: the same finishing, and no hold: a cell still being fetched is missing until it arrives.
 * - `budget`: nothing is ever finished outside the frame's budget; an urgent cell only gets the budget's priority extra.
 *
 * @experimental
 */
export type SlowStreamingPolicy = 'wait' | 'publish' | 'budget';

/**
 * How much a world streams at once, and what it does when it falls behind.
 *
 * @experimental
 */
export interface StreamingPolicy {
    /**
     * Cells being prepared (fetched, decoded, their assets acquired) at once; an urgent cell is not held back by it.
     * Default 4.
     */
    maxLoadingCells: number;
    /** Cells being published (spawned over frames) at once. Default 1: one at a time. */
    maxPublishingCells: number;
    /** See {@link SlowStreamingPolicy}. Default `wait`. */
    slowStreaming: SlowStreamingPolicy;
    /**
     * A cell a source needs is URGENT when it is not in and the source is within this share of its `loadRadius` of it:
     * distance to the cell over load radius. Default 0.25.
     */
    slowStreamingRatio: number;
}

/** @experimental */
export const DEFAULT_STREAMING_POLICY: Readonly<StreamingPolicy> = Object.freeze({
    maxLoadingCells: 4,
    maxPublishingCells: 1,
    slowStreaming: 'wait',
    slowStreamingRatio: 0.25,
});

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
    /** Cells whose far proxy is in the world, drawn in the cell's place. */
    proxyCells: string[];
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
    /** Cells a source is upon that are not in yet (see {@link StreamingPolicy.slowStreamingRatio}). */
    urgentCells: string[];
    /** Cells wanted that wait their turn: past `maxLoadingCells` to prepare, or `maxPublishingCells` to publish. */
    queuedCells: string[];
    /** Whether the game is held for an urgent cell (policy `wait`). */
    holding: boolean;
    /** How often the game was held, and how long it was held in all, milliseconds. */
    holdCount: number;
    holdMs: number;
    /** Publications finished outside the budget because their cell was urgent. */
    rushCount: number;
    policy: StreamingPolicy;
}

interface CellState {
    readonly registeredName: string;
    cell: WorldCell;
    proxy: ProxyState | undefined;
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
    discarding: boolean;
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
    /** Whether a source is upon it while it is not in. */
    urgent: boolean;
    /** Whether its last preparation or publication failed: such a cell does not hold the game, or it would hold for ever. */
    failed: boolean;
}

/** A cell's far proxy: a scene of its merged static meshes, in the world while the cell is not. */
interface ProxyState {
    scene: string;
    residency: 'unloaded' | 'loading' | 'prepared' | 'resident' | 'unloading';
    /** Whether the last reconciliation wants it in the world. */
    wanted: boolean;
    /** A proxy that failed to load stops holding its cell's unload back. */
    failed: boolean;
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
    /** Installed by a runtime that registers several maps in one scene manager. @internal */
    sourceSceneAllowed?: (scene: string) => boolean;
    private readonly host_: WorldStreamHost;
    private manifest_: WorldManifest | null = null;
    private readonly registrations_: SceneConfig[] = [];
    /** In manifest order, so every list this produces is stable. */
    private readonly cells_ = new Map<string, CellState>();
    private readonly occupiedSlots_ = { preparing: 0, publishing: 0 };
    private hasProxies_ = false;
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
    private readonly operations_ = new Set<Promise<void>>();
    private clearPromise_: Promise<void> | null = null;
    private clearing_ = false;
    private manifestRequest_ = 0;
    private policy_: StreamingPolicy = { ...DEFAULT_STREAMING_POLICY };
    /** The latest reconciliation's work order. Its identity also detects re-entry from host callbacks. */
    private order_: string[] = [];
    private holding_ = false;
    private holdStarted_ = 0;
    private holdCount_ = 0;
    private holdMs_ = 0;
    private rushCount_ = 0;
    private onHold_: ((held: boolean) => void) | null = null;
    private appPaused_: () => boolean = () => false;
    private residencyEpoch_ = 0;

    constructor(host: WorldStreamHost) {
        this.host_ = host;
    }

    /** Adopt a cooked world, or detach it, after the previous world's operations drain. The latest request wins. */
    async loadManifest(
        manifest: WorldManifest | null, sceneConfig?: (cell: WorldCell) => SceneConfig,
        proxyConfig?: (cell: WorldCell, scene: string, path: string) => SceneConfig,
    ): Promise<void> {
        if (manifest !== null) assertWorldManifest(manifest);
        const request = ++this.manifestRequest_;
        if (this.cells_.size > 0 || this.clearing_) await this.clearCells_();
        if (request !== this.manifestRequest_) return;
        for (const config of this.registrations_) this.host_.unregister?.(config);
        this.registrations_.length = 0;
        this.manifest_ = manifest;
        this.sourceCount_ = 0;
        this.residencyEpoch_++;
        this.cells_.clear();
        this.hasProxies_ = false;
        if (!manifest) return;
        const register = (config: SceneConfig): void => {
            this.host_.register(config);
            this.registrations_.push(config);
        };
        for (const cell of manifest.cells) {
            register(sceneConfig?.(cell) ?? { name: cell.name, path: cell.path });
            let proxy: ProxyState | undefined;
            if (cell.proxy && manifest.farDistance !== undefined) {
                const scene = farProxySceneName(cell.name);
                register(proxyConfig?.(cell, scene, cell.proxy) ?? { name: scene, path: cell.proxy });
                proxy = { scene, residency: 'unloaded', wanted: false, failed: false };
                this.hasProxies_ = true;
            }
            this.cells_.set(cell.name, {
                registeredName: cell.name, cell, proxy, residency: 'unloaded', desired: false, speculated: false,
                assetsReady: false, renderReadiness: null, readinessInFlight: false, discarding: false,
                restamps: 0,
                phases: {}, issuedAt: 0, delivery: 0,
                demandedAt: 0, preparedAt: 0, publishedAt: 0,
                prepareMs: 0, publishMs: 0, demandToResidentMs: 0, dwellMs: 0, outcome: '',
                urgent: false, failed: false,
            });
        }
    }

    get manifest(): WorldManifest | null {
        return this.manifest_;
    }

    /** What the streamer does at once and when it falls behind; see {@link StreamingPolicy}. */
    get policy(): Readonly<StreamingPolicy> {
        return this.policy_;
    }

    /** Changes the policy; what is left out keeps its value. A cap below one is taken as one. */
    setPolicy(policy: Partial<StreamingPolicy>): void {
        const next = { ...this.policy_, ...policy };
        next.maxLoadingCells = Math.max(1, Math.floor(next.maxLoadingCells));
        next.maxPublishingCells = Math.max(1, Math.floor(next.maxPublishingCells));
        next.slowStreamingRatio = Math.max(0, next.slowStreamingRatio);
        if (next.slowStreaming !== 'wait' && next.slowStreaming !== 'publish' && next.slowStreaming !== 'budget') {
            next.slowStreaming = DEFAULT_STREAMING_POLICY.slowStreaming;
        }
        this.policy_ = next;
        if (next.slowStreaming !== 'wait') this.setHolding_(false);
    }

    /**
     * Who holds the game for an urgent cell (policy `wait`): handed true when the hold begins and false when it ends.
     * `paused` says whether the game is paused at all, so the residency system can tell its own hold from the game's pause.
     */
    setHoldHandler(onHold: ((held: boolean) => void) | null, paused: () => boolean = () => false): void {
        this.onHold_ = onHold;
        this.appPaused_ = paused;
    }

    /** Whether the game is held for an urgent cell. */
    get holding(): boolean {
        return this.holding_;
    }

    /** Whether the game is paused by someone other than this streamer: then residency waits too, as it always has. */
    pausedWithoutHold(): boolean {
        return !this.holding_ && this.appPaused_();
    }

    private setHolding_(held: boolean): void {
        if (held === this.holding_) return;
        this.holding_ = held;
        const now = performance.now();
        if (held) { this.holdCount_++; this.holdStarted_ = now; }
        else this.holdMs_ += now - this.holdStarted_;
        this.onHold_?.(held);
    }

    /** Counts every cell that became resident or stopped being, and every world adopted: unchanged, nothing came or went. */
    get residencyEpoch(): number {
        return this.residencyEpoch_;
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
        if (this.clearing_ || !this.manifest_) return;
        this.sourceCount_ = sources.length;
        if (this.cells_.size === 0) return;
        const bounds = sourceBounds(sources);
        const { candidates, proxies } = this.hasProxies_ ? this.relevantCellsWithProxies_(sources, bounds)
            : { candidates: this.relevantCells_(bounds), proxies: [] };
        const cells: WorldCell[] = [];
        const resident = new Set<string>();
        for (const state of candidates) {
            cells.push(state.cell);
            // Publishing counts as resident so the decision does not ask twice, and
            // unloading does not, so a source that came back re-issues the load.
            if (state.residency === 'resident' || state.residency === 'publishing') resident.add(state.registeredName);
        }
        const decision = desiredResidency(cells, sources, resident);

        const target = new Set(decision.target);
        const speculated = new Set(decision.prefetch);
        const now = performance.now();
        for (const state of candidates) {
            const name = state.registeredName;
            const wanted = target.has(name);
            if (wanted && !state.desired) this.demand_(state, now);
            state.desired = wanted;
            state.speculated = speculated.has(name);
        }
        const order = [...decision.toLoad, ...decision.prefetch.filter((name) => !target.has(name))];
        this.order_ = order;
        this.judgeUrgency_(sources, candidates, order);
        if (this.order_ !== order) return;
        // Which stand-ins are wanted is settled before any cell steps: a cell stepped on the way (a prefetch of one that is
        // leaving) reads its proxy's want to decide whether it may go.
        for (const { state, proxy, inRange } of proxies) {
            proxy.wanted = !this.clearing_ && inRange && !(state.residency === 'resident' && state.desired);
            if (!proxy.wanted) proxy.failed = false;
        }
        // Demanded first and nearest first: a place a player is walking into
        // outranks one they might. Then speculation, then what nobody needs.
        for (const name of order) {
            this.step_(name);
            if (this.order_ !== order) return;
        }
        for (const { proxy } of proxies) {
            this.stepProxy_(proxy);
            if (this.order_ !== order) return;
        }
        for (const name of decision.toUnload) {
            this.step_(name);
            if (this.order_ !== order) return;
        }
        for (const state of candidates) {
            if ((state.residency === 'prepared' || state.residency === 'preparing') && !state.desired && !state.speculated) {
                this.step_(state.registeredName);
                if (this.order_ !== order) return;
            }
        }
        this.judgeHold_(candidates);
    }

    private relevantCells_(bounds: SourceBounds): CellState[] {
        const candidates: CellState[] = [];
        const individual = bounds.individual;
        for (const state of this.cells_.values()) {
            // A renamed box can address another registration in the exact decision.
            if (state.registeredName !== state.cell.name) return [...this.cells_.values()];
            if (state.residency !== 'unloaded' || state.desired || state.speculated || state.urgent ||
                (!outsideSourceReach(state.cell, bounds, bounds.reach) &&
                 (!individual || withinIndividualReach(state.cell, individual)))) candidates.push(state);
        }
        return candidates;
    }

    private relevantCellsWithProxies_(sources: readonly ResidencySource[], bounds: SourceBounds) {
        const candidates: CellState[] = [];
        const proxies: Array<{ state: CellState; proxy: ProxyState; inRange: boolean }> = [];
        const individual = bounds.individual;
        const far = this.manifest_?.farDistance ?? 0;
        const combinedReach = Math.max(bounds.reach, far);
        const rejectNearFromFarBounds = individual !== undefined && far > 0 && far >= bounds.reach;
        let renamed = false;
        for (const state of this.cells_.values()) {
            // Registrations keep their keys even if a caller edits a manifest in place.
            // A renamed box can address a different registration in the exact decision.
            const { cell, proxy } = state;
            renamed ||= state.registeredName !== cell.name;
            const active = state.residency !== 'unloaded' || state.desired || state.speculated || state.urgent;
            if (active) candidates.push(state);
            if (active && !proxy) continue;
            const reach = proxy ? combinedReach : bounds.reach;
            let inRange = false;
            if (!outsideSourceReach(cell, bounds, reach)) {
                const inFarBounds = proxy !== undefined && far > 0 && (reach === far || !outsideSourceReach(cell, bounds, far)) &&
                    (!individual || withinIndividualReach(cell, individual, far));
                // When far bounds cover near reach, a gap between sources can reject both paths.
                if (!active && (!rejectNearFromFarBounds || !proxy || inFarBounds) &&
                    (reach === bounds.reach || !outsideSourceReach(cell, bounds, bounds.reach)) &&
                    (!individual || withinIndividualReach(cell, individual))) candidates.push(state);
                inRange = inFarBounds && sources.some(source => distanceToCell(cell, source.x, source.z) <= far);
            }
            if (proxy && (inRange || proxy.wanted || proxy.failed || proxy.residency !== 'unloaded')) proxies.push({ state, proxy, inRange });
        }
        return { candidates: renamed ? [...this.cells_.values()] : candidates, proxies };
    }

    /**
     * Which cells a source is upon while they are not in: within `slowStreamingRatio` of the source's load radius
     * (distance to the cell over load radius). An urgent cell's work may take the budget's priority extra; under `wait` and `publish`
     * its publication is finished at once.
     */
    private judgeUrgency_(sources: readonly ResidencySource[], candidates: readonly CellState[], order: readonly string[]): void {
        const ratio = this.policy_.slowStreamingRatio;
        for (const state of candidates) {
            const name = state.registeredName;
            let urgent = false;
            if (state.desired && state.residency !== 'resident') {
                for (const source of sources) {
                    if (distanceToCell(state.cell, source.x, source.z) <= ratio * source.loadRadius) { urgent = true; break; }
                }
            }
            if (urgent !== state.urgent) {
                state.urgent = urgent;
                this.host_.urge?.(name, urgent);
                if (this.order_ !== order) return;
            }
            if (urgent && state.residency === 'publishing' && this.policy_.slowStreaming !== 'budget') {
                this.rush_(name);
                if (this.order_ !== order) return;
            }
        }
    }

    private rush_(name: string): void {
        if (!this.host_.rush) return;
        this.rushCount_++;
        this.host_.rush(name);
    }

    /** Under `wait`, the game is held while any urgent cell that can still arrive is not in. */
    private judgeHold_(candidates?: readonly CellState[]): void {
        let held = false;
        if (this.policy_.slowStreaming === 'wait' && !this.clearing_) {
            for (const state of candidates ?? this.cells_.values()) {
                if (state.urgent && !state.failed && state.residency !== 'resident') { held = true; break; }
            }
        }
        this.setHolding_(held);
    }

    /** A slot came free: the cells waiting for one are stepped again, in the order the last reconciliation wanted them. */
    private pump_(): void {
        if (this.clearing_) return;
        // Not a cell that has just failed: it is asked for again by the next reconciliation, as it always was, rather
        // than at once and for ever.
        const order = this.order_;
        for (const name of order) {
            if (!this.cells_.get(name)?.failed) this.step_(name);
            if (this.order_ !== order) return;
        }
        this.judgeHold_();
    }

    private setResidency_(state: CellState, next: CellResidency): void {
        const previous = state.residency;
        if (previous === 'preparing' || previous === 'publishing') this.occupiedSlots_[previous]--;
        state.residency = next;
        if (next === 'preparing' || next === 'publishing') this.occupiedSlots_[next]++;
    }


    private stepProxy_(proxy: ProxyState): void {
        if (proxy.residency === 'loading' || proxy.residency === 'unloading') return;
        if (proxy.wanted && (proxy.residency === 'unloaded' || proxy.residency === 'prepared') && !proxy.failed) {
            const prepare = proxy.residency === 'unloaded';
            proxy.residency = 'loading';
            this.run_(async (): Promise<'prepared' | 'resident'> => {
                if (prepare) await this.host_.prepare(proxy.scene);
                if (!proxy.wanted) return 'prepared';
                const ready = this.host_.readyRenderPrograms;
                if (ready) {
                    const outcome = await this.askReadiness_(proxy.scene, ready);
                    // A renderer that owes a stamp leaves the proxy prepared. A
                    // later reconciliation retries without fetching its assets again.
                    if (outcome.applicable && !outcome.stamp) return 'prepared';
                }
                if (!proxy.wanted) return 'prepared';
                await this.host_.loadAdditive(proxy.scene);
                return 'resident';
            },
                outcome => {
                    proxy.residency = outcome;
                    if (!proxy.wanted) this.stepProxy_(proxy);
                },
                (err) => {
                    proxy.failed = proxy.wanted;
                    log.error('residency', `far proxy "${proxy.scene}" did not load`, err);
                    this.discardProxy_(proxy);
                });
        } else if (!proxy.wanted && proxy.residency === 'prepared') {
            this.discardProxy_(proxy);
        } else if (!proxy.wanted && proxy.residency === 'resident') {
            proxy.residency = 'unloading';
            this.run_(() => this.host_.unload(proxy.scene, { keepPersistent: false }),
                () => { proxy.residency = 'unloaded'; this.stepProxy_(proxy); },
                (err) => {
                    proxy.residency = this.host_.isLoaded(proxy.scene) ? 'resident' : 'unloaded';
                    log.error('residency', `far proxy "${proxy.scene}" did not unload`, err);
                });
        }
    }

    private discardProxy_(proxy: ProxyState): void {
        proxy.residency = 'loading';
        try {
            this.cancelledRefs_ += this.host_.discardPrepared(proxy.scene);
        } finally {
            proxy.residency = 'unloaded';
        }
    }

    /** Drain every cell and preparation; registrations remain reusable by a later update. Cancels pending adoption. */
    clear(): Promise<void> {
        this.manifestRequest_++;
        return this.clearCells_();
    }

    private clearCells_(): Promise<void> {
        if (this.clearPromise_) return this.clearPromise_;
        this.clearing_ = true;
        this.order_ = [];
        this.sourceCount_ = 0;
        let resolveDrain!: (drain: Promise<void>) => void;
        const pending = new Promise<void>(resolve => { resolveDrain = resolve; });
        const clear = pending.finally(() => {
            this.clearing_ = false;
            this.clearPromise_ = null;
        });
        // Install the shared drain before any synchronous host notification.
        this.clearPromise_ = clear;
        resolveDrain(this.drainCells_());
        return clear;
    }

    private async drainCells_(): Promise<void> {
        this.setHolding_(false);
        for (const [name, state] of this.cells_) {
            state.desired = false;
            state.speculated = false;
            // Work spread over frames is finished here: a world being cleared may have no frames left to step it.
            // A preparation waiting for a frame's turn is let through too, or clearing would wait for frames that never come.
            if (state.residency === 'publishing' || state.residency === 'unloading' || state.residency === 'preparing') {
                this.host_.rush?.(name);
            }
        }
        for (const { proxy } of this.cells_.values()) {
            if (!proxy) continue;
            proxy.wanted = false;
            proxy.failed = false;
            if (proxy.residency === 'loading') this.host_.rush?.(proxy.scene);
            this.stepProxy_(proxy);
        }
        for (const name of this.cells_.keys()) this.step_(name);
        // Clearing can begin inside a synchronous host callback. Let that
        // transition finish and register any operation before checking the drain.
        await Promise.resolve();
        // Publication may finish by starting an unload, so drain the entire chain; a proxy still loading when the drain
        // began lands and unloads itself inside it.
        while (this.operations_.size > 0) await Promise.allSettled([...this.operations_]);
        const remaining = [...this.cells_].filter(([, state]) => state.residency !== 'unloaded').map(([name]) => name);
        for (const { proxy } of this.cells_.values()) if (proxy && proxy.residency !== 'unloaded') remaining.push(proxy.scene);
        if (remaining.length > 0) throw new Error(`World residency could not release: ${remaining.join(', ')}`);
    }

    /** Track host operations through their completion handlers so replacement cannot reuse a live scene name. */
    private run_<T>(action: () => Promise<T>, done: (value: T) => void, failed: (error: unknown) => void): void {
        let result: Promise<T>;
        try { result = Promise.resolve(action()); } catch (error) { result = Promise.reject(error); }
        const operation = result.then(done, failed);
        this.operations_.add(operation);
        void operation.then(
            () => { this.operations_.delete(operation); },
            error => {
                this.operations_.delete(operation);
                log.error('residency', 'cell completion failed', error);
            },
        );
    }

    status(): WorldStreamerStatus {
        const desiredCells: string[] = [];
        const prefetchCells: string[] = [];
        const residentCells: string[] = [];
        const preparedCells: string[] = [];
        const loadingCells: string[] = [];
        const unloadingCells: string[] = [];
        const proxyCells: string[] = [];
        for (const [name, state] of this.cells_) {
            if (state.proxy?.residency === 'resident') proxyCells.push(name);
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
            proxyCells,
            loadCount: this.loadCount_, unloadCount: this.unloadCount_,
            prepareCount: this.prepareCount_, cancelCount: this.cancelCount_,
            prefetchRequests: this.prefetchRequests_,
            cancelledRefs: this.cancelledRefs_,
            prefetchHits: this.prefetchHits_, prefetchMisses: this.prefetchMisses_,
            lastDemandToResidentMs: this.lastDemandToResident_,
            urgentCells: [...this.cells_].filter(([, state]) => state.urgent).map(([name]) => name),
            queuedCells: [...this.cells_].filter(([, state]) =>
                (state.residency === 'unloaded' && (state.desired || state.speculated))
                || (state.residency === 'prepared' && state.desired)).map(([name]) => name),
            holding: this.holding_,
            holdCount: this.holdCount_,
            holdMs: this.holdMs_ + (this.holding_ ? performance.now() - this.holdStarted_ : 0),
            rushCount: this.rushCount_,
            policy: { ...this.policy_ },
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
        if (state.readinessInFlight || state.discarding) return;
        if (state.residency === 'preparing') {
            // Assets are in and only the program obligation is left. Retried
            // here, because a claim refused once (a device that rebuilt mid-
            // readying) costs one more attempt rather than the whole preparation.
            if (state.assetsReady) {
                if (!state.desired && !state.speculated) this.discardPrepared_(name, state);
                else this.settleReadiness_(name, state);
            }
            return;
        }
        if (state.residency === 'publishing' || state.residency === 'unloading') return;
        if (state.residency === 'unloaded' && (state.desired || state.speculated)) {
            // Past the cap it waits its turn; a freed slot steps the cells in priority order (`pump_`). An urgent cell does
            // not wait: queued behind cells only prefetched, the one under a player was missing for seconds.
            if (!state.urgent && this.occupiedSlots_.preparing >= this.policy_.maxLoadingCells) return;
            this.beginPrepare_(name, state);
        } else if (state.residency === 'prepared' && state.desired) {
            // One cell made visible at a time; an urgent cell does not wait behind one that is not.
            if (!state.urgent && this.occupiedSlots_.publishing >= this.policy_.maxPublishingCells) return;
            this.publishWhenReady_(name, state);
        } else if (state.residency === 'prepared' && !state.speculated) {
            // Speculation is not authority. A cell nobody is near any more goes
            // back, receipts included, rather than being published because it
            // happens to be ready.
            this.discardPrepared_(name, state);
        } else if (state.residency === 'resident' && !state.desired) {
            // Held until its far proxy is in, so the place does not vanish for the frames the proxy takes to arrive.
            const proxy = state.proxy;
            if (proxy && proxy.wanted && !proxy.failed && proxy.residency !== 'resident' && !this.clearing_) return;
            this.beginUnload_(name, state);
        }
    }

    private discardPrepared_(name: string, state: CellState): void {
        const wasPreparing = state.residency === 'preparing';
        // A nested update may request this cell again while the host releases
        // its receipts. Keep it out of publication until the discard commits.
        state.discarding = true;
        try {
            this.cancelledRefs_ += this.host_.discardPrepared(name);
        } finally {
            state.discarding = false;
        }
        this.setResidency_(state, 'unloaded');
        state.assetsReady = false;
        state.renderReadiness = null;
        this.cancelCount_++;
        if (wasPreparing || state.desired || state.speculated) this.pump_();
    }

    private beginPrepare_(name: string, state: CellState): void {
        this.setResidency_(state, 'preparing');
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
        this.run_(() => this.host_.prepare(name),
            () => {
                // One obligation of two. `prepared` is not the end of the assets
                // arriving, it is the end of everything publication requires.
                state.assetsReady = true;
                this.step_(name);
            },
            (err) => {
                this.setResidency_(state, 'unloaded');
                state.assetsReady = false;
                state.failed = true;
                log.error('residency', `cell "${name}" did not prepare`, err);
                this.pump_();
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
        this.run_(() => this.askReadiness_(name, ready),
            (outcome) => {
                state.readinessInFlight = false;
                if (!state.desired && !state.speculated) { this.discardPrepared_(name, state); return; }
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
                if (!state.desired && !state.speculated) this.step_(name);
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
        // Timed around the CALL, not the settle: the readying is synchronous work
        // behind an async signature, so waiting on the promise measures how busy
        // the thread was afterwards — 6 ms of compile read as 52 on a busy arrival.
        const began = performance.now();
        try {
            return Promise.resolve(ready.call(this.host_, name));
        } catch (err) {
            return Promise.reject(err);
        } finally {
            this.recordPhase(name, 'readying', performance.now() - began);
        }
    }

    /** Every obligation is satisfied: only now is the cell prepared. */
    private markPrepared_(name: string, state: CellState): void {
        this.setResidency_(state, 'prepared');
        state.preparedAt = performance.now();
        state.prepareMs = state.preparedAt - state.issuedAt;
        // What finished was begun against a world that has moved. Whether this
        // cell is still wanted — or wanted now when it was not — is asked again
        // here rather than assumed from when it started.
        this.step_(name);
        this.pump_();
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
        this.run_(() => this.askReadiness_(name, ready),
            (outcome) => {
                state.readinessInFlight = false;
                if (!state.desired) { this.step_(name); return; }
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
                if (!state.desired) this.step_(name);
            },
        );
    }

    private beginLoad_(name: string, state: CellState): void {
        this.setResidency_(state, 'publishing');
        state.publishedAt = performance.now();
        this.loadCount_++;
        this.run_(() => {
            const loading = this.host_.loadAdditive(name);
            // Already upon it: not spread over frames at all. Said after the load began; a host whose job has not started
            // yet keeps the word for it.
            if (state.urgent && this.policy_.slowStreaming !== 'budget') this.rush_(name);
            return loading;
        },
            () => {
                const now = performance.now();
                this.setResidency_(state, 'resident');
                state.failed = false;
                // Said even when it was not urgent: it also forgets a rush that found no work spread over frames.
                state.urgent = false;
                this.host_.urge?.(name, false);
                this.residencyEpoch_++;
                state.delivery = now - state.issuedAt;
                state.publishMs = now - state.publishedAt;
                if (state.demandedAt > 0) {
                    state.demandToResidentMs = now - state.demandedAt;
                    this.lastDemandToResident_ = state.demandToResidentMs;
                }
                this.step_(name);
                this.pump_();
            },
            (err) => {
                // A cell that failed to come up owns nothing (the scene load is a
                // transaction), so it goes back to being absent and may be asked
                // for again rather than being stuck half-present.
                this.setResidency_(state, 'unloaded');
                state.failed = true;
                log.error('residency', `cell "${name}" did not load`, err);
                this.pump_();
            },
        );
    }

    private beginUnload_(name: string, state: CellState): void {
        this.setResidency_(state, 'unloading');
        this.unloadCount_++;
        // `keepPersistent: false` is the contract: a cell's unload takes everything
        // the cell brought. Scene persistence answers a different question, and
        // honouring it here leaves exactly what residency exists to remove.
        // Spread over frames, hidden at once (`retire`), unless the world is being cleared and may have no frames left.
        this.run_(() => this.host_.unload(name, { keepPersistent: false, staggered: !this.clearing_ }),
            () => {
                this.setResidency_(state, 'unloaded');
                this.residencyEpoch_++;
                // A rush said while it left (the world cleared) is not carried to its next arrival.
                this.host_.urge?.(name, false);
                this.step_(name);
            },
            (err) => {
                this.setResidency_(state, this.host_.isLoaded(name) ? 'resident' : 'unloaded');
                this.residencyEpoch_++;
                log.error('residency', `cell "${name}" did not unload`, err);
            },
        );
    }
}

/** The world's residency authority. @experimental */
export const WorldStreaming = defineResource<WorldStreamer>(null!, 'WorldStreaming');

export interface WorldResidencyView {
    readonly manifest: WorldManifest | null;
    readonly residencyEpoch: number;
    residencyOf(name: string): CellResidency;
}

export function worldResidencyView(app: App): WorldResidencyView | null {
    return app.hasResource(WorldStreaming) ? app.getResource(WorldStreaming) : null;
}
