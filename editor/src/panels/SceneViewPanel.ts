/**
 * @file    SceneViewPanel.ts
 * @brief   Scene viewport panel with WebGL rendering and gizmo overlay
 */

import type { Entity, App } from 'esengine';
import type { SpineModuleController } from 'esengine/spine';
import type { EditorStore } from '../store/EditorStore';
import type { EditorBridge } from '../bridge/EditorBridge';
import type { SliceBorder } from '../types/TextureMetadata';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { hasSlicing, parseTextureMetadata } from '../types/TextureMetadata';
import { getDefaultComponentData } from '../schemas/ComponentSchemas';
import { getGlobalPathResolver } from '../asset';
import { icons } from '../utils/icons';
import { EditorSceneRenderer } from '../renderer/EditorSceneRenderer';
import { quatToEuler, eulerToQuat } from '../math/Transform';
import { getEntityBounds } from '../bounds';
import { GizmoManager, getAllGizmos } from '../gizmos';
import type { GizmoContext } from '../gizmos';
import { ColliderOverlay } from '../gizmos/ColliderOverlay';
import { getSettingsValue, setSettingsValue, onSettingsChange } from '../settings/SettingsRegistry';

const CAMERA_COLORS = [
    '#ffaa00',
    '#00ccff',
    '#ff55aa',
    '#55ff55',
];

