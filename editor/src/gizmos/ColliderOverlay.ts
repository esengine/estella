/**
 * @file    ColliderOverlay.ts
 * @brief   Always-on overlay for collider shape visualization and handle editing
 */

import type { Entity } from 'esengine';
import { DEFAULT_PIXELS_PER_UNIT } from 'esengine';
import type { EditorStore } from '../store/EditorStore';
import type { EntityData, ComponentData } from '../types/SceneTypes';
import { quatToEuler } from '../math/Transform';

const COLLIDER_COLOR = 'rgba(0, 255, 100, 0.3)';
const COLLIDER_COLOR_SELECTED = 'rgba(0, 255, 100, 0.8)';
const HANDLE_SIZE_PX = 8;
const HANDLE_FILL = 'rgba(0, 255, 100, 0.9)';
const CAPSULE_SEGMENTS = 16;

type HandleId = 'left' | 'right' | 'top' | 'bottom' | 'radius' | 'halfHeight';

interface DragState {
    entity: Entity;
    componentType: string;
    handleId: HandleId;
    startWorldX: number;
    startWorldY: number;
    originalValue: Record<string, unknown>;
}

export interface OverlayContext {
    ctx: CanvasRenderingContext2D;
    zoom: number;
    store: EditorStore;
}

export class ColliderOverlay {
    private dragState_: DragState | null = null;
    private hoveredHandle_: HandleId | null = null;

    drawAll(octx: OverlayContext): void {
        const { ctx, store } = octx;
        const selectedIds = store.selectedEntities;

        for (const entity of store.scene.entities) {
            if (!store.isEntityVisible(entity.id)) continue;
            const isSelected = selectedIds.has(entity.id);
            this.drawEntityColliders(octx, entity, isSelected);
        }
    }

    hitTest(worldX: number, worldY: number, octx: OverlayContext): boolean {
        const { store } = octx;
        if (store.selectedEntities.size === 0) return false;

        const entityData = store.getSelectedEntityData();
        if (!entityData) return false;

        const handle = this.findHandle(worldX, worldY, octx, entityData);
        this.hoveredHandle_ = handle?.handleId ?? null;
        return handle !== null;
    }

    onDragStart(worldX: number, worldY: number, octx: OverlayContext): boolean {
        const { store } = octx;
        const entityData = store.getSelectedEntityData();
        if (!entityData) return false;

        const handle = this.findHandle(worldX, worldY, octx, entityData);
        if (!handle) return false;

        const comp = entityData.components.find(c => c.type === handle.componentType);
        if (!comp) return false;

        this.dragState_ = {
            entity: entityData.id as Entity,
            componentType: handle.componentType,
            handleId: handle.handleId,
            startWorldX: worldX,
            startWorldY: worldY,
            originalValue: this.cloneColliderData(comp),
        };
        return true;
    }

