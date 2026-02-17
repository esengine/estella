import type { EditorStore } from '../../store/EditorStore';
import type { PanelInstance, Resizable } from '../PanelRegistry';
import { GameInstanceManager, type GameState } from './GameInstanceManager';
import { GameViewToolbar } from './GameViewToolbar';

export interface GameViewPanelOptions {
    projectPath?: string;
}

export class GameViewPanel implements PanelInstance, Resizable {
    private container_: HTMLElement;
    private iframe_: HTMLIFrameElement | null = null;
    private toolbar_: GameViewToolbar;
    private gameManager_: GameInstanceManager;
    private viewport_: HTMLElement | null = null;
    private placeholder_: HTMLElement | null = null;

    constructor(container: HTMLElement, _store: EditorStore, _options?: GameViewPanelOptions) {
        this.container_ = container;

        this.gameManager_ = new GameInstanceManager({
            onStateChange: (state) => this.onStateChange(state),
            onError: (err) => console.error('[GameView]', err.message),
        });

        this.toolbar_ = new GameViewToolbar(container, {
            onPlay: () => this.play(),
            onStop: () => this.stop(),
            onResolutionChange: () => this.updateIframeSize(),
        });

        this.buildUI();
    }

    resize(): void {
        this.updateIframeSize();
    }

    dispose(): void {
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
                <iframe class="es-gameview-iframe"></iframe>
                <div class="es-gameview-placeholder">
                    <span>Click Play to start</span>
                </div>
            </div>
        `;

        this.iframe_ = this.container_.querySelector('.es-gameview-iframe')!;
        this.viewport_ = this.container_.querySelector('.es-gameview-viewport')!;
        this.placeholder_ = this.container_.querySelector('.es-gameview-placeholder')!;

        this.toolbar_.setup();
        this.updateIframeSize();
    }

    private async play(): Promise<void> {
        const url = await this.gameManager_.play();
        if (url && this.iframe_) {
            this.iframe_.src = url;
        }
    }

    private async stop(): Promise<void> {
        if (this.iframe_) {
            this.iframe_.src = 'about:blank';
        }
        await this.gameManager_.stop();
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
        if (!this.iframe_ || !this.viewport_) return;

        const rect = this.viewport_.getBoundingClientRect();
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