// =============================================================================
// SceneViewPanel
// =============================================================================

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
    private unsubscribeFocus_: (() => void) | null = null;
    private animationId_: number | null = null;
    private continuousRender_ = false;
    private resizeObserver_: ResizeObserver | null = null;
    private projectPath_: string | null = null;
    private app_: App | null = null;

    private sceneRenderer_: EditorSceneRenderer | null = null;
    private useWebGL_ = false;
    private webglInitialized_ = false;
    private webglInitPending_ = false;

    private panX_ = 0;
    private panY_ = 0;
    private zoom_ = 1;
    private isDragging_ = false;
    private lastMouseX_ = 0;
    private lastMouseY_ = 0;

    private gizmoManager_: GizmoManager;
    private colliderOverlay_: ColliderOverlay;
    private keydownHandler_: ((e: KeyboardEvent) => void) | null = null;
    private skipNextClick_ = false;
    private boundOnDocumentMouseMove_: ((e: MouseEvent) => void) | null = null;
    private boundOnDocumentMouseUp_: ((e: MouseEvent) => void) | null = null;

    private textureCache_: Map<string, HTMLImageElement | null> = new Map();
    private metadataCache_: Map<string, SliceBorder | null> = new Map();
    private loadingTextures_: Set<string> = new Set();

    private settingsDropdown_: HTMLElement | null = null;
    private settingsDropdownClickHandler_: ((e: MouseEvent) => void) | null = null;
    private unsubscribeSettings_: (() => void) | null = null;

    private getEntityBoundsWithSpine(entityData: import('../types/SceneTypes').EntityData): { width: number; height: number; offsetX?: number; offsetY?: number } {
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
        return getEntityBounds(entityData.components);
    }

    constructor(container: HTMLElement, store: EditorStore, options?: SceneViewPanelOptions) {
        this.container_ = container;
        this.store_ = store;
        this.projectPath_ = options?.projectPath ?? null;
        this.app_ = options?.app ?? null;
        this.gizmoManager_ = new GizmoManager();
        this.colliderOverlay_ = new ColliderOverlay();

        this.container_.className = 'es-sceneview-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <span class="es-panel-title">Scene</span>
                <div class="es-sceneview-tools">
                    <div class="es-gizmo-toolbar">
                        ${this.buildGizmoToolbarHTML()}
                    </div>
                    <div class="es-toolbar-divider"></div>
                    <button class="es-btn es-btn-icon" data-action="reset-view" title="Reset View">${icons.refresh(14)}</button>
                    <span class="es-zoom-display">100%</span>
                    <div class="es-toolbar-divider"></div>
                    <div class="es-gizmo-settings-wrapper">
                        <button class="es-btn es-btn-icon" data-action="gizmo-settings" title="Gizmo Settings">${icons.settings(14)}</button>
                        <div class="es-gizmo-settings-dropdown" style="display: none;">
                            <div class="es-settings-row">
                                <label class="es-settings-checkbox">
                                    <input type="checkbox" data-setting="scene.showGrid" ${getSettingsValue<boolean>('scene.showGrid') ? 'checked' : ''}>
                                    <span>Show Grid</span>
                                </label>
                            </div>
                            <div class="es-settings-row">
                                <label class="es-settings-label">Grid Color</label>
                                <input type="color" data-setting="scene.gridColor" value="${getSettingsValue<string>('scene.gridColor')}" class="es-color-input">
                            </div>
                            <div class="es-settings-row">
                                <label class="es-settings-label">Grid Opacity</label>
                                <input type="range" data-setting="scene.gridOpacity" min="0" max="1" step="0.1" value="${getSettingsValue<number>('scene.gridOpacity')}" class="es-slider-input">
                            </div>
                            <div class="es-settings-divider"></div>
                            <div class="es-settings-row">
                                <label class="es-settings-checkbox">
                                    <input type="checkbox" data-setting="scene.showGizmos" ${getSettingsValue<boolean>('scene.showGizmos') ? 'checked' : ''}>
                                    <span>Show Gizmos</span>
                                </label>
                            </div>
                            <div class="es-settings-row">
                                <label class="es-settings-checkbox">
                                    <input type="checkbox" data-setting="scene.showSelectionBox" ${getSettingsValue<boolean>('scene.showSelectionBox') ? 'checked' : ''}>
                                    <span>Show Selection Box</span>
                                </label>
                            </div>
                            <div class="es-settings-row">
                                <label class="es-settings-checkbox">
                                    <input type="checkbox" data-setting="scene.showColliders" ${getSettingsValue<boolean>('scene.showColliders') ? 'checked' : ''}>
                                    <span>Show Colliders</span>
                                </label>
                            </div>
                        </div>
                    </div>
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

        this.setupEvents();
        this.unsubscribe_ = store.subscribe(() => this.onSceneChanged());
        this.unsubscribeFocus_ = store.onFocusEntity((entityId) => this.focusOnEntity(entityId));
        this.resize();

        if (this.app_?.wasmModule) {
            this.initWebGLRenderer();
        } else {
            this.startContinuousRender();
        }
    }

    private buildGizmoToolbarHTML(): string {
        const gizmos = getAllGizmos();
        return gizmos.map(g => {
            const isActive = g.id === this.gizmoManager_.getActiveId();
            const shortcutLabel = g.shortcut ? ` (${g.shortcut.toUpperCase()})` : '';
            return `<button class="es-btn es-btn-icon es-gizmo-btn${isActive ? ' es-active' : ''}" data-mode="${g.id}" title="${g.name}${shortcutLabel}">${g.icon}</button>`;
        }).join('');
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
        if (this.unsubscribeFocus_) {
            this.unsubscribeFocus_();
            this.unsubscribeFocus_ = null;
        }
        if (this.resizeObserver_) {
            this.resizeObserver_.disconnect();
            this.resizeObserver_ = null;
        }
        if (this.keydownHandler_) {
            document.removeEventListener('keydown', this.keydownHandler_);
            this.keydownHandler_ = null;
        }
        if (this.settingsDropdownClickHandler_) {
            document.removeEventListener('click', this.settingsDropdownClickHandler_);
            this.settingsDropdownClickHandler_ = null;
        }
        if (this.unsubscribeSettings_) {
            this.unsubscribeSettings_();
            this.unsubscribeSettings_ = null;
        }
        if (this.sceneRenderer_) {
            this.sceneRenderer_.dispose();
            this.sceneRenderer_ = null;
        }
        this.stopDocumentDrag();
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

    private async initWebGLRenderer(): Promise<void> {
        if (this.webglInitPending_ || this.webglInitialized_) return;
        if (!this.app_?.wasmModule || !this.webglCanvas_) return;

        this.webglInitPending_ = true;

        const canvasId = `es-sceneview-webgl-${Date.now()}`;
        this.webglCanvas_.id = canvasId;

        this.sceneRenderer_ = new EditorSceneRenderer();
        this.sceneRenderer_.setStore(this.store_);
        const success = await this.sceneRenderer_.init(this.app_.wasmModule, `#${canvasId}`);

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

    private lastEntityCount_ = -1;
    private lastLoadVersion_ = -1;

    private async onSceneChanged(): Promise<void> {
        if (this.sceneRenderer_ && this.useWebGL_) {
            const loadVersion = this.store_.sceneLoadVersion ?? 0;
            if (loadVersion !== this.lastLoadVersion_) {
                this.lastLoadVersion_ = loadVersion;
                await this.syncSceneToRenderer();
            }
        }
        this.requestRender();
    }

    private loadTexture(texturePath: string): HTMLImageElement | null {
        if (!this.projectPath_ || !texturePath) return null;

        if (this.textureCache_.has(texturePath)) {
            return this.textureCache_.get(texturePath) ?? null;
        }

        if (this.loadingTextures_.has(texturePath)) {
            return null;
        }

        this.loadingTextures_.add(texturePath);

        const projectDir = this.projectPath_.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
        const fullPath = `${projectDir}/${texturePath}`;
        const img = new Image();

        img.onload = () => {
            this.loadingTextures_.delete(texturePath);
            this.textureCache_.set(texturePath, img);
            this.requestRender();
        };

        img.onerror = () => {
            this.loadingTextures_.delete(texturePath);
            this.textureCache_.set(texturePath, null);
            console.warn(`Failed to load texture: ${fullPath}`);
        };

        img.src = getPlatformAdapter().convertFilePathToUrl(fullPath);

        return null;
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

    private createGizmoContext(ctx: CanvasRenderingContext2D): GizmoContext {
        return {
            store: this.store_,
            ctx,
            zoom: this.zoom_,
            screenToWorld: (clientX, clientY) => this.screenToWorld(clientX, clientY),
            getWorldTransform: (entityId) => this.store_.getWorldTransform(entityId),
            getEntityBounds: (entityData) => this.getEntityBoundsWithSpine(entityData),
            requestRender: () => this.requestRender(),
        };
    }

    private setupEvents(): void {
        const resetBtn = this.container_.querySelector('[data-action="reset-view"]');
        resetBtn?.addEventListener('click', () => {
            this.panX_ = 0;
            this.panY_ = 0;
            this.zoom_ = 1;
            this.updateZoomDisplay();
            this.requestRender();
        });

        this.setupGizmoSettingsDropdown();

        const gizmoButtons = this.container_.querySelectorAll('.es-gizmo-btn');
        gizmoButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = (btn as HTMLElement).dataset.mode;
                if (mode) this.setGizmoMode(mode);
            });
        });

        this.keydownHandler_ = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            const gizmos = getAllGizmos();
            for (const g of gizmos) {
                if (g.shortcut && e.key.toLowerCase() === g.shortcut) {
                    this.setGizmoMode(g.id);
                    return;
                }
            }
        };
        document.addEventListener('keydown', this.keydownHandler_);

        this.canvas_.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas_.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas_.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas_.addEventListener('mouseleave', this.onMouseLeave.bind(this));
        this.canvas_.addEventListener('wheel', this.onWheel.bind(this));
        this.canvas_.addEventListener('click', this.onCanvasClick.bind(this));

        const viewport = this.container_.querySelector('.es-sceneview-viewport');
        if (viewport) {
            this.resizeObserver_ = new ResizeObserver(() => {
                this.resize();
            });
            this.resizeObserver_.observe(viewport);
        }

        this.canvas_.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types ?? [];
            if (!Array.from(types).includes('application/esengine-asset')) return;
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
        });

        this.canvas_.addEventListener('drop', (e) => {
            e.preventDefault();
            const assetDataStr = e.dataTransfer?.getData('application/esengine-asset');
            if (!assetDataStr) return;

            let assetData: { type: string; path: string; name: string };
            try {
                assetData = JSON.parse(assetDataStr);
            } catch {
                return;
            }

            if (assetData.type !== 'image') return;

            const { worldX, worldY } = this.screenToWorld(e.clientX, e.clientY);
            this.createSpriteFromDrop(assetData, worldX, worldY);
        });
    }

    private setGizmoMode(mode: string): void {
        this.gizmoManager_.setActive(mode);
        const buttons = this.container_.querySelectorAll('.es-gizmo-btn');
        buttons.forEach(btn => {
            const btnMode = (btn as HTMLElement).dataset.mode;
            btn.classList.toggle('es-active', btnMode === mode);
        });
        this.requestRender();
    }

    private setupGizmoSettingsDropdown(): void {
        const settingsBtn = this.container_.querySelector('[data-action="gizmo-settings"]');
        this.settingsDropdown_ = this.container_.querySelector('.es-gizmo-settings-dropdown');

        if (!settingsBtn || !this.settingsDropdown_) return;

        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = this.settingsDropdown_!.style.display !== 'none';
            this.settingsDropdown_!.style.display = isVisible ? 'none' : 'block';
        });

        this.settingsDropdownClickHandler_ = (e: MouseEvent) => {
            if (this.settingsDropdown_ && !this.settingsDropdown_.contains(e.target as Node) &&
                !settingsBtn.contains(e.target as Node)) {
                this.settingsDropdown_.style.display = 'none';
            }
        };
        document.addEventListener('click', this.settingsDropdownClickHandler_);

        this.settingsDropdown_.querySelectorAll('input').forEach(input => {
            const settingId = input.dataset.setting;
            if (!settingId) return;

            input.addEventListener('change', () => {
                if (input.type === 'checkbox') {
                    setSettingsValue(settingId, input.checked);
                } else if (input.type === 'range') {
                    setSettingsValue(settingId, parseFloat(input.value));
                } else if (input.type === 'color') {
                    setSettingsValue(settingId, input.value);
                }
                this.requestRender();
            });

            if (input.type === 'range') {
                input.addEventListener('input', () => {
                    setSettingsValue(settingId, parseFloat(input.value));
                    this.requestRender();
                });
            }
        });

        this.unsubscribeSettings_ = onSettingsChange((id, value) => {
            if (!id.startsWith('scene.')) return;
            const input = this.settingsDropdown_?.querySelector(`[data-setting="${id}"]`) as HTMLInputElement | null;
            if (!input) return;
            if (input.type === 'checkbox') {
                input.checked = value as boolean;
            } else {
                input.value = String(value);
            }
            this.requestRender();
        });
    }

    private updateGizmoContext(): void {
        const ctx = this.overlayCanvas_?.getContext('2d') ?? this.canvas_.getContext('2d');
        if (ctx) {
            this.gizmoManager_.setContext(this.createGizmoContext(ctx));
        }
    }

    private createOverlayContext(): import('../gizmos/ColliderOverlay').OverlayContext | null {
        const ctx = this.overlayCanvas_?.getContext('2d') ?? this.canvas_.getContext('2d');
        if (!ctx) return null;
        return { ctx, zoom: this.zoom_, store: this.store_ };
    }

    private onMouseDown(e: MouseEvent): void {
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            this.isDragging_ = true;
            this.lastMouseX_ = e.clientX;
            this.lastMouseY_ = e.clientY;
            this.canvas_.style.cursor = 'grabbing';
            this.startDocumentDrag();
            return;
        }

        if (e.button !== 0) return;

        const { worldX, worldY } = this.screenToWorld(e.clientX, e.clientY);

        if (this.gizmoManager_.getActiveId() !== 'select' && this.store_.selectedEntity !== null &&
            this.store_.isEntityVisible(this.store_.selectedEntity as number)) {
            this.updateGizmoContext();
            if (this.gizmoManager_.onMouseDown(worldX, worldY)) {
                this.startDocumentDrag();
                return;
            }
        }

        if (getSettingsValue<boolean>('scene.showColliders') && this.store_.selectedEntity !== null) {
            const octx = this.createOverlayContext();
            if (octx && this.colliderOverlay_.onDragStart(worldX, worldY, octx)) {
                this.startDocumentDrag();
                return;
            }
        }

        this.lastMouseX_ = e.clientX;
        this.lastMouseY_ = e.clientY;
    }

    private startDocumentDrag(): void {
        this.boundOnDocumentMouseMove_ = this.onDocumentMouseMove.bind(this);
        this.boundOnDocumentMouseUp_ = this.onDocumentMouseUp.bind(this);
        document.addEventListener('mousemove', this.boundOnDocumentMouseMove_);
        document.addEventListener('mouseup', this.boundOnDocumentMouseUp_);
    }

    private stopDocumentDrag(): void {
        if (this.boundOnDocumentMouseMove_) {
            document.removeEventListener('mousemove', this.boundOnDocumentMouseMove_);
            this.boundOnDocumentMouseMove_ = null;
        }
        if (this.boundOnDocumentMouseUp_) {
            document.removeEventListener('mouseup', this.boundOnDocumentMouseUp_);
            this.boundOnDocumentMouseUp_ = null;
        }
    }

    private onDocumentMouseMove(e: MouseEvent): void {
        this.onMouseMove(e);
    }

    private onDocumentMouseUp(e: MouseEvent): void {
        this.onMouseUp(e);
        this.stopDocumentDrag();
    }

    private onMouseMove(e: MouseEvent): void {
        const { worldX, worldY } = this.screenToWorld(e.clientX, e.clientY);

        if (this.isDragging_) {
            const dx = e.clientX - this.lastMouseX_;
            const dy = e.clientY - this.lastMouseY_;

            this.panX_ += dx / this.zoom_;
            this.panY_ += dy / this.zoom_;

            this.lastMouseX_ = e.clientX;
            this.lastMouseY_ = e.clientY;
            this.requestRender();
            return;
        }

        if (this.gizmoManager_.isDragging()) {
            this.updateGizmoContext();
            this.gizmoManager_.onMouseMove(worldX, worldY);
            return;
        }

        if (this.colliderOverlay_.isDragging()) {
            const octx = this.createOverlayContext();
            if (octx) {
                this.colliderOverlay_.onDrag(worldX, worldY, octx);
                this.requestRender();
            }
            return;
        }

        if (this.gizmoManager_.getActiveId() !== 'select' && this.store_.selectedEntity !== null) {
            this.updateGizmoContext();
            this.gizmoManager_.onMouseMove(worldX, worldY);
            this.canvas_.style.cursor = this.gizmoManager_.getCursor();
        }

        if (getSettingsValue<boolean>('scene.showColliders') && this.store_.selectedEntity !== null) {
            const octx = this.createOverlayContext();
            if (octx) {
                this.colliderOverlay_.hitTest(worldX, worldY, octx);
                const colliderCursor = this.colliderOverlay_.getCursor();
                if (colliderCursor) {
                    this.canvas_.style.cursor = colliderCursor;
                }
            }
        }
    }

    private onMouseUp(_e: MouseEvent): void {
        if (this.isDragging_) {
            this.isDragging_ = false;
            this.canvas_.style.cursor = 'default';
            this.skipNextClick_ = true;
        }

        if (this.gizmoManager_.isDragging()) {
            const { worldX, worldY } = this.screenToWorld(_e.clientX, _e.clientY);
            this.updateGizmoContext();
            this.gizmoManager_.onMouseUp(worldX, worldY);
            this.skipNextClick_ = true;
        }

        if (this.colliderOverlay_.isDragging()) {
            const octx = this.createOverlayContext();
            if (octx) {
                this.colliderOverlay_.onDragEnd(octx);
            }
            this.skipNextClick_ = true;
        }
    }

    private onMouseLeave(_e: MouseEvent): void {
        if (this.isDragging_ || this.gizmoManager_.isDragging() || this.colliderOverlay_.isDragging()) {
            return;
        }
        this.gizmoManager_.resetHover();
        this.requestRender();
    }

    private onCanvasClick(e: MouseEvent): void {
        if (this.skipNextClick_) {
            this.skipNextClick_ = false;
            return;
        }

        if (this.isDragging_ || this.gizmoManager_.isDragging()) return;

        const { worldX, worldY } = this.screenToWorld(e.clientX, e.clientY);

        if (this.gizmoManager_.getActiveId() !== 'select' && this.store_.selectedEntity !== null) {
            this.updateGizmoContext();
            const result = this.gizmoManager_.hitTest(worldX, worldY);
            if (result.hit) return;
        }

        const entity = this.findEntityAtPosition(worldX, worldY);
        this.store_.selectEntity(entity);
    }

    private focusOnEntity(entityId: number): void {
        const worldTransform = this.store_.getWorldTransform(entityId);
        this.panX_ = -worldTransform.position.x;
        this.panY_ = worldTransform.position.y;
        this.updateZoomDisplay();
        this.requestRender();
    }

    private screenToWorld(clientX: number, clientY: number): { worldX: number; worldY: number } {
        const rect = this.canvas_.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const x = (clientX - rect.left) * dpr;
        const y = (clientY - rect.top) * dpr;
        const w = this.canvas_.width;
        const h = this.canvas_.height;

        return {
            worldX: (x - w / 2) / this.zoom_ - this.panX_,
            worldY: -(y - h / 2) / this.zoom_ + this.panY_,
        };
    }

    private onWheel(e: WheelEvent): void {
        e.preventDefault();

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(10, this.zoom_ * zoomFactor));

        const rect = this.canvas_.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldX = (mouseX - this.canvas_.width / 2) / this.zoom_ - this.panX_;
        const worldY = (mouseY - this.canvas_.height / 2) / this.zoom_ - this.panY_;

        this.zoom_ = newZoom;

        this.panX_ = (mouseX - this.canvas_.width / 2) / this.zoom_ - worldX;
        this.panY_ = (mouseY - this.canvas_.height / 2) / this.zoom_ - worldY;

        this.updateZoomDisplay();
        this.requestRender();
    }

    private findEntityAtPosition(worldX: number, worldY: number): Entity | null {
        const scene = this.store_.scene;

        for (let i = scene.entities.length - 1; i >= 0; i--) {
            const entity = scene.entities[i];
            if (!this.store_.isEntityVisible(entity.id)) continue;

            const transform = entity.components.find(c => c.type === 'LocalTransform');

            if (!transform) continue;

            const worldTransform = this.store_.getWorldTransform(entity.id);
            const pos = worldTransform.position;
            const scale = worldTransform.scale;

            const bounds = this.getEntityBoundsWithSpine(entity);
            const w = bounds.width * Math.abs(scale.x);
            const h = bounds.height * Math.abs(scale.y);
            const offsetX = (bounds.offsetX ?? 0) * scale.x;
            const offsetY = (bounds.offsetY ?? 0) * scale.y;

            const centerX = pos.x + offsetX;
            const centerY = pos.y + offsetY;
            const halfW = w / 2;
            const halfH = h / 2;

            if (
                worldX >= centerX - halfW &&
                worldX <= centerX + halfW &&
                worldY >= centerY - halfH &&
                worldY <= centerY + halfH
            ) {
                return entity.id as Entity;
            }
        }

        return null;
    }

    private updateZoomDisplay(): void {
        const display = this.container_.querySelector('.es-zoom-display');
        if (display) {
            display.textContent = `${Math.round(this.zoom_ * 100)}%`;
        }
    }

    private requestRender(): void {
        if (this.animationId_ !== null) return;

        this.animationId_ = requestAnimationFrame(() => {
            this.animationId_ = null;
            this.render();
            if (this.continuousRender_) {
                this.requestRender();
            }
        });
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

    private render(): void {
        if (this.useWebGL_ && this.sceneRenderer_ && this.webglCanvas_) {
            const w = this.webglCanvas_.width;
            const h = this.webglCanvas_.height;
            if (w === 0 || h === 0) return;

            this.sceneRenderer_.camera.panX = this.panX_;
            this.sceneRenderer_.camera.panY = this.panY_;
            this.sceneRenderer_.camera.zoom = this.zoom_;

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

    private renderOverlay(): void {
        if (!this.overlayCanvas_) return;

        const ctx = this.overlayCanvas_.getContext('2d');
        if (!ctx) return;

        const w = this.overlayCanvas_.width;
        const h = this.overlayCanvas_.height;

        ctx.clearRect(0, 0, w, h);

        ctx.save();
        ctx.translate(w / 2 + this.panX_ * this.zoom_, h / 2 + this.panY_ * this.zoom_);
        ctx.scale(this.zoom_, this.zoom_);

        this.drawGrid(ctx, w, h);

        this.drawCameraFrustums(ctx);

        if (getSettingsValue<boolean>('scene.showColliders')) {
            this.colliderOverlay_.drawAll({
                ctx,
                zoom: this.zoom_,
                store: this.store_,
            });
        }

        const selectedEntity = this.store_.selectedEntity;

        if (selectedEntity !== null && this.store_.isEntityVisible(selectedEntity as number)) {
            if (getSettingsValue<boolean>('scene.showSelectionBox')) {
                this.drawSelectionBox(ctx);
            }

            if (this.gizmoManager_.getActiveId() !== 'select' && getSettingsValue<boolean>('scene.showGizmos')) {
                this.gizmoManager_.setContext(this.createGizmoContext(ctx));
                this.gizmoManager_.draw();
            }
        }

        ctx.restore();

        this.drawViewportPreview(ctx, w, h);

        if (!this.store_.scene.entities.some(
            e => e.components.some(c => c.type === 'Camera'))) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '14px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No Camera in Scene', w / 2, h / 2);
        }
    }

    private drawSelectionBox(ctx: CanvasRenderingContext2D): void {
        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return;

        const transform = entityData.components.find(c => c.type === 'LocalTransform');
        if (!transform) return;

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
        ctx.lineWidth = 2 / this.zoom_;
        ctx.setLineDash([]);
        ctx.strokeRect(-w / 2, -h / 2, w, h);

        ctx.fillStyle = '#00aaff';
        const handleSize = 6 / this.zoom_;
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
                ctx.lineWidth = 2 / this.zoom_;

                if (isSelected) {
                    ctx.globalAlpha = 1;
                    ctx.setLineDash([]);
                } else {
                    ctx.globalAlpha = 0.5;
                    ctx.setLineDash([8 / this.zoom_, 4 / this.zoom_]);
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

                const fontSize = 12 / this.zoom_;
                ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
                ctx.textBaseline = 'bottom';

                ctx.textAlign = 'left';
                const nameText = entity.name;
                const nameMetrics = ctx.measureText(nameText);
                const labelPad = 2 / this.zoom_;
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

    private drawCameraIcon(ctx: CanvasRenderingContext2D, color: string): void {
        const s = 1 / this.zoom_;
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

    private renderPreview(): void {
        const ctx = this.canvas_.getContext('2d');
        if (!ctx) return;

        const w = this.canvas_.width;
        const h = this.canvas_.height;

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.translate(w / 2 + this.panX_ * this.zoom_, h / 2 + this.panY_ * this.zoom_);
        ctx.scale(this.zoom_, this.zoom_);

        this.drawGrid(ctx, w, h);

        const scene = this.store_.scene;
        const selectedEntity = this.store_.selectedEntity;

        for (const entity of scene.entities) {
            if (!this.store_.isEntityVisible(entity.id)) continue;
            this.drawEntity(ctx, entity, entity.id === selectedEntity);
        }

        this.drawCameraFrustums(ctx);

        if (getSettingsValue<boolean>('scene.showColliders')) {
            this.colliderOverlay_.drawAll({
                ctx,
                zoom: this.zoom_,
                store: this.store_,
            });
        }

        if (selectedEntity !== null && this.store_.isEntityVisible(selectedEntity as number)) {
            if (this.gizmoManager_.getActiveId() !== 'select' && getSettingsValue<boolean>('scene.showGizmos')) {
                this.gizmoManager_.setContext(this.createGizmoContext(ctx));
                this.gizmoManager_.draw();
            }
        }

        ctx.restore();
    }

    private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        if (!getSettingsValue<boolean>('scene.showGrid')) return;

        const gridSize = 50;
        const halfW = w / 2 / this.zoom_;
        const halfH = h / 2 / this.zoom_;

        const startX = Math.floor((-halfW - this.panX_) / gridSize) * gridSize;
        const endX = Math.ceil((halfW - this.panX_) / gridSize) * gridSize;
        const startY = Math.floor((-halfH - this.panY_) / gridSize) * gridSize;
        const endY = Math.ceil((halfH - this.panY_) / gridSize) * gridSize;

        ctx.globalAlpha = getSettingsValue<number>('scene.gridOpacity');
        ctx.strokeStyle = getSettingsValue<string>('scene.gridColor');
        ctx.lineWidth = 1 / this.zoom_;

        for (let x = startX; x <= endX; x += gridSize) {
            if (x === 0) continue;
            ctx.beginPath();
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
            ctx.stroke();
        }

        for (let y = startY; y <= endY; y += gridSize) {
            if (y === 0) continue;
            ctx.beginPath();
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
            ctx.stroke();
        }

        ctx.strokeStyle = this.lightenColor(getSettingsValue<string>('scene.gridColor'), 30);
        ctx.lineWidth = 2 / this.zoom_;
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

    private lightenColor(hex: string, percent: number): string {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * percent / 100));
        const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * percent / 100));
        const b = Math.min(255, (num & 0xff) + Math.round(255 * percent / 100));
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    private createSpriteFromDrop(
        asset: { type: string; path: string; name: string },
        worldX: number,
        worldY: number
    ): void {
        const baseName = asset.name.replace(/\.[^.]+$/, '');
        const newEntity = this.store_.createEntity(baseName);

        const transformData = getDefaultComponentData('LocalTransform');
        transformData.position = { x: worldX, y: worldY, z: 0 };
        this.store_.addComponent(newEntity, 'LocalTransform', transformData);

        const relativePath = getGlobalPathResolver().toRelativePath(asset.path);
        this.store_.addComponent(newEntity, 'Sprite', {
            ...getDefaultComponentData('Sprite'),
            texture: relativePath,
        });

        this.loadImageSize(asset.path).then(size => {
            if (size) {
                this.store_.updateProperty(newEntity, 'Sprite', 'size', { x: 32, y: 32 }, size);
            }
        });
    }

    private loadImageSize(absolutePath: string): Promise<{ x: number; y: number } | null> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ x: img.naturalWidth, y: img.naturalHeight });
            img.onerror = () => resolve(null);
            img.src = getPlatformAdapter().convertFilePathToUrl(absolutePath);
        });
    }

    private drawEntity(
        ctx: CanvasRenderingContext2D,
        entity: import('../types/SceneTypes').EntityData,
        isSelected: boolean
    ): void {
        const transform = entity.components.find(c => c.type === 'LocalTransform');
        const sprite = entity.components.find(c => c.type === 'Sprite');

        if (!transform) return;

        const worldTransform = this.store_.getWorldTransform(entity.id);
        const pos = worldTransform.position;
        const scale = worldTransform.scale;

        let w = 50;
        let h = 50;
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
            ctx.lineWidth = 2 / this.zoom_;
            ctx.setLineDash([]);
            ctx.strokeRect(-w / 2, -h / 2, w, h);

            ctx.fillStyle = '#00aaff';
            const handleSize = 6 / this.zoom_;
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
