// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity, Vec3 } from '../types';
import type { Assets } from '../asset/Assets';
import type { AssetLease } from '../asset/AssetLease';
import type { AudioResult } from '../asset/AssetLoader';
import { defineResource } from '../ecs/resource';
import { disposeAll } from '../util/disposeAll';
import type { AudioAPI } from './Audio';
import type { AudioHandle } from './PlatformAudioBackend';
import { parseSoundEvent, SoundEventSelector, type SoundEventAsset, type SoundEventSelection, type SoundEventVariantShare } from './SoundEvent';
import { calculateAttenuation, calculatePanning, spatialDistance } from './SpatialAudio';

/** Lifecycle of one admitted or rejected event trigger. @beta */
export type SoundEventStatus = 'loading' | 'playing' | 'paused' | 'ended' | 'stopped' | 'rejected';
/** Event gates run before clip loading; global admission runs through Audio. @beta */
export type SoundEventRejection = 'disposed' | 'owner-gone' | 'cooldown' | 'event-limit'
    | 'empty' | 'zero-weight' | 'missing-position' | 'load-failed' | 'global-limit' | 'backend-refused';
/** A trigger's controls remain valid while its selected clip loads. @beta */
export interface SoundEventHandle extends AudioHandle {
    readonly status: SoundEventStatus;
    readonly reason: SoundEventRejection | null;
    readonly error: string | null;
    readonly selection: Readonly<SoundEventSelection> | null;
    /** Initial loading resolves to its resulting status, including early cancellation. */
    readonly ready: Promise<SoundEventStatus>;
}
/** One owned definition and deterministic choice stream. Dispose to release its voices and definition. @beta */
export interface SoundEventEmitter {
    readonly ref: string;
    readonly disposed: boolean;
    /** Probabilities for the next admitted trigger, in authored slot order. */
    getVariantShares(): SoundEventVariantShare[];
    /** Spatial events need an explicit world position or a live owner transform. */
    trigger(position?: Vec3): SoundEventHandle;
    dispose(): void;
}
/** Resource and admission counters, without retaining trigger history. @beta */
export interface SoundEventStats {
    definitions: number;
    emitters: number;
    pendingDefinitions: number;
    pendingClips: number;
    active: number;
    admitted: number;
    played: number;
    ended: number;
    stopped: number;
    rejected: number;
    reasons: Partial<Record<SoundEventRejection, number>>;
}

type Resources = Pick<Assets, 'acquireTyped'> & Partial<Pick<Assets, 'sourceIdentity'>>;
interface SharedEvent { key: string; references: number; nextAllowed: number; active: Set<Request>; running: Set<Request> }
interface Emitter {
    ref: string; owner?: Entity; disposed: boolean; shared: SharedEvent; asset: SoundEventAsset;
    selector: SoundEventSelector; lease: AssetLease<SoundEventAsset>; resources: Resources; requests: Set<Request>;
    alive?: () => boolean;
}
interface Request {
    emitter: Emitter; generation: number; status: SoundEventStatus; reason: SoundEventRejection | null; error: string | null;
    selection: Readonly<SoundEventSelection> | null; native?: AudioHandle; lease?: AssetLease<AudioResult>;
    paused: boolean; loop: boolean; volume: number; rate: number; pan: number; position?: Vec3;
    lastVolume?: number; lastPan?: number;
    resolve(status: SoundEventStatus): void; onEnd?: () => void;
}
interface PendingDefinition { owner?: Entity; cancelled: boolean }

/** Per-App event ownership layered on Assets leases and Audio's existing voice pool.
 * Emitters of one canonical definition share admission across asset generations.
 * Cooldown starts on admission, including later load/global-pool failures; stopping does not reset it.
 * @beta */
export class SoundEventPlayback {
    private readonly events = new Map<string, SharedEvent>();
    private readonly emitters = new Set<Emitter>();
    private readonly pending = new Set<PendingDefinition>();
    private readonly owners = new Map<Entity, Set<Emitter>>();
    private readonly ownerLoads = new Map<Entity, Set<PendingDefinition>>();
    private readonly reasons: Partial<Record<SoundEventRejection, number>> = {};
    private readonly offStop: () => void;
    private clock = 0;
    private disposed = false;
    private admitted = 0;
    private played = 0;
    private ended = 0;
    private stopped = 0;
    private rejected = 0;
    private listener: Vec3 = { x: 0, y: 0, z: 0 };
    private right: Vec3 = { x: 1, y: 0, z: 0 };

