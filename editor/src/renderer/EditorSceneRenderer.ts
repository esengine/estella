import type { ESEngineModule, LayoutRect } from 'esengine';
import {
    App,
    UICameraInfo,
    RenderPipeline,
    Renderer,
    PostProcess,
    syncPostProcessVolume,
    cleanupPostProcessVolume,
    type PostProcessEffectData,
    type PostProcessVolumeData,
} from 'esengine';
import type { SceneData, ComponentData } from '../types/SceneTypes';
import type { EditorStore } from '../store/EditorStore';
import { EditorCamera } from './EditorCamera';
import { EditorSceneManager } from '../scene/EditorSceneManager';
import { AssetPathResolver } from '../asset';
import { getAssetEventBus } from '../events/AssetEventBus';
import { getDependencyGraph } from '../asset/AssetDependencyGraph';
import type { TransformValue } from '../math/Transform';
import type { SharedRenderContext } from './SharedRenderContext';
import { BuiltinPropertySync } from '../sync/BuiltinPropertySync';

export class EditorSceneRenderer {
    private context_: SharedRenderContext;
    private camera_: EditorCamera;
    private store_: EditorStore | null = null;
    private unsubscribes_: (() => void)[] = [];
    private dirtyEntities_ = new Set<number>();
    private rafId_: number | null = null;
    private renderCallback_: (() => void) | null = null;
    private lastElapsed_ = 0;
    private gizmoActive_ = false;

    constructor(context: SharedRenderContext) {
        this.context_ = context;
        this.camera_ = new EditorCamera();
    }

    get camera(): EditorCamera {
        return this.camera_;
    }

    private get sceneManager_(): EditorSceneManager | null {
        return this.context_.sceneManager_;
    }

    private get pipeline_(): RenderPipeline | null {
        return this.context_.pipeline_;
    }

    private get app_(): App | null {
        return this.context_.app_;
    }

    private get module_(): ESEngineModule | null {
        return this.context_.module_;
    }

    setStore(store: EditorStore): void {
        this.store_ = store;
        this.setupSyncService();
    }

    setRenderCallback(callback: (() => void) | null): void {
        this.renderCallback_ = callback;
        this.builtinSync_?.setRenderCallback(callback);
    }

    private setupSyncService(): void {
        if (this.unsubscribes_.length > 0) return;
        if (!this.store_ || !this.sceneManager_) {
            console.warn('[SceneRenderer] setupSyncService skipped: store=', !!this.store_, 'sceneManager=', !!this.sceneManager_);
            return;
        }

        const store = this.store_;
        const sm = this.sceneManager_;

        this.registerPipelineSyncHooks_(store);

        const bus = store.bus;
        this.unsubscribes_.push(
            bus.on('hierarchy:changed', (e) => {
                sm.reparentEntity(e.entity, e.newParent);
            }),
            bus.on('visibility:changed', (e) => {
                if (e.visible) {
                    sm.showEntity(e.entity);
                } else {
                    sm.hideEntity(e.entity);
                }
            }),
            bus.on('entity:lifecycle', (e) => {
                if (e.type === 'created') {
                    sm.spawnEntity(e.entity, e.parent);
                } else {
                    sm.removeEntity(e.entity);
                    this.dirtyEntities_.delete(e.entity);
                }
            }),
            bus.on('component:changed', (e) => {
                if (e.action === 'removed') {
                    sm.removeComponentFromEntity(e.entity, e.componentType);
                    if (e.componentType === 'PostProcessVolume') {
                        cleanupPostProcessVolume(e.entity);
                    }
                }
                if (e.action === 'added' && e.componentType === 'PostProcessVolume') {
                    this.syncPostProcessVolumeForEntity(e.entity);
                }
                this.scheduleEntityUpdate(e.entity);
            }),
            getAssetEventBus().on('material', (e) => {
                if (e.type === 'asset:modified') this.onAssetModified(e.path);
            }),
            getAssetEventBus().on('texture', (e) => {
                if (e.type === 'asset:modified') this.onAssetModified(e.path);
            }),
            getAssetEventBus().on('anim-clip', (e) => {
                if (e.type === 'asset:modified') {
                    this.sceneManager_?.reloadAnimClip(e.path);
                }
            }),
        );

        store.worldTransforms_.setCppWorldTransformProvider((entityId: number) => {
            return this.getCppWorldTransform(entityId);
        });
    }

    private builtinSync_: BuiltinPropertySync | null = null;

