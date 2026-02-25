import type { ESEngineModule, LayoutRect } from 'esengine';
import {
    App,
    UICameraInfo,
    ButtonState,
    RenderPipeline,
    Renderer,
} from 'esengine';
import type { SpineModuleController } from 'esengine/spine';
import type { SceneData, ComponentData } from '../types/SceneTypes';
import type { EditorStore, PropertyChangeEvent } from '../store/EditorStore';
import { EditorCamera } from './EditorCamera';
import { EditorSceneManager } from '../scene/EditorSceneManager';
import { AssetPathResolver } from '../asset';
import { getAssetEventBus } from '../events/AssetEventBus';
import { getDependencyGraph } from '../asset/AssetDependencyGraph';
import type { TransformValue } from '../math/Transform';
import type { SharedRenderContext } from './SharedRenderContext';

export class EditorSceneRenderer {
    private context_: SharedRenderContext;
    private camera_: EditorCamera;
    private store_: EditorStore | null = null;
    private unsubscribes_: (() => void)[] = [];
    private dirtyEntities_ = new Set<number>();
    private rafId_: number | null = null;
    private renderCallback_: (() => void) | null = null;
    private lastElapsed_ = 0;

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
    }

    private setupSyncService(): void {
        if (this.unsubscribes_.length > 0) return;
        if (!this.store_ || !this.sceneManager_) return;

        const store = this.store_;
        const sm = this.sceneManager_;

        this.unsubscribes_.push(
            store.subscribeToPropertyChanges((e) => this.handlePropertyChange(e)),
            store.subscribeToHierarchyChanges((e) => {
                sm.reparentEntity(e.entity, e.newParent);
            }),
            store.subscribeToVisibilityChanges((e) => {
                if (e.visible) {
                    sm.showEntity(e.entity);
                } else {
                    sm.hideEntity(e.entity);
                }
            }),
            store.subscribeToEntityLifecycle((e) => {
                if (e.type === 'created') {
                    sm.spawnEntity(e.entity, e.parent);
                } else {
                    sm.removeEntity(e.entity);
                    this.dirtyEntities_.delete(e.entity);
                }
            }),
            store.subscribeToComponentChanges((e) => {
                if (e.action === 'removed') {
                    sm.removeComponentFromEntity(e.entity, e.componentType);
                }
                this.scheduleEntityUpdate(e.entity);
            }),
            getAssetEventBus().on('material', (e) => {
                if (e.type === 'asset:modified') this.onAssetModified(e.path);
            }),
            getAssetEventBus().on('texture', (e) => {
                if (e.type === 'asset:modified') this.onAssetModified(e.path);
            }),
        );

        store.worldTransforms_.setCppWorldTransformProvider((entityId: number) => {
            return this.getCppWorldTransform(entityId);
        });
    }

    private handlePropertyChange(event: PropertyChangeEvent): void {
        if (!this.sceneManager_?.hasEntity(event.entity)) return;

        switch (event.componentType) {
            case 'UIRect':
            case 'ScreenSpace':
                this.scheduleDescendantUpdates(event.entity);
                break;
            case 'Canvas':
                this.syncCanvasToCamera(event.entity);
                break;
            case 'Button':
                this.syncButtonTransitionColor(event.entity);
                break;
            case 'TextInput':
                if (event.propertyName === 'backgroundColor') {
                    this.store_!.updatePropertyDirect(event.entity, 'Sprite', 'color', event.newValue);
                }
                break;
        }

        this.scheduleEntityUpdate(event.entity);
    }

    private syncCanvasToCamera(canvasEntityId: number): void {
        const canvasData = this.store_!.getEntityData(canvasEntityId);
        if (!canvasData) return;

        const canvasComp = canvasData.components.find(c => c.type === 'Canvas');
        const resolution = canvasComp?.data?.designResolution as { x: number; y: number } | undefined;
        if (!resolution) return;

        const orthoSize = resolution.y / 2;

        for (const entity of this.store_!.scene.entities) {
            const cameraComp = entity.components.find(c => c.type === 'Camera');
            if (!cameraComp) continue;

            this.store_!.updatePropertyDirect(entity.id, 'Camera', 'orthoSize', orthoSize);
            this.scheduleEntityUpdate(entity.id);
            break;
        }
    }

    private syncButtonTransitionColor(entityId: number): void {
        const entityData = this.store_!.getEntityData(entityId);
        if (!entityData) return;

        const buttonComp = entityData.components.find(c => c.type === 'Button');
        if (!buttonComp) return;

        const transition = buttonComp.data.transition as {
            normalColor: { r: number; g: number; b: number; a: number };
            hoveredColor: { r: number; g: number; b: number; a: number };
            pressedColor: { r: number; g: number; b: number; a: number };
            disabledColor: { r: number; g: number; b: number; a: number };
        } | null;
        if (!transition) return;

        const spriteComp = entityData.components.find(c => c.type === 'Sprite');
        if (!spriteComp) return;

        const state = (buttonComp.data.state as number) ?? ButtonState.Normal;
        const colorMap: Record<number, { r: number; g: number; b: number; a: number }> = {
            [ButtonState.Normal]: transition.normalColor,
            [ButtonState.Hovered]: transition.hoveredColor,
            [ButtonState.Pressed]: transition.pressedColor,
            [ButtonState.Disabled]: transition.disabledColor,
        };
        const color = colorMap[state] ?? transition.normalColor;

        this.store_!.updatePropertyDirect(entityId, 'Sprite', 'color', { ...color });
        this.scheduleEntityUpdate(entityId);
    }

    private scheduleDescendantUpdates(entityId: number): void {
        const entityData = this.store_!.getEntityData(entityId);
        if (!entityData) return;
        for (const childId of entityData.children) {
            this.scheduleEntityUpdate(childId);
            this.scheduleDescendantUpdates(childId);
        }
    }

    private scheduleEntityUpdate(entityId: number): void {
        this.dirtyEntities_.add(entityId);
        if (this.rafId_ !== null) return;
        this.rafId_ = requestAnimationFrame(() => {
            this.rafId_ = null;
            this.flushDirtyEntities();
        });
    }

    private flushDirtyEntities(): void {
        const entities = [...this.dirtyEntities_];
        this.dirtyEntities_.clear();
        for (const entityId of entities) {
            this.syncEntity(entityId);
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

    setSpineController(controller: SpineModuleController | null): void {
        this.context_.setSpineController(controller);
    }

    get pathResolver(): AssetPathResolver {
        return this.context_.pathResolver_;
    }

    async syncScene(scene: SceneData): Promise<void> {
        await this.sceneManager_?.loadScene(scene);
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

    get spineInstanceCount(): number {
        return this.sceneManager_?.spineInstanceCount ?? 0;
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
        return {
            position: { x: wt.worldPosition.x, y: wt.worldPosition.y, z: wt.worldPosition.z },
            rotation: { x: wt.worldRotation.x, y: wt.worldRotation.y, z: wt.worldRotation.z, w: wt.worldRotation.w },
            scale: { x: wt.worldScale.x, y: wt.worldScale.y, z: wt.worldScale.z },
        };
    }

    computeLayoutSize(entityId: number): { x: number; y: number } | null {
        return this.getComputedLayoutSize(entityId);
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
            }

            const gameRenderer = this.context_.gameViewRenderer;
            if (gameRenderer && gameRenderer.visible) {
                gameRenderer.renderAndCapture(this.context_);
            }

            Renderer.setClearColor(bg.r, bg.g, bg.b, bg.a);
            Renderer.setViewport(0, 0, width, height);
            Renderer.clearBuffers(3);
            Renderer.begin(matrix);
            if (this.pipeline_.maskProcessor) {
                this.pipeline_.maskProcessor(registry._cpp, matrix, 0, 0, width, height);
            }
            Renderer.submitSprites(registry);
            Renderer.submitBitmapText(registry);
            if (this.pipeline_.spineRenderer) {
                this.pipeline_.spineRenderer(registry, elapsed);
            } else {
                Renderer.submitSpine(registry);
            }
            Renderer.flush();
            Renderer.end();
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
            Renderer.setViewport(0, 0, width, height);
            Renderer.clearBuffers(3);
            Renderer.begin(vpMatrix);
            if (this.pipeline_.maskProcessor) {
                this.pipeline_.maskProcessor(registry._cpp, vpMatrix, 0, 0, width, height);
            }
            Renderer.submitSprites(registry);
            Renderer.submitBitmapText(registry);
            if (this.pipeline_.spineRenderer) {
                this.pipeline_.spineRenderer(registry, elapsed);
            } else {
                Renderer.submitSpine(registry);
            }
            Renderer.flush();
            Renderer.end();
        } catch (e) {
            if (e instanceof WebAssembly.RuntimeError) {
                console.warn('[EditorSceneRenderer] WASM error during game camera render:', (e as Error).message);
            } else {
                throw e;
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
