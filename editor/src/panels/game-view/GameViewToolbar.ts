import { icons } from '../../utils/icons';
import type { GameState } from './GameInstanceManager';

export interface ResolutionPreset {
    label: string;
    width: number;
    height: number;
}

const RESOLUTION_PRESETS: ResolutionPreset[] = [
    { label: 'Free', width: 0, height: 0 },
    { label: '16:9 (1920x1080)', width: 1920, height: 1080 },
    { label: '9:16 (1080x1920)', width: 1080, height: 1920 },
    { label: '4:3 (1024x768)', width: 1024, height: 768 },
    { label: '3:4 (768x1024)', width: 768, height: 1024 },
];

export interface GameViewToolbarCallbacks {
    onPlay(): void;
    onPause(): void;
    onStep(): void;
    onStop(): void;
    onResolutionChange(preset: ResolutionPreset): void;
}

export class GameViewToolbar {
    private container_: HTMLElement;
    private callbacks_: GameViewToolbarCallbacks;
    private playBtn_: HTMLButtonElement | null = null;
    private pauseBtn_: HTMLButtonElement | null = null;
    private stepBtn_: HTMLButtonElement | null = null;
    private stopBtn_: HTMLButtonElement | null = null;
    private fpsDisplay_: HTMLSpanElement | null = null;
    private resolutionSelect_: HTMLSelectElement | null = null;
    private currentPreset_: ResolutionPreset = RESOLUTION_PRESETS[0];

    constructor(container: HTMLElement, callbacks: GameViewToolbarCallbacks) {
        this.container_ = container;
        this.callbacks_ = callbacks;
    }

    buildHTML(): string {
        const options = RESOLUTION_PRESETS.map((p, i) =>
            `<option value="${i}">${p.label}</option>`
        ).join('');

        return `
            <div class="es-gameview-toolbar">
                <div class="es-gameview-controls">
                    <button class="es-btn es-btn-icon es-gameview-play" title="Play">${icons.play(14)}</button>
                    <button class="es-btn es-btn-icon es-gameview-pause" title="Pause" disabled>${icons.pause(14)}</button>
                    <button class="es-btn es-btn-icon es-gameview-step" title="Step Forward" disabled>${icons.stepForward(14)}</button>
                    <button class="es-btn es-btn-icon es-gameview-stop" title="Stop" disabled>${icons.stop(14)}</button>
                </div>
                <div class="es-toolbar-divider"></div>
                <select class="es-gameview-resolution">${options}</select>
                <span class="es-gameview-fps"></span>
            </div>
        `;
    }

    setup(): void {
        this.playBtn_ = this.container_.querySelector('.es-gameview-play');
        this.pauseBtn_ = this.container_.querySelector('.es-gameview-pause');
        this.stepBtn_ = this.container_.querySelector('.es-gameview-step');
        this.stopBtn_ = this.container_.querySelector('.es-gameview-stop');
        this.fpsDisplay_ = this.container_.querySelector('.es-gameview-fps');
        this.resolutionSelect_ = this.container_.querySelector('.es-gameview-resolution');

        this.playBtn_?.addEventListener('click', () => this.callbacks_.onPlay());
        this.pauseBtn_?.addEventListener('click', () => this.callbacks_.onPause());
        this.stepBtn_?.addEventListener('click', () => this.callbacks_.onStep());
        this.stopBtn_?.addEventListener('click', () => this.callbacks_.onStop());

        this.resolutionSelect_?.addEventListener('change', () => {
            const idx = parseInt(this.resolutionSelect_!.value, 10);
            this.currentPreset_ = RESOLUTION_PRESETS[idx];
            this.callbacks_.onResolutionChange(this.currentPreset_);
        });
    }

    updateState(state: GameState): void {
        if (!this.playBtn_) return;

        const playing = state === 'playing';
        const paused = state === 'paused';
        const stopped = state === 'stopped';

        this.playBtn_.disabled = playing;
        this.pauseBtn_!.disabled = !playing;
        this.stepBtn_!.disabled = !paused;
        this.stopBtn_!.disabled = stopped;

        this.playBtn_.classList.toggle('es-active', playing);
    }

    updateFps(fps: number): void {
        if (!this.fpsDisplay_) return;
        this.fpsDisplay_.textContent = fps > 0 ? `${fps} FPS` : '';
    }

    get currentPreset(): ResolutionPreset {
        return this.currentPreset_;
    }

    dispose(): void {
        this.playBtn_ = null;
        this.pauseBtn_ = null;
        this.stepBtn_ = null;
        this.stopBtn_ = null;
        this.fpsDisplay_ = null;
        this.resolutionSelect_ = null;
    }
}