    private registerPipelineSyncHooks_(store: EditorStore): void {
        const pipeline = store.pipeline_;

        this.builtinSync_ = new BuiltinPropertySync(this.sceneManager_!, store);
        this.builtinSync_.setRenderCallback(this.renderCallback_);
        pipeline.setBuiltinSync(this.builtinSync_);

        this.unsubscribes_.push(
            pipeline.registerSyncHook('PostProcessVolume', '*', (event) => {
                if (!this.sceneManager_?.hasEntity(event.entity)) return;
                this.syncPostProcessVolumeForEntity(event.entity);
            }),

            pipeline.setDefaultSyncHook((event) => {
                if (!this.sceneManager_?.hasEntity(event.entity)) return;
                this.scheduleEntityUpdate(event.entity);
            }),
        );
    }

    async flushPendingUpdates(): Promise<void> {
        if (this.rafId_ !== null) {
            cancelAnimationFrame(this.rafId_);
            this.rafId_ = null;
        }
        await this.flushDirtyEntities();
    }

    private scheduleEntityUpdate(entityId: number): void {
        this.dirtyEntities_.add(entityId);
        if (this.rafId_ !== null) return;
        this.rafId_ = requestAnimationFrame(() => {
            this.rafId_ = null;
            this.flushDirtyEntities();
        });
    }

    private async flushDirtyEntities(): Promise<void> {
        const entities = [...this.dirtyEntities_];
        this.dirtyEntities_.clear();
        for (const entityId of entities) {
            await this.syncEntity(entityId);
        }
    }

    private async syncEntity(entityId: number): Promise<void> {
        if (!this.store_!.isEntityVisible(entityId)) return;
        const entityData = this.store_!.getEntityData(entityId);
        if (!entityData) return;
        await this.sceneManager_!.updateEntity(entityId, entityData.components, entityData);
        this.renderCallback_?.();
    }

    private onAssetModified(path: string): void {
        for (const entityId of getDependencyGraph().getUsers(path)) {
            this.scheduleEntityUpdate(entityId);
        }
    }

    setProjectDir(projectDir: string): void {
        this.context_.setProjectDir(projectDir);
    }

    get pathResolver(): AssetPathResolver {
        return this.context_.pathResolver_;
    }

    async syncScene(scene: SceneData): Promise<void> {
        await this.sceneManager_?.loadScene(scene);
        this.syncAllPostProcessVolumes();
    }

    async updateEntity(entityId: number, components: ComponentData[]): Promise<void> {
        await this.sceneManager_?.updateEntity(entityId, components);
    }

    removeEntity(entityId: number): void {
        this.sceneManager_?.removeEntity(entityId);
    }

    get textureManager() {
        return this.sceneManager_?.assetServer.textureManager ?? null;
    }

    get assetServer() {
        return this.sceneManager_?.assetServer ?? null;
    }

    getSpineBounds(sceneEntityId: number): { x: number; y: number; width: number; height: number } | null {
        if (!this.sceneManager_) return null;

        const entity = this.sceneManager_.getEntityMap().get(sceneEntityId);
        if (entity === undefined) return null;

        const spineManager = this.context_.spineManager;
        if (spineManager) {
            const moduleBounds = spineManager.getBounds(entity);
            if (moduleBounds) return moduleBounds;
        }

        if (!this.module_) return null;
        const bounds = this.module_.getSpineBounds?.(this.sceneManager_.registry, entity);
        if (!bounds?.valid) return null;

        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }

    getBitmapTextBounds(entityId: number): { width: number; height: number; offsetX: number; offsetY: number } | null {
        return this.sceneManager_?.getBitmapTextBounds(entityId) ?? null;
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        return this.sceneManager_?.getSpineSkeletonInfo(entityId) ?? null;
    }

    onSpineInstanceReady(listener: (entityId: number) => void): () => void {
        return this.sceneManager_?.onSpineInstanceReady(listener) ?? (() => {});
    }

    getCanvasRect(): LayoutRect | null {
        return this.sceneManager_?.getCanvasRect() ?? null;
    }

    getComputedLayoutSize(entityId: number): { x: number; y: number } | null {
        if (!this.module_ || !this.sceneManager_) return null;
        const entity = this.sceneManager_.getEntityMap().get(entityId);
        if (entity === undefined) return null;
        const registry = this.sceneManager_.registry;
        const w = this.module_.getUIRectComputedWidth(registry, entity);
        const h = this.module_.getUIRectComputedHeight(registry, entity);
        if (w <= 0 && h <= 0) return null;
        return { x: w, y: h };
    }

