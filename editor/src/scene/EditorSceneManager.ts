/**
 * @file    EditorSceneManager.ts
 * @brief   Scene manager using SDK's World and loadSceneWithAssets
 */

import type { ESEngineModule, CppRegistry, Entity } from 'esengine';
import {
    World,
    App,
    loadComponent,
    remapEntityFields,
    Transform,
    Sprite,
    BitmapText,
    Renderer,
    Text,
    TextInput,
    Name,
    getComponentAssetFieldDescriptors,
    getComponentSpineFieldDescriptor,
    Audio,
    INVALID_FONT,
    INVALID_MATERIAL,
    UIRect,
    UIMask,
    defineSystem,
    Schedule,
    registerAnimClip,
    parseAnimClipData,
    extractAnimClipTexturePaths,
    getAnimClip,
    type AnimClipAssetData,
    type SceneComponentData,
    type TextInputData,
    type LayoutRect,
    ScaleMode,
    parseTmjJson,
    resolveRelativePath,
    registerTextureDimensions,
    registerTilemapSource,
    registerTimelineAsset,
    parseTimelineAsset,
    SpineAnimation,
} from 'esengine';
import { SpineCpp, SpineManager } from 'esengine/spine';
import type { SceneData, EntityData, ComponentData } from '../types/SceneTypes';
import { EditorAssetServer } from '../asset/EditorAssetServer';
import { AssetPathResolver } from '../asset/AssetPathResolver';
import { getDependencyGraph } from '../asset/AssetDependencyGraph';
import { getAssetLibrary, isUUID } from '../asset/AssetLibrary';
import { getEditorContext } from '../context/EditorContext';
import { getEditorContainer } from '../container/EditorContainer';
import { COMPONENT_LIFECYCLE, type ComponentLifecycle } from '../container/tokens';
import { getPlatformAdapter } from '../platform/PlatformAdapter';

const BitmapTextAlign = {
    Left: 0,
    Center: 1,
    Right: 2,
} as const;

const COMPONENT_SUPPRESS_RULES = new Map<string, Set<string>>([
    ['Sprite', new Set(['Text', 'SpineAnimation'])],
]);

const EDITOR_IGNORED_COMPONENTS = new Set<string>();

// =============================================================================
// EditorSceneManager
// =============================================================================

export class EditorSceneManager {
    private module_: ESEngineModule;
    private world_: World;
    private assetServer_: EditorAssetServer;
    private pathResolver_: AssetPathResolver;
    private entityMap_ = new Map<number, Entity>();
    private entityDataMap_ = new Map<number, EntityData>();
    private sceneData_: SceneData | null = null;
    private syncing_ = false;
    private pendingScene_: SceneData | null = null;
    private syncCompleteResolvers_: (() => void)[] = [];
    private spineReadyListeners_ = new Set<(entityId: number) => void>();
    private updatingEntities_ = new Map<number, Promise<void>>();
    private viewportAspect_ = 0;
    private postLoadHooks_ = new Map<string, (entityId: number, data: Record<string, any>) => Promise<void>>();

    private ownsWorld_: boolean;
    private spineManager_: SpineManager | null = null;
    private pendingSpineData_ = new Map<number, {
        skelData: Uint8Array | string;
        atlasText: string;
        textures: Map<string, { glId: number; w: number; h: number }>;
    }>();

    constructor(module: ESEngineModule, pathResolver: AssetPathResolver, world?: World) {
        this.module_ = module;
        this.pathResolver_ = pathResolver;
        if (world) {
            this.world_ = world;
            this.ownsWorld_ = false;
        } else {
            this.world_ = new World();
            this.world_.connectCpp(new module.Registry() as CppRegistry);
            this.ownsWorld_ = true;
        }
        this.assetServer_ = new EditorAssetServer(module, pathResolver);
        this.postLoadHooks_.set('SpineAnimation', (id, data) => this.syncSpineInstance(id, data));
        this.postLoadHooks_.set('SpriteAnimator', (id, data) => this.applyAnimFirstFrame(id, data));
        this.registerComponentLifecycles_();
    }

