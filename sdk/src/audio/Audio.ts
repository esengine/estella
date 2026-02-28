import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle } from './PlatformAudioBackend';
import type { AudioMixer } from './AudioMixer';

export class Audio {
    private static backend_: PlatformAudioBackend;
    private static mixer_: AudioMixer | null = null;
    private static bufferCache_ = new Map<string, AudioBufferHandle>();
    private static bgmHandle_: AudioHandle | null = null;

    static init(backend: PlatformAudioBackend, mixer: AudioMixer | null = null): void {
        this.backend_ = backend;
        this.mixer_ = mixer;
        this.bufferCache_.clear();
        this.bgmHandle_ = null;
    }

    static async preload(url: string): Promise<void> {
        if (this.bufferCache_.has(url)) return;
        const buffer = await this.backend_.loadBuffer(url);
        this.bufferCache_.set(url, buffer);
    }

    static async preloadAll(urls: string[]): Promise<void> {
        await Promise.all(urls.map(url => this.preload(url)));
    }

    static playSFX(url: string, config?: {
        volume?: number;
        pitch?: number;
        pan?: number;
        priority?: number;
    }): AudioHandle {
        const buffer = this.bufferCache_.get(url);
        if (!buffer) {
            this.preload(url).then(() => {
                const buf = this.bufferCache_.get(url);
                if (buf) {
                    this.backend_.play(buf, {
                        bus: 'sfx',
                        volume: config?.volume,
                        playbackRate: config?.pitch,
                        pan: config?.pan,
                        priority: config?.priority ?? 0,
                    });
                }
            });
            return this.createPendingHandle();
        }
        return this.backend_.play(buffer, {
            bus: 'sfx',
            volume: config?.volume,
            playbackRate: config?.pitch,
            pan: config?.pan,
            priority: config?.priority ?? 0,
        });
    }

    static playBGM(url: string, config?: {
        volume?: number;
        fadeIn?: number;
        crossFade?: number;
    }): void {
        const play = (buffer: AudioBufferHandle) => {
            if (this.bgmHandle_ && config?.crossFade) {
                this.fadeOut(this.bgmHandle_, config.crossFade);
            } else if (this.bgmHandle_) {
                this.bgmHandle_.stop();
            }

            this.bgmHandle_ = this.backend_.play(buffer, {
                bus: 'music',
                volume: config?.fadeIn ? 0 : (config?.volume ?? 1.0),
                loop: true,
            });

            if (config?.fadeIn) {
                this.fadeIn(this.bgmHandle_, config.fadeIn, config?.volume ?? 1.0);
            }
        };

        const buffer = this.bufferCache_.get(url);
        if (buffer) {
            play(buffer);
        } else {
            this.preload(url).then(() => {
                const buf = this.bufferCache_.get(url);
                if (buf) {
                    play(buf);
                }
            });
        }
    }

    static stopBGM(fadeOut?: number): void {
        if (!this.bgmHandle_) return;
        if (fadeOut && fadeOut > 0) {
            this.fadeOut(this.bgmHandle_, fadeOut);
        } else {
            this.bgmHandle_.stop();
        }
        this.bgmHandle_ = null;
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

    private static fadeIn(handle: AudioHandle, duration: number, targetVolume: number): void {
        handle.setVolume(0);
        const startTime = performance.now();
        const tick = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            handle.setVolume(t * targetVolume);
            if (t < 1 && handle.isPlaying) {
                requestAnimationFrame(tick);
            }
        };
        requestAnimationFrame(tick);
    }

    private static fadeOut(handle: AudioHandle, duration: number): void {
        const startTime = performance.now();
        const tick = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const t = Math.min(elapsed / duration, 1);
            handle.setVolume(1 - t);
            if (t < 1 && handle.isPlaying) {
                requestAnimationFrame(tick);
            } else {
                handle.stop();
            }
        };
        requestAnimationFrame(tick);
    }

    private static createPendingHandle(): AudioHandle {
        return {
            id: -1,
            stop() {},
            pause() {},
            resume() {},
            setVolume() {},
            setPan() {},
            setLoop() {},
            setPlaybackRate() {},
            isPlaying: false,
            currentTime: 0,
            duration: 0,
        };
    }
}
