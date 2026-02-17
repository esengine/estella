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
    onStop(): void;
    onResolutionChange(preset: ResolutionPreset): void;
}

export class GameViewToolbar {
    private container_: HTMLElement;
    private callbacks_: GameViewToolbarCallbacks;
    private playBtn_: HTMLButtonElement | null = null;
    private stopBtn_: HTMLButtonElement | null = null;
    private fpsDisplay_: HTMLSpanElement | null = null;
    private resolutionSelect_: HTMLSelectElement | null = null;
    private customSizeEl_: HTMLElement | null = null;
    private customWidthInput_: HTMLInputElement | null = null;
    private customHeightInput_: HTMLInputElement | null = null;
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
                    <button class="es-btn es-btn-icon es-gameview-stop" title="Stop" disabled>${icons.stop(14)}</button>
                </div>
                <div class="es-toolbar-divider"></div>
                <select class="es-gameview-resolution">${options}<option value="custom">Custom</option></select>
                <div class="es-gameview-custom-size" style="display:none">
                    <input type="number" class="es-gameview-custom-w" placeholder="W" min="1" max="7680" />
                    <span class="es-gameview-custom-x">&times;</span>
                    <input type="number" class="es-gameview-custom-h" placeholder="H" min="1" max="4320" />
                </div>
                <span class="es-gameview-fps"></span>
            </div>
        `;
    }

    setup(): void {
        this.playBtn_ = this.container_.querySelector('.es-gameview-play');
        this.stopBtn_ = this.container_.querySelector('.es-gameview-stop');
        this.fpsDisplay_ = this.container_.querySelector('.es-gameview-fps');
        this.resolutionSelect_ = this.container_.querySelector('.es-gameview-resolution');
        this.customSizeEl_ = this.container_.querySelector('.es-gameview-custom-size');
        this.customWidthInput_ = this.container_.querySelector('.es-gameview-custom-w');
        this.customHeightInput_ = this.container_.querySelector('.es-gameview-custom-h');

        this.playBtn_?.addEventListener('click', () => this.callbacks_.onPlay());
        this.stopBtn_?.addEventListener('click', () => this.callbacks_.onStop());

        this.resolutionSelect_?.addEventListener('change', () => {
            const val = this.resolutionSelect_!.value;
            if (val === 'custom') {
                this.customSizeEl_!.style.display = 'flex';
                this.applyCustomResolution();
            } else {
                this.customSizeEl_!.style.display = 'none';
                const idx = parseInt(val, 10);
                this.currentPreset_ = RESOLUTION_PRESETS[idx];
                this.callbacks_.onResolutionChange(this.currentPreset_);
            }
        });

        this.customWidthInput_?.addEventListener('change', () => this.applyCustomResolution());
        this.customHeightInput_?.addEventListener('change', () => this.applyCustomResolution());
    }

    private applyCustomResolution(): void {
        const w = parseInt(this.customWidthInput_?.value ?? '0', 10) || 0;
        const h = parseInt(this.customHeightInput_?.value ?? '0', 10) || 0;
        this.currentPreset_ = { label: 'Custom', width: w, height: h };
        this.callbacks_.onResolutionChange(this.currentPreset_);
    }

    updateState(state: GameState): void {
        if (!this.playBtn_) return;

        const playing = state === 'playing';
        const stopped = state === 'stopped';

        this.playBtn_.disabled = playing;
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
        this.stopBtn_ = null;
        this.fpsDisplay_ = null;
        this.resolutionSelect_ = null;
        this.customSizeEl_ = null;
        this.customWidthInput_ = null;
        this.customHeightInput_ = null;
    }
}