    private registerComponentLifecycles_(): void {
        const container = getEditorContainer();
        const simpleRemove = (comp: any): ComponentLifecycle => ({
            remove: (world, entity) => {
                if (world.has(entity, comp)) world.remove(entity, comp);
            },
        });
        container.provide(COMPONENT_LIFECYCLE, 'Transform', simpleRemove(Transform));
        container.provide(COMPONENT_LIFECYCLE, 'Sprite', simpleRemove(Sprite));
        container.provide(COMPONENT_LIFECYCLE, 'BitmapText', simpleRemove(BitmapText));
        container.provide(COMPONENT_LIFECYCLE, 'UIRect', simpleRemove(UIRect));
        container.provide(COMPONENT_LIFECYCLE, 'UIMask', simpleRemove(UIMask));
        container.provide(COMPONENT_LIFECYCLE, 'Text', simpleRemove(Text));
        container.provide(COMPONENT_LIFECYCLE, 'TextInput', {
            remove: (world, entity) => {
                if (world.has(entity, TextInput)) world.remove(entity, TextInput);
                if (world.has(entity, Text)) world.remove(entity, Text);
            },
        });
        container.provide(COMPONENT_LIFECYCLE, 'SpineAnimation', {
            remove: (_world, entity, _entityId) => {
                this.spineManager_?.removeEntity(entity);
            },
        });
    }

    setSpineManager(manager: SpineManager | null): void {
        this.spineManager_ = manager;
    }

    setProjectDir(projectDir: string): void {
        this.pathResolver_.setProjectDir(projectDir);
    }

    setViewportSize(width: number, height: number): void {
        if (height > 0) {
            this.viewportAspect_ = width / height;
        }
    }

    getCanvasRect(): LayoutRect | null {
        let designResolution: { x: number; y: number } | null = null;
        let scaleMode = ScaleMode.FixedHeight as number;
        let matchWidthOrHeight = 0.5;
        let cameraPos = { x: 0, y: 0 };

        for (const [_, entityData] of this.entityDataMap_) {
            const canvas = entityData.components.find(c => c.type === 'Canvas');
            if (canvas?.data?.designResolution) {
                designResolution = canvas.data.designResolution as { x: number; y: number };
                scaleMode = (canvas.data.scaleMode as number) ?? ScaleMode.FixedHeight;
                matchWidthOrHeight = (canvas.data.matchWidthOrHeight as number) ?? 0.5;
            }
            const camera = entityData.components.find(c => c.type === 'Camera');
            if (camera) {
                const lt = entityData.components.find(c => c.type === 'Transform');
                if (lt?.data?.position) {
                    const pos = lt.data.position as { x: number; y: number };
                    cameraPos = { x: pos.x, y: pos.y };
                }
            }
        }

        if (!designResolution) return null;

        const baseOrthoSize = designResolution.y / 2;
        const designAspect = designResolution.x / designResolution.y;
        const actualAspect = this.viewportAspect_ > 0 ? this.viewportAspect_ : designAspect;

        const orthoForWidth = baseOrthoSize * designAspect / actualAspect;
        const orthoForHeight = baseOrthoSize;
        let halfH: number;
        switch (scaleMode) {
            case ScaleMode.FixedWidth:
                halfH = orthoForWidth; break;
            case ScaleMode.FixedHeight:
                halfH = orthoForHeight; break;
            case ScaleMode.Expand:
                halfH = Math.max(orthoForWidth, orthoForHeight); break;
            case ScaleMode.Shrink:
                halfH = Math.min(orthoForWidth, orthoForHeight); break;
            case ScaleMode.Match:
                halfH = Math.pow(orthoForWidth, 1 - matchWidthOrHeight)
                      * Math.pow(orthoForHeight, matchWidthOrHeight);
                break;
            default:
                halfH = orthoForHeight;
        }
        const halfW = halfH * actualAspect;

        return {
            left: cameraPos.x - halfW,
            bottom: cameraPos.y - halfH,
            right: cameraPos.x + halfW,
            top: cameraPos.y + halfH,
        };
    }

    // =========================================================================
    // Scene Loading
    // =========================================================================

