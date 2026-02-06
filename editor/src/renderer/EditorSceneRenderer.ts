/**
 * @file    EditorSceneRenderer.ts
 * @brief   WebGL scene renderer for editor scene view
 */

import type { ESEngineModule } from 'esengine';
import { initMaterialAPI, shutdownMaterialAPI } from 'esengine';
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
    private camera_: EditorCamera;
    private pathResolver_: AssetPathResolver;
    private store_: EditorStore | null = null;
    private initialized_ = false;

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

        initMaterialAPI(module);

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

        const entity = this.sceneManager_.getEntityMap().get(sceneEntityId);
        if (entity === undefined) return null;

        const bounds = this.module_.getSpineBounds(this.sceneManager_.registry, entity);
        if (!bounds.valid) return null;

        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }

    // =========================================================================
    // Rendering
    // =========================================================================

    render(width: number, height: number): void {
        if (!this.module_ || !this.sceneManager_ || !this.initialized_) return;
        if (width <= 0 || height <= 0) return;

        const matrix = this.camera_.getViewProjection(width, height);
        const matrixPtr = this.module_._malloc(64);
        this.module_.HEAPF32.set(matrix, matrixPtr / 4);

        this.module_.renderFrameWithMatrix(this.sceneManager_.registry, width, height, matrixPtr);

        this.module_._free(matrixPtr);
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
            shutdownMaterialAPI();
            this.module_.shutdownRenderer();
        }

        this.initialized_ = false;
        this.module_ = null;
    }
}
