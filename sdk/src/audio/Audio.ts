import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle } from './PlatformAudioBackend';
import type { AudioMixer } from './AudioMixer';
import { defineResource } from '../resource';
import { log } from '../logger';

/**
 * Per-app audio API. Each `App` owns an `AudioAPI` instance (created by
 * `AudioPlugin.build()`), exposed via the `Audio` resource.
 *
 * Consumed as a resource: declare `Res(Audio)` as a system param or
 * grab it with `app.getResource(Audio)` outside ECS code.
 */
export class AudioAPI {
    private readonly backend_: PlatformAudioBackend;
    private readonly mixer_: AudioMixer | null;
    private readonly bufferCache_ = new Map<string, AudioBufferHandle>();
    private bgmHandle_: AudioHandle | null = null;
    private bgmVolume_ = 1.0;
    private readonly fadeAnimIds_ = new Set<number>();
    private disposed_ = false;
    private assetResolver_: ((url: string) => ArrayBuffer | null) | null = null;
    baseUrl = '';

    constructor(backend: PlatformAudioBackend, mixer: AudioMixer | null = null) {
        this.backend_ = backend;
        this.mixer_ = mixer;
    }

    setAssetResolver(resolver: (url: string) => ArrayBuffer | null): void {
        this.assetResolver_ = resolver;
    }

