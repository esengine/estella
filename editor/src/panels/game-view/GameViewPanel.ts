import type { EditorStore } from '../../store/EditorStore';
import type { PanelInstance, Resizable } from '../PanelRegistry';
import { GameInstanceManager, type GameState } from './GameInstanceManager';
import { GameViewToolbar } from './GameViewToolbar';
import { GameViewBridge } from './GameViewBridge';
import { getPlayModeService } from '../../services/PlayModeService';

export interface GameViewPanelOptions {
    projectPath?: string;
}

export class GameViewPanel implements PanelInstance, Resizable {
    private container_: HTMLElement;
    private iframe_: HTMLIFrameElement | null = null;
    private toolbar_: GameViewToolbar;
    private gameManager_: GameInstanceManager;
    private bridge_: GameViewBridge | null = null;
    private canvasArea_: HTMLElement | null = null;
    private placeholder_: HTMLElement | null = null;
    private eventCleanups_: (() => void)[] = [];

    constructor(container: HTMLElement, _store: EditorStore, _options?: GameViewPanelOptions) {
        this.container_ = container;

        this.gameManager_ = new GameInstanceManager({
            onStateChange: (state) => this.onStateChange(state),
            onError: (err) => console.error('[GameView]', err.message),
        });

        this.toolbar_ = new GameViewToolbar(container, {
            onPlay: () => this.play(),
            onStop: () => this.stop(),
            onPause: () => this.pause(),
            onResume: () => this.resume(),
            onStepFrame: () => this.stepFrame(),
            onSpeedChange: (speed) => this.bridge_?.setSpeed(speed),
            onResolutionChange: () => this.updateIframeSize(),
        });

        this.buildUI();
    }

    resize(): void {
        this.updateIframeSize();
    }

    dispose(): void {
        this.disposeBridge();
        this.gameManager_.dispose();
        this.toolbar_.dispose();
    }

    private buildUI(): void {
        this.container_.className = 'es-gameview-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <div class="es-gameview-tools">
                    ${this.toolbar_.buildHTML()}
                </div>
            </div>
            <div class="es-gameview-viewport">
                <div class="es-gameview-canvas-area">
                    <iframe class="es-gameview-iframe"></iframe>
                    <div class="es-gameview-placeholder">
                        <span>Click Play to start</span>
                    </div>
                </div>
            </div>
        `;

        this.iframe_ = this.container_.querySelector('.es-gameview-iframe')!;
        this.canvasArea_ = this.container_.querySelector('.es-gameview-canvas-area')!;
        this.placeholder_ = this.container_.querySelector('.es-gameview-placeholder')!;

        this.toolbar_.setup();
        this.updateIframeSize();
    }

    private async play(): Promise<void> {
        const url = await this.gameManager_.play();
        if (url && this.iframe_) {
            this.iframe_.src = url + '?t=' + Date.now();
            this.toolbar_.setPreviewUrl(url);
            this.createBridge();
        }
    }

    private async pause(): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            await this.bridge_.pause();
            this.gameManager_.pause();
        } catch { /* ignore timeout */ }
    }

    private async resume(): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            await this.bridge_.resume();
            this.gameManager_.resume();
        } catch { /* ignore timeout */ }
    }

    private async stepFrame(): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            await this.bridge_.step();
        } catch { /* ignore timeout */ }
    }

    private async stop(): Promise<void> {
        this.disposeBridge();
        this.toolbar_.setPreviewUrl(null);
        if (this.iframe_) {
            this.iframe_.src = 'about:blank';
        }
        await this.gameManager_.stop();
    }

    private createBridge(): void {
        if (!this.iframe_) return;
        this.disposeBridge();

        this.bridge_ = new GameViewBridge(this.iframe_);

        this.eventCleanups_.push(
            this.bridge_.on('stats', (data) => {
                this.toolbar_.updateFps(data.fps ?? 0);
            }),
            this.bridge_.on('console:log', (data) => {
                console.log('[Preview]', data.message);
            }),
            this.bridge_.on('console:warn', (data) => {
                console.warn('[Preview]', data.message);
            }),
            this.bridge_.on('console:error', (data) => {
                console.error('[Preview]', data.message);
            }),
            this.bridge_.on('error', (data) => {
                console.error('[Preview Error]', data.message);
            }),
            this.bridge_.on('ready', () => {
                getPlayModeService().enter(this.bridge_!);
            }),
        );
    }

    private disposeBridge(): void {
        for (const cleanup of this.eventCleanups_) cleanup();
        this.eventCleanups_ = [];
        getPlayModeService().exit();
        this.bridge_?.dispose();
        this.bridge_ = null;
        this.toolbar_.updateFps(0);
    }

    private onStateChange(state: GameState): void {
        this.toolbar_.updateState(state);

        if (this.placeholder_) {
            this.placeholder_.style.display = state === 'stopped' ? 'flex' : 'none';
        }
        if (this.iframe_) {
            this.iframe_.style.display = state === 'stopped' ? 'none' : 'block';
        }
    }

    private updateIframeSize(): void {
        if (!this.iframe_ || !this.canvasArea_) return;

        const rect = this.canvasArea_.getBoundingClientRect();
        const preset = this.toolbar_.currentPreset;

        if (preset.width > 0 && preset.height > 0) {
            const targetAspect = preset.width / preset.height;
            const viewportAspect = rect.width / rect.height;

            let displayW: number;
            let displayH: number;

            if (viewportAspect > targetAspect) {
                displayH = rect.height;
                displayW = displayH * targetAspect;
            } else {
                displayW = rect.width;
                displayH = displayW / targetAspect;
            }

            this.iframe_.style.width = `${displayW}px`;
            this.iframe_.style.height = `${displayH}px`;
        } else {
            this.iframe_.style.width = '100%';
            this.iframe_.style.height = '100%';
        }
    }
}
