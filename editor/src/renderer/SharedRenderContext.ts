import type { ESEngineModule, CppRegistry, UICameraData } from 'esengine';
import {
    App,
    UICameraInfo,
    UIEvents,
    UIEventQueue,
    Input,
    InputState,
    setEditorMode,
    setPlayMode,
    defineSystem,
    Schedule,
    uiPlugins,
    assetPlugin,
    prefabsPlugin,
    animationPlugin,
    audioPlugin,
    RenderPipeline,
    Renderer,
    initDrawAPI,
    shutdownDrawAPI,
    initGeometryAPI,
    shutdownGeometryAPI,
    initMaterialAPI,
    shutdownMaterialAPI,
    initPostProcessAPI,
    shutdownPostProcessAPI,
    initRendererAPI,
    shutdownRendererAPI,
    particlePlugin,
    tilemapPlugin,
    sceneManagerPlugin,
    postProcessPlugin,
    timelinePlugin,
    clearTimelineHandles,
} from 'esengine';
import { PhysicsPlugin, type PhysicsPluginConfig } from 'esengine/physics';
import { SpinePlugin, SpineManager, createSpineFactories, type SpineWasmProvider } from 'esengine/spine';
import { EditorSceneManager } from '../scene/EditorSceneManager';
import { AssetPathResolver } from '../asset';
import type { GameViewRenderer } from './GameViewRenderer';
import { getEditorContext } from '../context/EditorContext';

export class SharedRenderContext {
    module_: ESEngineModule | null = null;
    gl_: WebGL2RenderingContext | null = null;
    app_: App | null = null;
    sceneManager_: EditorSceneManager | null = null;
    pipeline_: RenderPipeline | null = null;
    webglCanvas_: HTMLCanvasElement | null = null;
    pathResolver_: AssetPathResolver;

    private initialized_ = false;
    private gameViewRenderer_: GameViewRenderer | null = null;
    private inputState_: InputState | null = null;
    private startTime_ = 0;
    private playMode_ = false;
    private paused_ = false;
    private playSpeed_ = 1;
    private lastFrameTime_ = 0;

    private animationId_: number | null = null;
    private continuousRender_ = false;
    private isDirty_ = true;
    private physicsFactory_: unknown = null;
    private spineManager_: SpineManager | null = null;
    private sceneViewportW_ = 0;
    private sceneViewportH_ = 0;
    private gameViewportW_ = 0;
    private gameViewportH_ = 0;
    private renderCallback_: (() => void) | null = null;
    private onInitCallbacks_: (() => void)[] = [];
    private postTickCallback_: (() => void) | null = null;

    constructor() {
        this.pathResolver_ = new AssetPathResolver();
    }

    get initialized(): boolean {
        return this.initialized_;
    }

    get isPlayMode(): boolean {
        return this.playMode_;
    }

    async init(module: ESEngineModule): Promise<boolean> {
        if (this.initialized_) return true;

        this.module_ = module;

        const canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.left = '-9999px';
        canvas.style.top = '-9999px';
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);
        this.webglCanvas_ = canvas;

        const gl = canvas.getContext('webgl2', {
            alpha: true,
            depth: true,
            stencil: true,
            antialias: true,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
        });
        if (!gl) {
            console.error('[SharedRenderContext] Failed to create WebGL2 context');
            return false;
        }
        this.gl_ = gl;

        const handle = module.GL.registerContext(gl, { majorVersion: 2, minorVersion: 0 });
        if (handle <= 0) {
            console.error('[SharedRenderContext] Failed to register WebGL context');
            return false;
        }

        const success = module.initRendererWithContext(handle);
        if (!success) {
            console.error('[SharedRenderContext] Failed to initialize renderer');
            return false;
        }

        initDrawAPI(module);
        initGeometryAPI(module);
        initMaterialAPI(module);
        initPostProcessAPI(module);
        initRendererAPI(module);

        this.pipeline_ = new RenderPipeline();
        this.startTime_ = performance.now();

