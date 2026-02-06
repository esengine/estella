/**
 * @file    EditorSceneManager.ts
 * @brief   Scene manager using SDK's World and loadSceneWithAssets
 */

import type { ESEngineModule, CppRegistry, Entity } from 'esengine';
import {
    World,
    loadComponent,
    LocalTransform,
    Sprite,
    TextRenderer,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
    type SceneComponentData,
    type TextData,
} from 'esengine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { EditorAssetServer } from '../asset/EditorAssetServer';
import { AssetPathResolver } from '../asset/AssetPathResolver';
import { getDependencyGraph } from '../asset/AssetDependencyGraph';
import {
    Transform,
    createIdentityTransform,
    getLocalTransformFromEntity,
    getUIRectFromEntity,
    getEntitySize,
} from '../math/Transform';

// =============================================================================
// EditorSceneManager
// =============================================================================

export class EditorSceneManager {
    private module_: ESEngineModule;
    private world_: World;
    private assetServer_: EditorAssetServer;
    private pathResolver_: AssetPathResolver;
    private textRenderer_: TextRenderer;
    private entityMap_ = new Map<number, Entity>();
    private entityDataMap_ = new Map<number, EntityData>();
    private sceneData_: SceneData | null = null;
    private syncing_ = false;
    private pendingScene_: SceneData | null = null;

    constructor(module: ESEngineModule, pathResolver: AssetPathResolver) {
        this.module_ = module;
        this.pathResolver_ = pathResolver;
        this.world_ = new World();
        this.world_.connectCpp(new module.Registry() as CppRegistry);
        this.assetServer_ = new EditorAssetServer(module, pathResolver);
        this.textRenderer_ = new TextRenderer(module);
    }

    setProjectDir(projectDir: string): void {
        this.pathResolver_.setProjectDir(projectDir);
    }

    // =========================================================================
    // Scene Loading
    // =========================================================================

    async loadScene(scene: SceneData): Promise<void> {
        if (this.syncing_) {
            this.pendingScene_ = scene;
            return;
        }

        this.syncing_ = true;

        try {
            await this.loadSceneInternal(scene);

            if (this.pendingScene_) {
                const latest = this.pendingScene_;
                this.pendingScene_ = null;
                await this.loadSceneInternal(latest);
            }
        } finally {
            this.syncing_ = false;
        }
    }

    private async loadSceneInternal(scene: SceneData): Promise<void> {
        this.clear();

        this.sceneData_ = scene;
        for (const entityData of scene.entities) {
            this.entityDataMap_.set(entityData.id, entityData);
        }

        for (const entityData of scene.entities) {
            await this.loadEntity(entityData);
        }

        for (const entityData of scene.entities) {
            if (entityData.parent !== null) {
                const entity = this.entityMap_.get(entityData.id);
                const parentEntity = this.entityMap_.get(entityData.parent);
                if (entity !== undefined && parentEntity !== undefined) {
                    this.world_.setParent(entity, parentEntity);
                }
            }
        }
    }

    private async loadEntity(entityData: EntityData): Promise<void> {
        const entity = this.world_.spawn();
        this.entityMap_.set(entityData.id, entity);

        if (entityData.visible === false) return;

        for (const comp of entityData.components) {
            await this.loadComponentWithEditorLogic(entity, comp, entityData.id);
        }
    }

    private async loadComponentWithEditorLogic(
        entity: Entity,
        comp: ComponentData,
        entityId: number
    ): Promise<void> {
        switch (comp.type) {
            case 'LocalTransform':
                this.syncTransform(entity, comp.data, entityId);
                break;

            case 'Sprite': {
                const entityData = this.entityDataMap_.get(entityId);
                const hasText = entityData?.components.some(c => c.type === 'Text');
                if (!hasText) {
                    await this.syncSprite(entity, comp.data, entityId);
                }
                break;
            }

            case 'Text':
                this.syncText(entity, comp.data, entityId);
                break;

            case 'SpineAnimation':
                await this.syncSpineAnimation(entity, comp.data, entityId);
                break;

            default:
                loadComponent(this.world_, entity, comp as SceneComponentData);
        }
    }

    // =========================================================================
    // Incremental Updates
    // =========================================================================

    async updateEntity(entityId: number, components: ComponentData[]): Promise<void> {
        const entity = this.entityMap_.get(entityId);
        if (!entity) return;

        const existingData = this.entityDataMap_.get(entityId);
        if (existingData) {
            existingData.components = components;
        }

        for (const comp of components) {
            await this.loadComponentWithEditorLogic(entity, comp, entityId);
        }
    }

