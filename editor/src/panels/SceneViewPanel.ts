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

// =============================================================================
// Types
// =============================================================================

type GizmoMode = 'select' | 'move' | 'rotate' | 'scale';
type DragAxis = 'none' | 'x' | 'y' | 'xy';

interface GizmoColors {
    x: string;
    y: string;
    xy: string;
    hover: string;
}

interface GizmoSettings {
    showGrid: boolean;
    gridColor: string;
    gridOpacity: number;
    showGizmos: boolean;
    showSelectionBox: boolean;
}

const GIZMO_COLORS: GizmoColors = {
    x: '#e74c3c',
    y: '#2ecc71',
    xy: '#f1c40f',
    hover: '#ffffff',
};

const GIZMO_SIZE = 80;
const GIZMO_HANDLE_SIZE = 10;

const DEFAULT_GIZMO_SETTINGS: GizmoSettings = {
    showGrid: true,
    gridColor: '#333333',
    gridOpacity: 1.0,
    showGizmos: true,
    showSelectionBox: true,
};

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
    private animationId_: number | null = null;
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

    private gizmoMode_: GizmoMode = 'move';
    private dragAxis_: DragAxis = 'none';
    private hoveredAxis_: DragAxis = 'none';
    private isGizmoDragging_ = false;
    private gizmoDragStartX_ = 0;
    private gizmoDragStartY_ = 0;
    private gizmoDragStartValue_: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    private gizmoDragOriginalValue_: unknown = null;
    private gizmoDragPropertyName_: string = '';
    private keydownHandler_: ((e: KeyboardEvent) => void) | null = null;
    private skipNextClick_ = false;
    private boundOnDocumentMouseMove_: ((e: MouseEvent) => void) | null = null;
    private boundOnDocumentMouseUp_: ((e: MouseEvent) => void) | null = null;

    private textureCache_: Map<string, HTMLImageElement | null> = new Map();
    private metadataCache_: Map<string, SliceBorder | null> = new Map();
    private loadingTextures_: Set<string> = new Set();

    private gizmoSettings_: GizmoSettings = { ...DEFAULT_GIZMO_SETTINGS };
    private settingsDropdown_: HTMLElement | null = null;
    private settingsDropdownClickHandler_: ((e: MouseEvent) => void) | null = null;

    constructor(container: HTMLElement, store: EditorStore, options?: SceneViewPanelOptions) {
        this.container_ = container;
        this.store_ = store;
        this.projectPath_ = options?.projectPath ?? null;
        this.app_ = options?.app ?? null;

        this.container_.className = 'es-sceneview-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <span class="es-panel-title">Scene</span>
                <div class="es-sceneview-tools">
                    <div class="es-gizmo-toolbar">
                        <button class="es-btn es-btn-icon es-gizmo-btn" data-mode="select" title="Select (Q)">${icons.pointer(14)}</button>
                        <button class="es-btn es-btn-icon es-gizmo-btn es-active" data-mode="move" title="Move (W)">${icons.move(14)}</button>
                        <button class="es-btn es-btn-icon es-gizmo-btn" data-mode="rotate" title="Rotate (E)">${icons.rotateCw(14)}</button>
                        <button class="es-btn es-btn-icon es-gizmo-btn" data-mode="scale" title="Scale (R)">${icons.maximize(14)}</button>
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
                                    <input type="checkbox" data-setting="showGrid" checked>
                                    <span>Show Grid</span>
                                </label>
                            </div>
                            <div class="es-settings-row">
                                <label class="es-settings-label">Grid Color</label>
                                <input type="color" data-setting="gridColor" value="#333333" class="es-color-input">
                            </div>
                            <div class="es-settings-row">
                                <label class="es-settings-label">Grid Opacity</label>
                                <input type="range" data-setting="gridOpacity" min="0" max="1" step="0.1" value="1" class="es-slider-input">
                            </div>
                            <div class="es-settings-divider"></div>
                            <div class="es-settings-row">
                                <label class="es-settings-checkbox">
                                    <input type="checkbox" data-setting="showGizmos" checked>
                                    <span>Show Gizmos</span>
                                </label>
                            </div>
                            <div class="es-settings-row">
                                <label class="es-settings-checkbox">
                                    <input type="checkbox" data-setting="showSelectionBox" checked>
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
        this.resize();

        if (this.app_?.wasmModule) {
            this.initWebGLRenderer();
        }
    }

    dispose(): void {
        if (this.animationId_ !== null) {
            cancelAnimationFrame(this.animationId_);
            this.animationId_ = null;
        }
        if (this.unsubscribe_) {
            this.unsubscribe_();
            this.unsubscribe_ = null;
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
        const success = await this.sceneRenderer_.init(this.app_.wasmModule, `#${canvasId}`);

        if (success) {
            this.webglInitialized_ = true;
            this.useWebGL_ = true;

            if (this.projectPath_) {
                const projectDir = this.projectPath_.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
                this.sceneRenderer_.setProjectDir(projectDir);
            }

            await this.syncSceneToRenderer();
            this.requestRender();
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
                const mode = (btn as HTMLElement).dataset.mode as GizmoMode;
                if (mode) this.setGizmoMode(mode);
            });
        });

        this.keydownHandler_ = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            switch (e.key.toLowerCase()) {
                case 'q':
                    this.setGizmoMode('select');
                    break;
                case 'w':
                    this.setGizmoMode('move');
                    break;
                case 'e':
                    this.setGizmoMode('rotate');
                    break;
                case 'r':
                    this.setGizmoMode('scale');
                    break;
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

    private setGizmoMode(mode: GizmoMode): void {
        this.gizmoMode_ = mode;
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
            const setting = input.dataset.setting as keyof GizmoSettings;
            if (!setting) return;

            input.addEventListener('change', () => {
                if (input.type === 'checkbox') {
                    (this.gizmoSettings_ as any)[setting] = input.checked;
                } else if (input.type === 'range') {
                    (this.gizmoSettings_ as any)[setting] = parseFloat(input.value);
                } else if (input.type === 'color') {
                    (this.gizmoSettings_ as any)[setting] = input.value;
                }
                this.requestRender();
            });

            if (input.type === 'range') {
                input.addEventListener('input', () => {
                    (this.gizmoSettings_ as any)[setting] = parseFloat(input.value);
                    this.requestRender();
                });
            }
        });
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

        if (this.gizmoMode_ !== 'select' && this.store_.selectedEntity !== null) {
            const axis = this.hitTestGizmo(worldX, worldY);
            if (axis !== 'none') {
                this.isGizmoDragging_ = true;
                this.dragAxis_ = axis;
                this.gizmoDragStartX_ = worldX;
                this.gizmoDragStartY_ = worldY;

                const entityData = this.store_.getSelectedEntityData();
                const transform = entityData?.components.find(c => c.type === 'LocalTransform');
                if (transform) {
                    if (this.gizmoMode_ === 'rotate') {
                        const quat = transform.data.rotation as { x: number; y: number; z: number; w: number };
                        this.gizmoDragStartValue_ = quatToEuler(quat ?? { x: 0, y: 0, z: 0, w: 1 });
                        this.gizmoDragPropertyName_ = 'rotation';
                        this.gizmoDragOriginalValue_ = quat ? { ...quat } : { x: 0, y: 0, z: 0, w: 1 };
                    } else {
                        const prop = this.gizmoMode_ === 'scale' ? 'scale' : 'position';
                        const value = transform.data[prop] as { x: number; y: number; z: number };
                        this.gizmoDragStartValue_ = { ...value };
                        this.gizmoDragPropertyName_ = prop;
                        this.gizmoDragOriginalValue_ = { ...value };
                    }
                }
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

        if (this.isGizmoDragging_) {
            this.handleGizmoDrag(worldX, worldY);
            return;
        }

        if (this.gizmoMode_ !== 'select' && this.store_.selectedEntity !== null) {
            const axis = this.hitTestGizmo(worldX, worldY);
            if (axis !== this.hoveredAxis_) {
                this.hoveredAxis_ = axis;
                this.canvas_.style.cursor = axis !== 'none' ? 'pointer' : 'default';
                this.requestRender();
            }
        }
    }

    private onMouseUp(_e: MouseEvent): void {
        if (this.isDragging_) {
            this.isDragging_ = false;
            this.canvas_.style.cursor = 'default';
            this.skipNextClick_ = true;
        }

        if (this.isGizmoDragging_) {
            this.commitGizmoDrag();
            this.isGizmoDragging_ = false;
            this.dragAxis_ = 'none';
            this.skipNextClick_ = true;
        }
    }

    private commitGizmoDrag(): void {
        const entity = this.store_.selectedEntity;
        if (entity === null || !this.gizmoDragPropertyName_ || this.gizmoDragOriginalValue_ === null) {
            return;
        }

        const entityData = this.store_.getSelectedEntityData();
        const transform = entityData?.components.find(c => c.type === 'LocalTransform');
        if (!transform) return;

        const currentValue = transform.data[this.gizmoDragPropertyName_];
        if (!currentValue) return;

        const oldValue = this.gizmoDragOriginalValue_;
        const newValue = this.deepClone(currentValue);

        if (this.valuesEqual(oldValue, newValue)) {
            return;
        }

        this.store_.updateProperty(
            entity,
            'LocalTransform',
            this.gizmoDragPropertyName_,
            oldValue,
            newValue
        );

        this.gizmoDragOriginalValue_ = null;
        this.gizmoDragPropertyName_ = '';
    }

    private deepClone<T>(obj: T): T {
        if (obj === null || typeof obj !== 'object') return obj;
        return JSON.parse(JSON.stringify(obj));
    }

    private valuesEqual(a: unknown, b: unknown): boolean {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    private onMouseLeave(_e: MouseEvent): void {
        if (this.isDragging_ || this.isGizmoDragging_) {
            return;
        }
        this.hoveredAxis_ = 'none';
        this.requestRender();
    }

    private onCanvasClick(e: MouseEvent): void {
        if (this.skipNextClick_) {
            this.skipNextClick_ = false;
            return;
        }

        if (this.isDragging_ || this.isGizmoDragging_) return;

        const { worldX, worldY } = this.screenToWorld(e.clientX, e.clientY);

        if (this.gizmoMode_ !== 'select' && this.store_.selectedEntity !== null) {
            const axis = this.hitTestGizmo(worldX, worldY);
            if (axis !== 'none') return;
        }

        const entity = this.findEntityAtPosition(worldX, worldY);
        this.store_.selectEntity(entity);
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

    private getSelectedEntityPosition(): { x: number; y: number; z: number } | null {
        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return null;

        return this.store_.getWorldTransform(entityData.id).position;
    }

    private hitTestGizmo(worldX: number, worldY: number): DragAxis {
        const pos = this.getSelectedEntityPosition();
        if (!pos) return 'none';

        const gizmoScale = GIZMO_SIZE / this.zoom_;
        const handleSize = GIZMO_HANDLE_SIZE / this.zoom_;

        const dx = worldX - pos.x;
        const dy = worldY - pos.y;

        if (this.gizmoMode_ === 'move' || this.gizmoMode_ === 'scale') {
            if (Math.abs(dx) < handleSize * 2 && Math.abs(dy) < handleSize * 2) {
                return 'xy';
            }
            if (dx > 0 && dx < gizmoScale && Math.abs(dy) < handleSize) {
                return 'x';
            }
            if (dy > 0 && dy < gizmoScale && Math.abs(dx) < handleSize) {
                return 'y';
            }
        } else if (this.gizmoMode_ === 'rotate') {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (Math.abs(dist - gizmoScale * 0.8) < handleSize * 2) {
                return 'xy';
            }
        }

        return 'none';
    }

    private handleGizmoDrag(worldX: number, worldY: number): void {
        const entity = this.store_.selectedEntity;
        if (entity === null) return;

        const dx = worldX - this.gizmoDragStartX_;
        const dy = worldY - this.gizmoDragStartY_;

        if (this.gizmoMode_ === 'move') {
            let newX = this.gizmoDragStartValue_.x;
            let newY = this.gizmoDragStartValue_.y;

            if (this.dragAxis_ === 'x' || this.dragAxis_ === 'xy') {
                newX += dx;
            }
            if (this.dragAxis_ === 'y' || this.dragAxis_ === 'xy') {
                newY += dy;
            }

            const newPos = { x: newX, y: newY, z: this.gizmoDragStartValue_.z };
            this.store_.updatePropertyDirect(entity, 'LocalTransform', 'position', newPos);
        } else if (this.gizmoMode_ === 'scale') {
            const scaleFactor = 0.01;
            let newX = this.gizmoDragStartValue_.x;
            let newY = this.gizmoDragStartValue_.y;

            if (this.dragAxis_ === 'x' || this.dragAxis_ === 'xy') {
                newX += dx * scaleFactor;
            }
            if (this.dragAxis_ === 'y' || this.dragAxis_ === 'xy') {
                newY += dy * scaleFactor;
            }

            const newScale = { x: Math.max(0.01, newX), y: Math.max(0.01, newY), z: this.gizmoDragStartValue_.z };
            this.store_.updatePropertyDirect(entity, 'LocalTransform', 'scale', newScale);
        } else if (this.gizmoMode_ === 'rotate') {
            const pos = this.getSelectedEntityPosition();
            if (!pos) return;

            const startAngle = Math.atan2(
                this.gizmoDragStartY_ - pos.y,
                this.gizmoDragStartX_ - pos.x
            );
            const currentAngle = Math.atan2(worldY - pos.y, worldX - pos.x);
            const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);

            const newRotZ = this.gizmoDragStartValue_.z + deltaAngle;
            const euler = { x: 0, y: 0, z: newRotZ };
            const quat = eulerToQuat(euler);
            this.store_.updatePropertyDirect(entity, 'LocalTransform', 'rotation', quat);
        }

        this.requestRender();
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
            const transform = entity.components.find(c => c.type === 'LocalTransform');

            if (!transform) continue;

            const worldTransform = this.store_.getWorldTransform(entity.id);
            const pos = worldTransform.position;
            const scale = worldTransform.scale;

            const bounds = getEntityBounds(entity.components);
            const w = bounds.width * Math.abs(scale.x);
            const h = bounds.height * Math.abs(scale.y);

            const halfW = w / 2;
            const halfH = h / 2;

            if (
                worldX >= pos.x - halfW &&
                worldX <= pos.x + halfW &&
                worldY >= pos.y - halfH &&
                worldY <= pos.y + halfH
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
        });
    }

    private render(): void {
        if (this.useWebGL_ && this.sceneRenderer_ && this.webglCanvas_) {
            this.sceneRenderer_.camera.panX = this.panX_;
            this.sceneRenderer_.camera.panY = this.panY_;
            this.sceneRenderer_.camera.zoom = this.zoom_;

            this.sceneRenderer_.render(this.webglCanvas_.width, this.webglCanvas_.height);
            this.renderOverlay();
        } else if (this.bridge_) {
            this.bridge_.render(this.canvas_.width, this.canvas_.height);
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

        if (selectedEntity !== null) {
            if (this.gizmoSettings_.showSelectionBox) {
                this.drawSelectionBox(ctx);
            }

            this.drawCameraFrustum(ctx);

            if (this.gizmoMode_ !== 'select' && this.gizmoSettings_.showGizmos) {
                this.drawGizmo(ctx);
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

        const bounds = getEntityBounds(entityData.components);
        const w = bounds.width * Math.abs(scale.x);
        const h = bounds.height * Math.abs(scale.y);

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

        if (projectionType === 1) {  // 1 = Orthographic
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
            this.drawEntity(ctx, entity, entity.id === selectedEntity);
        }

        if (selectedEntity !== null) {
            this.drawCameraFrustum(ctx);

            if (this.gizmoMode_ !== 'select' && this.gizmoSettings_.showGizmos) {
                this.drawGizmo(ctx);
            }
        }

        ctx.restore();
    }

    private drawGizmo(ctx: CanvasRenderingContext2D): void {
        const pos = this.getSelectedEntityPosition();
        if (!pos) return;

        ctx.save();
        ctx.translate(pos.x, -pos.y);

        const size = GIZMO_SIZE / this.zoom_;
        const lineWidth = 2 / this.zoom_;
        const handleSize = GIZMO_HANDLE_SIZE / this.zoom_;
        const arrowSize = 8 / this.zoom_;

        if (this.gizmoMode_ === 'move') {
            ctx.fillStyle = this.hoveredAxis_ === 'xy' ? GIZMO_COLORS.hover : GIZMO_COLORS.xy;
            ctx.fillRect(-handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = this.hoveredAxis_ === 'x' ? GIZMO_COLORS.hover : GIZMO_COLORS.x;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(size, 0);
            ctx.stroke();

            ctx.fillStyle = this.hoveredAxis_ === 'x' ? GIZMO_COLORS.hover : GIZMO_COLORS.x;
            ctx.beginPath();
            ctx.moveTo(size, 0);
            ctx.lineTo(size - arrowSize, -arrowSize / 2);
            ctx.lineTo(size - arrowSize, arrowSize / 2);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = this.hoveredAxis_ === 'y' ? GIZMO_COLORS.hover : GIZMO_COLORS.y;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -size);
            ctx.stroke();

            ctx.fillStyle = this.hoveredAxis_ === 'y' ? GIZMO_COLORS.hover : GIZMO_COLORS.y;
            ctx.beginPath();
            ctx.moveTo(0, -size);
            ctx.lineTo(-arrowSize / 2, -size + arrowSize);
            ctx.lineTo(arrowSize / 2, -size + arrowSize);
            ctx.closePath();
            ctx.fill();
        } else if (this.gizmoMode_ === 'rotate') {
            const radius = size * 0.8;

            const entityData = this.store_.getSelectedEntityData();
            const transform = entityData?.components.find(c => c.type === 'LocalTransform');
            const quat = transform?.data.rotation as { x: number; y: number; z: number; w: number } ?? { x: 0, y: 0, z: 0, w: 1 };
            const euler = quatToEuler(quat);
            const angleRad = -euler.z * Math.PI / 180;

            ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(radius, 0);
            ctx.stroke();

            ctx.strokeStyle = this.hoveredAxis_ === 'xy' ? GIZMO_COLORS.hover : GIZMO_COLORS.xy;
            ctx.lineWidth = lineWidth * 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = '#00aaff';
            ctx.lineWidth = lineWidth * 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(angleRad) * radius, Math.sin(angleRad) * radius);
            ctx.stroke();

            ctx.fillStyle = '#00aaff';
            ctx.beginPath();
            ctx.arc(Math.cos(angleRad) * radius, Math.sin(angleRad) * radius, handleSize, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.gizmoMode_ === 'scale') {
            ctx.fillStyle = this.hoveredAxis_ === 'xy' ? GIZMO_COLORS.hover : GIZMO_COLORS.xy;
            ctx.fillRect(-handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = this.hoveredAxis_ === 'x' ? GIZMO_COLORS.hover : GIZMO_COLORS.x;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(size, 0);
            ctx.stroke();

            ctx.fillStyle = this.hoveredAxis_ === 'x' ? GIZMO_COLORS.hover : GIZMO_COLORS.x;
            ctx.fillRect(size - handleSize, -handleSize, handleSize * 2, handleSize * 2);

            ctx.strokeStyle = this.hoveredAxis_ === 'y' ? GIZMO_COLORS.hover : GIZMO_COLORS.y;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -size);
            ctx.stroke();

            ctx.fillStyle = this.hoveredAxis_ === 'y' ? GIZMO_COLORS.hover : GIZMO_COLORS.y;
            ctx.fillRect(-handleSize, -size - handleSize, handleSize * 2, handleSize * 2);
        }

        ctx.restore();
    }

    private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        if (!this.gizmoSettings_.showGrid) return;

        const gridSize = 50;
        const halfW = w / 2 / this.zoom_;
        const halfH = h / 2 / this.zoom_;

        const startX = Math.floor((-halfW - this.panX_) / gridSize) * gridSize;
        const endX = Math.ceil((halfW - this.panX_) / gridSize) * gridSize;
        const startY = Math.floor((-halfH - this.panY_) / gridSize) * gridSize;
        const endY = Math.ceil((halfH - this.panY_) / gridSize) * gridSize;

        ctx.globalAlpha = this.gizmoSettings_.gridOpacity;
        ctx.strokeStyle = this.gizmoSettings_.gridColor;
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

        ctx.strokeStyle = this.lightenColor(this.gizmoSettings_.gridColor, 30);
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
