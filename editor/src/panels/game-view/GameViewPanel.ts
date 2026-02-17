import type { App } from 'esengine';
import type { EditorStore } from '../../store/EditorStore';
import type { AppAware, PanelInstance, Resizable } from '../PanelRegistry';
import { GameInstanceManager, type GameState } from './GameInstanceManager';
import { GameViewToolbar } from './GameViewToolbar';

export interface GameViewPanelOptions {
    projectPath?: string;
}

export class GameViewPanel implements PanelInstance, Resizable, AppAware {
    private container_: HTMLElement;
    private store_: EditorStore;
    private app_: App | null = null;
    private projectPath_: string | null;
    private canvas_: HTMLCanvasElement | null = null;
    private canvasId_: string;
    private toolbar_: GameViewToolbar;
    private gameManager_: GameInstanceManager;
    private viewport_: HTMLElement | null = null;
    private resizeObserver_: ResizeObserver | null = null;
    private placeholder_: HTMLElement | null = null;

    constructor(container: HTMLElement, store: EditorStore, options?: GameViewPanelOptions) {
        this.container_ = container;
        this.store_ = store;
        this.projectPath_ = options?.projectPath ?? null;
        this.canvasId_ = `es-gameview-canvas-${Date.now()}`;

        this.gameManager_ = new GameInstanceManager({
            onStateChange: (state) => this.onStateChange(state),
            onFpsUpdate: (fps) => this.toolbar_.updateFps(fps),
            onError: (err) => console.error('[GameView]', err.message),
        });

        this.toolbar_ = new GameViewToolbar(container, {
            onPlay: () => this.play(),
            onPause: () => this.gameManager_.pause(),
            onStep: () => this.gameManager_.step(),
            onStop: () => this.gameManager_.stop(),
            onResolutionChange: () => this.updateCanvasSize(),
        });

        this.buildUI();
    }

    setApp(app: App): void {
        this.app_ = app;
        if (app.wasmModule) {
            this.gameManager_.setEditorModule(app.wasmModule);
        }
    }

    resize(): void {
        this.updateCanvasSize();
    }

    dispose(): void {
        this.gameManager_.dispose();
        this.toolbar_.dispose();
        if (this.resizeObserver_) {
            this.resizeObserver_.disconnect();
            this.resizeObserver_ = null;
        }
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
                <canvas id="${this.canvasId_}" class="es-gameview-canvas"></canvas>
                <div class="es-gameview-placeholder">
                    <span>Click Play to start</span>
                </div>
            </div>
        `;

        this.canvas_ = this.container_.querySelector(`#${this.canvasId_}`)!;
        this.viewport_ = this.container_.querySelector('.es-gameview-viewport')!;
        this.placeholder_ = this.container_.querySelector('.es-gameview-placeholder')!;

        this.toolbar_.setup();

        if (this.projectPath_) {
            const projectDir = this.projectPath_.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
            this.gameManager_.setProjectDir(projectDir);
        }

        this.gameManager_.setCanvasSelector(`#${this.canvasId_}`);

        this.resizeObserver_ = new ResizeObserver(() => this.updateCanvasSize());
        this.resizeObserver_.observe(this.viewport_);

        this.updateCanvasSize();
    }

    private play(): void {
        if (!this.app_?.wasmModule) {
            console.warn('[GameView] WASM module not available yet');
            return;
        }
        this.gameManager_.setEditorModule(this.app_.wasmModule);
        this.updateCanvasSize();
        this.gameManager_.play(this.store_.scene);
    }

    private onStateChange(state: GameState): void {
        this.toolbar_.updateState(state);

        if (this.placeholder_) {
            this.placeholder_.style.display = state === 'stopped' ? 'flex' : 'none';
        }
        if (this.canvas_) {
            this.canvas_.style.display = state === 'stopped' ? 'none' : 'block';
        }
    }

    private updateCanvasSize(): void {
        if (!this.canvas_ || !this.viewport_) return;

        const rect = this.viewport_.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
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

            this.canvas_.style.width = `${displayW}px`;
            this.canvas_.style.height = `${displayH}px`;
            this.canvas_.width = displayW * dpr;
            this.canvas_.height = displayH * dpr;
        } else {
            this.canvas_.style.width = `${rect.width}px`;
            this.canvas_.style.height = `${rect.height}px`;
            this.canvas_.width = rect.width * dpr;
            this.canvas_.height = rect.height * dpr;
        }
    }
}
