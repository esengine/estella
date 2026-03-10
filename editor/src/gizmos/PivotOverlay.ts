import type { Entity } from 'esengine';
import type { EditorStore } from '../store/EditorStore';
import type { EntityData } from '../types/SceneTypes';
import { quatToEuler } from '../math/Transform';

const PIVOT_COLOR = 'rgba(255, 165, 0, 0.9)';
const PIVOT_COLOR_HOVER = 'rgba(255, 200, 50, 1.0)';
const HANDLE_RADIUS_PX = 5;
const CROSSHAIR_SIZE_PX = 10;
const HIT_RADIUS_PX = 8;

export interface PivotOverlayContext {
    ctx: CanvasRenderingContext2D;
    zoom: number;
    store: EditorStore;
}

interface DragState {
    entity: Entity;
    startWorldX: number;
    startWorldY: number;
    originalPivot: { x: number; y: number };
}

export class PivotOverlay {
    private dragState_: DragState | null = null;
    private hovered_ = false;

    drawAll(octx: PivotOverlayContext): void {
        const { store } = octx;
        if (store.selectedEntities.size === 0) return;

        for (const entityId of store.selectedEntities) {
            const entityData = store.getEntityData(entityId);
            if (!entityData) continue;
            if (!store.isEntityVisible(entityId)) continue;

            const spriteComp = entityData.components.find(c => c.type === 'Sprite');
            if (!spriteComp) continue;

            this.drawPivotHandle(octx, entityData, spriteComp.data);
        }
    }

    hitTest(worldX: number, worldY: number, octx: PivotOverlayContext): boolean {
        const { store } = octx;
        if (store.selectedEntities.size === 0) return false;

        for (const entityId of store.selectedEntities) {
            const entityData = store.getEntityData(entityId);
            if (!entityData) continue;

            const spriteComp = entityData.components.find(c => c.type === 'Sprite');
            if (!spriteComp) continue;

            if (this.isNearPivot(worldX, worldY, octx, entityData, spriteComp.data)) {
                this.hovered_ = true;
                return true;
            }
        }

        this.hovered_ = false;
        return false;
    }

    onDragStart(worldX: number, worldY: number, octx: PivotOverlayContext): boolean {
        const { store } = octx;

        for (const entityId of store.selectedEntities) {
            const entityData = store.getEntityData(entityId);
            if (!entityData) continue;

            const spriteComp = entityData.components.find(c => c.type === 'Sprite');
            if (!spriteComp) continue;

            if (this.isNearPivot(worldX, worldY, octx, entityData, spriteComp.data)) {
                const pivot = spriteComp.data.pivot as { x: number; y: number } | undefined;
                this.dragState_ = {
                    entity: entityId as Entity,
                    startWorldX: worldX,
                    startWorldY: worldY,
                    originalPivot: { x: pivot?.x ?? 0.5, y: pivot?.y ?? 0.5 },
                };
                return true;
            }
        }

        return false;
    }

    onDrag(worldX: number, worldY: number, octx: PivotOverlayContext): void {
        if (!this.dragState_) return;

        const { store } = octx;
        const { entity, startWorldX, startWorldY, originalPivot } = this.dragState_;

        const worldTransform = store.getWorldTransform(entity as number);
        const scale = worldTransform.scale;
        const euler = quatToEuler(worldTransform.rotation);
        const rad = euler.z * Math.PI / 180;

        const dx = worldX - startWorldX;
        const dy = worldY - startWorldY;
        const localDx = dx * Math.cos(rad) + dy * Math.sin(rad);
        const localDy = -dx * Math.sin(rad) + dy * Math.cos(rad);

        const comp = store.getComponent(entity, 'Sprite');
        if (!comp) return;

        const size = comp.data.size as { x: number; y: number };
        const sizeWorldX = size.x * Math.abs(scale.x);
        const sizeWorldY = size.y * Math.abs(scale.y);

        if (sizeWorldX === 0 || sizeWorldY === 0) return;

        const newPivot = {
            x: Math.max(0, Math.min(1, originalPivot.x - localDx / sizeWorldX)),
            y: Math.max(0, Math.min(1, originalPivot.y - localDy / sizeWorldY)),
        };

        store.updatePropertyDirect(entity, 'Sprite', 'pivot', newPivot);
    }