    async loadScene(scene: SceneData): Promise<void> {
        if (this.syncing_) {
            this.pendingScene_ = scene;
            return new Promise<void>(resolve => {
                this.syncCompleteResolvers_.push(resolve);
            });
        }

        this.syncing_ = true;

        try {
            await this.loadSceneInternal(scene);

            while (this.pendingScene_) {
                const latest = this.pendingScene_;
                this.pendingScene_ = null;
                await this.loadSceneInternal(latest);
            }
        } finally {
            this.syncing_ = false;
            const resolvers = this.syncCompleteResolvers_.splice(0);
            for (const resolve of resolvers) {
                resolve();
            }
        }
    }

    private async loadSceneInternal(scene: SceneData): Promise<void> {
        this.clear();

        this.sceneData_ = scene;

        for (const entityData of scene.entities) {
            this.entityDataMap_.set(entityData.id, entityData);
            const entity = this.world_.spawn();
            this.entityMap_.set(entityData.id, entity);
            if (entityData.name) {
                this.world_.insert(entity, Name, { value: entityData.name });
            }
        }

        const loadPromises: Promise<void>[] = [];
        for (const entityData of scene.entities) {
            if (entityData.parent !== null) {
                const entity = this.entityMap_.get(entityData.id)!;
                const parentEntity = this.entityMap_.get(entityData.parent);
                if (parentEntity !== undefined) {
                    this.world_.setParent(entity, parentEntity);
                }
            }
            if (entityData.visible !== false) {
                loadPromises.push(this.loadEntityComponents(entityData));
            }
        }
        await Promise.all(loadPromises);
    }

    private async loadEntityComponents(entityData: EntityData): Promise<void> {
        const entity = this.entityMap_.get(entityData.id)!;
        getDependencyGraph().clearEntity(entityData.id);
        this.assetServer_.releaseMaterialInstance(entityData.id);
        for (const comp of entityData.components) {
            await this.loadComponentForEntity(entity, comp, entityData.id);
        }
    }

    private async loadComponentForEntity(
        entity: Entity,
        comp: ComponentData,
        entityId: number,
    ): Promise<void> {
        if (EDITOR_IGNORED_COMPONENTS.has(comp.type)) return;

        const suppressors = COMPONENT_SUPPRESS_RULES.get(comp.type);
        if (suppressors) {
            const ed = this.entityDataMap_.get(entityId);
            if (ed?.components.some(c => suppressors.has(c.type))) return;
        }

        const resolved: ComponentData = { type: comp.type, data: { ...comp.data } };
        remapEntityFields(resolved as SceneComponentData, this.entityMap_);
        await this.resolveComponentAssets(resolved, entityId);
        loadComponent(this.world_, entity, resolved as SceneComponentData);

        const hook = this.postLoadHooks_.get(comp.type);
        if (hook) await hook(entityId, resolved.data as Record<string, any>);
    }

    // =========================================================================
    // Incremental Updates
    // =========================================================================

    async updateEntity(entityId: number, components: ComponentData[], entityData?: EntityData): Promise<void> {
        if (this.syncing_) return;

        const prev = this.updatingEntities_.get(entityId);
        if (prev) {
            await prev;
        }

        const p = this.updateEntityInternal(entityId, components, entityData);
        this.updatingEntities_.set(entityId, p);
        try {
            await p;
        } finally {
            if (this.updatingEntities_.get(entityId) === p) {
                this.updatingEntities_.delete(entityId);
            }
        }
    }

    private async updateEntityInternal(entityId: number, components: ComponentData[], entityData?: EntityData): Promise<void> {
        let entity = this.entityMap_.get(entityId);
        if (entity === undefined) {
            entity = this.world_.spawn();
            this.entityMap_.set(entityId, entity);
        }

        if (entityData) {
            this.entityDataMap_.set(entityId, entityData);
        } else {
            const existing = this.entityDataMap_.get(entityId);
            if (existing) {
                existing.components = components;
            }
        }

        getDependencyGraph().clearEntity(entityId);
        this.assetServer_.releaseMaterialInstance(entityId);
        for (const comp of components) {
            await this.loadComponentForEntity(entity, comp, entityId);
        }
    }

    patchUIRectOffset(entityId: number, minX: number, minY: number, maxX: number, maxY: number): void {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return;
        this.module_.uiRect_patchOffset(this.registry, entity, minX, minY, maxX, maxY);
    }