    onDrag(worldX: number, worldY: number, octx: OverlayContext): void {
        if (!this.dragState_) return;

        const { store } = octx;
        const ppu = this.getPixelsPerUnit(store);
        const { entity, componentType, handleId, startWorldX, startWorldY } = this.dragState_;
        const comp = store.getComponent(entity, componentType);
        if (!comp) return;

        const worldTransform = store.getWorldTransform(entity as number);
        const scale = worldTransform.scale;
        const euler = quatToEuler(worldTransform.rotation);
        const rad = -euler.z * Math.PI / 180;

        const dx = worldX - startWorldX;
        const dy = worldY - startWorldY;
        const localDx = dx * Math.cos(rad) + dy * Math.sin(rad);
        const localDy = -dx * Math.sin(rad) + dy * Math.cos(rad);

        if (componentType === 'BoxCollider') {
            const he = comp.data.halfExtents as { x: number; y: number };
            const origHe = this.dragState_.originalValue.halfExtents as { x: number; y: number };
            let newHe = { ...he };

            if (handleId === 'right') {
                newHe = { x: Math.max(0.01, origHe.x + localDx / (Math.abs(scale.x) * ppu)), y: he.y };
            } else if (handleId === 'left') {
                newHe = { x: Math.max(0.01, origHe.x - localDx / (Math.abs(scale.x) * ppu)), y: he.y };
            } else if (handleId === 'top') {
                newHe = { x: he.x, y: Math.max(0.01, origHe.y + localDy / (Math.abs(scale.y) * ppu)) };
            } else if (handleId === 'bottom') {
                newHe = { x: he.x, y: Math.max(0.01, origHe.y - localDy / (Math.abs(scale.y) * ppu)) };
            }

            store.updatePropertyDirect(entity, componentType, 'halfExtents', newHe);
        } else if (componentType === 'CircleCollider') {
            const origRadius = this.dragState_.originalValue.radius as number;
            const dist = Math.sqrt(localDx * localDx + localDy * localDy);
            const sign = localDx >= 0 ? 1 : -1;
            const maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y));
            store.updatePropertyDirect(entity, componentType, 'radius',
                Math.max(0.01, origRadius + sign * dist / (maxScale * ppu)));
        } else if (componentType === 'CapsuleCollider') {
            if (handleId === 'radius') {
                const origRadius = this.dragState_.originalValue.radius as number;
                store.updatePropertyDirect(entity, componentType, 'radius',
                    Math.max(0.01, origRadius + localDx / (Math.abs(scale.x) * ppu)));
            } else if (handleId === 'halfHeight') {
                const origHH = this.dragState_.originalValue.halfHeight as number;
                store.updatePropertyDirect(entity, componentType, 'halfHeight',
                    Math.max(0.01, origHH + localDy / (Math.abs(scale.y) * ppu)));
            }
        }
    }

    onDragEnd(octx: OverlayContext): void {
        if (!this.dragState_) return;

        const { entity, componentType, originalValue } = this.dragState_;
        const { store } = octx;
        const comp = store.getComponent(entity, componentType);

        if (comp) {
            for (const key of Object.keys(originalValue)) {
                const oldVal = originalValue[key];
                const newVal = comp.data[key];
                if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                    store.updateProperty(entity, componentType, key, oldVal, newVal);
                }
            }
        }

        this.dragState_ = null;
    }

    isDragging(): boolean {
        return this.dragState_ !== null;
    }

    getCursor(): string {
        if (this.dragState_) return 'grabbing';
        if (this.hoveredHandle_) return 'grab';
        return '';
    }

    private drawEntityColliders(octx: OverlayContext, entity: EntityData, isSelected: boolean): void {
        const { ctx, zoom, store } = octx;
        const ppu = this.getPixelsPerUnit(store);
        const worldTransform = store.getWorldTransform(entity.id);
        const pos = worldTransform.position;
        const scale = worldTransform.scale;
        const euler = quatToEuler(worldTransform.rotation);
        const rad = -euler.z * Math.PI / 180;
        const color = isSelected ? COLLIDER_COLOR_SELECTED : COLLIDER_COLOR;
        const lineWidth = (isSelected ? 2 : 1) / zoom;

        for (const comp of entity.components) {
            if (comp.type === 'BoxCollider') {
                this.drawBox(ctx, pos, scale, rad, comp, color, lineWidth, zoom, isSelected, ppu);
            } else if (comp.type === 'CircleCollider') {
                this.drawCircle(ctx, pos, scale, rad, comp, color, lineWidth, zoom, isSelected, ppu);
            } else if (comp.type === 'CapsuleCollider') {
                this.drawCapsule(ctx, pos, scale, rad, comp, color, lineWidth, zoom, isSelected, ppu);
            }
        }
    }

    private drawBox(
        ctx: CanvasRenderingContext2D,
        pos: { x: number; y: number; z: number },
        scale: { x: number; y: number; z: number },
        rad: number,
        comp: ComponentData,
        color: string,
        lineWidth: number,
        zoom: number,
        isSelected: boolean,
        ppu: number
    ): void {
        const he = comp.data.halfExtents as { x: number; y: number } | undefined;
        const offset = comp.data.offset as { x: number; y: number } | undefined;
        if (!he) return;

        const hx = he.x * ppu * Math.abs(scale.x);
        const hy = he.y * ppu * Math.abs(scale.y);
        const ox = (offset?.x ?? 0) * ppu * scale.x;
        const oy = (offset?.y ?? 0) * ppu * scale.y;

        ctx.save();
        ctx.translate(pos.x, -pos.y);
        ctx.rotate(rad);
        ctx.translate(ox, -oy);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([]);
        ctx.strokeRect(-hx, -hy, hx * 2, hy * 2);

        if (isSelected) {
            this.drawHandle(ctx, hx, 0, zoom);
            this.drawHandle(ctx, -hx, 0, zoom);
            this.drawHandle(ctx, 0, -hy, zoom);
            this.drawHandle(ctx, 0, hy, zoom);
        }

        ctx.restore();
    }

    private drawCircle(
        ctx: CanvasRenderingContext2D,
        pos: { x: number; y: number; z: number },
        scale: { x: number; y: number; z: number },
        rad: number,
        comp: ComponentData,
        color: string,
        lineWidth: number,
        zoom: number,
        isSelected: boolean,
        ppu: number
    ): void {
        const radius = comp.data.radius as number | undefined;
        const offset = comp.data.offset as { x: number; y: number } | undefined;
        if (radius === undefined) return;

        const maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y));
        const r = radius * ppu * maxScale;
        const ox = (offset?.x ?? 0) * ppu * scale.x;
        const oy = (offset?.y ?? 0) * ppu * scale.y;

        ctx.save();
        ctx.translate(pos.x, -pos.y);
        ctx.rotate(rad);
        ctx.translate(ox, -oy);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        if (isSelected) {
            this.drawHandle(ctx, r, 0, zoom);
        }

        ctx.restore();
    }

    private drawCapsule(
        ctx: CanvasRenderingContext2D,
        pos: { x: number; y: number; z: number },
        scale: { x: number; y: number; z: number },
        rad: number,
        comp: ComponentData,
        color: string,
        lineWidth: number,
        zoom: number,
        isSelected: boolean,
        ppu: number
    ): void {
        const radius = comp.data.radius as number | undefined;
        const halfHeight = comp.data.halfHeight as number | undefined;
        const offset = comp.data.offset as { x: number; y: number } | undefined;
        if (radius === undefined || halfHeight === undefined) return;

        const r = radius * ppu * Math.abs(scale.x);
        const hh = halfHeight * ppu * Math.abs(scale.y);
        const ox = (offset?.x ?? 0) * ppu * scale.x;
        const oy = (offset?.y ?? 0) * ppu * scale.y;

        ctx.save();
        ctx.translate(pos.x, -pos.y);
        ctx.rotate(rad);
        ctx.translate(ox, -oy);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([]);
        ctx.beginPath();

        ctx.moveTo(r, -hh);
        ctx.lineTo(r, hh);
        for (let i = 0; i <= CAPSULE_SEGMENTS; i++) {
            const angle = Math.PI * i / CAPSULE_SEGMENTS;
            ctx.lineTo(Math.cos(angle) * r, hh + Math.sin(angle) * r);
        }
        ctx.lineTo(-r, -hh);
        for (let i = 0; i <= CAPSULE_SEGMENTS; i++) {
            const angle = Math.PI + Math.PI * i / CAPSULE_SEGMENTS;
            ctx.lineTo(Math.cos(angle) * r, -hh + Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.stroke();

        if (isSelected) {
            this.drawHandle(ctx, r, 0, zoom);
            this.drawHandle(ctx, 0, -(hh + r), zoom);
        }

        ctx.restore();
    }

    private drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, zoom: number): void {
        const size = HANDLE_SIZE_PX / zoom;
        ctx.fillStyle = HANDLE_FILL;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }

    private findHandle(
        worldX: number,
        worldY: number,
        octx: OverlayContext,
        entityData: EntityData
    ): { componentType: string; handleId: HandleId } | null {
        const { zoom, store } = octx;
        const ppu = this.getPixelsPerUnit(store);
        const worldTransform = store.getWorldTransform(entityData.id);
        const pos = worldTransform.position;
        const scale = worldTransform.scale;
        const euler = quatToEuler(worldTransform.rotation);
        const rad = euler.z * Math.PI / 180;

        const dx = worldX - pos.x;
        const dy = worldY - pos.y;
        const localX = dx * Math.cos(rad) + dy * Math.sin(rad);
        const localY = -dx * Math.sin(rad) + dy * Math.cos(rad);

        const hitRadius = HANDLE_SIZE_PX / zoom;

        for (const comp of entityData.components) {
            if (comp.type === 'BoxCollider') {
                const he = comp.data.halfExtents as { x: number; y: number } | undefined;
                const offset = comp.data.offset as { x: number; y: number } | undefined;
                if (!he) continue;

                const ox = (offset?.x ?? 0) * ppu * scale.x;
                const oy = (offset?.y ?? 0) * ppu * scale.y;
                const lx = localX - ox;
                const ly = localY - oy;
                const hx = he.x * ppu * Math.abs(scale.x);
                const hy = he.y * ppu * Math.abs(scale.y);

                if (Math.abs(lx - hx) < hitRadius && Math.abs(ly) < hitRadius) {
                    return { componentType: 'BoxCollider', handleId: 'right' };
                }
                if (Math.abs(lx + hx) < hitRadius && Math.abs(ly) < hitRadius) {
                    return { componentType: 'BoxCollider', handleId: 'left' };
                }
                if (Math.abs(ly - hy) < hitRadius && Math.abs(lx) < hitRadius) {
                    return { componentType: 'BoxCollider', handleId: 'top' };
                }
                if (Math.abs(ly + hy) < hitRadius && Math.abs(lx) < hitRadius) {
                    return { componentType: 'BoxCollider', handleId: 'bottom' };
                }
            } else if (comp.type === 'CircleCollider') {
                const radius = comp.data.radius as number | undefined;
                const offset = comp.data.offset as { x: number; y: number } | undefined;
                if (radius === undefined) continue;

                const ox = (offset?.x ?? 0) * ppu * scale.x;
                const oy = (offset?.y ?? 0) * ppu * scale.y;
                const lx = localX - ox;
                const ly = localY - oy;
                const maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y));
                const r = radius * ppu * maxScale;

                if (Math.abs(lx - r) < hitRadius && Math.abs(ly) < hitRadius) {
                    return { componentType: 'CircleCollider', handleId: 'radius' };
                }
            } else if (comp.type === 'CapsuleCollider') {
                const radius = comp.data.radius as number | undefined;
                const halfHeight = comp.data.halfHeight as number | undefined;
                const offset = comp.data.offset as { x: number; y: number } | undefined;
                if (radius === undefined || halfHeight === undefined) continue;

                const ox = (offset?.x ?? 0) * ppu * scale.x;
                const oy = (offset?.y ?? 0) * ppu * scale.y;
                const lx = localX - ox;
                const ly = localY - oy;
                const r = radius * ppu * Math.abs(scale.x);
                const hh = halfHeight * ppu * Math.abs(scale.y);

                if (Math.abs(lx - r) < hitRadius && Math.abs(ly) < hitRadius) {
                    return { componentType: 'CapsuleCollider', handleId: 'radius' };
                }
                if (Math.abs(ly - (hh + r)) < hitRadius && Math.abs(lx) < hitRadius) {
                    return { componentType: 'CapsuleCollider', handleId: 'halfHeight' };
                }
            }
        }

        return null;
    }

    private getPixelsPerUnit(store: EditorStore): number {
        for (const entity of store.scene.entities) {
            for (const comp of entity.components) {
                if (comp.type === 'Canvas') {
                    return (comp.data.pixelsPerUnit as number) || DEFAULT_PIXELS_PER_UNIT;
                }
            }
        }
        return DEFAULT_PIXELS_PER_UNIT;
    }

    private cloneColliderData(comp: ComponentData): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(comp.data)) {
            if (typeof value === 'object' && value !== null) {
                result[key] = { ...value as Record<string, unknown> };
            } else {
                result[key] = value;
            }
        }
        return result;
    }
}
