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
    BitmapText,
    INVALID_TEXTURE,
    INVALID_FONT,
    TextRenderer,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
    type SceneComponentData,
    type TextData,
    type BitmapTextData,
    type LocalTransformData,
    type WorldTransformData,
} from 'esengine';
import type { SpineModuleController } from 'esengine/spine';
import { submitSpineMeshesToCore } from 'esengine/spine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { EditorAssetServer } from '../asset/EditorAssetServer';
import { AssetPathResolver } from '../asset/AssetPathResolver';
import { getDependencyGraph } from '../asset/AssetDependencyGraph';
import { getAssetLibrary, isUUID } from '../asset/AssetLibrary';
import {
    type Transform,
    getUIRectFromEntity,
    computeAdjustedLocalTransform,
    transformToMatrix4x4,
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
    private spineController_: SpineModuleController | null = null;
    private spineInstances_ = new Map<number, number>();
    private spineSkeletons_ = new Map<string, number>();
    private spineInstanceKeys_ = new Map<number, string>();
    private spineCurrentState_ = new Map<number, { animation: string; skin: string; loop: boolean }>();

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

    setSpineController(controller: SpineModuleController | null): void {
        this.clearSpineInstances();
        this.spineController_ = controller;
        if (controller) {
            this.resyncSpineEntities();
        }
    }

    private async resyncSpineEntities(): Promise<void> {
        for (const [entityId, entityData] of this.entityDataMap_) {
            const spineComp = entityData.components.find(c => c.type === 'SpineAnimation');
            if (!spineComp) continue;
            const entity = this.entityMap_.get(entityId);
            if (!entity) continue;
            await this.syncSpineAnimation(entity, spineComp.data, entityId);
        }
    }

    get spineController(): SpineModuleController | null {
        return this.spineController_;
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

            case 'BitmapText':
                await this.syncBitmapText(entity, comp.data, entityId);
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

    syncEntityTransform(entityId: number): void {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return;
        this.syncTransform(entity, null, entityId);
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
            this.destroySpineInstance(entityId);
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
        if (this.world_.has(entity, BitmapText)) {
            this.world_.remove(entity, BitmapText);
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
    // Spine Module Rendering
    // =========================================================================

    updateAndSubmitSpine(coreModule: ESEngineModule, dt: number): void {
        if (!this.spineController_ || this.spineInstances_.size === 0) return;

        for (const [entityId, instanceId] of this.spineInstances_) {
            const entityData = this.entityDataMap_.get(entityId);
            const spineComp = entityData?.components.find(c => c.type === 'SpineAnimation');
            const spineData = spineComp?.data as Record<string, unknown> | undefined;

            const skeletonScale = (spineData?.skeletonScale as number) ?? 1;
            const flipX = (spineData?.flipX as boolean) ?? false;
            const flipY = (spineData?.flipY as boolean) ?? false;
            const playing = spineData?.playing !== false;
            const timeScale = (spineData?.timeScale as number) ?? 1;
            const color = spineData?.color as { r: number; g: number; b: number; a: number } | undefined;

            if (playing) {
                this.spineController_.update(instanceId, dt * timeScale);
            }

            const entity = this.entityMap_.get(entityId);
            if (!entity) continue;

            const scaleX = skeletonScale * (flipX ? -1 : 1);
            const scaleY = skeletonScale * (flipY ? -1 : 1);

            const registry = this.registry;
            let transform: Float32Array | undefined;

            if (registry.hasWorldTransform(entity)) {
                const wt = registry.getWorldTransform(entity) as WorldTransformData;
                transform = transformToMatrix4x4({
                    position: wt.position,
                    rotation: wt.rotation,
                    scale: { x: wt.scale.x * scaleX, y: wt.scale.y * scaleY, z: wt.scale.z },
                });
            } else if (registry.hasLocalTransform(entity)) {
                const lt = registry.getLocalTransform(entity) as LocalTransformData;
                transform = transformToMatrix4x4({
                    position: lt.position,
                    rotation: lt.rotation,
                    scale: { x: lt.scale.x * scaleX, y: lt.scale.y * scaleY, z: lt.scale.z },
                });
            }

            submitSpineMeshesToCore(coreModule, this.spineController_, instanceId, transform, color);
        }
    }

    getSpineBoundsFromModule(sceneEntityId: number): { x: number; y: number; width: number; height: number } | null {
        if (!this.spineController_) return null;
        const instanceId = this.spineInstances_.get(sceneEntityId);
        if (instanceId === undefined) return null;
        return this.spineController_.getBounds(instanceId);
    }

    hasSpineInstance(entityId: number): boolean {
        return this.spineInstances_.has(entityId);
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        if (!this.spineController_) return null;
        const instanceId = this.spineInstances_.get(entityId);
        if (instanceId === undefined) return null;
        return {
            animations: this.spineController_.getAnimations(instanceId),
            skins: this.spineController_.getSkins(instanceId),
        };
    }

    // =========================================================================
    // Spine Instance Lifecycle
    // =========================================================================

    private destroySpineInstance(entityId: number): void {
        const instanceId = this.spineInstances_.get(entityId);
        if (instanceId !== undefined && this.spineController_) {
            this.spineController_.destroyInstance(instanceId);
        }
        this.spineInstances_.delete(entityId);
        this.spineInstanceKeys_.delete(entityId);
        this.spineCurrentState_.delete(entityId);
    }

    private clearSpineInstances(): void {
        if (this.spineController_) {
            for (const instanceId of this.spineInstances_.values()) {
                this.spineController_.destroyInstance(instanceId);
            }
        }
        this.spineInstances_.clear();
        this.spineSkeletons_.clear();
        this.spineInstanceKeys_.clear();
        this.spineCurrentState_.clear();
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    clear(): void {
        this.clearSpineInstances();
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

        const entityData = this.entityDataMap_.get(entityId);
        if (!entityData) return;

        const adjustedLocal = computeAdjustedLocalTransform(
            entityData, (id) => this.entityDataMap_.get(id)
        );

        this.world_.insert(entity, LocalTransform, {
            position: adjustedLocal.position,
            rotation: adjustedLocal.rotation,
            scale: adjustedLocal.scale,
        });
    }

    private resolveAssetRef(ref: string): string {
        if (isUUID(ref)) {
            return getAssetLibrary().getPath(ref) ?? ref;
        }
        return ref;
    }

    private async syncSprite(entity: Entity, data: any, entityId: number): Promise<void> {
        let textureHandle = INVALID_TEXTURE as number;
        let materialHandle = 0;

        getDependencyGraph().clearEntity(entityId);
        this.assetServer_.releaseMaterialInstance(entityId);

        const textureRef = data.texture;
        if (textureRef && typeof textureRef === 'string') {
            const texturePath = this.resolveAssetRef(textureRef);
            const info = await this.assetServer_.loadTexture(texturePath);
            textureHandle = info.handle;
            getDependencyGraph().registerUsage(textureRef, entityId);
        }

        const materialRef = data.material;
        if (materialRef && typeof materialRef === 'string') {
            const materialPath = this.resolveAssetRef(materialRef);
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
                getDependencyGraph().registerUsage(materialRef, entityId);
            } catch (err) {
                console.warn(`[EditorSceneManager] Failed to load material: ${materialPath}`, err);
            }
        }

        if (this.world_.has(entity, Sprite)) {
            this.world_.remove(entity, Sprite);
        }

        this.world_.insert(entity, Sprite, {
            texture: textureHandle,
            color: data.color ?? { r: 1, g: 1, b: 1, a: 1 },
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
            color: data.color ?? { r: 1, g: 1, b: 1, a: 1 },
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
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: result.width, y: result.height },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 25,
            flipX: false,
            flipY: false,
        });
    }

    private async syncBitmapText(entity: Entity, data: any, _entityId: number): Promise<void> {
        let fontHandle = INVALID_FONT as number;

        const fontRef = data.font;
        if (fontRef && typeof fontRef === 'string') {
            try {
                const fontPath = this.resolveAssetRef(fontRef);
                fontHandle = await this.assetServer_.loadBitmapFont(fontPath);
            } catch (err) {
                console.warn(`[EditorSceneManager] Failed to load bitmap font: ${fontRef}`, err);
            }
        }

        if (this.world_.has(entity, BitmapText)) {
            this.world_.remove(entity, BitmapText);
        }

        this.world_.insert(entity, BitmapText, {
            text: data.text ?? '',
            color: data.color ?? { r: 1, g: 1, b: 1, a: 1 },
            fontSize: data.fontSize ?? 1.0,
            align: data.align ?? 0,
            spacing: data.spacing ?? 0,
            layer: data.layer ?? 0,
            font: fontHandle,
        });
    }

    private async syncSpineAnimation(entity: Entity, data: any, entityId: number): Promise<void> {
        const skeletonRef = data.skeletonPath ?? '';
        const atlasRef = data.atlasPath ?? '';

        if (!skeletonRef || !atlasRef) {
            console.warn('[EditorSceneManager] SpineAnimation missing skeleton or atlas path');
            return;
        }

        const skeletonPath = this.resolveAssetRef(skeletonRef);
        const atlasPath = this.resolveAssetRef(atlasRef);

        getDependencyGraph().clearEntity(entityId);
        getDependencyGraph().registerUsage(skeletonRef, entityId);
        getDependencyGraph().registerUsage(atlasRef, entityId);

        if (this.spineController_) {
            await this.syncSpineViaModule(entityId, skeletonPath, atlasPath, data);
        } else {
            await this.syncSpineViaCore(entity, entityId, skeletonPath, atlasPath, data);
        }
    }

    private async syncSpineViaModule(
        entityId: number,
        skeletonPath: string,
        atlasPath: string,
        data: any,
    ): Promise<void> {
        const controller = this.spineController_!;
        const cacheKey = `${skeletonPath}:${atlasPath}`;

        const existingKey = this.spineInstanceKeys_.get(entityId);
        let instanceId = this.spineInstances_.get(entityId);

        if (instanceId === undefined || existingKey !== cacheKey) {
            this.destroySpineInstance(entityId);

            let skeletonHandle = this.spineSkeletons_.get(cacheKey);
            if (skeletonHandle === undefined) {
                const result = await this.assetServer_.assetLoader.loadSpineToModule(
                    controller, skeletonPath, atlasPath
                );
                if (!result.success || result.skeletonHandle === undefined) {
                    console.warn(`[EditorSceneManager] Failed to load Spine to module: ${result.error}`);
                    return;
                }
                skeletonHandle = result.skeletonHandle;
                this.spineSkeletons_.set(cacheKey, skeletonHandle);
            }

            instanceId = controller.createInstance(skeletonHandle);
            this.spineInstances_.set(entityId, instanceId);
            this.spineInstanceKeys_.set(entityId, cacheKey);
            this.spineCurrentState_.delete(entityId);
        }

        const skin = data.skin ?? 'default';
        const animation = data.animation ?? '';
        const loop = data.loop ?? true;
        const prev = this.spineCurrentState_.get(entityId);

        if (!prev || prev.skin !== skin) {
            controller.setSkin(instanceId, skin);
        }
        if (!prev || prev.animation !== animation || prev.loop !== loop) {
            if (animation) {
                controller.play(instanceId, animation, loop);
            }
        }

        this.spineCurrentState_.set(entityId, { animation, skin, loop });
    }

    private async syncSpineViaCore(
        entity: Entity,
        entityId: number,
        skeletonPath: string,
        atlasPath: string,
        data: any,
    ): Promise<void> {
        const result = await this.assetServer_.loadSpine(skeletonPath, atlasPath);
        if (!result.success) {
            console.warn(`[EditorSceneManager] Failed to load Spine: ${result.error}`);
            return;
        }

        let materialHandle = 0;
        const materialRef = data.material;
        if (materialRef && typeof materialRef === 'string') {
            const materialPath = this.resolveAssetRef(materialRef);
            try {
                const loaded = await this.assetServer_.loadMaterial(materialPath);
                materialHandle = loaded.handle;
                getDependencyGraph().registerUsage(materialRef, entityId);
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
                color: data.color ?? { r: 1, g: 1, b: 1, a: 1 },
                layer: data.layer ?? 0,
                skeletonScale: data.skeletonScale ?? 1,
                material: materialHandle,
            },
        });
    }
}