    getCppWorldTransform(entityId: number): TransformValue | null {
        if (!this.sceneManager_) return null;
        const entity = this.sceneManager_.getEntityMap().get(entityId);
        if (entity === undefined) return null;
        const registry = this.sceneManager_.registry;
        if (!registry.hasTransform(entity)) return null;
        const wt = registry.getTransform(entity);

        let px = wt.worldPosition.x;
        let py = wt.worldPosition.y;

        if (registry.hasUIRect(entity)) {
            const uiRect = registry.getUIRect(entity);
            let sizeX = uiRect.size.x;
            let sizeY = uiRect.size.y;
            if (this.module_) {
                sizeX = this.module_.getUIRectComputedWidth(registry, entity) || sizeX;
                sizeY = this.module_.getUIRectComputedHeight(registry, entity) || sizeY;
            }
            let dx = (0.5 - uiRect.pivot.x) * sizeX * wt.worldScale.x;
            let dy = (0.5 - uiRect.pivot.y) * sizeY * wt.worldScale.y;
            const sinHalf = wt.worldRotation.z;
            if (sinHalf * sinHalf > 1e-6) {
                const cosHalf = wt.worldRotation.w;
                const s = 2.0 * sinHalf * cosHalf;
                const c = cosHalf * cosHalf - sinHalf * sinHalf;
                const rdx = dx * c - dy * s;
                const rdy = dx * s + dy * c;
                dx = rdx;
                dy = rdy;
            }
            px += dx;
            py += dy;
        }

        return {
            position: { x: px, y: py, z: wt.worldPosition.z },
            rotation: { x: wt.worldRotation.x, y: wt.worldRotation.y, z: wt.worldRotation.z, w: wt.worldRotation.w },
            scale: { x: wt.worldScale.x, y: wt.worldScale.y, z: wt.worldScale.z },
        };
    }

    computeLayoutSize(entityId: number): { x: number; y: number } | null {
        return this.getComputedLayoutSize(entityId);
    }

    setGizmoActive(active: boolean): void {
        this.gizmoActive_ = active;
    }

    syncDerivedTransforms(): void {
        if (this.gizmoActive_) return;
        const store = this.store_;
        if (!store || !this.sceneManager_) return;
        const registry = this.sceneManager_.registry;
        for (const entity of store.scene.entities) {
            if (!entity.components.some(c => c.type === 'UIRect')) continue;
            const transform = entity.components.find(c => c.type === 'Transform');
            if (!transform) continue;
            const runtimeEntity = this.sceneManager_.getEntityMap().get(entity.id);
            if (runtimeEntity === undefined || !registry.hasTransform(runtimeEntity)) continue;
            const wt = registry.getTransform(runtimeEntity);
            const pos = transform.data.position as { x: number; y: number; z: number };
            if (pos.x !== wt.position.x || pos.y !== wt.position.y) {
                pos.x = wt.position.x;
                pos.y = wt.position.y;
            }
        }
    }