    constructor(private readonly audio: AudioAPI, private readonly resources: () => Resources | null,
        private readonly ownerAlive: (owner: Entity) => boolean = () => true,
        private readonly ownerPosition: (owner: Entity) => Vec3 | null = () => null) {
        this.offStop = audio.onPlaybackStop(generation => {
            const requests = [...this.events.values()].flatMap(event => [...event.active]).filter(request => request.generation < generation);
            disposeAll(requests, request => this.finish(request, 'stopped', false));
        });
    }

    /** Loading a definition is preparation, not a play intent; Audio.stopAll does not unload emitters.
     * `alive` is a pure lifetime predicate checked after asynchronous loads and on updates/triggers. */
    async load(ref: string, options: { owner?: Entity; seed?: number; alive?: () => boolean } = {}): Promise<SoundEventEmitter | null> {
        if (this.disposed || options.alive?.() === false || (options.owner !== undefined && !this.ownerAlive(options.owner))) return null;
        const resources = this.resources();
        if (!resources) throw new Error(`${ref}: no Assets resource for sound events`);
        const pending: PendingDefinition = { owner: options.owner, cancelled: false };
        this.pending.add(pending);
        if (pending.owner !== undefined) this.addOwner(this.ownerLoads, pending.owner, pending);
        let lease: AssetLease<SoundEventAsset> | undefined;
        try {
            lease = await resources.acquireTyped<SoundEventAsset>('sound-event', ref);
            if (this.disposed || pending.cancelled || options.alive?.() === false || resources !== this.resources()
                || (pending.owner !== undefined && !this.ownerAlive(pending.owner))) { lease.release(); return null; }
            const asset = parseSoundEvent(lease.value);
            const selector = new SoundEventSelector(asset, options.seed ?? (Math.random() * 4294967296) >>> 0,
                ref => resources.sourceIdentity?.(ref) ?? null);
            let shared = this.events.get(lease.key);
            if (!shared) { shared = { key: lease.key, references: 0, nextAllowed: 0, active: new Set(), running: new Set() }; this.events.set(lease.key, shared); }
            const emitter: Emitter = { ref, owner: options.owner, alive: options.alive, disposed: false, shared, asset, selector, lease, resources, requests: new Set() };
            shared.references++; this.emitters.add(emitter);
            if (emitter.owner !== undefined) this.addOwner(this.owners, emitter.owner, emitter);
            return { ref, get disposed() { return emitter.disposed; }, getVariantShares: () => selector.getVariantShares(),
                trigger: position => this.trigger(emitter, position),
                dispose: () => this.releaseEmitter(emitter) };
        } catch (error) {
            lease?.release();
            if (this.disposed || pending.cancelled || options.alive?.() === false || resources !== this.resources()
                || (pending.owner !== undefined && !this.ownerAlive(pending.owner))) return null;
            throw error;
        } finally {
            this.pending.delete(pending);
            if (pending.owner !== undefined) this.removeOwner(this.ownerLoads, pending.owner, pending);
        }
    }

    /** Advance on simulation time; paused requests retain event and global voice ownership. */
    update(delta: number, listener?: Vec3, right?: Vec3): void {
        if (this.disposed) return;
        if (Number.isFinite(delta) && delta > 0) this.clock += delta;
        if (listener) this.listener = { ...listener };
        if (right) this.right = { ...right };
        for (const emitter of [...this.emitters]) {
            if (emitter.resources !== this.resources()) { this.releaseEmitter(emitter); continue; }
            if (!this.alive(emitter)) { this.releaseEmitter(emitter); continue; }
            for (const request of [...emitter.requests]) { this.refresh(request); this.applySpatial(request); }
        }
    }

    stopOwner(owner: Entity): void {
        for (const pending of this.ownerLoads.get(owner) ?? []) pending.cancelled = true;
        disposeAll([...(this.owners.get(owner) ?? [])], emitter => this.releaseEmitter(emitter));
    }

    /** @internal A registry switch cannot transfer an old entity owner's emitters to reused IDs. */
    resetOwners(): void {
        const owners = new Set([...this.ownerLoads.keys(), ...this.owners.keys()]);
        disposeAll([...owners], owner => this.stopOwner(owner));
    }

    stopAll(): void {
        const active = [...this.events.values()].flatMap(event => [...event.active]);
        disposeAll(active, request => this.finish(request, 'stopped', true));
    }

