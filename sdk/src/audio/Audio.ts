import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle } from './PlatformAudioBackend';
import type { AudioMixer } from './AudioMixer';

export class Audio {
    private static backend_: PlatformAudioBackend;
    private static mixer_: AudioMixer | null = null;
    private static bufferCache_ = new Map<string, AudioBufferHandle>();
    private static bgmHandle_: AudioHandle | null = null;
    private static bgmVolume_ = 1.0;
    private static fadeAnimId_ = 0;
    private static disposed_ = false;
    private static assetResolver_: ((url: string) => ArrayBuffer | null) | null = null;
    static baseUrl = '';

    static init(backend: PlatformAudioBackend, mixer: AudioMixer | null = null): void {
        this.backend_ = backend;
        this.mixer_ = mixer;
        this.bufferCache_.clear();
        this.bgmHandle_ = null;
        this.bgmVolume_ = 1.0;
        this.disposed_ = false;
        if (this.fadeAnimId_) {
            cancelAnimationFrame(this.fadeAnimId_);
            this.fadeAnimId_ = 0;
        }
    }

    static setAssetResolver(resolver: (url: string) => ArrayBuffer | null): void {
        this.assetResolver_ = resolver;
    }

    private static resolveUrl_(url: string): string {
        if (!this.baseUrl || url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        return `${this.baseUrl}/${url}`;
    }

    static async preload(url: string): Promise<void> {
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

    static async preloadAll(urls: string[]): Promise<void> {
        await Promise.all(urls.map(url => this.preload(url)));
    }

    static async preloadFromData(url: string, data: ArrayBuffer): Promise<void> {
        if (this.bufferCache_.has(url)) return;
        const buffer = await this.backend_.loadBufferFromData(url, data);
        this.bufferCache_.set(url, buffer);
    }

    static playSFX(url: string, config?: {
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
            const pending = this.createDeferredHandle();
            this.preload(url).then(() => {
                if (this.disposed_) return;
                const buf = this.bufferCache_.get(url);
                if (buf) {
                    pending.resolve(this.backend_.play(buf, playConfig));
                }
            }).catch(err => {
                console.warn(`Failed to preload audio: ${url}`, err);
            });
            return pending;
        }
        return this.backend_.play(buffer, playConfig);
    }

    static playBGM(url: string, config?: {
        volume?: number;
        fadeIn?: number;
        crossFade?: number;
    }): void {
        const play = (buffer: AudioBufferHandle) => {
            if (this.fadeAnimId_) {
                cancelAnimationFrame(this.fadeAnimId_);
                this.fadeAnimId_ = 0;
            }

            const targetVolume = config?.volume ?? 1.0;
            const oldVolume = this.bgmVolume_;
            this.bgmVolume_ = targetVolume;

            if (this.bgmHandle_ && config?.crossFade) {
                this.fadeOut(this.bgmHandle_, config.crossFade, oldVolume);
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
                this.fadeIn(this.bgmHandle_, fadeInDuration, targetVolume);
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
                console.warn(`Failed to preload BGM: ${url}`, err);
            });
        }
    }

    static stopAll(): void {
        if (this.fadeAnimId_) {
            cancelAnimationFrame(this.fadeAnimId_);
            this.fadeAnimId_ = 0;
        }
        if (this.bgmHandle_) {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
    }

    static stopBGM(fadeOut?: number): void {
        if (!this.bgmHandle_) return;
        if (this.fadeAnimId_) {
            cancelAnimationFrame(this.fadeAnimId_);
            this.fadeAnimId_ = 0;
        }
        if (fadeOut && fadeOut > 0) {
            const handle = this.bgmHandle_;
            this.bgmHandle_ = null;
            this.fadeOut(handle, fadeOut, this.bgmVolume_);
        } else {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
    }

    static setMasterVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.master.volume = volume;
        }
    }

    static setMusicVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.music.volume = volume;
        }
    }

    static setSFXVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.sfx.volume = volume;
        }
    }

    static setUIVolume(volume: number): void {
        if (this.mixer_) {
            this.mixer_.ui.volume = volume;
        }
    }

    static muteBus(busName: string, muted: boolean): void {
        const bus = this.mixer_?.getBus(busName);
        if (bus) {
            bus.muted = muted;
        }
    }

    static getBufferHandle(url: string): AudioBufferHandle | undefined {
        return this.bufferCache_.get(url);
    }

    static dispose(): void {
        this.disposed_ = true;
        if (this.fadeAnimId_) {
            cancelAnimationFrame(this.fadeAnimId_);
            this.fadeAnimId_ = 0;
        }
        if (this.bgmHandle_) {
            this.bgmHandle_.stop();
            this.bgmHandle_ = null;
        }
        for (const handle of this.bufferCache_.values()) {
            this.backend_?.unloadBuffer(handle);
        }
        this.bufferCache_.clear();
        this.backend_?.dispose();
        this.mixer_ = null;
    }

    private static fadeIn(handle: AudioHandle, duration: number, targetVolume: number): void {
        handle.setVolume(0);
        const startTime = performance.now();
        const tick = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            handle.setVolume(t * targetVolume);
            if (t < 1 && handle.isPlaying) {
                this.fadeAnimId_ = requestAnimationFrame(tick);
            } else {
                this.fadeAnimId_ = 0;
            }
        };
        this.fadeAnimId_ = requestAnimationFrame(tick);
    }

    private static fadeOut(handle: AudioHandle, duration: number, startVolume: number): void {
        const startTime = performance.now();
        const tick = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            handle.setVolume(startVolume * (1 - t));
            if (t < 1 && handle.isPlaying) {
                this.fadeAnimId_ = requestAnimationFrame(tick);
            } else {
                handle.stop();
                this.fadeAnimId_ = 0;
            }
        };
        this.fadeAnimId_ = requestAnimationFrame(tick);
    }

    private static createDeferredHandle(): AudioHandle & { resolve(real: AudioHandle): void } {
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
