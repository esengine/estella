// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Per-app video service — the imperative face of the video system, exposed as
// the VideoPlayer resource.
import type { ESEngineModule } from '../wasm';
import type { PlatformVideoBackend, VideoStreamHandle, VideoStreamOptions } from './PlatformVideoBackend';
import { defineResource } from '../ecs/resource';
import { log } from '../util/logger';
import { probeRefs } from '../asset/AddressableManifest';
import { getPlatform, isPlatformInitialized } from '../platform/base';

export type VideoHandle = VideoStreamHandle;
export type VideoPlayOptions = VideoStreamOptions;

export class VideoAPI {
    private readonly backend_: PlatformVideoBackend;
    private readonly handles_ = new Set<VideoStreamHandle>();
    private refResolver_: ((ref: string) => string) | null = null;
    private disposed_ = false;
    private hostMuted_ = false;
    private readonly muteTargets_ = new Map<VideoStreamHandle, () => void>();
    private readonly offHostMute_: () => void;
    private readonly hasHostMute_: boolean;
    private executionHeld_ = false;
    private readonly playbackTargets_ = new Map<VideoStreamHandle, (held: boolean) => void>();
    private readonly offExecution_: () => void;
    private readonly hasExecutionPolicy_: boolean;
    baseUrl = '';

    constructor(backend: PlatformVideoBackend, observeExecution?: (callback: (held: boolean) => void) => () => void) {
        this.backend_ = backend;
        const subscribe = isPlatformInitialized() ? getPlatform().onAudioMute : undefined;
        this.hasHostMute_ = subscribe !== undefined;
        this.offHostMute_ = subscribe?.call(getPlatform(), muted => {
            this.hostMuted_ = muted;
            for (const apply of this.muteTargets_.values()) apply();
        }) ?? (() => {});
        this.hasExecutionPolicy_ = observeExecution !== undefined;
        this.offExecution_ = observeExecution?.(held => {
            if (held === this.executionHeld_) return;
            this.executionHeld_ = held;
            for (const [handle, apply] of this.playbackTargets_) {
                try { apply(held); } catch (error) {
                    log.error('video', 'Execution policy failed for a stream', error);
                    try { this.stop(handle); } catch { /* broken stream does not block other streams */ }
                }
            }
        }) ?? (() => {});
    }

    get backendName(): string { return this.backend_.name; }

    setRefResolver(resolver: ((ref: string) => string) | null): void {
        this.refResolver_ = resolver;
    }

    private resolveUrl_(ref: string): string {
        if (this.refResolver_) return this.refResolver_(ref);
        if (!this.baseUrl || ref.includes('://') || ref.startsWith('/') || ref.startsWith('blob:') || ref.startsWith('data:')) {
            return ref;
        }
        return `${this.baseUrl}/${ref}`;
    }

    play(source: string, options: VideoPlayOptions = {}): VideoStreamHandle {
        let userMuted = options.muted ?? false;
        let userPlaying = options.autoplay ?? true;
        const stream = this.backend_.createStream(this.resolveUrl_(source), {
            ...options,
            ...(this.hasHostMute_ ? { muted: userMuted || this.hostMuted_ } : {}),
            ...(this.executionHeld_ ? { autoplay: false } : {}),
            audioTrackUrl: options.audioTrackUrl ?? this.resolveAudioTrack_(source),
        });
        let handle = stream;
        if (this.hasHostMute_ || this.hasExecutionPolicy_) {
            const setMuted = stream.setMuted.bind(stream);
            const play = stream.play.bind(stream), pause = stream.pause.bind(stream), stop = stream.stop.bind(stream);
            const methods = new Set(['play', 'pause', 'stop', 'seek', 'setVolume', 'setLoop', 'setPlaybackRate', 'pump']);
            const bindings = new Map<PropertyKey, { original: unknown; bound: unknown }>();
            const overrideMuted = (muted: boolean) => { userMuted = muted; setMuted(userMuted || this.hostMuted_); };
            const overridePlay = () => { userPlaying = true; if (!this.executionHeld_) play(); };
            const overridePause = () => { userPlaying = false; pause(); };
            const overrideStop = () => { userPlaying = false; stop(); };
            const ownsExecution = this.hasExecutionPolicy_;
            handle = new Proxy(stream, {
                get(target, key) {
                    if (key === 'setMuted') return overrideMuted;
                    if (ownsExecution && key === 'play') return overridePlay;
                    if (ownsExecution && key === 'pause') return overridePause;
                    if (ownsExecution && key === 'stop') return overrideStop;
                    const value = Reflect.get(target, key, target);
                    if (typeof key === 'string' && methods.has(key) && typeof value === 'function') {
                        let entry = bindings.get(key);
                        if (!entry || entry.original !== value) { entry = { original: value, bound: value.bind(target) }; bindings.set(key, entry); }
                        return entry.bound;
                    }
                    return value;
                },
                set(target, key, value) { return Reflect.set(target, key, value, target); },
            });
            this.muteTargets_.set(handle, () => setMuted(userMuted || this.hostMuted_));
            if (this.hasExecutionPolicy_) this.playbackTargets_.set(handle, held => {
                if (held) {
                    // A completed or already-paused stream must not restart on release.
                    if (stream.isReady && !stream.isPlaying) userPlaying = false;
                    pause();
                } else if (userPlaying) play();
            });
        }
        this.handles_.add(handle);
        return handle;
    }

    /**
     * Resolve the cook-demuxed audio-track sibling through the realm's ref
     * resolver: the cook registers it as `<source path>.m4a` (path refs) or
     * `<uuid>-audio` (uuid refs). A resolver miss returns the ref unchanged —
     * treated as "no cooked sibling" so backends fall back to URL derivation.
     */
    private resolveAudioTrack_(source: string): string | undefined {
        if (!this.refResolver_) return undefined;
        const siblingRef = source.startsWith('@uuid:') ? `${source}-audio` : `${source}.m4a`;
        // A question, not a reference: most targets have no cooked sibling.
        const resolver = this.refResolver_;
        const resolved = probeRefs(() => resolver(siblingRef));
        return resolved !== siblingRef ? resolved : undefined;
    }

    update(module: ESEngineModule | null): void {
        if (this.disposed_) return;
        for (const handle of this.handles_) {
            // One stream's decode failure (wasm abort, detached heap) must not
            // stall every other video this tick.
            try {
                handle.pump(module);
            } catch (err) {
                log.error('video', `pump failed for stream #${handle.id} — stopping it`, err);
                this.handles_.delete(handle);
                this.muteTargets_.delete(handle);
                this.playbackTargets_.delete(handle);
                try { handle.stop(); } catch { /* already broken */ }
                handle.onError?.(err);
            }
        }
    }

    stop(handle: VideoStreamHandle): void {
        this.muteTargets_.delete(handle);
        this.playbackTargets_.delete(handle);
        if (this.handles_.delete(handle)) handle.stop();
    }

    stopAll(): void {
        for (const handle of this.handles_) handle.stop();
        this.handles_.clear();
        this.muteTargets_.clear();
        this.playbackTargets_.clear();
    }

    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        this.offHostMute_();
        this.offExecution_();
        this.stopAll();
        this.backend_.dispose();
    }
}

export const VideoPlayer = defineResource<VideoAPI>(null!, 'VideoPlayer');