    reparentEntity(entityId: number, newParentId: number | null): void {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return;

        if (newParentId !== null) {
            const parentEntity = this.entityMap_.get(newParentId);
            if (parentEntity !== undefined) {
                this.world_.setParent(entity, parentEntity);
            }
        } else {
            this.world_.removeParent(entity);
        }

        const entityData = this.entityDataMap_.get(entityId);
        if (entityData) {
            const transformComp = entityData.components.find(c => c.type === 'LocalTransform');
            if (transformComp) {
                this.syncTransform(entity, transformComp.data, entityId);
            }
        }
    }

    removeEntity(entityId: number): void {
        const entity = this.entityMap_.get(entityId);
        if (entity) {
            getDependencyGraph().clearEntity(entityId);
            this.world_.despawn(entity);
            this.entityMap_.delete(entityId);
            this.entityDataMap_.delete(entityId);
        }
    }

    // =========================================================================
    // Visibility
    // =========================================================================

    hideEntity(entityId: number): void {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return;

        if (this.world_.has(entity, Sprite)) {
            this.world_.remove(entity, Sprite);
        }
    }

    async showEntity(entityId: number): Promise<void> {
        const entityData = this.entityDataMap_.get(entityId);
        if (!entityData) return;
        await this.updateEntity(entityId, entityData.components);
    }

    // =========================================================================
    // Accessors
    // =========================================================================

    getEntityMap(): Map<number, Entity> {
        return this.entityMap_;
    }

    get world(): World {
        return this.world_;
    }

    get registry(): CppRegistry {
        const registry = (this.world_ as any).cppRegistry_;
        if (!registry) {
            throw new Error('CppRegistry not connected');
        }
        return registry;
    }

    get assetServer(): EditorAssetServer {
        return this.assetServer_;
    }