    getStats(): SoundEventStats {
        let pendingClips = 0, active = 0;
        for (const event of this.events.values()) for (const request of [...event.active]) {
            this.refresh(request);
            if (this.live(request)) { active++; if (!request.native) pendingClips++; }
        }
        return { definitions: this.events.size, emitters: this.emitters.size, pendingDefinitions: this.pending.size,
            pendingClips, active, admitted: this.admitted, played: this.played, ended: this.ended, stopped: this.stopped,
            rejected: this.rejected, reasons: { ...this.reasons } };
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.offStop();
        for (const pending of this.pending) pending.cancelled = true;
        this.pending.clear(); this.ownerLoads.clear();
        disposeAll([...this.emitters], emitter => this.releaseEmitter(emitter));
    }

    private addOwner<T>(map: Map<Entity, Set<T>>, owner: Entity, value: T): void {
        let entries = map.get(owner); if (!entries) { entries = new Set(); map.set(owner, entries); } entries.add(value);
    }
    private removeOwner<T>(map: Map<Entity, Set<T>>, owner: Entity, value: T): void {
        const entries = map.get(owner); entries?.delete(value); if (!entries?.size) map.delete(owner);
    }
    private live(request: Request): boolean { return request.status === 'loading' || request.status === 'playing' || request.status === 'paused'; }
    private refresh(request: Request): void {
        if (!this.live(request) || !request.native) return;
        const state = this.audio.getVoiceState(request.native);
        if (state === 'stopped' || state === 'untracked') this.finish(request, 'stopped', false);
        else if (state === 'ended') this.end(request);
        else request.status = state;
    }
    private end(request: Request): void {
        if (!this.live(request)) return;
        const callback = request.onEnd;
        try { this.finish(request, 'ended', false); } finally { callback?.(); }
    }
    private finish(request: Request, status: SoundEventStatus, stop: boolean): void {
        if (!this.live(request)) return;
        request.status = status; request.resolve(status);
        if (status === 'ended') this.ended++; else if (status === 'stopped') this.stopped++;
        request.emitter.requests.delete(request); request.emitter.shared.active.delete(request);
        request.emitter.shared.running.delete(request);
        const native = request.native, lease = request.lease; request.lease = undefined;
        disposeAll([() => { if (native) native.onEnd = undefined; }, () => { if (stop) native?.stop(); }, () => lease?.release()], action => action());
    }
    private reject(request: Request, reason: SoundEventRejection, error?: string): void {
        request.reason = reason; request.error = error ?? null; this.rejected++;
        this.reasons[reason] = (this.reasons[reason] ?? 0) + 1;
        this.finish(request, 'rejected', !!request.native);
    }
    private releaseEmitter(emitter: Emitter): void {
        if (emitter.disposed) return;
        emitter.disposed = true; this.emitters.delete(emitter);
        if (emitter.owner !== undefined) this.removeOwner(this.owners, emitter.owner, emitter);
        try { disposeAll([...emitter.requests], request => this.finish(request, 'stopped', true)); }
        finally {
            if (--emitter.shared.references === 0) this.events.delete(emitter.shared.key);
            emitter.lease.release();
        }
    }

    private trigger(emitter: Emitter, position?: Vec3): SoundEventHandle {
        if (!emitter.disposed && emitter.resources !== this.resources()) this.releaseEmitter(emitter);
        let resolve!: (status: SoundEventStatus) => void;
        const ready = new Promise<SoundEventStatus>(done => { resolve = done; });
        const request: Request = { emitter, generation: this.audio.playbackGeneration, status: 'loading', reason: null, error: null,
            selection: null, paused: false, loop: false, volume: 1, rate: 1, pan: 0, position: position ? { ...position } : undefined, resolve };
        const handle: SoundEventHandle = {
            ready, get id() { return request.native?.id ?? -1; },
            get status() { refresh(); return request.status; }, get reason() { return request.reason; }, get error() { return request.error; },
            get selection() { return request.selection; }, get isPlaying() { refresh(); return request.status === 'playing'; },
            get duration() { return request.native?.duration ?? 0; }, get currentTime() { return request.native?.currentTime ?? 0; },
            stop: () => this.finish(request, 'stopped', true),
            pause: () => {
                refresh();
                if (this.live(request)) {
                    request.paused = true;
                    request.native?.pause();
                    refresh();
                }
            },
            resume: () => {
                refresh();
                if (this.live(request)) {
                    request.paused = false;
                    request.native?.resume();
                    refresh();
                }
            },
            setVolume: volume => {
                if (this.live(request)) {
                    request.volume = volume;
                    this.applySpatial(request);
                }
            },
            setPan: pan => {
                if (this.live(request)) {
                    request.pan = pan;
                    this.applySpatial(request);
                }
            },
            setLoop: loop => {
                if (this.live(request)) {
                    request.loop = loop;
                    request.native?.setLoop(loop);
                }
            },
            setPlaybackRate: rate => {
                if (this.live(request)) {
                    request.rate = rate;
                    request.native?.setPlaybackRate(rate);
                }
            },
            get onEnd() { return request.onEnd; }, set onEnd(callback) { request.onEnd = callback; },
        };
        const refresh = () => this.refresh(request);
        if (this.disposed || emitter.disposed || emitter.resources !== this.resources()) this.reject(request, 'disposed');
        else if (!this.alive(emitter)) this.reject(request, 'owner-gone');
        else if (emitter.asset.spatial && !this.position(request)) this.reject(request, 'missing-position');
        else {
            // Pending requests already own counted slots; only started voices can have retired externally.
            for (const existing of [...emitter.shared.running]) this.refresh(existing);
            if (this.clock < emitter.shared.nextAllowed) this.reject(request, 'cooldown');
            else if (emitter.asset.maxInstances > 0 && emitter.shared.active.size >= emitter.asset.maxInstances) this.reject(request, 'event-limit');
            else {
                const result = emitter.selector.next();
                if (!result.selection) this.reject(request, result.reason);
                else {
                    request.selection = Object.freeze(result.selection); request.volume = result.selection.volume; request.rate = result.selection.playbackRate;
                    emitter.shared.nextAllowed = this.clock + emitter.asset.cooldown;
                    emitter.requests.add(request); emitter.shared.active.add(request); this.admitted++;
                    void this.start(request);
                }
            }
        }
        return handle;
    }

