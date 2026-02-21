import type { Entity, App } from 'esengine';
import { Renderer, computeUIRectLayout, DEFAULT_SPRITE_SIZE } from 'esengine';
import type { SpineModuleController } from 'esengine/spine';
import type { EditorStore } from '../../store/EditorStore';
import type { EditorBridge } from '../../bridge/EditorBridge';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { isUUID, getAssetLibrary } from '../../asset/AssetDatabase';
import { icons } from '../../utils/icons';
import { EditorSceneRenderer } from '../../renderer/EditorSceneRenderer';
import { findCanvasWorldRect } from '../../math/Transform';
import { getEntityBounds } from '../../bounds';
import { GizmoManager } from '../../gizmos';
import type { GizmoContext } from '../../gizmos';
import { ColliderOverlay } from '../../gizmos/ColliderOverlay';
import { getSettingsValue, onSettingsChange } from '../../settings/SettingsRegistry';
import type { EntityData } from '../../types/SceneTypes';

import { CameraController } from './CameraController';
import { GizmoToolbar } from './GizmoToolbar';
import { MarqueeSelection } from './MarqueeSelection';
import { EntityDropHandler } from './EntityDropHandler';
import { SceneViewInput } from './SceneViewInput';

const CAMERA_COLORS = [
    '#ffaa00',
    '#00ccff',
    '#ff55aa',
    '#55ff55',
];

export interface SceneViewPanelOptions {
    projectPath?: string;
    app?: App;
}

export class SceneViewPanel {
    private container_: HTMLElement;
    private store_: EditorStore;
    private bridge_: EditorBridge | null = null;
    private canvas_: HTMLCanvasElement;
    private webglCanvas_: HTMLCanvasElement | null = null;
    private overlayCanvas_: HTMLCanvasElement | null = null;
    private unsubscribe_: (() => void) | null = null;
    private unsubscribeSceneSync_: (() => void) | null = null;
    private unsubscribeFocus_: (() => void) | null = null;
    private unsubscribeLivePreview_: (() => void) | null = null;
    private animationId_: number | null = null;
    private continuousRender_ = false;
    private livePreview_ = false;
    private isDirty_ = true;
    private resizeObserver_: ResizeObserver | null = null;
    private projectPath_: string | null = null;
    private app_: App | null = null;

    private sceneRenderer_: EditorSceneRenderer | null = null;
    private useWebGL_ = false;
    private webglInitialized_ = false;
    private webglInitPending_ = false;

    private gizmoManager_: GizmoManager;
    private colliderOverlay_: ColliderOverlay;

    private camera_: CameraController;
    private toolbar_: GizmoToolbar;
    private marquee_: MarqueeSelection;
    private dropHandler_: EntityDropHandler;
    private input_: SceneViewInput;

    private static readonly MAX_CACHE_SIZE = 100;
    private textureCache_: Map<string, HTMLImageElement | null> = new Map();
    private loadingTextures_: Set<string> = new Set();

