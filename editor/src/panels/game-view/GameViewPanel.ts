import type { EditorStore } from '../../store/EditorStore';
import type { PanelInstance, Resizable } from '../PanelRegistry';
import { GameInstanceManager, type GameState } from './GameInstanceManager';
import { GameViewToolbar } from './GameViewToolbar';
import { GameViewRenderer } from '../../renderer/GameViewRenderer';
import { getSharedRenderContext } from '../../renderer/SharedRenderContext';
import { getPlayModeService } from '../../services/PlayModeService';

export interface GameViewPanelOptions {
    projectPath?: string;
}

export class GameViewPanel implements PanelInstance, Resizable {
    private container_: HTMLElement;
    private toolbar_: GameViewToolbar;
    private gameManager_: GameInstanceManager;
    private canvasArea_: HTMLElement | null = null;
    private placeholder_: HTMLElement | null = null;
    private canvas2d_: HTMLCanvasElement | null = null;
    private gameRenderer_: GameViewRenderer | null = null;
    private inputCleanup_: (() => void) | null = null;
    private resizeObserver_: ResizeObserver | null = null;
    private scale_ = 1;

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
            onSpeedChange: (speed) => this.onSpeedChange(speed),
            onResolutionChange: () => this.updateCanvasSize(),
            onScaleChange: (scale) => {
                this.scale_ = scale;
                this.updateCanvasSize();
            },
        });

        this.buildUI();
        this.initGameRenderer();
    }

    resize(): void {
        this.updateCanvasSize();
    }

    dispose(): void {
        if (this.resizeObserver_) {
            this.resizeObserver_.disconnect();
            this.resizeObserver_ = null;
        }
        this.cleanupInput();
        this.detachRenderer();
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
                    <canvas class="es-gameview-canvas"></canvas>
                    <div class="es-gameview-placeholder">
                        <span>Game Camera Preview</span>
                    </div>
                </div>
            </div>
        `;

        this.canvas2d_ = this.container_.querySelector('.es-gameview-canvas')!;
        this.canvasArea_ = this.container_.querySelector('.es-gameview-canvas-area')!;
        this.placeholder_ = this.container_.querySelector('.es-gameview-placeholder')!;

        this.toolbar_.setup();

        if (this.canvasArea_) {
            this.resizeObserver_ = new ResizeObserver(() => this.updateCanvasSize());
            this.resizeObserver_.observe(this.canvasArea_);
        }

        this.updateCanvasSize();
    }

    private initGameRenderer(): void {
        const ctx = getSharedRenderContext();
        if (!ctx.initialized || !ctx.webglCanvas_ || !this.canvas2d_) {
            ctx.onceInitialized(() => this.initGameRenderer());
            return;
        }

        if (this.gameRenderer_) return;
        this.gameRenderer_ = new GameViewRenderer(this.canvas2d_, ctx.webglCanvas_);
        ctx.setGameViewRenderer(this.gameRenderer_);
        this.updateCanvasSize();
    }

    tryInitRenderer(): void {
        if (this.gameRenderer_) return;
        this.initGameRenderer();
    }

    private detachRenderer(): void {
        if (this.gameRenderer_) {
            const ctx = getSharedRenderContext();
            ctx.setGameViewRenderer(null);
            ctx.setGameViewportSize(0, 0);
            this.gameRenderer_.dispose();
            this.gameRenderer_ = null;
        }
    }

    private async play(): Promise<void> {
        const service = getPlayModeService();
        service.enterShared();
        this.gameManager_.setState('playing');
        if (this.gameRenderer_) {
            this.gameRenderer_.setVisible(true);
        }
        this.updateCanvasSize();
        this.setupInput();
    }

    private pause(): void {
        getSharedRenderContext().pausePlay();
        this.gameManager_.pause();
    }

    private resume(): void {
        getSharedRenderContext().resumePlay();
        this.gameManager_.resume();
    }

    private stepFrame(): void {
        const ctx = getSharedRenderContext();
        if (ctx.app_) {
            ctx.app_.tick(1 / 60);
            ctx.requestRender();
        }
    }

    private async stop(): Promise<void> {
        this.cleanupInput();
        if (this.gameRenderer_) {
            this.gameRenderer_.setVisible(false);
        }
        await getPlayModeService().exitShared();
        await this.gameManager_.stop();
    }

    private onSpeedChange(speed: number): void {
        getSharedRenderContext().setPlaySpeed(speed);
    }

    private onStateChange(state: GameState): void {
        this.toolbar_.updateState(state);

        const stopped = state === 'stopped';
        if (this.placeholder_) {
            this.placeholder_.style.display = stopped ? 'flex' : 'none';
        }
        if (this.canvas2d_) {
            this.canvas2d_.style.display = stopped ? 'none' : 'block';
        }
    }

    private updateCanvasSize(): void {
        if (!this.canvas2d_ || !this.canvasArea_) return;

        const rect = this.canvasArea_.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const preset = this.toolbar_.currentPreset;
        const ctx = getSharedRenderContext();

        let renderW: number;
        let renderH: number;

        if (preset.width > 0 && preset.height > 0) {
            renderW = preset.width;
            renderH = preset.height;
        } else {
            const designRes = this.gameRenderer_?.getDesignResolution(ctx);
            if (designRes) {
                renderW = designRes.x;
                renderH = designRes.y;
            } else {
                renderW = Math.round(rect.width);
                renderH = Math.round(rect.height);
            }
        }

        const targetAspect = renderW / renderH;
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

        const scaledW = displayW * this.scale_;
        const scaledH = displayH * this.scale_;

        this.canvas2d_.style.width = `${scaledW}px`;
        this.canvas2d_.style.height = `${scaledH}px`;

        const dpr = window.devicePixelRatio || 1;
        const deviceW = Math.round(scaledW * dpr);
        const deviceH = Math.round(scaledH * dpr);

        if (this.gameRenderer_) {
            this.gameRenderer_.setSize(deviceW, deviceH);
            ctx.setGameViewportSize(deviceW, deviceH);
            ctx.requestRender();
        }
    }

    private setupInput(): void {
        this.cleanupInput();
        const canvas = this.canvas2d_;
        if (!canvas) return;

        canvas.tabIndex = 0;
        canvas.style.outline = 'none';
        canvas.focus();

        const getInput = () => getSharedRenderContext().inputState;

        const onMouseMove = (e: MouseEvent) => {
            const input = getInput();
            if (input) {
                input.mouseX = e.offsetX;
                input.mouseY = e.offsetY;
            }
        };
        const onMouseDown = (e: MouseEvent) => {
            const input = getInput();
            if (input) {
                input.mouseX = e.offsetX;
                input.mouseY = e.offsetY;
                input.mouseButtons.add(e.button);
                input.mouseButtonsPressed.add(e.button);
            }
        };
        const onMouseUp = (e: MouseEvent) => {
            const input = getInput();
            if (input) {
                input.mouseButtons.delete(e.button);
                input.mouseButtonsReleased.add(e.button);
            }
        };
        const onTouchStart = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (!touch) return;
            const rect = canvas.getBoundingClientRect();
            const input = getInput();
            if (input) {
                input.mouseX = touch.clientX - rect.left;
                input.mouseY = touch.clientY - rect.top;
                input.mouseButtons.add(0);
                input.mouseButtonsPressed.add(0);
            }
            e.preventDefault();
        };
        const onTouchMove = (e: TouchEvent) => {
            const touch = e.touches[0];
            if (!touch) return;
            const rect = canvas.getBoundingClientRect();
            const input = getInput();
            if (input) {
                input.mouseX = touch.clientX - rect.left;
                input.mouseY = touch.clientY - rect.top;
            }
            e.preventDefault();
        };
        const onTouchEnd = (e: TouchEvent) => {
            const input = getInput();
            if (input) {
                input.mouseButtons.delete(0);
                input.mouseButtonsReleased.add(0);
            }
            e.preventDefault();
        };
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const input = getInput();
            if (input) {
                input.scrollDeltaX += e.deltaX;
                input.scrollDeltaY += e.deltaY;
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            const input = getInput();
            if (input && !input.keysDown.has(e.code)) {
                input.keysPressed.add(e.code);
            }
            if (input) input.keysDown.add(e.code);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            const input = getInput();
            if (input) {
                input.keysDown.delete(e.code);
                input.keysReleased.add(e.code);
            }
        };

        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('keydown', onKeyDown);
        canvas.addEventListener('keyup', onKeyUp);

        this.inputCleanup_ = () => {
            canvas.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mouseup', onMouseUp);
            canvas.removeEventListener('touchstart', onTouchStart);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('keydown', onKeyDown);
            canvas.removeEventListener('keyup', onKeyUp);
        };
    }

    private cleanupInput(): void {
        if (this.inputCleanup_) {
            this.inputCleanup_();
            this.inputCleanup_ = null;
        }
    }
}
