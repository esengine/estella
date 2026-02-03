/**
 * @file    SceneViewPanel.ts
 * @brief   Scene viewport panel with canvas rendering
 */

import type { Entity } from 'esengine';
import type { EditorStore } from '../store/EditorStore';
import type { EditorBridge } from '../bridge/EditorBridge';

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

    private panX_ = 0;
    private panY_ = 0;
    private zoom_ = 1;
    private isDragging_ = false;
    private lastMouseX_ = 0;
    private lastMouseY_ = 0;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.container_.className = 'es-sceneview-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <span class="es-panel-title">Scene</span>
                <div class="es-sceneview-tools">
                    <button class="es-btn es-btn-icon" data-action="reset-view" title="Reset View">⟲</button>
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

        this.canvas_.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas_.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas_.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas_.addEventListener('mouseleave', this.onMouseUp.bind(this));
        this.canvas_.addEventListener('wheel', this.onWheel.bind(this));
        this.canvas_.addEventListener('click', this.onClick.bind(this));

        window.addEventListener('resize', () => this.resize());
    }

    private onMouseDown(e: MouseEvent): void {
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            this.isDragging_ = true;
            this.lastMouseX_ = e.clientX;
            this.lastMouseY_ = e.clientY;
            this.canvas_.style.cursor = 'grabbing';
        }
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.isDragging_) return;

        const dx = e.clientX - this.lastMouseX_;
        const dy = e.clientY - this.lastMouseY_;

        this.panX_ += dx / this.zoom_;
        this.panY_ += dy / this.zoom_;

        this.lastMouseX_ = e.clientX;
        this.lastMouseY_ = e.clientY;

        this.requestRender();
    }

    private onMouseUp(_e: MouseEvent): void {
        this.isDragging_ = false;
        this.canvas_.style.cursor = 'default';
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

    private onClick(e: MouseEvent): void {
        if (this.isDragging_) return;

        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const worldX = (x - rect.width / 2) / this.zoom_ - this.panX_;
        const worldY = -(y - rect.height / 2) / this.zoom_ - this.panY_;

        const entity = this.findEntityAtPosition(worldX, worldY);
        this.store_.selectEntity(entity);
    }

    private findEntityAtPosition(worldX: number, worldY: number): Entity | null {
        const scene = this.store_.scene;

        for (let i = scene.entities.length - 1; i >= 0; i--) {
            const entity = scene.entities[i];
            const transform = entity.components.find(c => c.type === 'LocalTransform');
            const sprite = entity.components.find(c => c.type === 'Sprite');

            if (!transform || !sprite) continue;

            const pos = transform.data.position as { x: number; y: number; z: number };
            const size = sprite.data.size as { x: number; y: number };

            const halfW = (size?.x ?? 100) / 2;
            const halfH = (size?.y ?? 100) / 2;

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

        if (sprite) {
            const size = sprite.data.size as { x: number; y: number };
            const col = sprite.data.color as { x: number; y: number; z: number; w: number };

            if (size) {
                w = size.x * scale.x;
                h = size.y * scale.y;
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

        ctx.fillStyle = color;
        ctx.fillRect(-w / 2, -h / 2, w, h);

        if (isSelected) {
            ctx.strokeStyle = '#00aaff';
            ctx.lineWidth = 2 / this.zoom_;
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