    render(width: number, height: number): void {
        if (!this.pipeline_ || !this.sceneManager_ || !this.context_.initialized) return;
        if (width <= 0 || height <= 0) return;
        if (this.sceneManager_.isBusy) return;

        this.sceneManager_.setViewportSize(width, height);

        const bg = this.findCanvasBackgroundColor();
        Renderer.setClearColor(bg.r, bg.g, bg.b, bg.a);

        const canvasRect = this.sceneManager_.getCanvasRect();
        if (canvasRect) {
            this.camera_.orthoHalfHeight = (canvasRect.top - canvasRect.bottom) / 2;
        } else {
            this.camera_.orthoHalfHeight = 0;
        }

        const matrix = this.camera_.getViewProjection(width, height);
        const elapsed = this.context_.elapsed;

        const cppReg = this.sceneManager_.registry;
        const registry = { _cpp: cppReg };

        try {
            if (this.app_) {
                if (this.context_.isPlayMode) {
                    const gameRenderer = this.context_.gameViewRenderer;
                    if (gameRenderer && gameRenderer.visible) {
                        gameRenderer.updateUICameraInfo(this.context_);
                    }
                } else {
                    const uiCamera = this.app_.getResource(UICameraInfo);
                    if (canvasRect) {
                        uiCamera.worldLeft = canvasRect.left;
                        uiCamera.worldBottom = canvasRect.bottom;
                        uiCamera.worldRight = canvasRect.right;
                        uiCamera.worldTop = canvasRect.top;
                        uiCamera.valid = true;
                    } else {
                        uiCamera.valid = false;
                    }
                }

                this.context_.tickApp();
                this.syncDerivedTransforms();
            }

            const gameRenderer = this.context_.gameViewRenderer;
            if (gameRenderer && gameRenderer.visible) {
                gameRenderer.renderAndCapture(this.context_);
            }

            const ppCamera = this.findFirstPPCamera();
            if (ppCamera >= 0) {
                PostProcess._applyForCamera(ppCamera);
                PostProcess.resize(width, height);
                PostProcess.setOutputViewport(0, 0, width, height);
            }

            Renderer.setClearColor(bg.r, bg.g, bg.b, bg.a);
            Renderer.resize(width, height);
            Renderer.beginFrame();
            Renderer.setViewport(0, 0, width, height);
            Renderer.setScissor(0, 0, 0, 0, false);
            Renderer.clearBuffers(3);
            Renderer.begin(matrix);
            this.pipeline_.submitScene(registry, matrix, { x: 0, y: 0, w: width, h: height }, elapsed);
            Renderer.end();

            if (ppCamera >= 0) {
                PostProcess._resetAfterCamera();
            }
        } catch (e) {
            if (e instanceof WebAssembly.RuntimeError) {
                console.warn('[EditorSceneRenderer] WASM error during render:', (e as Error).message);
            } else {
                throw e;
            }
        }
    }

    renderGameCamera(width: number, height: number, vpMatrix: Float32Array): void {
        if (!this.pipeline_ || !this.sceneManager_ || !this.context_.initialized) return;
        if (width <= 0 || height <= 0) return;
        if (this.sceneManager_.isBusy) return;

        const elapsed = this.context_.elapsed;
        const cppReg = this.sceneManager_.registry;
        const registry = { _cpp: cppReg };

        try {
            Renderer.beginFrame();
            Renderer.setViewport(0, 0, width, height);
            Renderer.clearBuffers(3);
            Renderer.begin(vpMatrix);
            this.pipeline_.submitScene(registry, vpMatrix, { x: 0, y: 0, w: width, h: height }, elapsed);
            Renderer.end();
        } catch (e) {
            if (e instanceof WebAssembly.RuntimeError) {
                console.warn('[EditorSceneRenderer] WASM error during game camera render:', (e as Error).message);
            } else {
                throw e;
            }
        }
    }

    private findFirstPPCamera(): number {
        if (!this.store_) return -1;
        for (const entity of this.store_.scene.entities) {
            const hasCam = entity.components.some(c => c.type === 'Camera');
            const hasPP = entity.components.some(c => c.type === 'PostProcessVolume');
            if (hasCam && hasPP && PostProcess.getStack(entity.id)) {
                return entity.id;
            }
        }
        return -1;
    }

    private extractVolumeData(data: Record<string, unknown>): PostProcessVolumeData {
        return {
            effects: (data.effects as PostProcessEffectData[]) ?? [],
            isGlobal: (data.isGlobal as boolean) ?? true,
            shape: (data.shape as 'box' | 'sphere') ?? 'box',
            size: (data.size as { x: number; y: number }) ?? { x: 5, y: 5 },
            priority: (data.priority as number) ?? 0,
            weight: (data.weight as number) ?? 1,
            blendDistance: (data.blendDistance as number) ?? 0,
        };
    }

    private syncPostProcessVolumeForEntity(entityId: number): void {
        const entityData = this.store_?.getEntityData(entityId);
        if (!entityData) return;
        const ppComp = entityData.components.find(c => c.type === 'PostProcessVolume');
        if (ppComp) {
            syncPostProcessVolume(entityId, this.extractVolumeData(ppComp.data));
        } else {
            cleanupPostProcessVolume(entityId);
        }
    }

    syncAllPostProcessVolumes(): void {
        if (!this.store_) return;
        for (const entity of this.store_.scene.entities) {
            const ppComp = entity.components.find(c => c.type === 'PostProcessVolume');
            if (ppComp) {
                syncPostProcessVolume(entity.id, this.extractVolumeData(ppComp.data));
            }
        }
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

    dispose(): void {
        if (this.rafId_ !== null) {
            cancelAnimationFrame(this.rafId_);
            this.rafId_ = null;
        }
        this.dirtyEntities_.clear();
        for (const unsub of this.unsubscribes_) unsub();
        this.unsubscribes_ = [];
    }
}