    private alive(emitter: Emitter): boolean {
        return emitter.alive?.() !== false && (emitter.owner === undefined || this.ownerAlive(emitter.owner));
    }

    private position(request: Request): Vec3 | null {
        const position = request.position ?? (request.emitter.owner !== undefined ? this.ownerPosition(request.emitter.owner) : null);
        return position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z) ? position : null;
    }
    private applySpatial(request: Request): void {
        if (!request.native || !this.live(request)) return;
        const spatial = request.emitter.asset.spatial, position = this.position(request);
        if (spatial && !position) { this.reject(request, 'missing-position'); return; }
        const volume = request.volume * (spatial && position ? calculateAttenuation(spatialDistance(position, this.listener), spatial) : 1);
        if (volume !== request.lastVolume) { request.native.setVolume(volume); request.lastVolume = volume; }
        const pan = Math.max(-1, Math.min(1, request.pan + (spatial && position ? calculatePanning(position, this.listener, this.right, spatial.maxDistance) : 0)));
        if (pan !== request.lastPan && (pan !== 0 || request.lastPan !== undefined || spatial)) {
            request.native.setPan(pan); request.lastPan = pan;
        }
    }
    private async start(request: Request): Promise<void> {
        const { emitter, selection } = request;
        try {
            const lease = await emitter.resources.acquireTyped<AudioResult>('audio', selection!.clip);
            if (!this.live(request)) { lease.release(); return; }
            request.lease = lease;
            if (this.disposed || emitter.disposed || emitter.resources !== this.resources()) { this.finish(request, 'stopped', false); return; }
            if (!this.alive(emitter)) { this.reject(request, 'owner-gone'); return; }
            if (emitter.asset.spatial && !this.position(request)) { this.reject(request, 'missing-position'); return; }
            const buffer = this.audio.getBufferHandle(lease.value.bufferId);
            if (!buffer) throw new Error('selected audio buffer is unavailable');
            const native = this.audio.playBuffer(buffer, { bus: emitter.asset.bus, priority: emitter.asset.priority,
                volume: 0, playbackRate: request.rate, loop: request.loop });
            if (!this.live(request)) { native.stop(); return; }
            request.native = native;
            const state = this.audio.getVoiceState(native);
            if (state === 'untracked') { this.reject(request, 'global-limit'); return; }
            if (state === 'ended' || state === 'stopped') { this.reject(request, 'backend-refused'); return; }
            emitter.shared.running.add(request);
            for (const existing of [...emitter.shared.running]) this.refresh(existing);
            if (!this.live(request)) return;
            this.played++;
            native.onEnd = () => this.end(request);
            if (request.paused) native.pause();
            request.status = this.audio.getVoiceState(native) === 'paused' ? 'paused' : 'playing';
            this.applySpatial(request); request.resolve(request.status);
        } catch (error) {
            if (this.live(request)) this.reject(request, 'load-failed', `${emitter.ref}: clips[${selection!.slot}].clip (${selection!.clip}): ${String(error)}`);
        }
    }
}

/** Per-App sound event loading, emitters and admission controls. @beta */
export const SoundEvents = defineResource<SoundEventPlayback>(null!, 'SoundEvents');