    constructor(container: HTMLElement, store: EditorStore, options?: SceneViewPanelOptions) {
        this.container_ = container;
        this.store_ = store;
        this.projectPath_ = options?.projectPath ?? null;
        this.app_ = options?.app ?? null;
        this.gizmoManager_ = new GizmoManager();
        this.colliderOverlay_ = new ColliderOverlay();

        this.camera_ = new CameraController(null!, () => this.requestRender());
        this.toolbar_ = new GizmoToolbar(container, this.gizmoManager_, () => this.requestRender());
        this.marquee_ = new MarqueeSelection();
        this.dropHandler_ = new EntityDropHandler(store);

        this.container_.className = 'es-sceneview-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <div class="es-sceneview-tools">
                    <div class="es-gizmo-toolbar">
                        ${this.toolbar_.buildToolbarHTML()}
                    </div>
                    <div class="es-toolbar-divider"></div>
                    <button class="es-btn es-btn-icon" data-action="reset-view" title="Reset View">${icons.refresh(14)}</button>
                    <span class="es-zoom-display">100%</span>
                    <span class="es-snap-indicator" style="display: none;">SNAP</span>
                    <div class="es-toolbar-divider"></div>
                    ${this.toolbar_.buildSettingsHTML()}
                </div>
            </div>
            <div class="es-sceneview-viewport">
                <canvas class="es-sceneview-webgl"></canvas>
                <canvas class="es-sceneview-overlay"></canvas>
            </div>
        `;

        this.webglCanvas_ = this.container_.querySelector('.es-sceneview-webgl')!;
        this.overlayCanvas_ = this.container_.querySelector('.es-sceneview-overlay')!;
        this.canvas_ = this.overlayCanvas_;

        this.camera_.setCanvas(this.canvas_);

        this.input_ = new SceneViewInput({
            store,
            canvas: this.canvas_,
            overlayCanvas: this.overlayCanvas_,
            camera: this.camera_,
            toolbar: this.toolbar_,
            marquee: this.marquee_,
            gizmoManager: this.gizmoManager_,
            colliderOverlay: this.colliderOverlay_,
            getBounds: (entityData) => this.getEntityBoundsWithSpine(entityData),
            createGizmoContext: (ctx) => this.createGizmoContext(ctx),
            createOverlayContext: () => this.createOverlayContext(),
            requestRender: () => this.requestRender(),
        });

        this.toolbar_.setupEvents();
        this.input_.setup();
        this.dropHandler_.setupListeners(
            this.canvas_,
            (cx, cy) => this.camera_.screenToWorld(cx, cy),
        );

        this.unsubscribe_ = store.subscribe(() => this.onSceneChanged());
        this.unsubscribeSceneSync_ = store.subscribeToSceneSync(() => this.onSceneSyncNeeded());
        this.unsubscribeFocus_ = store.onFocusEntity((entityId) => {
            const worldTransform = this.store_.getWorldTransform(entityId);
            this.camera_.focusOnEntity(worldTransform.position.x, worldTransform.position.y);
            this.toolbar_.updateZoomDisplay(this.camera_.zoom);
        });

        this.livePreview_ = getSettingsValue<boolean>('scene.livePreview') ?? false;
        this.unsubscribeLivePreview_ = onSettingsChange((id, value) => {
            if (id === 'scene.livePreview') {
                this.livePreview_ = value as boolean;
                if (this.livePreview_) this.requestRender();
            }
        });

        const viewport = this.container_.querySelector('.es-sceneview-viewport');
        if (viewport) {
            this.resizeObserver_ = new ResizeObserver(() => this.resize());
            this.resizeObserver_.observe(viewport);
        }

        this.resize();

        if (this.app_?.wasmModule) {
            this.initWebGLRenderer();
        } else {
            this.startContinuousRender();
        }
    }

    private getEntityBoundsWithSpine(entityData: EntityData): { width: number; height: number; offsetX?: number; offsetY?: number } {
        const hasSpine = entityData.components.some(c => c.type === 'SpineAnimation');
        if (hasSpine && this.sceneRenderer_) {
            const spineBounds = this.sceneRenderer_.getSpineBounds(entityData.id);
            if (spineBounds) {
                return {
                    width: Math.abs(spineBounds.width),
                    height: Math.abs(spineBounds.height),
                    offsetX: spineBounds.x + spineBounds.width / 2,
                    offsetY: spineBounds.y + spineBounds.height / 2
                };
            }
        }

        const hasBitmapText = entityData.components.some(c => c.type === 'BitmapText');
        if (hasBitmapText && this.sceneRenderer_) {
            const textBounds = this.sceneRenderer_.getBitmapTextBounds(entityData.id);
            if (textBounds) {
                return {
                    width: textBounds.width,
                    height: textBounds.height,
                    offsetX: textBounds.offsetX,
                    offsetY: textBounds.offsetY,
                };
            }
        }

        const uiRect = entityData.components.find(c => c.type === 'UIRect');
        if (uiRect) {
            const d = uiRect.data;
            const resolved = this.resolveUIRectSize(d, entityData.parent);
            if (resolved) return resolved;
        }

        return getEntityBounds(entityData.components);
    }

    private resolveUIRectSize(
        data: any,
        parentId: number | null,
    ): { width: number; height: number } | null {
        const anchorMin = data.anchorMin ?? { x: 0.5, y: 0.5 };
        const anchorMax = data.anchorMax ?? { x: 0.5, y: 0.5 };
        const isStretchX = anchorMin.x !== anchorMax.x;
        const isStretchY = anchorMin.y !== anchorMax.y;

        if (!isStretchX && !isStretchY) {
            const s = data.size;
            return (s?.x > 0 && s?.y > 0) ? { width: s.x, height: s.y } : null;
        }

        const parentSize = this.resolveParentSize(parentId);
        if (!parentSize) return null;

        const parentRect = {
            left: -parentSize.width / 2,
            bottom: -parentSize.height / 2,
            right: parentSize.width / 2,
            top: parentSize.height / 2,
        };
        const layout = computeUIRectLayout(
            anchorMin, anchorMax,
            data.offsetMin ?? { x: 0, y: 0 },
            data.offsetMax ?? { x: 0, y: 0 },
            data.size ?? DEFAULT_SPRITE_SIZE,
            parentRect,
        );
        return { width: Math.abs(layout.width), height: Math.abs(layout.height) };
    }

    private resolveParentSize(parentId: number | null): { width: number; height: number } | null {
        if (parentId == null) return null;
        const parentData = this.store_.getEntityData(parentId);
        if (!parentData) return null;

        const parentUIRect = parentData.components.find(c => c.type === 'UIRect');
        if (parentUIRect) {
            return this.resolveUIRectSize(parentUIRect.data, parentData.parent);
        }

        const bounds = getEntityBounds(parentData.components);
        return (bounds.width > 0 && bounds.height > 0) ? bounds : null;
    }

    dispose(): void {
        this.continuousRender_ = false;
        if (this.animationId_ !== null) {
            cancelAnimationFrame(this.animationId_);
            this.animationId_ = null;
        }
        if (this.unsubscribe_) {
            this.unsubscribe_();
            this.unsubscribe_ = null;
        }
        if (this.unsubscribeSceneSync_) {
            this.unsubscribeSceneSync_();
            this.unsubscribeSceneSync_ = null;
        }
        if (this.unsubscribeFocus_) {
            this.unsubscribeFocus_();
            this.unsubscribeFocus_ = null;
        }
        if (this.unsubscribeLivePreview_) {
            this.unsubscribeLivePreview_();
            this.unsubscribeLivePreview_ = null;
        }
        if (this.resizeObserver_) {
            this.resizeObserver_.disconnect();
            this.resizeObserver_ = null;
        }
        if (this.sceneRenderer_) {
            this.sceneRenderer_.dispose();
            this.sceneRenderer_ = null;
        }
        this.input_.dispose();
        this.toolbar_.dispose();
    }

    setBridge(bridge: EditorBridge): void {
        this.bridge_ = bridge;
        this.requestRender();
    }

    setProjectPath(path: string): void {
        this.projectPath_ = path;
        this.textureCache_.clear();
        this.loadingTextures_.clear();

        if (this.sceneRenderer_) {
            const projectDir = path.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
            this.sceneRenderer_.setProjectDir(projectDir);
            this.syncSceneToRenderer();
        }

        this.requestRender();
    }

    setApp(app: App): void {
        this.app_ = app;
        if (app.wasmModule && !this.webglInitialized_ && !this.webglInitPending_) {
            this.initWebGLRenderer();
        }
    }

    setSpineController(controller: SpineModuleController | null): void {
        this.sceneRenderer_?.setSpineController(controller);
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        return this.sceneRenderer_?.getSpineSkeletonInfo(entityId) ?? null;
    }

    onSpineInstanceReady(listener: (entityId: number) => void): () => void {
        return this.sceneRenderer_?.onSpineInstanceReady(listener) ?? (() => {});
    }

    get canvas(): HTMLCanvasElement {
        return this.canvas_;
    }

    get assetServer() {
        return this.sceneRenderer_?.assetServer ?? null;
    }

    resize(): void {
        const viewport = this.container_.querySelector('.es-sceneview-viewport') as HTMLElement;
        if (!viewport) return;

        const rect = viewport.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        if (this.webglCanvas_) {
            this.webglCanvas_.width = rect.width * dpr;
            this.webglCanvas_.height = rect.height * dpr;
            this.webglCanvas_.style.width = `${rect.width}px`;
            this.webglCanvas_.style.height = `${rect.height}px`;
        }

        if (this.overlayCanvas_) {
            this.overlayCanvas_.width = rect.width * dpr;
            this.overlayCanvas_.height = rect.height * dpr;
            this.overlayCanvas_.style.width = `${rect.width}px`;
            this.overlayCanvas_.style.height = `${rect.height}px`;
        }

        this.canvas_.width = rect.width * dpr;
        this.canvas_.height = rect.height * dpr;
        this.canvas_.style.width = `${rect.width}px`;
        this.canvas_.style.height = `${rect.height}px`;

        this.requestRender();
    }

    startContinuousRender(): void {
        if (!this.continuousRender_) {
            this.continuousRender_ = true;
            this.requestRender();
        }
    }

    stopContinuousRender(): void {
        this.continuousRender_ = false;
    }

    // =========================================================================
    // WebGL / Scene Renderer
    // =========================================================================

    private async initWebGLRenderer(): Promise<void> {
        if (this.webglInitPending_ || this.webglInitialized_) return;
        if (!this.app_?.wasmModule || !this.webglCanvas_) return;

        this.webglInitPending_ = true;

        this.sceneRenderer_ = new EditorSceneRenderer();
        this.sceneRenderer_.setStore(this.store_);
        const success = await this.sceneRenderer_.init(this.app_.wasmModule, this.webglCanvas_);

        if (success) {
            this.webglInitialized_ = true;
            this.useWebGL_ = true;

            if (this.projectPath_) {
                const projectDir = this.projectPath_.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
                this.sceneRenderer_.setProjectDir(projectDir);
            }

            await this.syncSceneToRenderer();
            this.startContinuousRender();
        } else {
            console.warn('WebGL init failed, falling back to Canvas 2D');
            this.sceneRenderer_ = null;
            this.startContinuousRender();
        }

        this.webglInitPending_ = false;
    }

    private async syncSceneToRenderer(): Promise<void> {
        if (!this.sceneRenderer_) return;
        await this.sceneRenderer_.syncScene(this.store_.scene);
    }

    private async onSceneSyncNeeded(): Promise<void> {
        try {
            if (this.sceneRenderer_ && this.useWebGL_) {
                await this.syncSceneToRenderer();
            }
        } catch (e) {
            console.warn('[SceneViewPanel] Scene sync error:', e);
        }
    }

    private onSceneChanged(): void {
        this.requestRender();
    }

    // =========================================================================
    // Texture Cache
    // =========================================================================

    private loadTexture(texturePath: string): HTMLImageElement | null {
        if (!this.projectPath_ || !texturePath) return null;

        const resolved = isUUID(texturePath)
            ? (getAssetLibrary().getPath(texturePath) ?? texturePath)
            : texturePath;

        if (this.textureCache_.has(resolved)) {
            return this.textureCache_.get(resolved) ?? null;
        }

        if (this.loadingTextures_.has(resolved)) {
            return null;
        }

        this.loadingTextures_.add(resolved);

        const projectDir = this.projectPath_.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
        const fullPath = `${projectDir}/${resolved}`;
        const img = new Image();

        img.onload = () => {
            this.loadingTextures_.delete(resolved);
            this.evictCache(this.textureCache_);
            this.textureCache_.set(resolved, img);
            this.requestRender();
        };

        img.onerror = () => {
            this.loadingTextures_.delete(resolved);
            this.evictCache(this.textureCache_);
            this.textureCache_.set(resolved, null);
            console.warn(`Failed to load texture: ${fullPath}`);
        };

        img.src = getPlatformAdapter().convertFilePathToUrl(fullPath);

        return null;
    }

    private evictCache<T>(cache: Map<string, T>): void {
        if (cache.size >= SceneViewPanel.MAX_CACHE_SIZE) {
            const firstKey = cache.keys().next().value;
            if (firstKey !== undefined) {
                cache.delete(firstKey);
            }
        }
    }

    // =========================================================================
    // Gizmo Context
    // =========================================================================

    private createGizmoContext(ctx: CanvasRenderingContext2D): GizmoContext {
        return {
            store: this.store_,
            ctx,
            zoom: this.camera_.zoom,
            screenToWorld: (clientX, clientY) => this.camera_.screenToWorld(clientX, clientY),
            getWorldTransform: (entityId) => this.store_.getWorldTransform(entityId),
            getEntityBounds: (entityData) => this.getEntityBoundsWithSpine(entityData),
            requestRender: () => this.requestRender(),
        };
    }

    private createOverlayContext(): import('../../gizmos/ColliderOverlay').OverlayContext | null {
        const ctx = (this.overlayCanvas_ ?? this.canvas_).getContext('2d');
        if (!ctx) return null;
        return { ctx, zoom: this.camera_.zoom, store: this.store_ };
    }

    // =========================================================================
    // Render Loop
    // =========================================================================

    private requestRender(): void {
        this.isDirty_ = true;
        if (this.animationId_ !== null) return;

        this.animationId_ = requestAnimationFrame(() => {
            this.animationId_ = null;
            if (this.isDirty_) {
                this.isDirty_ = false;
                try {
                    this.render();
                } catch (e) {
                    console.warn('[SceneViewPanel] Render error, skipping frame:', e);
                }
            }
            if (this.continuousRender_) {
                this.scheduleNextFrame();
            }
        });
    }

    private scheduleNextFrame(): void {
        if (this.animationId_ !== null) return;
        this.animationId_ = requestAnimationFrame(() => {
            this.animationId_ = null;
            if (this.livePreview_) this.isDirty_ = true;
            if (this.isDirty_) {
                this.isDirty_ = false;
                try {
                    this.render();
                } catch (e) {
                    console.warn('[SceneViewPanel] Render error, skipping frame:', e);
                }
            }
            if (this.continuousRender_) {
                this.scheduleNextFrame();
            }
        });
    }

    private render(): void {
        if (this.useWebGL_ && this.sceneRenderer_ && this.webglCanvas_) {
            const w = this.webglCanvas_.width;
            const h = this.webglCanvas_.height;
            if (w === 0 || h === 0) return;

            this.sceneRenderer_.camera.panX = this.camera_.panX;
            this.sceneRenderer_.camera.panY = this.camera_.panY;
            this.sceneRenderer_.camera.zoom = this.camera_.zoom;

            this.sceneRenderer_.render(w, h);
            this.renderOverlay();
        } else if (this.bridge_) {
            const w = this.canvas_.width;
            const h = this.canvas_.height;
            if (w === 0 || h === 0) return;

            this.bridge_.render(w, h);
        } else {
            this.renderPreview();
        }
    }

    // =========================================================================
    // Overlay Rendering
    // =========================================================================

    private renderOverlay(): void {
        if (!this.overlayCanvas_) return;

        const ctx = this.overlayCanvas_.getContext('2d');
        if (!ctx) return;

        const w = this.overlayCanvas_.width;
        const h = this.overlayCanvas_.height;

        ctx.clearRect(0, 0, w, h);

        ctx.save();
        ctx.translate(w / 2 + this.camera_.panX * this.camera_.zoom, h / 2 + this.camera_.panY * this.camera_.zoom);
        ctx.scale(this.camera_.zoom, this.camera_.zoom);

        this.drawGrid(ctx, w, h);

        this.drawCameraFrustums(ctx);
        this.drawScreenSpaceBounds(ctx);

        if (getSettingsValue<boolean>('scene.showColliders')) {
            this.colliderOverlay_.drawAll({
                ctx,
                zoom: this.camera_.zoom,
                store: this.store_,
            });
        }

        const hasSelection = this.store_.selectedEntities.size > 0;

        if (hasSelection) {
            if (getSettingsValue<boolean>('scene.showSelectionBox')) {
                this.drawSelectionBox(ctx);
            }

            if (this.gizmoManager_.getActiveId() !== 'select' && getSettingsValue<boolean>('scene.showGizmos')) {
                this.gizmoManager_.setContext(this.createGizmoContext(ctx));
                this.gizmoManager_.draw();
            }
        }

        if (this.marquee_.active) {
            this.marquee_.draw(ctx, this.camera_.zoom);
        }

        ctx.restore();

        this.drawStats(ctx, w, h);
        this.drawViewportPreview(ctx, w, h);

        if (!this.store_.scene.entities.some(
            e => e.components.some(c => c.type === 'Camera'))) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '14px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No Camera in Scene', w / 2, h / 2);
        }
    }

    // =========================================================================
    // Canvas 2D Preview (fallback)
    // =========================================================================

    private renderPreview(): void {
        const ctx = this.canvas_.getContext('2d');
        if (!ctx) return;

        const w = this.canvas_.width;
        const h = this.canvas_.height;

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.translate(w / 2 + this.camera_.panX * this.camera_.zoom, h / 2 + this.camera_.panY * this.camera_.zoom);
        ctx.scale(this.camera_.zoom, this.camera_.zoom);

        this.drawGrid(ctx, w, h);

        const scene = this.store_.scene;
        const selectedEntity = this.store_.selectedEntity;

        for (const entity of scene.entities) {
            if (!this.store_.isEntityVisible(entity.id)) continue;
            this.drawEntity(ctx, entity, entity.id === selectedEntity);
        }

        this.drawCameraFrustums(ctx);
        this.drawScreenSpaceBounds(ctx);

        if (getSettingsValue<boolean>('scene.showColliders')) {
            this.colliderOverlay_.drawAll({
                ctx,
                zoom: this.camera_.zoom,
                store: this.store_,
            });
        }

        if (selectedEntity !== null && this.store_.isEntityVisible(selectedEntity as number)) {
            if (this.gizmoManager_.getActiveId() !== 'select' && getSettingsValue<boolean>('scene.showGizmos')) {
                this.gizmoManager_.setContext(this.createGizmoContext(ctx));
                this.gizmoManager_.draw();
            }
        }

        if (this.marquee_.active) {
            this.marquee_.draw(ctx, this.camera_.zoom);
        }

        ctx.restore();
    }

    // =========================================================================
    // Drawing Helpers
    // =========================================================================

    private drawSelectionBox(ctx: CanvasRenderingContext2D): void {
        const selectedEntities = this.store_.getSelectedEntitiesData();

        for (const entityData of selectedEntities) {
            if (!this.store_.isEntityVisible(entityData.id)) continue;

            const transform = entityData.components.find(c => c.type === 'LocalTransform');
            if (!transform) continue;

            const worldTransform = this.store_.getWorldTransform(entityData.id);
            const pos = worldTransform.position;
            const scale = worldTransform.scale;

            const bounds = this.getEntityBoundsWithSpine(entityData);
            const w = bounds.width * Math.abs(scale.x);
            const h = bounds.height * Math.abs(scale.y);
            const offsetX = (bounds.offsetX ?? 0) * scale.x;
            const offsetY = (bounds.offsetY ?? 0) * scale.y;

            ctx.save();
            ctx.translate(pos.x + offsetX, -pos.y - offsetY);

            ctx.strokeStyle = '#00aaff';
            ctx.lineWidth = 2 / this.camera_.zoom;
            ctx.setLineDash([]);
            ctx.strokeRect(-w / 2, -h / 2, w, h);

            if (selectedEntities.length === 1) {
                ctx.fillStyle = '#00aaff';
                const handleSize = 6 / this.camera_.zoom;
                const corners = [
                    [-w / 2, -h / 2],
                    [w / 2, -h / 2],
                    [-w / 2, h / 2],
                    [w / 2, h / 2],
                ];
                for (const [cx, cy] of corners) {
                    ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
                }
            }

            ctx.restore();
        }
    }

    private drawCameraFrustums(ctx: CanvasRenderingContext2D): void {
        const selectedEntity = this.store_.selectedEntity;

        let aspectRatio = 750 / 1650;
        const canvasEntity = this.store_.scene.entities.find(
            e => e.components.some(c => c.type === 'Canvas')
        );
        if (canvasEntity) {
            const canvas = canvasEntity.components.find(c => c.type === 'Canvas');
            const resolution = canvas?.data.designResolution as { x: number; y: number };
            if (resolution && resolution.y > 0) {
                aspectRatio = resolution.x / resolution.y;
            }
        }

        let cameraIndex = 0;
        for (const entity of this.store_.scene.entities) {
            const camera = entity.components.find(c => c.type === 'Camera');
            if (!camera) continue;

            const transform = entity.components.find(c => c.type === 'LocalTransform');
            if (!transform) { cameraIndex++; continue; }

            const isSelected = entity.id === selectedEntity;
            const showFrustum = (camera.data.showFrustum as boolean) ?? true;

            if (!showFrustum && !isSelected) { cameraIndex++; continue; }

            const color = CAMERA_COLORS[cameraIndex % CAMERA_COLORS.length];
            const worldTransform = this.store_.getWorldTransform(entity.id);
            const pos = worldTransform.position;

            const orthoSize = (camera.data.orthoSize as number) ?? 400;
            const projectionType = (camera.data.projectionType as number) ?? 0;
            const priority = (camera.data.priority as number) ?? 0;
            const vpX = (camera.data.viewportX as number) ?? 0;
            const vpY = (camera.data.viewportY as number) ?? 0;
            const vpW = (camera.data.viewportW as number) ?? 1;
            const vpH = (camera.data.viewportH as number) ?? 1;

            ctx.save();
            ctx.translate(pos.x, -pos.y);

            if (projectionType === 1) {
                const halfHeight = orthoSize;
                const halfWidth = halfHeight * aspectRatio;

                ctx.strokeStyle = color;
                ctx.lineWidth = 2 / this.camera_.zoom;

                if (isSelected) {
                    ctx.globalAlpha = 1;
                    ctx.setLineDash([]);
                } else {
                    ctx.globalAlpha = 0.5;
                    ctx.setLineDash([8 / this.camera_.zoom, 4 / this.camera_.zoom]);
                }

                ctx.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);

                const [cr, cg, cb] = this.hexToRgb(color);
                ctx.fillStyle = isSelected
                    ? `rgba(${cr}, ${cg}, ${cb}, 0.1)`
                    : `rgba(${cr}, ${cg}, ${cb}, 0.05)`;
                ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);

                ctx.setLineDash([]);
                ctx.globalAlpha = isSelected ? 1 : 0.5;

                this.drawCameraIcon(ctx, color);

                const fontSize = 12 / this.camera_.zoom;
                ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
                ctx.textBaseline = 'bottom';

                ctx.textAlign = 'left';
                const nameText = entity.name;
                const nameMetrics = ctx.measureText(nameText);
                const labelPad = 2 / this.camera_.zoom;
                const labelH = fontSize + labelPad * 2;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillRect(
                    -halfWidth,
                    -halfHeight - labelH - labelPad,
                    nameMetrics.width + labelPad * 2,
                    labelH
                );
                ctx.fillStyle = color;
                ctx.fillText(nameText, -halfWidth + labelPad, -halfHeight - labelPad * 2);

                ctx.textAlign = 'right';
                const prioText = `P${priority}`;
                const prioMetrics = ctx.measureText(prioText);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillRect(
                    halfWidth - prioMetrics.width - labelPad * 2,
                    -halfHeight - labelH - labelPad,
                    prioMetrics.width + labelPad * 2,
                    labelH
                );
                ctx.fillStyle = color;
                ctx.fillText(prioText, halfWidth - labelPad, -halfHeight - labelPad * 2);

                const isFullscreen = vpX === 0 && vpY === 0 && vpW === 1 && vpH === 1;
                if (!isFullscreen) {
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    ctx.font = `${fontSize * 0.9}px system-ui, sans-serif`;
                    const pctW = Math.round(vpW * 100);
                    const pctH = Math.round(vpH * 100);
                    const vpText = `viewport: ${vpX}, ${vpY}  ${pctW}%\u00d7${pctH}%`;
                    const vpMetrics = ctx.measureText(vpText);
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                    ctx.fillRect(
                        -halfWidth,
                        halfHeight + labelPad,
                        vpMetrics.width + labelPad * 2,
                        labelH
                    );
                    ctx.fillStyle = color;
                    ctx.fillText(vpText, -halfWidth + labelPad, halfHeight + labelPad * 2);
                }
            }

            ctx.globalAlpha = 1;
            ctx.restore();
            cameraIndex++;
        }
    }

    private drawScreenSpaceBounds(ctx: CanvasRenderingContext2D): void {
        const hasScreenSpace = this.store_.scene.entities.some(
            e => e.components.some(c => c.type === 'ScreenSpace')
        );
        if (!hasScreenSpace) return;

        const canvasRect = findCanvasWorldRect(this.store_.scene.entities);
        if (!canvasRect) return;

        const x = canvasRect.left;
        const y = -(canvasRect.top);
        const w = canvasRect.right - canvasRect.left;
        const h = canvasRect.top - canvasRect.bottom;

        ctx.save();

        ctx.strokeStyle = '#ffb400';
        ctx.lineWidth = 2 / this.camera_.zoom;
        ctx.setLineDash([6 / this.camera_.zoom, 4 / this.camera_.zoom]);
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = 'rgba(255, 180, 0, 0.04)';
        ctx.fillRect(x, y, w, h);

        ctx.setLineDash([]);
        const fontSize = 11 / this.camera_.zoom;
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const label = 'ScreenSpace';
        const pad = 2 / this.camera_.zoom;
        const metrics = ctx.measureText(label);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(x, y - fontSize - pad * 2, metrics.width + pad * 2, fontSize + pad * 2);
        ctx.fillStyle = '#ffb400';
        ctx.fillText(label, x + pad, y - pad);

        ctx.restore();
    }

    private drawCameraIcon(ctx: CanvasRenderingContext2D, color: string): void {
        const s = 1 / this.camera_.zoom;
        const bodyW = 16 * s;
        const bodyH = 12 * s;
        const lensW = 6 * s;
        const lensH1 = 8 * s;
        const lensH2 = 12 * s;

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5 * s;

        ctx.beginPath();
        ctx.rect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(bodyW / 2, -lensH1 / 2);
        ctx.lineTo(bodyW / 2 + lensW, -lensH2 / 2);
        ctx.lineTo(bodyW / 2 + lensW, lensH2 / 2);
        ctx.lineTo(bodyW / 2, lensH1 / 2);
        ctx.closePath();
        ctx.stroke();

        const dotR = 2 * s;
        ctx.beginPath();
        ctx.arc(-bodyW / 4, -bodyH / 2 - dotR - 1 * s, dotR, 0, Math.PI * 2);
        ctx.fill();
    }

    private hexToRgb(hex: string): [number, number, number] {
        const num = parseInt(hex.replace('#', ''), 16);
        return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
    }

    private drawStats(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
        if (!getSettingsValue<boolean>('scene.showStats') || !this.useWebGL_) return;

        const stats = Renderer.getStats();
        const spineCount = this.sceneRenderer_?.spineInstanceCount ?? stats.spine;

        const lines = [
            `DC: ${stats.drawCalls}    Tri: ${stats.triangles}`,
            `Sprite: ${stats.sprites}  Spine: ${spineCount}`,
            `Text: ${stats.text}    Mesh: ${stats.meshes}`,
            `Culled: ${stats.culled}`,
        ];

        const fontSize = 12;
        const lineHeight = 18;
        const padding = 8;
        const panelW = 180;
        const panelH = lines.length * lineHeight + padding * 2;
        const x0 = 12;
        const y0 = canvasHeight - panelH - 12;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x0, y0, panelW, panelH);

        ctx.fillStyle = '#ffffff';
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], x0 + padding, y0 + padding + i * lineHeight);
        }
    }

    private drawViewportPreview(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
        const cameraEntities: Array<{ name: string; color: string; vpX: number; vpY: number; vpW: number; vpH: number }> = [];

        let idx = 0;
        for (const entity of this.store_.scene.entities) {
            const camera = entity.components.find(c => c.type === 'Camera');
            if (!camera) continue;
            cameraEntities.push({
                name: entity.name,
                color: CAMERA_COLORS[idx % CAMERA_COLORS.length],
                vpX: (camera.data.viewportX as number) ?? 0,
                vpY: (camera.data.viewportY as number) ?? 0,
                vpW: (camera.data.viewportW as number) ?? 1,
                vpH: (camera.data.viewportH as number) ?? 1,
            });
            idx++;
        }

        if (cameraEntities.length < 2) return;

        const previewW = 160;
        const previewH = 90;
        const padding = 12;
        const x0 = canvasWidth - previewW - padding;
        const y0 = canvasHeight - previewH - padding;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x0 - 1, y0 - 1, previewW + 2, previewH + 2);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(x0, y0, previewW, previewH);

        for (const cam of cameraEntities) {
            const rx = x0 + cam.vpX * previewW;
            const ry = y0 + cam.vpY * previewH;
            const rw = cam.vpW * previewW;
            const rh = cam.vpH * previewH;

            const [cr, cg, cb] = this.hexToRgb(cam.color);
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.25)`;
            ctx.fillRect(rx, ry, rw, rh);

            ctx.strokeStyle = cam.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(rx, ry, rw, rh);

            ctx.fillStyle = cam.color;
            ctx.font = '9px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(cam.name, rx + 3, ry + 2, rw - 6);
        }
    }

    private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        if (!getSettingsValue<boolean>('scene.showGrid')) return;

        const gridSize = getSettingsValue<number>('scene.gridSize') ?? 50;
        const baseOpacity = getSettingsValue<number>('scene.gridOpacity');
        const gridColor = getSettingsValue<string>('scene.gridColor');
        const halfW = w / 2 / this.camera_.zoom;
        const halfH = h / 2 / this.camera_.zoom;

        const screenGridSize = gridSize * this.camera_.zoom;

        if (screenGridSize > 100) {
            const subDiv = screenGridSize > 250 ? 10 : 5;
            const subSize = gridSize / subDiv;
            this.drawGridLines(ctx, subSize, halfW, halfH, gridColor, baseOpacity * 0.3);
        }

        this.drawGridLines(ctx, gridSize, halfW, halfH, gridColor, baseOpacity);

        if (screenGridSize < 15) {
            const majorSize = gridSize * (screenGridSize < 5 ? 10 : 5);
            this.drawGridLines(ctx, majorSize, halfW, halfH, gridColor, baseOpacity);
        }

        ctx.globalAlpha = baseOpacity;
        ctx.strokeStyle = this.lightenColor(gridColor, 30);
        ctx.lineWidth = 2 / this.camera_.zoom;
        const startX = Math.floor((-halfW - this.camera_.panX) / gridSize) * gridSize;
        const endX = Math.ceil((halfW - this.camera_.panX) / gridSize) * gridSize;
        const startY = Math.floor((-halfH - this.camera_.panY) / gridSize) * gridSize;
        const endY = Math.ceil((halfH - this.camera_.panY) / gridSize) * gridSize;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(endX, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, startY);
        ctx.lineTo(0, endY);
        ctx.stroke();

        ctx.globalAlpha = 1;
    }

    private drawGridLines(
        ctx: CanvasRenderingContext2D,
        step: number,
        halfW: number,
        halfH: number,
        color: string,
        opacity: number,
    ): void {
        const startX = Math.floor((-halfW - this.camera_.panX) / step) * step;
        const endX = Math.ceil((halfW - this.camera_.panX) / step) * step;
        const startY = Math.floor((-halfH - this.camera_.panY) / step) * step;
        const endY = Math.ceil((halfH - this.camera_.panY) / step) * step;

        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 / this.camera_.zoom;

        for (let x = startX; x <= endX; x += step) {
            if (x === 0) continue;
            ctx.beginPath();
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
            ctx.stroke();
        }

        for (let y = startY; y <= endY; y += step) {
            if (y === 0) continue;
            ctx.beginPath();
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
            ctx.stroke();
        }
    }

    private lightenColor(hex: string, percent: number): string {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * percent / 100));
        const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * percent / 100));
        const b = Math.min(255, (num & 0xff) + Math.round(255 * percent / 100));
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    private drawEntity(
        ctx: CanvasRenderingContext2D,
        entity: EntityData,
        isSelected: boolean,
    ): void {
        const transform = entity.components.find(c => c.type === 'LocalTransform');
        const sprite = entity.components.find(c => c.type === 'Sprite');

        if (!transform) return;

        const worldTransform = this.store_.getWorldTransform(entity.id);
        const pos = worldTransform.position;
        const scale = worldTransform.scale;

        let w = DEFAULT_SPRITE_SIZE.x / 2;
        let h = DEFAULT_SPRITE_SIZE.y / 2;
        let color: { r: number; g: number; b: number; a: number } | null = null;
        const hasSprite = !!sprite;
        let textureImg: HTMLImageElement | null = null;
        let flipX = false;
        let flipY = false;

        if (sprite) {
            const size = sprite.data.size as { x: number; y: number };
            const col = sprite.data.color as { r: number; g: number; b: number; a: number };
            const texturePath = sprite.data.texture;

            if (size) {
                w = size.x * Math.abs(scale.x);
                h = size.y * Math.abs(scale.y);
            }
            if (col) {
                color = col;
            }

            flipX = sprite.data.flipX === true;
            flipY = sprite.data.flipY === true;

            if (typeof texturePath === 'string' && texturePath) {
                textureImg = this.loadTexture(texturePath);
            }
        }

        ctx.save();
        ctx.translate(pos.x, -pos.y);

        if (flipX || flipY) {
            ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        }

        if (hasSprite) {
            if (textureImg) {
                ctx.globalAlpha = color?.a ?? 1;
                ctx.drawImage(textureImg, -w / 2, -h / 2, w, h);

                if (color && (color.r !== 1 || color.g !== 1 || color.b !== 1)) {
                    ctx.globalCompositeOperation = 'multiply';
                    const r = Math.round(color.r * 255);
                    const g = Math.round(color.g * 255);
                    const b = Math.round(color.b * 255);
                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    ctx.fillRect(-w / 2, -h / 2, w, h);
                    ctx.globalCompositeOperation = 'source-over';
                }
                ctx.globalAlpha = 1;
            } else {
                const r = Math.round((color?.r ?? 0.4) * 255);
                const g = Math.round((color?.g ?? 0.4) * 255);
                const b = Math.round((color?.b ?? 0.8) * 255);
                const a = color?.a ?? 0.5;
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
                ctx.fillRect(-w / 2, -h / 2, w, h);
            }
        }

        ctx.restore();

        if (isSelected && hasSprite) {
            ctx.save();
            ctx.translate(pos.x, -pos.y);

            ctx.strokeStyle = '#00aaff';
            ctx.lineWidth = 2 / this.camera_.zoom;
            ctx.setLineDash([]);
            ctx.strokeRect(-w / 2, -h / 2, w, h);

            ctx.fillStyle = '#00aaff';
            const handleSize = 6 / this.camera_.zoom;
            const corners = [
                [-w / 2, -h / 2],
                [w / 2, -h / 2],
                [-w / 2, h / 2],
                [w / 2, h / 2],
            ];
            for (const [cx, cy] of corners) {
                ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
            }

            ctx.restore();
        }
    }
}