    private resolveUrl_(url: string): string {
        if (!this.baseUrl || url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        return `${this.baseUrl}/${url}`;
    }

    async preload(url: string): Promise<void> {
        if (this.bufferCache_.has(url)) return;
        if (this.assetResolver_) {
            const data = this.assetResolver_(url);
            if (data) {
                return this.preloadFromData(url, data);
            }
        }
        const buffer = await this.backend_.loadBuffer(this.resolveUrl_(url));
        this.bufferCache_.set(url, buffer);
    }

    async preloadAll(urls: string[]): Promise<void> {
        await Promise.all(urls.map(url => this.preload(url)));
    }

    async preloadFromData(url: string, data: ArrayBuffer): Promise<void> {
        if (this.bufferCache_.has(url)) return;
        const buffer = await this.backend_.loadBufferFromData(url, data);
        this.bufferCache_.set(url, buffer);
    }

    playSFX(url: string, config?: {
        volume?: number;
        pitch?: number;
        pan?: number;
        priority?: number;
    }): AudioHandle {
        const playConfig = {
            bus: 'sfx',
            volume: config?.volume,
            playbackRate: config?.pitch,
            pan: config?.pan,
            priority: config?.priority ?? 0,
        };
        const buffer = this.bufferCache_.get(url);
        if (!buffer) {
            const pending = this.createDeferredHandle_();
            this.preload(url).then(() => {
                if (this.disposed_) return;
                const buf = this.bufferCache_.get(url);
                if (buf) {
                    pending.resolve(this.backend_.play(buf, playConfig));
                }
            }).catch(err => {
                log.warn('audio', `Failed to preload audio: ${url}`, err);
            });
            return pending;
        }
        return this.backend_.play(buffer, playConfig);
    }

    playBGM(url: string, config?: {
        volume?: number;
        fadeIn?: number;
        crossFade?: number;
    }): void {
        const play = (buffer: AudioBufferHandle) => {
            for (const id of this.fadeAnimIds_) {
                cancelAnimationFrame(id);
            }
            this.fadeAnimIds_.clear();

            const targetVolume = config?.volume ?? 1.0;
            const oldVolume = this.bgmVolume_;
            this.bgmVolume_ = targetVolume;

            if (this.bgmHandle_ && config?.crossFade) {
                this.fadeOut_(this.bgmHandle_, config.crossFade, oldVolume);
            } else if (this.bgmHandle_) {
                this.bgmHandle_.stop();
            }
            const fadeInDuration = config?.fadeIn ?? config?.crossFade;

            this.bgmHandle_ = this.backend_.play(buffer, {
                bus: 'music',
                volume: fadeInDuration ? 0 : targetVolume,
                loop: true,
            });

            if (fadeInDuration) {
                this.fadeIn_(this.bgmHandle_, fadeInDuration, targetVolume);
            }
        };

        const buffer = this.bufferCache_.get(url);
        if (buffer) {
            play(buffer);
        } else {
            this.preload(url).then(() => {
                if (this.disposed_) return;
                const buf = this.bufferCache_.get(url);
                if (buf) {
                    play(buf);
                }
            }).catch(err => {
                log.warn('audio', `Failed to preload BGM: ${url}`, err);
            });
        }
    }

    stopAll(): void {
        for (const id of this.fadeAnimIds_) {
            cancelAnimationFrame(id);
        }
        this.fadeAnimIds_.clear();
        if (this.bgmHandle_) {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
    }

    stopBGM(fadeOut?: number): void {
        if (!this.bgmHandle_) return;
        for (const id of this.fadeAnimIds_) {
            cancelAnimationFrame(id);
        }
        this.fadeAnimIds_.clear();
        if (fadeOut && fadeOut > 0) {
            const handle = this.bgmHandle_;
            this.bgmHandle_ = null;
            this.fadeOut_(handle, fadeOut, this.bgmVolume_);
        } else {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
    }

    setMasterVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.master.volume = volume;
        }
    }

    setMusicVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.music.volume = volume;
        }
    }

    setSFXVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.sfx.volume = volume;
        }
    }

    setUIVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.ui.volume = volume;
        }
    }

    muteBus(busName: string, muted: boolean): void {
        const bus = this.mixer_?.getBus(busName);
        if (bus) {
            bus.muted = muted;
        }
    }

    getBufferHandle(url: string): AudioBufferHandle | undefined {
        return this.bufferCache_.get(url);
    }

    dispose(): void {
        this.disposed_ = true;
        for (const id of this.fadeAnimIds_) {
            cancelAnimationFrame(id);
        }
        this.fadeAnimIds_.clear();
        if (this.bgmHandle_) {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
        for (const handle of this.bufferCache_.values()) {
            this.backend_?.unloadBuffer(handle);
        }
        this.bufferCache_.clear();
        this.backend_?.dispose();
    }

    private fadeIn_(handle: AudioHandle, duration: number, targetVolume: number): void {
        handle.setVolume(0);
        const startTime = performance.now();
        let animId = 0;
        const tick = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            handle.setVolume(t * targetVolume);
            if (t < 1 && handle.isPlaying) {
                animId = requestAnimationFrame(tick);
                this.fadeAnimIds_.add(animId);
            } else {
                this.fadeAnimIds_.delete(animId);
            }
        };
        animId = requestAnimationFrame(tick);
        this.fadeAnimIds_.add(animId);
    }

    private fadeOut_(handle: AudioHandle, duration: number, startVolume: number): void {
        const startTime = performance.now();
        let animId = 0;
        const tick = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            handle.setVolume(startVolume * (1 - t));
            if (t < 1 && handle.isPlaying) {
                animId = requestAnimationFrame(tick);
                this.fadeAnimIds_.add(animId);
            } else {
                handle.stop();
                this.fadeAnimIds_.delete(animId);
            }
        };
        animId = requestAnimationFrame(tick);
        this.fadeAnimIds_.add(animId);
    }

    private createDeferredHandle_(): AudioHandle & { resolve(real: AudioHandle): void } {
        let real: AudioHandle | null = null;
        const handle: AudioHandle & { resolve(r: AudioHandle): void } = {
            id: -1,
            stop() { real?.stop(); },
            pause() { real?.pause(); },
            resume() { real?.resume(); },
            setVolume(v: number) { real?.setVolume(v); },
            setPan(p: number) { real?.setPan(p); },
            setLoop(l: boolean) { real?.setLoop(l); },
            setPlaybackRate(r: number) { real?.setPlaybackRate(r); },
            get isPlaying() { return real?.isPlaying ?? false; },
            get currentTime() { return real?.currentTime ?? 0; },
            get duration() { return real?.duration ?? 0; },
            resolve(r: AudioHandle) { real = r; },
        };
        return handle;
    }
}

/** Resource handle for the per-app audio API. */
export const Audio = defineResource<AudioAPI>(null!, 'Audio');