        const app = App.new();
        const cppRegistry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(cppRegistry, module);
        app.setPipeline(this.pipeline_);

        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
            vpX: 0, vpY: 0, vpW: 0, vpH: 0,
            screenW: 0, screenH: 0,
            worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0,
            worldMouseX: 0, worldMouseY: 0,
            valid: false,
        });

        this.inputState_ = new InputState();
        app.insertResource(Input, this.inputState_);
        app.insertResource(UIEvents, new UIEventQueue());

        app.addSystemToSchedule(Schedule.Last, defineSystem([], () => {
            if (!this.inputState_) return;
            this.inputState_.keysPressed.clear();
            this.inputState_.keysReleased.clear();
            this.inputState_.mouseButtonsPressed.clear();
            this.inputState_.mouseButtonsReleased.clear();
            this.inputState_.scrollDeltaX = 0;
            this.inputState_.scrollDeltaY = 0;
        }, { name: 'EditorInputClearSystem' }));

        setEditorMode(true);
        app.enableStats();
        app.addPlugin(assetPlugin);
        app.addPlugin(prefabsPlugin);
        app.addPlugin(animationPlugin);
        app.addPlugin(audioPlugin);
        app.addPlugin(particlePlugin);
        app.addPlugin(tilemapPlugin);
        this.spineManager_ = this.createSpineManager_(module);
        app.addPlugin(new SpinePlugin(this.spineManager_ ?? undefined));
        app.addPlugin(sceneManagerPlugin);
        app.addPlugin(postProcessPlugin);
        app.addPlugin(timelinePlugin);
        for (const plugin of uiPlugins) {
            app.addPlugin(plugin);
        }
        this.app_ = app;

        this.sceneManager_ = new EditorSceneManager(module, this.pathResolver_, app.world);
        this.sceneManager_.setSpineManager(this.spineManager_);
        this.sceneManager_.registerSystems(app);
        this.initialized_ = true;

        for (const cb of this.onInitCallbacks_) cb();
        this.onInitCallbacks_ = [];

        return true;
    }

    onceInitialized(cb: () => void): void {
        if (this.initialized_) {
            cb();
        } else {
            this.onInitCallbacks_.push(cb);
        }
    }

    setRenderCallback(callback: (() => void) | null): void {
        this.renderCallback_ = callback;
    }

    setGameViewRenderer(renderer: GameViewRenderer | null): void {
        this.gameViewRenderer_ = renderer;
        if (renderer) {
            this.requestRender();
        }
    }

    get gameViewRenderer(): GameViewRenderer | null {
        return this.gameViewRenderer_;
    }

    get inputState(): InputState | null {
        return this.inputState_;
    }

    getUICameraInfo(): UICameraData | null {
        return this.app_?.getResource(UICameraInfo) as UICameraData | null ?? null;
    }

    private clearInputState(): void {
        if (!this.inputState_) return;
        this.inputState_.keysDown.clear();
        this.inputState_.keysPressed.clear();
        this.inputState_.keysReleased.clear();
        this.inputState_.mouseButtons.clear();
        this.inputState_.mouseButtonsPressed.clear();
        this.inputState_.mouseButtonsReleased.clear();
        this.inputState_.scrollDeltaX = 0;
        this.inputState_.scrollDeltaY = 0;
    }

    setProjectDir(projectDir: string): void {
        this.pathResolver_.setProjectDir(projectDir);
        this.sceneManager_?.setProjectDir(projectDir);
    }

    get elapsed(): number {
        return (performance.now() - this.startTime_) / 1000;
    }

    requestRender(): void {
        this.isDirty_ = true;
        this.renderCallback_?.();
    }

    startContinuousRender(): void {
        this.continuousRender_ = true;
    }

    stopContinuousRender(): void {
        this.continuousRender_ = false;
    }

    get isContinuousRender(): boolean {
        return this.continuousRender_;
    }

    setSceneViewportSize(w: number, h: number): void {
        this.sceneViewportW_ = w;
        this.sceneViewportH_ = h;
        this.syncCanvasSize_();
    }

    setGameViewportSize(w: number, h: number): void {
        this.gameViewportW_ = w;
        this.gameViewportH_ = h;
        this.syncCanvasSize_();
    }

    private syncCanvasSize_(): void {
        if (!this.webglCanvas_) return;
        const w = Math.max(this.sceneViewportW_, this.gameViewportW_);
        const h = Math.max(this.sceneViewportH_, this.gameViewportH_);
        if (w <= 0 || h <= 0) return;
        if (this.webglCanvas_.width !== w || this.webglCanvas_.height !== h) {
            this.webglCanvas_.width = w;
            this.webglCanvas_.height = h;
        }
    }

    setPostTickCallback(cb: (() => void) | null): void {
        this.postTickCallback_ = cb;
    }

    tickApp(): void {
        if (!this.app_) return;
        if (this.playMode_ && !this.paused_) {
            const now = performance.now();
            const dt = (now - this.lastFrameTime_) / 1000;
            this.lastFrameTime_ = now;
            const clampedDt = Math.min(dt, 0.1);
            this.app_.tick(clampedDt * this.playSpeed_);
        } else {
            this.app_.tick(1 / 60);
        }
        this.postTickCallback_?.();
    }

    get spineManager(): SpineManager | null {
        return this.spineManager_;
    }

    setPhysicsFactory(factory: unknown): void {
        this.physicsFactory_ = factory;
    }

    private createSpineManager_(module: ESEngineModule): SpineManager {
        const provider: SpineWasmProvider = {
            async loadJs(version: string): Promise<string> {
                const fs = getEditorContext().fs;
                if (!fs) throw new Error('NativeFS not available');
                return fs.getSpineJs(version);
            },
            async loadWasm(version: string): Promise<ArrayBuffer> {
                const fs = getEditorContext().fs;
                if (!fs) throw new Error('NativeFS not available');
                const bytes = await fs.getSpineWasm(version);
                return bytes.buffer as ArrayBuffer;
            },
        };
        const factories = createSpineFactories(provider);
        return new SpineManager(module, factories);
    }

    async enterPlayMode(physicsConfig?: PhysicsPluginConfig): Promise<void> {
        if (physicsConfig && this.app_) {
            const plugin = new PhysicsPlugin(
                '/wasm/physics.js',
                physicsConfig,
                this.physicsFactory_ as any,
            );
            this.app_.addPlugin(plugin);
            if (this.app_.physicsInitPromise) {
                await this.app_.physicsInitPromise;
            }
        }

        clearTimelineHandles();
        timelinePlugin.clearHandles();
        this.playMode_ = true;
        this.paused_ = false;
        this.lastFrameTime_ = performance.now();
        setPlayMode(true);
        this.startContinuousRender();
        this.requestRender();
    }

    async exitPlayMode(scene?: import('../types/SceneTypes').SceneData): Promise<void> {
        this.playMode_ = false;
        this.paused_ = false;
        this.app_?.setPaused(false);
        setPlayMode(false);
        this.clearInputState();

        if (scene && this.sceneManager_) {
            await this.sceneManager_.loadScene(scene);
            if (this.app_) {
                this.app_.tick(0);
            }
            this.requestRender();
        }
    }

    pausePlay(): void {
        this.paused_ = true;
        this.app_?.setPaused(true);
    }

    resumePlay(): void {
        this.paused_ = false;
        this.app_?.setPaused(false);
        this.lastFrameTime_ = performance.now();
    }

    setPlaySpeed(speed: number): void {
        this.playSpeed_ = speed;
    }

    dispose(): void {
        if (this.animationId_ !== null) {
            cancelAnimationFrame(this.animationId_);
            this.animationId_ = null;
        }

        if (this.spineManager_) {
            this.spineManager_.shutdown();
            this.spineManager_ = null;
        }

        if (this.sceneManager_) {
            this.sceneManager_.dispose();
            this.sceneManager_ = null;
        }

        if (this.app_) {
            const world = this.app_.world;
            const reg = world.getCppRegistry();
            world.disconnectCpp();
            if (reg) (reg as any).delete();
            this.app_ = null;
        }

        if (this.module_ && this.initialized_) {
            shutdownDrawAPI();
            shutdownGeometryAPI();
            shutdownMaterialAPI();
            shutdownPostProcessAPI();
            shutdownRendererAPI();
            this.module_.shutdownRenderer();
        }

        this.pipeline_ = null;
        this.gl_ = null;
        if (this.webglCanvas_) {
            this.webglCanvas_.remove();
            this.webglCanvas_ = null;
        }
        this.initialized_ = false;
        this.module_ = null;
        this.gameViewRenderer_ = null;
    }
}

import { getEditorContainer } from '../container/EditorContainer';
import { SHARED_RENDER_CTX } from '../container/tokens';

export function getSharedRenderContext(): SharedRenderContext {
    return getEditorContainer().get(SHARED_RENDER_CTX, 'default')!;
}

export function resetSharedRenderContext(): void {
    const instance = getEditorContainer().get(SHARED_RENDER_CTX, 'default');
    if (instance) {
        instance.dispose();
    }
}
