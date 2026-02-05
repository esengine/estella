/**
 * @file    EditorSceneRenderer.ts
 * @brief   WebGL scene renderer for editor scene view
 */

import type { ESEngineModule, CppRegistry, Entity } from 'esengine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { EditorTextureManager } from './EditorTextureManager';
import { EditorCamera } from './EditorCamera';
import {
    Transform,
    composeTransforms,
    createIdentityTransform,
} from '../math/Transform';
import { EditorTextRenderer } from './EditorTextRenderer';

// =============================================================================
// EditorSceneRenderer
// =============================================================================

export class EditorSceneRenderer {
    private module_: ESEngineModule | null = null;
    private registry_: CppRegistry | null = null;
    private textureManager_: EditorTextureManager | null = null;
    private textRenderer_: EditorTextRenderer | null = null;
    private camera_: EditorCamera;
    private initialized_ = false;
    private projectDir_ = '';

    /** Map scene entity IDs to runtime entities */
    private entityMap_: Map<number, Entity> = new Map();

    /** Current scene data for parent lookups */
    private sceneData_: SceneData | null = null;

    /** Map entity ID to EntityData for fast lookup */
    private entityDataMap_: Map<number, EntityData> = new Map();

    /** Sync lock to prevent concurrent syncScene calls */
    private syncing_ = false;
    private pendingScene_: SceneData | null = null;

    constructor() {
        this.camera_ = new EditorCamera();
    }

    /**
     * @brief Initialize renderer with WASM module and canvas
     * @returns true if initialization succeeded
     */
    async init(module: ESEngineModule, canvasSelector: string): Promise<boolean> {
        if (this.initialized_) return true;

        this.module_ = module;

        const success = module.initRendererWithCanvas(canvasSelector);
        if (!success) {
            console.error('[EditorSceneRenderer] Failed to initialize WebGL context');
            return false;
        }

        this.registry_ = new module.Registry();
        this.textureManager_ = new EditorTextureManager(module);
        this.textRenderer_ = new EditorTextRenderer(module);
        this.initialized_ = true;

        return true;
    }

    /**
     * @brief Set project directory for texture loading
     */
    setProjectDir(projectDir: string): void {
        this.projectDir_ = projectDir.replace(/\\/g, '/');
    }

    /**
     * @brief Sync entire scene to registry
     */
    async syncScene(scene: SceneData): Promise<void> {
        if (!this.registry_ || !this.module_) return;

        if (this.syncing_) {
            this.pendingScene_ = scene;
            return;
        }

        this.syncing_ = true;

        try {
            await this.syncSceneInternal(scene);

            if (this.pendingScene_) {
                const latest = this.pendingScene_;
                this.pendingScene_ = null;
                await this.syncSceneInternal(latest);
            }
        } finally {
            this.syncing_ = false;
        }
    }

    private async syncSceneInternal(scene: SceneData): Promise<void> {
        if (!this.registry_ || !this.module_) return;

        this.clearRegistry();

        this.sceneData_ = scene;
        this.entityDataMap_.clear();
        for (const entityData of scene.entities) {
            this.entityDataMap_.set(entityData.id, entityData);
        }

        for (const entityData of scene.entities) {
            await this.syncEntity(entityData);
        }
    }

    /**
     * @brief Sync a single entity
     */
    async syncEntity(entityData: EntityData): Promise<void> {
        if (!this.registry_ || !this.module_) return;

        let entity = this.entityMap_.get(entityData.id);
        if (!entity) {
            entity = this.registry_.create();
            this.entityMap_.set(entityData.id, entity);
        }

        // Update entityDataMap_ with latest data
        this.entityDataMap_.set(entityData.id, entityData);

        for (const comp of entityData.components) {
            await this.syncComponent(entity, comp, entityData.id);
        }
    }

    /**
     * @brief Update a specific entity's components
     */
    async updateEntity(entityId: number, components: ComponentData[]): Promise<void> {
        if (!this.registry_) return;

        const entity = this.entityMap_.get(entityId);
        if (!entity) return;

        // Update entityDataMap_ with latest components
        const existingData = this.entityDataMap_.get(entityId);
        if (existingData) {
            existingData.components = components;
        }

        for (const comp of components) {
            await this.syncComponent(entity, comp, entityId);
        }
    }