    onDragEnd(octx: PivotOverlayContext): void {
        if (!this.dragState_) return;

        const { entity, originalPivot } = this.dragState_;
        const { store } = octx;
        const comp = store.getComponent(entity, 'Sprite');

        if (comp) {
            const newPivot = comp.data.pivot as { x: number; y: number };
            if (originalPivot.x !== newPivot.x || originalPivot.y !== newPivot.y) {
                store.updateProperty(entity, 'Sprite', 'pivot', originalPivot, newPivot);
            }
        }

        this.dragState_ = null;
    }

    isDragging(): boolean {
        return this.dragState_ !== null;
    }

    getCursor(): string {
        if (this.dragState_) return 'grabbing';
        if (this.hovered_) return 'grab';
        return '';
    }

    private drawPivotHandle(
        octx: PivotOverlayContext,
        entityData: EntityData,
        spriteData: Record<string, unknown>
    ): void {
        const { ctx, zoom, store } = octx;
        const worldTransform = store.getWorldTransform(entityData.id);
        const pos = worldTransform.position;
        const scale = worldTransform.scale;
        const euler = quatToEuler(worldTransform.rotation);
        const rad = -euler.z * Math.PI / 180;

        const size = spriteData.size as { x: number; y: number };
        const pivot = spriteData.pivot as { x: number; y: number } | undefined;
        const px = pivot?.x ?? 0.5;
        const py = pivot?.y ?? 0.5;

        const offsetX = (0.5 - px) * size.x * scale.x;
        const offsetY = (0.5 - py) * size.y * scale.y;

        ctx.save();
        ctx.translate(pos.x, -pos.y);
        ctx.rotate(rad);
        ctx.translate(offsetX, -offsetY);

        const color = this.hovered_ || this.dragState_ ? PIVOT_COLOR_HOVER : PIVOT_COLOR;
        const r = HANDLE_RADIUS_PX / zoom;
        const cross = CROSSHAIR_SIZE_PX / zoom;

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5 / zoom;

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-cross, 0);
        ctx.lineTo(cross, 0);
        ctx.moveTo(0, -cross);
        ctx.lineTo(0, cross);
        ctx.stroke();

        ctx.restore();
    }

    private isNearPivot(
        worldX: number,
        worldY: number,
        octx: PivotOverlayContext,
        entityData: EntityData,
        spriteData: Record<string, unknown>
    ): boolean {
        const { zoom, store } = octx;
        const worldTransform = store.getWorldTransform(entityData.id);
        const pos = worldTransform.position;
        const scale = worldTransform.scale;
        const euler = quatToEuler(worldTransform.rotation);
        const rad = euler.z * Math.PI / 180;

        const size = spriteData.size as { x: number; y: number };
        const pivot = spriteData.pivot as { x: number; y: number } | undefined;
        const px = pivot?.x ?? 0.5;
        const py = pivot?.y ?? 0.5;

        const offsetX = (0.5 - px) * size.x * scale.x;
        const offsetY = (0.5 - py) * size.y * scale.y;

        const pivotWorldX = pos.x + offsetX * Math.cos(rad) - offsetY * Math.sin(rad);
        const pivotWorldY = pos.y + offsetX * Math.sin(rad) + offsetY * Math.cos(rad);

        const dx = worldX - pivotWorldX;
        const dy = worldY - pivotWorldY;
        const hitRadius = HIT_RADIUS_PX / zoom;

        return dx * dx + dy * dy <= hitRadius * hitRadius;
    }
}