    patchTransformPosition(entityId: number, x: number, y: number, z: number): void {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return;
        this.module_.transform_patchPosition(this.registry, entity, x, y, z);
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
    }

    removeEntity(entityId: number): void {
        const entity = this.entityMap_.get(entityId);
        if (entity !== undefined) {
            getDependencyGraph().clearEntity(entityId);
            try {
                this.world_.despawn(entity);
            } catch (e) {
                console.warn(`[EditorSceneManager] despawn failed for entity ${entityId}`, e);
            }
            this.entityMap_.delete(entityId);
            this.entityDataMap_.delete(entityId);
        }
    }

    spawnEntity(entityId: number, parentId: number | null): void {
        if (this.entityMap_.has(entityId)) return;
        const entity = this.world_.spawn();
        this.entityMap_.set(entityId, entity);
        if (parentId !== null) {
            const parentEntity = this.entityMap_.get(parentId);
            if (parentEntity !== undefined) {
                try {
                    this.world_.setParent(entity, parentEntity);
                } catch (e) {
                    console.warn(`[EditorSceneManager] setParent failed for entity ${entityId} -> ${parentId}`, e);
                }
            }
        }
    }

    hasEntity(entityId: number): boolean {
        return this.entityMap_.has(entityId);
    }

    updateTransform(entityId: number, data: Record<string, unknown>): void {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return;
        this.world_.insert(entity, Transform, data);
    }

    removeComponentFromEntity(entityId: number, componentType: string): void {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return;
        const lifecycle = getEditorContainer().get(COMPONENT_LIFECYCLE, componentType);
        if (lifecycle) {
            lifecycle.remove(this.world_, entity, entityId);
        }
    }

    // =========================================================================
    // Visibility
    // =========================================================================

    hideEntity(entityId: number): void {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return;

        this.setRenderEnabled_(entity, false);
    }

    private setRenderEnabled_(entity: Entity, enabled: boolean): void {
        if (this.world_.has(entity, Sprite)) {
            const s = this.world_.get(entity, Sprite);
            if (s.enabled !== enabled) {
                s.enabled = enabled;
                this.world_.insert(entity, Sprite, s);
            }
        }
        if (this.world_.has(entity, BitmapText)) {
            const bt = this.world_.get(entity, BitmapText);
            if (bt.enabled !== enabled) {
                bt.enabled = enabled;
                this.world_.insert(entity, BitmapText, bt);
            }
        }
        if (this.world_.has(entity, SpineAnimation)) {
            const sa = this.world_.get(entity, SpineAnimation);
            if (sa.enabled !== enabled) {
                sa.enabled = enabled;
                this.world_.insert(entity, SpineAnimation, sa);
                this.spineManager_?.setEnabled(entity, enabled);
            }
        }
    }

    async showEntity(entityId: number): Promise<void> {
        const entity = this.entityMap_.get(entityId);
        if (entity !== undefined) {
            this.setRenderEnabled_(entity, true);
        }
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
        const reg = this.world_.getCppRegistry();
        if (!reg) throw new Error('CppRegistry not connected');
        return reg;
    }

    get isBusy(): boolean {
        return this.syncing_ || this.updatingEntities_.size > 0;
    }

    get assetServer(): EditorAssetServer {
        return this.assetServer_;
    }

    // =========================================================================
    // Spine (C++ path)
    // =========================================================================

    getBitmapTextBounds(entityId: number): { width: number; height: number; offsetX: number; offsetY: number } | null {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return null;

        const registry = this.registry;
        if (!registry.hasBitmapText(entity)) return null;

        const bt = registry.getBitmapText(entity);
        if (!bt.text || bt.font === (INVALID_FONT as number)) return null;

        const metrics = Renderer.measureBitmapText(bt.font, bt.text, bt.fontSize, bt.spacing);

        let offsetX = metrics.width / 2;
        if (bt.align === BitmapTextAlign.Center) {
            offsetX = 0;
        } else if (bt.align === BitmapTextAlign.Right) {
            offsetX = -metrics.width / 2;
        }

        return { width: metrics.width, height: metrics.height, offsetX, offsetY: metrics.height / 2 };
    }