    /**
     * @brief Remove an entity
     */
    removeEntity(entityId: number): void {
        if (!this.registry_) return;

        const entity = this.entityMap_.get(entityId);
        if (entity) {
            this.registry_.destroy(entity);
            this.entityMap_.delete(entityId);
        }
    }

    /**
     * @brief Get editor camera for pan/zoom control
     */
    get camera(): EditorCamera {
        return this.camera_;
    }

    /**
     * @brief Get texture manager
     */
    get textureManager(): EditorTextureManager | null {
        return this.textureManager_;
    }

    /**
     * @brief Render a frame
     */
    render(width: number, height: number): void {
        if (!this.module_ || !this.registry_ || !this.initialized_) return;

        const matrix = this.camera_.getViewProjection(width, height);
        const matrixPtr = this.module_._malloc(64);
        this.module_.HEAPF32.set(matrix, matrixPtr / 4);

        this.module_.renderFrameWithMatrix(this.registry_, width, height, matrixPtr);

        this.module_._free(matrixPtr);
    }

    /**
     * @brief Dispose resources
     */
    dispose(): void {
        if (this.textureManager_) {
            this.textureManager_.releaseAll();
            this.textureManager_ = null;
        }

        if (this.textRenderer_) {
            this.textRenderer_.releaseAll();
            this.textRenderer_ = null;
        }

        if (this.registry_) {
            this.registry_.delete();
            this.registry_ = null;
        }

        if (this.module_ && this.initialized_) {
            this.module_.shutdownRenderer();
        }

        this.entityMap_.clear();
        this.initialized_ = false;
        this.module_ = null;
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private clearRegistry(): void {
        if (!this.registry_) return;

        for (const [, entity] of this.entityMap_) {
            this.registry_.destroy(entity);
        }
        this.entityMap_.clear();

        if (this.textRenderer_) {
            this.textRenderer_.releaseAll();
        }
    }

    private async syncComponent(entity: Entity, comp: ComponentData, entityId: number): Promise<void> {
        if (!this.registry_) return;

        switch (comp.type) {
            case 'LocalTransform':
                this.syncTransform(entity, comp.data, entityId);
                break;

            case 'Sprite': {
                const entityData = this.entityDataMap_.get(entityId);
                const hasText = entityData?.components.some(c => c.type === 'Text');
                if (!hasText) {
                    await this.syncSprite(entity, comp.data);
                }
                break;
            }

            case 'Camera':
                this.syncCamera(entity, comp.data);
                break;

            case 'Text':
                this.syncText(entity, comp.data, entityId);
                break;
        }
    }

    private syncTransform(entity: Entity, data: any, entityId: number): void {
        if (!this.registry_) return;

        if (this.registry_.hasLocalTransform(entity)) {
            this.registry_.removeLocalTransform(entity);
        }

        const worldTransform = this.computeWorldTransform(entityId);

        this.registry_.addLocalTransform(entity, {
            position: worldTransform.position,
            rotation: worldTransform.rotation,
            scale: worldTransform.scale,
        });
    }

    private computeWorldTransform(entityId: number): Transform {
        const entityData = this.entityDataMap_.get(entityId);
        if (!entityData) {
            return createIdentityTransform();
        }

        const localTransform = this.getLocalTransform(entityData);
        const uiRect = this.getUIRect(entityData);
        const entitySize = this.getEntitySize(entityData);

        let adjustedPosition = { ...localTransform.position };

        if (uiRect) {
            const parentSize = this.getParentSize(entityData);

            // anchor offset (relative to parent center)
            adjustedPosition.x += (uiRect.anchor.x - 0.5) * parentSize.x;
            adjustedPosition.y += (uiRect.anchor.y - 0.5) * parentSize.y;

            // pivot offset (renderer uses center pivot)
            adjustedPosition.x += (0.5 - uiRect.pivot.x) * entitySize.x;
            adjustedPosition.y += (0.5 - uiRect.pivot.y) * entitySize.y;
        }

        const adjustedLocal: Transform = {
            position: adjustedPosition,
            rotation: localTransform.rotation,
            scale: localTransform.scale,
        };

        if (entityData.parent === null) {
            return adjustedLocal;
        }

        const parentWorld = this.computeWorldTransform(entityData.parent);
        return composeTransforms(parentWorld, adjustedLocal);
    }

    private getLocalTransform(entity: EntityData): Transform {
        const comp = entity.components.find(c => c.type === 'LocalTransform');
        if (!comp) {
            return createIdentityTransform();
        }

        return {
            position: (comp.data.position as any) ?? { x: 0, y: 0, z: 0 },
            rotation: (comp.data.rotation as any) ?? { x: 0, y: 0, z: 0, w: 1 },
            scale: (comp.data.scale as any) ?? { x: 1, y: 1, z: 1 },
        };
    }

    private getUIRect(entity: EntityData): { size: { x: number; y: number }; anchor: { x: number; y: number }; pivot: { x: number; y: number } } | null {
        const comp = entity.components.find(c => c.type === 'UIRect');
        if (!comp) return null;

        return {
            size: (comp.data as any).size ?? { x: 100, y: 100 },
            anchor: (comp.data as any).anchor ?? { x: 0.5, y: 0.5 },
            pivot: (comp.data as any).pivot ?? { x: 0.5, y: 0.5 },
        };
    }

    private getEntitySize(entity: EntityData): { x: number; y: number } {
        const uiRect = this.getUIRect(entity);
        if (uiRect?.size) {
            return uiRect.size;
        }

        const sprite = entity.components.find(c => c.type === 'Sprite');
        if (sprite?.data?.size) {
            return (sprite.data as any).size;
        }

        return { x: 100, y: 100 };
    }

    private getParentSize(entity: EntityData): { x: number; y: number } {
        if (entity.parent !== null) {
            const parentData = this.entityDataMap_.get(entity.parent);
            if (parentData) {
                return this.getEntitySize(parentData);
            }
        }

        return this.getCanvasSize();
    }

    private getCanvasSize(): { x: number; y: number } {
        if (this.sceneData_) {
            for (const entity of this.sceneData_.entities) {
                const canvas = entity.components.find(c => c.type === 'Canvas');
                if (canvas?.data) {
                    const resolution = (canvas.data as any).designResolution;
                    if (resolution) {
                        return { x: resolution.x, y: resolution.y };
                    }
                }
            }
        }
        return { x: 1920, y: 1080 };
    }

    private async syncSprite(entity: Entity, data: any): Promise<void> {
        if (!this.registry_ || !this.textureManager_) return;

        let textureHandle = 0;

        const texturePath = data.texture;
        if (texturePath && this.projectDir_) {
            textureHandle = await this.textureManager_.loadTexture(
                this.projectDir_,
                texturePath
            );
        }

        if (this.registry_.hasSprite(entity)) {
            this.registry_.removeSprite(entity);
        }

        this.registry_.addSprite(entity, {
            texture: textureHandle,
            color: data.color ?? { x: 1, y: 1, z: 1, w: 1 },
            size: data.size ?? { x: 100, y: 100 },
            uvOffset: data.uvOffset ?? { x: 0, y: 0 },
            uvScale: data.uvScale ?? { x: 1, y: 1 },
            layer: data.layer ?? 0,
            flipX: data.flipX ?? false,
            flipY: data.flipY ?? false,
        });
    }

    private syncCamera(entity: Entity, data: any): void {
        if (!this.registry_) return;

        if (this.registry_.hasCamera(entity)) {
            this.registry_.removeCamera(entity);
        }

        this.registry_.addCamera(entity, {
            projectionType: data.projectionType ?? 1,
            fov: data.fov ?? 60,
            orthoSize: data.orthoSize ?? 400,
            nearPlane: data.nearPlane ?? 0.1,
            farPlane: data.farPlane ?? 1000,
            aspectRatio: data.aspectRatio ?? 1.0,
            isActive: data.isActive ?? true,
            priority: data.priority ?? 0,
        });
    }

    private syncText(entity: Entity, data: any, entityId: number): void {
        if (!this.registry_ || !this.textRenderer_) return;

        const entityData = this.entityDataMap_.get(entityId);
        const uiRect = entityData ? this.getUIRect(entityData) : null;

        const result = this.textRenderer_.renderText(entityId, data, uiRect);
        if (!result) return;

        if (this.registry_.hasSprite(entity)) {
            this.registry_.removeSprite(entity);
        }

        this.registry_.addSprite(entity, {
            texture: result.textureHandle,
            color: { x: 1, y: 1, z: 1, w: 1 },
            size: { x: result.width, y: result.height },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 25,
            flipX: false,
            flipY: false,
        });
    }
}
