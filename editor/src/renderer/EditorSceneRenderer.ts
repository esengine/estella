/**
 * @file    EditorSceneRenderer.ts
 * @brief   WebGL scene renderer for editor scene view
 */

import type { ESEngineModule } from 'esengine';
import {
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
} from 'esengine';
import type { SpineModuleController } from 'esengine/spine';
import type { SceneData, ComponentData } from '../types/SceneTypes';
import type { EditorStore } from '../store/EditorStore';
import { EditorCamera } from './EditorCamera';
import { EditorSceneManager } from '../scene/EditorSceneManager';
import { RuntimeSyncService } from '../sync/RuntimeSyncService';
import { AssetPathResolver } from '../asset';

// =============================================================================
// EditorSceneRenderer
// =============================================================================

export class EditorSceneRenderer {
    private module_: ESEngineModule | null = null;
    private sceneManager_: EditorSceneManager | null = null;
    private syncService_: RuntimeSyncService | null = null;
    private pipeline_: RenderPipeline | null = null;
    private camera_: EditorCamera;
    private pathResolver_: AssetPathResolver;
    private store_: EditorStore | null = null;
    private initialized_ = false;
    private startTime_ = 0;
    private lastElapsed_ = 0;

    constructor() {
        this.camera_ = new EditorCamera();
        this.pathResolver_ = new AssetPathResolver();
    }

    setStore(store: EditorStore): void {
        this.store_ = store;
        this.setupSyncService();
    }

    async init(module: ESEngineModule, canvasSelector: string): Promise<boolean> {
        if (this.initialized_) return true;

        this.module_ = module;

        const success = module.initRendererWithCanvas(canvasSelector);
        if (!success) {
            console.error('[EditorSceneRenderer] Failed to initialize WebGL context');
            return false;
        }

        initDrawAPI(module);
        initGeometryAPI(module);
        initMaterialAPI(module);
        initPostProcessAPI(module);
        initRendererAPI(module);

        this.pipeline_ = new RenderPipeline();
        this.startTime_ = performance.now();

        this.sceneManager_ = new EditorSceneManager(module, this.pathResolver_);
        this.initialized_ = true;

        this.setupSyncService();

        return true;
    }

    private setupSyncService(): void {
        if (this.syncService_) return;
        if (!this.store_ || !this.sceneManager_) return;

        this.syncService_ = new RuntimeSyncService(this.store_, this.sceneManager_);
    }

    setProjectDir(projectDir: string): void {
        this.pathResolver_.setProjectDir(projectDir);
        this.sceneManager_?.setProjectDir(projectDir);
    }

    setSpineController(controller: SpineModuleController | null): void {
        this.sceneManager_?.setSpineController(controller);

        if (controller && this.pipeline_ && this.module_) {
            const module = this.module_;
            this.pipeline_.setSpineRenderer((_registry, elapsed) => {
                const dt = elapsed - this.lastElapsed_;
                this.lastElapsed_ = elapsed;
                this.sceneManager_?.updateAndSubmitSpine(module, dt);
            });
        } else {
            this.pipeline_?.setSpineRenderer(null);
        }
    }

    get pathResolver(): AssetPathResolver {
        return this.pathResolver_;
    }

    // =========================================================================
    // Scene Sync (Delegated to EditorSceneManager)
    // =========================================================================

    async syncScene(scene: SceneData): Promise<void> {
        await this.sceneManager_?.loadScene(scene);
    }

    async updateEntity(entityId: number, components: ComponentData[]): Promise<void> {
        await this.sceneManager_?.updateEntity(entityId, components);
    }

    removeEntity(entityId: number): void {
        this.sceneManager_?.removeEntity(entityId);
    }

    // =========================================================================
    // Editor-specific Features
    // =========================================================================

    get camera(): EditorCamera {
        return this.camera_;
    }

    get textureManager() {
        return this.sceneManager_?.assetServer.textureManager ?? null;
    }

    get assetServer() {
        return this.sceneManager_?.assetServer ?? null;
    }

    getSpineBounds(sceneEntityId: number): { x: number; y: number; width: number; height: number } | null {
        if (!this.module_ || !this.sceneManager_) return null;

        const moduleBounds = this.sceneManager_.getSpineBoundsFromModule(sceneEntityId);
        if (moduleBounds) return moduleBounds;

        const entity = this.sceneManager_.getEntityMap().get(sceneEntityId);
        if (entity === undefined) return null;

        const bounds = this.module_.getSpineBounds?.(this.sceneManager_.registry, entity);
        if (!bounds?.valid) return null;

        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        return this.sceneManager_?.getSpineSkeletonInfo(entityId) ?? null;
    }

    // =========================================================================
    // Rendering
    // =========================================================================

    render(width: number, height: number): void {
        if (!this.pipeline_ || !this.sceneManager_ || !this.initialized_) return;
        if (width <= 0 || height <= 0) return;

        const bg = this.findCanvasBackgroundColor();
        Renderer.setClearColor(bg.r, bg.g, bg.b, bg.a);

        const matrix = this.camera_.getViewProjection(width, height);
        const elapsed = (performance.now() - this.startTime_) / 1000;

        this.pipeline_.render({
            registry: { _cpp: this.sceneManager_.registry },
            viewProjection: matrix,
            width, height, elapsed,
        });
    }

    private findCanvasBackgroundColor(): { r: number; g: number; b: number; a: number } {
        if (this.store_) {
            for (const entity of this.store_.scene.entities) {
                for (const comp of entity.components) {
                    if (comp.type === 'Canvas' && comp.data?.backgroundColor) {
                        return comp.data.backgroundColor as { r: number; g: number; b: number; a: number };
                    }
                }
            }
        }
        return { r: 0.1, g: 0.1, b: 0.1, a: 1.0 };
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    dispose(): void {
        if (this.syncService_) {
            this.syncService_.dispose();
            this.syncService_ = null;
        }

        if (this.sceneManager_) {
            this.sceneManager_.dispose();
            this.sceneManager_ = null;
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
        this.initialized_ = false;
        this.module_ = null;
    }
}
