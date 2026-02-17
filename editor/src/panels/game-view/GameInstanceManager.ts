import type { App, ESEngineModule, SceneData } from 'esengine';
import { createWebApp, loadRuntimeScene, type RuntimeAssetProvider } from 'esengine';
import type { SceneData as EditorSceneData } from '../../types/SceneTypes';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { isUUID, getAssetLibrary } from '../../asset/AssetDatabase';

export type GameState = 'stopped' | 'playing' | 'paused';

export interface GameInstanceCallbacks {
    onStateChange(state: GameState): void;
    onFpsUpdate(fps: number): void;
    onError(error: Error): void;
}

class EditorRuntimeAssetProvider implements RuntimeAssetProvider {
    private projectDir_: string;

    constructor(projectDir: string) {
        this.projectDir_ = projectDir;
    }

    async loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
        const resolved = this.resolvePath(ref);
        const url = getPlatformAdapter().convertFilePathToUrl(`${this.projectDir_}/${resolved}`);
        const img = await this.loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        return { width: img.width, height: img.height, pixels: new Uint8Array(imageData.data.buffer) };
    }

    async readText(ref: string): Promise<string> {
        const resolved = this.resolvePath(ref);
        const url = getPlatformAdapter().convertFilePathToUrl(`${this.projectDir_}/${resolved}`);
        const resp = await fetch(url);
        return resp.text();
    }

    async readBinary(ref: string): Promise<Uint8Array> {
        const resolved = this.resolvePath(ref);
        const url = getPlatformAdapter().convertFilePathToUrl(`${this.projectDir_}/${resolved}`);
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        return new Uint8Array(buf);
    }

    resolvePath(ref: string): string {
        if (isUUID(ref)) {
            return getAssetLibrary().getPath(ref) ?? ref;
        }
        return ref;
    }

    private loadImage(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
    }
}

export class GameInstanceManager {
    private app_: App | null = null;
    private editorModule_: ESEngineModule | null = null;
    private state_: GameState = 'stopped';
    private callbacks_: GameInstanceCallbacks;
    private canvasSelector_ = '';
    private projectDir_ = '';
    private frameCount_ = 0;
    private lastFpsTime_ = 0;
    private fpsInterval_: ReturnType<typeof setInterval> | null = null;

    constructor(callbacks: GameInstanceCallbacks) {
        this.callbacks_ = callbacks;
    }

    get state(): GameState {
        return this.state_;
    }

    setEditorModule(module: ESEngineModule): void {
        this.editorModule_ = module;
    }

    setProjectDir(projectDir: string): void {
        this.projectDir_ = projectDir;
    }

    setCanvasSelector(selector: string): void {
        this.canvasSelector_ = selector;
    }

    async play(sceneData: EditorSceneData): Promise<void> {
        if (this.state_ === 'paused') {
            this.resume();
            return;
        }

        if (this.state_ === 'playing') return;
        if (!this.editorModule_) {
            this.callbacks_.onError(new Error('WASM module not available'));
            return;
        }

        try {
            this.editorModule_.shutdownRenderer();

            const success = this.editorModule_.initRendererWithCanvas(this.canvasSelector_);
            if (!success) {
                this.callbacks_.onError(new Error('Failed to initialize WebGL context for Game View'));
                return;
            }

            const canvasSelector = this.canvasSelector_;
            const getViewportSize = () => {
                const canvas = document.querySelector(canvasSelector) as HTMLCanvasElement;
                if (!canvas) return { width: 0, height: 0 };
                return { width: canvas.width, height: canvas.height };
            };

            this.app_ = createWebApp(this.editorModule_, { getViewportSize });

            const sdkSceneData = JSON.parse(JSON.stringify(sceneData)) as SceneData;
            const provider = new EditorRuntimeAssetProvider(this.projectDir_);
            await loadRuntimeScene(this.app_, this.editorModule_, sdkSceneData, provider);

            this.app_.run();
            this.setState('playing');
            this.startFpsCounter();
        } catch (e) {
            this.stop();
            this.callbacks_.onError(e instanceof Error ? e : new Error(String(e)));
        }
    }

    pause(): void {
        if (this.state_ !== 'playing' || !this.app_) return;
        this.setState('paused');
    }

    private resume(): void {
        if (this.state_ !== 'paused' || !this.app_) return;
        this.setState('playing');
    }

    step(): void {
        if (this.state_ !== 'paused') return;
    }

    stop(): void {
        if (this.app_) {
            try {
                this.app_.quit();
            } catch (e) {
                console.warn('[GameView] Error during quit:', e);
            }
            this.app_ = null;
        }

        this.stopFpsCounter();
        this.setState('stopped');
    }

    dispose(): void {
        this.stop();
        this.editorModule_ = null;
    }

    private setState(state: GameState): void {
        this.state_ = state;
        this.callbacks_.onStateChange(state);
    }

    private startFpsCounter(): void {
        this.frameCount_ = 0;
        this.lastFpsTime_ = performance.now();
        this.fpsInterval_ = setInterval(() => {
            const now = performance.now();
            const elapsed = (now - this.lastFpsTime_) / 1000;
            if (elapsed > 0) {
                this.callbacks_.onFpsUpdate(Math.round(this.frameCount_ / elapsed));
            }
            this.frameCount_ = 0;
            this.lastFpsTime_ = now;
        }, 1000);

        const countFrames = () => {
            if (this.state_ === 'stopped') return;
            this.frameCount_++;
            requestAnimationFrame(countFrames);
        };
        requestAnimationFrame(countFrames);
    }

    private stopFpsCounter(): void {
        if (this.fpsInterval_ !== null) {
            clearInterval(this.fpsInterval_);
            this.fpsInterval_ = null;
        }
        this.callbacks_.onFpsUpdate(0);
    }
}
