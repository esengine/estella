/**
 * @file    EditorSceneRenderer.ts
 * @brief   WebGL scene renderer for editor scene view
 */

import type { ESEngineModule } from 'esengine';
import type { SceneData, ComponentData } from '../types/SceneTypes';
import { EditorCamera } from './EditorCamera';
import { EditorSceneManager } from '../scene/EditorSceneManager';
import { AssetPathResolver } from '../asset';

// =============================================================================
// EditorSceneRenderer
// =============================================================================

export class EditorSceneRenderer {
    private module_: ESEngineModule | null = null;
    private sceneManager_: EditorSceneManager | null = null;
    private camera_: EditorCamera;
    private pathResolver_: AssetPathResolver;
    private initialized_ = false;

    constructor() {
        this.camera_ = new EditorCamera();
        this.pathResolver_ = new AssetPathResolver();
    }

    async init(module: ESEngineModule, canvasSelector: string): Promise<boolean> {
        if (this.initialized_) return true;

        this.module_ = module;

        const success = module.initRendererWithCanvas(canvasSelector);
        if (!success) {
            console.error('[EditorSceneRenderer] Failed to initialize WebGL context');
            return false;
        }

        this.sceneManager_ = new EditorSceneManager(module, this.pathResolver_);
        this.initialized_ = true;

        return true;
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
        if (this.sceneManager_) {
            this.sceneManager_.dispose();
            this.sceneManager_ = null;
        }

        if (this.module_ && this.initialized_) {
            this.module_.shutdownRenderer();
        }

        this.initialized_ = false;
        this.module_ = null;
    }
}