    hasSpineInstance(entityId: number): boolean {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return false;
        if (this.spineManager_?.hasInstance(entity)) return true;
        return SpineCpp.hasInstance(entity);
    }

    onSpineInstanceReady(listener: (entityId: number) => void): () => void {
        this.spineReadyListeners_.add(listener);
        return () => this.spineReadyListeners_.delete(listener);
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        const entity = this.entityMap_.get(entityId);
        if (entity === undefined) return null;
        if (this.spineManager_?.hasInstance(entity)) {
            return {
                animations: this.spineManager_.getAnimations(entity),
                skins: this.spineManager_.getSkins(entity),
            };
        }
        if (!SpineCpp.hasInstance(entity)) return null;
        return {
            animations: SpineCpp.getAnimations(entity),
            skins: SpineCpp.getSkins(entity),
        };
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    clear(): void {
        for (const entityId of this.entityMap_.keys()) {
            getDependencyGraph().clearEntity(entityId);
        }
        if (this.spineManager_) {
            for (const entity of this.entityMap_.values()) {
                this.spineManager_.removeEntity(entity);
            }
        }
        this.pendingSpineData_.clear();
        for (const entity of this.world_.getAllEntities()) {
            this.world_.despawn(entity);
        }
        this.entityMap_.clear();
        this.entityDataMap_.clear();
        this.sceneData_ = null;
    }

    dispose(): void {
        this.clear();
        this.assetServer_.releaseAll();
        if (this.ownsWorld_) {
            const registry = this.registry;
            this.world_.disconnectCpp();
            registry.delete();
        }
    }

    // =========================================================================
    // System Registration
    // =========================================================================

    registerSystems(app: App): void {
        const self = this;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                for (const entity of self.world_.getEntitiesWithComponents([TextInput])) {
                    const input = self.world_.get(entity, TextInput) as TextInputData;
                    const isEmpty = !input.value;
                    const displayText = isEmpty ? input.placeholder : input.value;
                    if (!displayText) {
                        if (self.world_.has(entity, Text)) self.world_.remove(entity, Text);
                        continue;
                    }
                    self.world_.insert(entity, Text, {
                        content: displayText,
                        fontFamily: input.fontFamily,
                        fontSize: input.fontSize,
                        color: isEmpty ? input.placeholderColor : input.color,
                        wordWrap: false,
                    });
                }
            },
            { name: 'EditorTextInputVisualSystem' },
        ), { runBefore: ['TextSystem'] });

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                for (const [entityId, entityData] of self.entityDataMap_) {
                    if (entityData.visible !== false) continue;
                    const entity = self.entityMap_.get(entityId);
                    if (entity === undefined) continue;
                    self.setRenderEnabled_(entity, false);
                }
            },
            { name: 'EditorVisibilityEnforcementSystem' },
        ), { runAfter: ['TextSystem'] });
    }

    // =========================================================================
    // Generic Asset Resolution
    // =========================================================================

    private resolveAssetRef(ref: string): string {
        if (isUUID(ref)) {
            return getAssetLibrary().getPath(ref) ?? ref;
        }
        return ref;
    }

    private async resolveComponentAssets(comp: ComponentData, entityId: number): Promise<void> {
        const data = comp.data as Record<string, any>;

        const descriptors = getComponentAssetFieldDescriptors(comp.type);
        for (const desc of descriptors) {
            const ref = data[desc.field];
            if (typeof ref !== 'string' || !ref) continue;

            const resolved = this.resolveAssetRef(ref);
            getDependencyGraph().registerUsage(ref, entityId);

            switch (desc.type) {
                case 'texture': {
                    const info = await this.assetServer_.loadTexture(resolved);
                    data[desc.field] = info.handle;
                    break;
                }
                case 'material': {
                    try {
                        const loaded = await this.assetServer_.loadMaterial(resolved);
                        const overrides = data.materialOverrides;
                        if (overrides && Object.keys(overrides).length > 0) {
                            data[desc.field] = this.assetServer_.createMaterialInstance(
                                resolved, entityId, overrides,
                            );
                        } else {
                            data[desc.field] = loaded.handle;
                        }
                    } catch (err) {
                        console.warn(`[EditorSceneManager] Failed to load material: ${resolved}`, err);
                        data[desc.field] = INVALID_MATERIAL;
                    }
                    break;
                }
                case 'font': {
                    try {
                        data[desc.field] = await this.assetServer_.loadBitmapFont(resolved);
                    } catch (err) {
                        console.warn(`[EditorSceneManager] Failed to load bitmap font: ${resolved}`, err);
                        data[desc.field] = INVALID_FONT;
                    }
                    break;
                }
                case 'anim-clip': {
                    try {
                        await this.loadAndRegisterAnimClip(resolved);
                        data[desc.field] = resolved;
                    } catch (err) {
                        console.warn(`[EditorSceneManager] Failed to load animation clip: ${resolved}`, err);
                    }
                    break;
                }
                case 'audio': {
                    try {
                        const absPath = this.pathResolver_.toAbsolutePath(resolved);
                        const url = getPlatformAdapter().convertFilePathToUrl(absPath);
                        await Audio.preload(url);
                        data[desc.field] = url;
                    } catch (err) {
                        console.warn(`[EditorSceneManager] Failed to preload audio: ${resolved}`, err);
                    }
                    break;
                }
                case 'tilemap': {
                    try {
                        await this.loadTilemapSource(resolved);
                        data[desc.field] = resolved;
                    } catch (err) {
                        console.warn(`[EditorSceneManager] Failed to load tilemap: ${resolved}`, err);
                    }
                    break;
                }
                case 'timeline': {
                    try {
                        await this.loadAndRegisterTimeline(resolved);
                        data[desc.field] = resolved;
                    } catch (err) {
                        console.warn(`[EditorSceneManager] Failed to load timeline: ${resolved}`, err);
                    }
                    break;
                }
            }
        }

        if (comp.type === 'StateMachine') {
            const states = data.states as Record<string, { timeline?: string }> | undefined;
            if (states) {
                for (const state of Object.values(states)) {
                    if (typeof state.timeline === 'string' && state.timeline) {
                        const resolved = this.resolveAssetRef(state.timeline);
                        try {
                            await this.loadAndRegisterTimeline(resolved);
                        } catch (err) {
                            console.warn(`[EditorSceneManager] Failed to load StateMachine timeline: ${resolved}`, err);
                        }
                    }
                }
            }
        }

        const spineDesc = getComponentSpineFieldDescriptor(comp.type);
        if (spineDesc) {
            const skelRef = data[spineDesc.skeletonField] ?? '';
            const atlasRef = data[spineDesc.atlasField] ?? '';

            if (skelRef && atlasRef) {
                const skelPath = this.resolveAssetRef(skelRef);
                const atlasPath = this.resolveAssetRef(atlasRef);

                getDependencyGraph().registerUsage(skelRef, entityId);
                getDependencyGraph().registerUsage(atlasRef, entityId);

                data[spineDesc.skeletonField] = skelPath;
                data[spineDesc.atlasField] = atlasPath;

                if (this.spineManager_) {
                    const rawResult = await this.assetServer_.loadSpineWithRawData(skelPath, atlasPath);
                    if (rawResult.success && rawResult.skelData) {
                        this.pendingSpineData_.set(entityId, {
                            skelData: rawResult.skelData,
                            atlasText: rawResult.atlasText!,
                            textures: rawResult.textures!,
                        });
                    } else {
                        console.warn(`[EditorSceneManager] Failed to load Spine raw data: ${rawResult.error}`);
                    }
                } else {
                    const result = await this.assetServer_.loadSpine(skelPath, atlasPath);
                    if (!result.success) {
                        console.warn(`[EditorSceneManager] Failed to load Spine: ${result.error}`);
                    }
                }
            }
        }
    }

    async reloadAnimClip(clipPath: string): Promise<void> {
        return this.loadAndRegisterAnimClip(clipPath);
    }

    private async loadAndRegisterAnimClip(clipPath: string): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const absPath = this.pathResolver_.toAbsolutePath(clipPath);
        const raw = await fs.readFile(absPath);
        if (!raw) return;

        const clipData = JSON.parse(raw) as AnimClipAssetData;
        const texturePaths = extractAnimClipTexturePaths(clipData);
        const textureHandles = new Map<string, number>();

        await Promise.all(texturePaths.map(async (texPath) => {
            try {
                const info = await this.assetServer_.loadTexture(texPath);
                textureHandles.set(texPath, info.handle);
            } catch {
                textureHandles.set(texPath, 0);
            }
        }));

        const clip = parseAnimClipData(clipPath, clipData, textureHandles);
        registerAnimClip(clip);
    }

    private async loadTilemapSource(tmjPath: string): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const absPath = this.pathResolver_.toAbsolutePath(tmjPath);
        const raw = await fs.readFile(absPath);
        if (!raw) return;

        const json = JSON.parse(raw) as Record<string, unknown>;
        const mapData = parseTmjJson(json);
        if (!mapData) return;

        const tilesets = [];
        for (const ts of mapData.tilesets) {
            const imagePath = resolveRelativePath(tmjPath, ts.image);
            let textureHandle = 0;
            try {
                const info = await this.assetServer_.loadTexture(imagePath);
                textureHandle = info.handle;
                registerTextureDimensions(info.handle, info.width, info.height);
            } catch (err) {
                console.warn(`[EditorSceneManager] Failed to load tileset texture: ${imagePath}`, err);
            }
            tilesets.push({ textureHandle, columns: ts.columns });
        }

        registerTilemapSource(tmjPath, {
            tileWidth: mapData.tileWidth,
            tileHeight: mapData.tileHeight,
            layers: mapData.layers.map(l => ({
                name: l.name,
                width: l.width,
                height: l.height,
                tiles: l.tiles,
            })),
            tilesets,
        });
    }

    private async loadAndRegisterTimeline(tlPath: string): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const absPath = this.pathResolver_.toAbsolutePath(tlPath);
        const raw = await fs.readFile(absPath);
        if (!raw) return;

        const json = JSON.parse(raw) as Record<string, unknown>;
        const asset = parseTimelineAsset(json);
        registerTimelineAsset(tlPath, asset);
    }

    // =========================================================================
    // Post-load hooks
    // =========================================================================

    private async applyAnimFirstFrame(entityId: number, data: Record<string, any>): Promise<void> {
        const clipName = data.clip as string;
        if (!clipName) return;

        const clip = getAnimClip(clipName);
        if (!clip || clip.frames.length === 0) return;

        const entity = this.entityMap_.get(entityId);
        if (entity === undefined || !this.world_.has(entity, Sprite)) return;

        const sprite = this.world_.get(entity, Sprite) as Record<string, any>;
        if (sprite.texture !== 0) return;

        const frame = clip.frames[0];
        sprite.texture = frame.texture;
        if (frame.uvOffset) {
            sprite.uvOffset = frame.uvOffset;
            sprite.uvScale = frame.uvScale;
        }
        this.world_.insert(entity, Sprite, sprite);
    }

    private async syncSpineInstance(entityId: number, data: Record<string, any>): Promise<void> {
        const pending = this.pendingSpineData_.get(entityId);
        if (pending && this.spineManager_) {
            this.pendingSpineData_.delete(entityId);
            const entity = this.entityMap_.get(entityId);
            if (entity !== undefined) {
                const cppRegistry = this.world_.getCppRegistry();
                if (cppRegistry) {
                    const version = await this.spineManager_.loadEntity(
                        entity, pending.skelData, pending.atlasText,
                        pending.textures, cppRegistry);
                    if (version) {
                        this.spineManager_.setEntityProps(entity, {
                            skeletonScale: (data.skeletonScale as number) ?? 1,
                            flipX: (data.flipX as boolean) ?? false,
                            flipY: (data.flipY as boolean) ?? false,
                            layer: (data.layer as number) ?? 0,
                        });
                        const skin = data.skin as string;
                        if (skin) this.spineManager_.setSkin(entity, skin);
                        const animation = data.animation as string;
                        if (animation) {
                            this.spineManager_.setAnimation(entity, animation, data.loop !== false);
                        }
                    }
                }
            }
        }
        for (const cb of this.spineReadyListeners_) {
            cb(entityId);
        }
    }
}
