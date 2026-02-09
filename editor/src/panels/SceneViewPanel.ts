/**
 * @file    SceneViewPanel.ts
 * @brief   Scene viewport panel with WebGL rendering and gizmo overlay
 */

import type { Entity, App } from 'esengine';
import type { EditorStore } from '../store/EditorStore';
import type { EditorBridge } from '../bridge/EditorBridge';
import type { SliceBorder } from '../types/TextureMetadata';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { hasSlicing, parseTextureMetadata } from '../types/TextureMetadata';
import { icons } from '../utils/icons';
import { EditorSceneRenderer } from '../renderer/EditorSceneRenderer';
import { quatToEuler, eulerToQuat } from '../math/Transform';
import { getEntityBounds } from '../bounds';
import { GizmoManager, getAllGizmos } from '../gizmos';
import type { GizmoContext } from '../gizmos';
import { getSettingsValue, setSettingsValue, onSettingsChange } from '../settings/SettingsRegistry';

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
        }

        this.webglInitPending_ = false;
    }

    private async syncSceneToRenderer(): Promise<void> {
        if (!this.sceneRenderer_) return;
        await this.sceneRenderer_.syncScene(this.store_.scene);
    }

    private async onSceneChanged(): Promise<void> {
        if (this.sceneRenderer_ && this.useWebGL_) {
            await this.syncSceneToRenderer();
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

        if (this.gizmoManager_.getActiveId() !== 'select' && this.store_.selectedEntity !== null) {
            this.updateGizmoContext();
            this.gizmoManager_.onMouseMove(worldX, worldY);
            this.canvas_.style.cursor = this.gizmoManager_.getCursor();
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
    }

    private onMouseLeave(_e: MouseEvent): void {
        if (this.isDragging_ || this.gizmoManager_.isDragging()) {
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

        const selectedEntity = this.store_.selectedEntity;

        if (selectedEntity !== null && this.store_.isEntityVisible(selectedEntity as number)) {
            if (getSettingsValue<boolean>('scene.showSelectionBox')) {
                this.drawSelectionBox(ctx);
            }

            this.drawCameraFrustum(ctx);

            if (this.gizmoManager_.getActiveId() !== 'select' && getSettingsValue<boolean>('scene.showGizmos')) {
                this.gizmoManager_.setContext(this.createGizmoContext(ctx));
                this.gizmoManager_.draw();
            }
        }

        ctx.restore();
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

    private drawCameraFrustum(ctx: CanvasRenderingContext2D): void {
        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return;

        const camera = entityData.components.find(c => c.type === 'Camera');
        if (!camera) return;

        const transform = entityData.components.find(c => c.type === 'LocalTransform');
        if (!transform) return;

        const worldTransform = this.store_.getWorldTransform(entityData.id);
        const pos = worldTransform.position;

        const orthoSize = (camera.data.orthoSize as number) ?? 400;
        const projectionType = (camera.data.projectionType as number) ?? 0;

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

        ctx.save();
        ctx.translate(pos.x, -pos.y);

        if (projectionType === 1) {
            const halfHeight = orthoSize;
            const halfWidth = halfHeight * aspectRatio;

            ctx.strokeStyle = '#ffaa00';
            ctx.lineWidth = 2 / this.zoom_;
            ctx.setLineDash([8 / this.zoom_, 4 / this.zoom_]);

            ctx.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);

            ctx.fillStyle = 'rgba(255, 170, 0, 0.1)';
            ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);

            ctx.setLineDash([]);
            ctx.strokeStyle = '#ffaa00';
            ctx.lineWidth = 1 / this.zoom_;
            ctx.beginPath();
            ctx.moveTo(-halfWidth * 0.1, 0);
            ctx.lineTo(halfWidth * 0.1, 0);
            ctx.moveTo(0, -halfHeight * 0.1);
            ctx.lineTo(0, halfHeight * 0.1);
            ctx.stroke();
        }

        ctx.restore();
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

        if (selectedEntity !== null && this.store_.isEntityVisible(selectedEntity as number)) {
            this.drawCameraFrustum(ctx);

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
        let color: { x: number; y: number; z: number; w: number } | null = null;
        const hasSprite = !!sprite;
        let textureImg: HTMLImageElement | null = null;
        let flipX = false;
        let flipY = false;

        if (sprite) {
            const size = sprite.data.size as { x: number; y: number };
            const col = sprite.data.color as { x: number; y: number; z: number; w: number };
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
                ctx.globalAlpha = color?.w ?? 1;
                ctx.drawImage(textureImg, -w / 2, -h / 2, w, h);

                if (color && (color.x !== 1 || color.y !== 1 || color.z !== 1)) {
                    ctx.globalCompositeOperation = 'multiply';
                    const r = Math.round(color.x * 255);
                    const g = Math.round(color.y * 255);
                    const b = Math.round(color.z * 255);
                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    ctx.fillRect(-w / 2, -h / 2, w, h);
                    ctx.globalCompositeOperation = 'source-over';
                }
                ctx.globalAlpha = 1;
            } else {
                const r = Math.round((color?.x ?? 0.4) * 255);
                const g = Math.round((color?.y ?? 0.4) * 255);
                const b = Math.round((color?.z ?? 0.8) * 255);
                const a = color?.w ?? 0.5;
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
