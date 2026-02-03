/**
 * @file    SceneViewPanel.ts
 * @brief   Scene viewport panel with canvas rendering and gizmo tools
 */

import type { Entity } from 'esengine';
import type { EditorStore } from '../store/EditorStore';
import type { EditorBridge } from '../bridge/EditorBridge';
import { icons } from '../utils/icons';

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

const GIZMO_COLORS: GizmoColors = {
    x: '#e74c3c',
    y: '#2ecc71',
    xy: '#f1c40f',
    hover: '#ffffff',
};

const GIZMO_SIZE = 80;
const GIZMO_HANDLE_SIZE = 10;

// =============================================================================
// SceneViewPanel
// =============================================================================

export class SceneViewPanel {
    private container_: HTMLElement;
    private store_: EditorStore;
    private bridge_: EditorBridge | null = null;
    private canvas_: HTMLCanvasElement;
    private unsubscribe_: (() => void) | null = null;
    private animationId_: number | null = null;
    private resizeObserver_: ResizeObserver | null = null;

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
    private keydownHandler_: ((e: KeyboardEvent) => void) | null = null;
    private skipNextClick_ = false;
    private boundOnDocumentMouseMove_: ((e: MouseEvent) => void) | null = null;
    private boundOnDocumentMouseUp_: ((e: MouseEvent) => void) | null = null;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

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
                </div>
            </div>
            <div class="es-sceneview-viewport">
                <canvas class="es-sceneview-canvas"></canvas>
            </div>
        `;

        this.canvas_ = this.container_.querySelector('.es-sceneview-canvas')!;

        this.setupEvents();
        this.unsubscribe_ = store.subscribe(() => this.requestRender());
        this.resize();
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
        this.stopDocumentDrag();
    }

    setBridge(bridge: EditorBridge): void {
        this.bridge_ = bridge;
        this.requestRender();
    }

    get canvas(): HTMLCanvasElement {
        return this.canvas_;
    }

    resize(): void {
        const viewport = this.container_.querySelector('.es-sceneview-viewport') as HTMLElement;
        if (!viewport) return;

        const rect = viewport.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

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
                        this.gizmoDragStartValue_ = this.quatToEuler(quat ?? { x: 0, y: 0, z: 0, w: 1 });
                    } else {
                        const prop = this.gizmoMode_ === 'scale' ? 'scale' : 'position';
                        const value = transform.data[prop] as { x: number; y: number; z: number };
                        this.gizmoDragStartValue_ = { ...value };
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
            this.isGizmoDragging_ = false;
            this.dragAxis_ = 'none';
            this.skipNextClick_ = true;
        }
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

        const transform = entityData.components.find(c => c.type === 'LocalTransform');
        if (!transform) return null;

        return transform.data.position as { x: number; y: number; z: number } ?? { x: 0, y: 0, z: 0 };
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
            const quat = this.eulerToQuat(euler);
            this.store_.updatePropertyDirect(entity, 'LocalTransform', 'rotation', quat);
        }

        this.requestRender();
    }

    private quatToEuler(q: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number } {
        const { x, y, z, w } = q;

        const sinrCosp = 2 * (w * x + y * z);
        const cosrCosp = 1 - 2 * (x * x + y * y);
        const roll = Math.atan2(sinrCosp, cosrCosp);

        const sinp = 2 * (w * y - z * x);
        const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);

        const sinyCosp = 2 * (w * z + x * y);
        const cosyCosp = 1 - 2 * (y * y + z * z);
        const yaw = Math.atan2(sinyCosp, cosyCosp);

        const toDeg = 180 / Math.PI;
        return { x: roll * toDeg, y: pitch * toDeg, z: yaw * toDeg };
    }

    private eulerToQuat(euler: { x: number; y: number; z: number }): { x: number; y: number; z: number; w: number } {
        const toRad = Math.PI / 180;
        const roll = euler.x * toRad;
        const pitch = euler.y * toRad;
        const yaw = euler.z * toRad;

        const cr = Math.cos(roll * 0.5);
        const sr = Math.sin(roll * 0.5);
        const cp = Math.cos(pitch * 0.5);
        const sp = Math.sin(pitch * 0.5);
        const cy = Math.cos(yaw * 0.5);
        const sy = Math.sin(yaw * 0.5);

        return {
            w: cr * cp * cy + sr * sp * sy,
            x: sr * cp * cy - cr * sp * sy,
            y: cr * sp * cy + sr * cp * sy,
            z: cr * cp * sy - sr * sp * cy,
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
        const defaultSize = 50;

        for (let i = scene.entities.length - 1; i >= 0; i--) {
            const entity = scene.entities[i];
            const transform = entity.components.find(c => c.type === 'LocalTransform');

            if (!transform) continue;

            const pos = transform.data.position as { x: number; y: number; z: number };
            const scale = transform.data.scale as { x: number; y: number; z: number } ?? { x: 1, y: 1, z: 1 };
            const sprite = entity.components.find(c => c.type === 'Sprite');

            let w = defaultSize;
            let h = defaultSize;

            if (sprite) {
                const size = sprite.data.size as { x: number; y: number };
                w = (size?.x ?? defaultSize) * Math.abs(scale.x);
                h = (size?.y ?? defaultSize) * Math.abs(scale.y);
            }

            const halfW = w / 2;
            const halfH = h / 2;

            if (
                worldX >= (pos?.x ?? 0) - halfW &&
                worldX <= (pos?.x ?? 0) + halfW &&
                worldY >= (pos?.y ?? 0) - halfH &&
                worldY <= (pos?.y ?? 0) + halfH
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
        if (this.bridge_) {
            this.bridge_.render(this.canvas_.width, this.canvas_.height);
        } else {
            this.renderPreview();
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
            this.drawEntity(ctx, entity, entity.id === selectedEntity);
        }

        if (selectedEntity !== null && this.gizmoMode_ !== 'select') {
            this.drawGizmo(ctx);
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
            const euler = this.quatToEuler(quat);
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
        const gridSize = 50;
        const halfW = w / 2 / this.zoom_;
        const halfH = h / 2 / this.zoom_;

        const startX = Math.floor((-halfW - this.panX_) / gridSize) * gridSize;
        const endX = Math.ceil((halfW - this.panX_) / gridSize) * gridSize;
        const startY = Math.floor((-halfH - this.panY_) / gridSize) * gridSize;
        const endY = Math.ceil((halfH - this.panY_) / gridSize) * gridSize;

        ctx.strokeStyle = '#333';
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

        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2 / this.zoom_;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(endX, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, startY);
        ctx.lineTo(0, endY);
        ctx.stroke();
    }

    private drawEntity(
        ctx: CanvasRenderingContext2D,
        entity: import('../types/SceneTypes').EntityData,
        isSelected: boolean
    ): void {
        const transform = entity.components.find(c => c.type === 'LocalTransform');
        const sprite = entity.components.find(c => c.type === 'Sprite');

        if (!transform) return;

        const pos = transform.data.position as { x: number; y: number; z: number } ?? { x: 0, y: 0, z: 0 };
        const scale = transform.data.scale as { x: number; y: number; z: number } ?? { x: 1, y: 1, z: 1 };

        let w = 50;
        let h = 50;
        let color = 'rgba(100, 100, 200, 0.5)';
        const hasSprite = !!sprite;

        if (sprite) {
            const size = sprite.data.size as { x: number; y: number };
            const col = sprite.data.color as { x: number; y: number; z: number; w: number };

            if (size) {
                w = size.x * Math.abs(scale.x);
                h = size.y * Math.abs(scale.y);
            }
            if (col) {
                const r = Math.round(col.x * 255);
                const g = Math.round(col.y * 255);
                const b = Math.round(col.z * 255);
                const a = col.w;
                color = `rgba(${r}, ${g}, ${b}, ${a})`;
            }
        }

        ctx.save();
        ctx.translate(pos.x, -pos.y);

        if (hasSprite) {
            ctx.fillStyle = color;
            ctx.fillRect(-w / 2, -h / 2, w, h);
        }

        if (isSelected && hasSprite) {
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
        }

        ctx.restore();
    }
}