    get textRenderer(): TextRenderer {
        return this.textRenderer_;
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    clear(): void {
        for (const entityId of this.entityMap_.keys()) {
            getDependencyGraph().clearEntity(entityId);
        }
        for (const entity of this.entityMap_.values()) {
            this.world_.despawn(entity);
        }
        this.entityMap_.clear();
        this.entityDataMap_.clear();
        this.sceneData_ = null;
        this.textRenderer_.releaseAll();
    }

    dispose(): void {
        this.clear();
        this.assetServer_.releaseAll();
        const registry = this.registry;
        registry.delete();
    }

    // =========================================================================
    // Component Sync (Editor-specific logic)
    // =========================================================================

    private syncTransform(entity: Entity, data: any, entityId: number): void {
        if (this.world_.has(entity, LocalTransform)) {
            this.world_.remove(entity, LocalTransform);
        }

        const adjustedLocal = this.computeAdjustedLocalTransform(entityId);

        this.world_.insert(entity, LocalTransform, {
            position: adjustedLocal.position,
            rotation: adjustedLocal.rotation,
            scale: adjustedLocal.scale,
        });
    }

    private computeAdjustedLocalTransform(entityId: number): Transform {
        const entityData = this.entityDataMap_.get(entityId);
        if (!entityData) {
            return createIdentityTransform();
        }

        const localTransform = getLocalTransformFromEntity(entityData);
        const uiRect = getUIRectFromEntity(entityData);
        const size = getEntitySize(entityData);

        let adjustedPosition = { ...localTransform.position };

        if (uiRect) {
            const parentSize = this.getParentSize(entityData);

            adjustedPosition.x += (uiRect.anchor.x - 0.5) * parentSize.x;
            adjustedPosition.y += (uiRect.anchor.y - 0.5) * parentSize.y;

            adjustedPosition.x += (0.5 - uiRect.pivot.x) * size.x;
            adjustedPosition.y += (0.5 - uiRect.pivot.y) * size.y;
        }

        return {
            position: adjustedPosition,
            rotation: localTransform.rotation,
            scale: localTransform.scale,
        };
    }

    private getParentSize(entity: EntityData): { x: number; y: number } {
        if (entity.parent !== null) {
            const parentData = this.entityDataMap_.get(entity.parent);
            if (parentData) {
                return getEntitySize(parentData);
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

    private async syncSprite(entity: Entity, data: any, entityId: number): Promise<void> {
        let textureHandle = 0;
        let materialHandle = 0;

        getDependencyGraph().clearEntity(entityId);
        this.assetServer_.releaseMaterialInstance(entityId);

        const texturePath = data.texture;
        if (texturePath) {
            const info = await this.assetServer_.loadTexture(texturePath);
            textureHandle = info.handle;
            getDependencyGraph().registerUsage(texturePath, entityId);
        }

        const materialPath = data.material;
        if (materialPath) {
            try {
                const loaded = await this.assetServer_.loadMaterial(materialPath);
                const overrides = data.materialOverrides;

                if (overrides && Object.keys(overrides).length > 0) {
                    materialHandle = this.assetServer_.createMaterialInstance(
                        materialPath, entityId, overrides
                    );
                } else {
                    materialHandle = loaded.handle;
                }
                getDependencyGraph().registerUsage(materialPath, entityId);
            } catch (err) {
                console.warn(`[EditorSceneManager] Failed to load material: ${materialPath}`, err);
            }
        }

        if (this.world_.has(entity, Sprite)) {
            this.world_.remove(entity, Sprite);
        }

        this.world_.insert(entity, Sprite, {
            texture: textureHandle,
            color: data.color ?? { x: 1, y: 1, z: 1, w: 1 },
            size: data.size ?? { x: 100, y: 100 },
            uvOffset: data.uvOffset ?? { x: 0, y: 0 },
            uvScale: data.uvScale ?? { x: 1, y: 1 },
            layer: data.layer ?? 0,
            flipX: data.flipX ?? false,
            flipY: data.flipY ?? false,
            material: materialHandle,
        });
    }

    private syncText(entity: Entity, data: any, entityId: number): void {
        const entityData = this.entityDataMap_.get(entityId);
        const uiRectData = entityData ? getUIRectFromEntity(entityData) : null;

        const textData: TextData = {
            content: data.content ?? '',
            fontFamily: data.fontFamily ?? 'Arial',
            fontSize: data.fontSize ?? 24,
            color: data.color ?? { x: 1, y: 1, z: 1, w: 1 },
            align: data.align ?? TextAlign.Left,
            verticalAlign: data.verticalAlign ?? TextVerticalAlign.Top,
            wordWrap: data.wordWrap ?? true,
            overflow: data.overflow ?? TextOverflow.Visible,
            lineHeight: data.lineHeight ?? 1.2,
            dirty: true,
        };

        if (!textData.content) return;

        const result = this.textRenderer_.renderForEntity(entity, textData, uiRectData);

        if (this.world_.has(entity, Sprite)) {
            this.world_.remove(entity, Sprite);
        }

        this.world_.insert(entity, Sprite, {
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

    private async syncSpineAnimation(entity: Entity, data: any, entityId: number): Promise<void> {
        const skeletonPath = data.skeletonPath ?? '';
        const atlasPath = data.atlasPath ?? '';

        if (!skeletonPath || !atlasPath) {
            console.warn('[EditorSceneManager] SpineAnimation missing skeleton or atlas path');
            return;
        }

        getDependencyGraph().clearEntity(entityId);

        const result = await this.assetServer_.loadSpine(skeletonPath, atlasPath);
        if (!result.success) {
            console.warn(`[EditorSceneManager] Failed to load Spine: ${result.error}`);
            return;
        }

        getDependencyGraph().registerUsage(skeletonPath, entityId);
        getDependencyGraph().registerUsage(atlasPath, entityId);

        let materialHandle = 0;
        const materialPath = data.material;
        if (materialPath) {
            try {
                const loaded = await this.assetServer_.loadMaterial(materialPath);
                materialHandle = loaded.handle;
                getDependencyGraph().registerUsage(materialPath, entityId);
            } catch (err) {
                console.warn(`[EditorSceneManager] Failed to load material: ${materialPath}`, err);
            }
        }

        loadComponent(this.world_, entity, {
            type: 'SpineAnimation',
            data: {
                skeletonPath,
                atlasPath,
                skin: data.skin ?? 'default',
                animation: data.animation ?? '',
                timeScale: data.timeScale ?? 1,
                loop: data.loop ?? true,
                playing: data.playing ?? true,
                flipX: data.flipX ?? false,
                flipY: data.flipY ?? false,
                color: data.color ?? { x: 1, y: 1, z: 1, w: 1 },
                layer: data.layer ?? 0,
                skeletonScale: data.skeletonScale ?? 1,
                material: materialHandle,
            },
        });
    }
}
