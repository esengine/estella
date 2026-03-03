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
const CHAIN_DASH = [6, 4];
const MIN_POLYGON_VERTICES = 3;
const MIN_CHAIN_POINTS = 4;

type HandleId = string;

function parseVertexIndex(id: string): number | null {
    const match = id.match(/^vertex-(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
}

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
        } else if (componentType === 'SegmentCollider') {
            const propName = handleId as 'point1' | 'point2';
            const orig = this.dragState_.originalValue[propName] as { x: number; y: number };
            store.updatePropertyDirect(entity, componentType, propName, {
                x: orig.x + localDx / (Math.abs(scale.x) * ppu),
                y: orig.y + localDy / (Math.abs(scale.y) * ppu),
            });
        } else if (componentType === 'PolygonCollider' || componentType === 'ChainCollider') {
            const vertexIndex = parseVertexIndex(handleId);
            if (vertexIndex === null) return;

            const arrayKey = componentType === 'PolygonCollider' ? 'vertices' : 'points';
            const origArray = this.dragState_.originalValue[arrayKey] as { x: number; y: number }[];
            if (!origArray || vertexIndex >= origArray.length) return;

            const origVert = origArray[vertexIndex];
            const currentArray = (comp.data[arrayKey] as { x: number; y: number }[]).map(v => ({ ...v }));
            currentArray[vertexIndex] = {
                x: origVert.x + localDx / (Math.abs(scale.x) * ppu),
                y: origVert.y + localDy / (Math.abs(scale.y) * ppu),
            };
            store.updatePropertyDirect(entity, componentType, arrayKey, currentArray);
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

    onDoubleClick(worldX: number, worldY: number, octx: OverlayContext): boolean {
        const { store } = octx;
        const entityData = store.getSelectedEntityData();
        if (!entityData) return false;

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

        for (const comp of entityData.components) {
            const isPolygon = comp.type === 'PolygonCollider';
            const isChain = comp.type === 'ChainCollider';
            if (!isPolygon && !isChain) continue;

            const arrayKey = isPolygon ? 'vertices' : 'points';
            const verts = comp.data[arrayKey] as { x: number; y: number }[] | undefined;
            if (!verts || verts.length < 2) continue;

            if (isPolygon && (comp.data as any).vertices?.length >= 8) continue;

            const result = this.findNearestEdge(localX, localY, verts, scale, ppu, isPolygon || !!(comp.data.isLoop));
            if (!result) continue;

            const hitThreshold = HANDLE_SIZE_PX / octx.zoom * 2;
            if (result.distance > hitThreshold) continue;

            const newVerts = verts.map(v => ({ ...v }));
            newVerts.splice(result.insertIndex, 0, {
                x: result.pointX / (scale.x * ppu),
                y: result.pointY / (scale.y * ppu),
            });
            store.updateProperty(
                entityData.id as Entity,
                comp.type,
                arrayKey,
                verts.map(v => ({ ...v })),
                newVerts
            );
            return true;
        }
        return false;
    }

    getContextMenuItems(worldX: number, worldY: number, octx: OverlayContext): { label: string; action: () => void }[] {
        const { store } = octx;
        const entityData = store.getSelectedEntityData();
        if (!entityData) return [];

        const handle = this.findHandle(worldX, worldY, octx, entityData);
        if (!handle) return [];

        const vertexIndex = parseVertexIndex(handle.handleId);
        if (vertexIndex === null) return [];

        const comp = entityData.components.find(c => c.type === handle.componentType);
        if (!comp) return [];

        const isPolygon = handle.componentType === 'PolygonCollider';
        const isChain = handle.componentType === 'ChainCollider';
        if (!isPolygon && !isChain) return [];

        const arrayKey = isPolygon ? 'vertices' : 'points';
        const verts = comp.data[arrayKey] as { x: number; y: number }[];
        if (!verts) return [];

        const minCount = isPolygon ? MIN_POLYGON_VERTICES : MIN_CHAIN_POINTS;
        if (verts.length <= minCount) return [];

        return [{
            label: 'Remove Vertex',
            action: () => {
                const newVerts = verts.filter((_, i) => i !== vertexIndex).map(v => ({ ...v }));
                store.updateProperty(
                    entityData.id as Entity,
                    handle.componentType,
                    arrayKey,
                    verts.map(v => ({ ...v })),
                    newVerts
                );
            },
        }];
    }

    private findNearestEdge(
        localX: number,
        localY: number,
        verts: { x: number; y: number }[],
        scale: { x: number; y: number; z: number },
        ppu: number,
        closed: boolean
    ): { distance: number; insertIndex: number; pointX: number; pointY: number } | null {
        let bestDist = Infinity;
        let bestIdx = -1;
        let bestPx = 0;
        let bestPy = 0;

        const count = closed ? verts.length : verts.length - 1;
        for (let i = 0; i < count; i++) {
            const j = (i + 1) % verts.length;
            const ax = verts[i].x * scale.x * ppu;
            const ay = verts[i].y * scale.y * ppu;
            const bx = verts[j].x * scale.x * ppu;
            const by = verts[j].y * scale.y * ppu;

            const abx = bx - ax;
            const aby = by - ay;
            const len2 = abx * abx + aby * aby;
            if (len2 === 0) continue;

            let t = ((localX - ax) * abx + (localY - ay) * aby) / len2;
            t = Math.max(0, Math.min(1, t));
            const px = ax + t * abx;
            const py = ay + t * aby;
            const dist = Math.sqrt((localX - px) * (localX - px) + (localY - py) * (localY - py));

            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = j;
                bestPx = px;
                bestPy = py;
            }
        }

        if (bestIdx < 0) return null;
        return { distance: bestDist, insertIndex: bestIdx, pointX: bestPx, pointY: bestPy };
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
            } else if (comp.type === 'SegmentCollider') {
                this.drawSegment(ctx, pos, scale, rad, comp, color, lineWidth, zoom, isSelected, ppu);
            } else if (comp.type === 'PolygonCollider') {
                this.drawPolygon(ctx, pos, scale, rad, comp, color, lineWidth, zoom, isSelected, ppu);
            } else if (comp.type === 'ChainCollider') {
                this.drawChain(ctx, pos, scale, rad, comp, color, lineWidth, zoom, isSelected, ppu);
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

    private drawSegment(
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
        const p1 = comp.data.point1 as { x: number; y: number } | undefined;
        const p2 = comp.data.point2 as { x: number; y: number } | undefined;
        if (!p1 || !p2) return;

        const x1 = p1.x * ppu * scale.x;
        const y1 = p1.y * ppu * scale.y;
        const x2 = p2.x * ppu * scale.x;
        const y2 = p2.y * ppu * scale.y;

        ctx.save();
        ctx.translate(pos.x, -pos.y);
        ctx.rotate(rad);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, -y1);
        ctx.lineTo(x2, -y2);
        ctx.stroke();

        if (isSelected) {
            this.drawHandle(ctx, x1, -y1, zoom);
            this.drawHandle(ctx, x2, -y2, zoom);
        }

        ctx.restore();
    }

    private drawPolygon(
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
        const vertices = comp.data.vertices as { x: number; y: number }[] | undefined;
        if (!vertices || vertices.length < 2) return;

        ctx.save();
        ctx.translate(pos.x, -pos.y);
        ctx.rotate(rad);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([]);
        ctx.beginPath();

        for (let i = 0; i < vertices.length; i++) {
            const vx = vertices[i].x * ppu * scale.x;
            const vy = -vertices[i].y * ppu * scale.y;
            if (i === 0) ctx.moveTo(vx, vy);
            else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.stroke();

        if (isSelected) {
            for (const v of vertices) {
                this.drawHandle(ctx, v.x * ppu * scale.x, -v.y * ppu * scale.y, zoom);
            }
        }

        ctx.restore();
    }

    private drawChain(
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
        const points = comp.data.points as { x: number; y: number }[] | undefined;
        if (!points || points.length < 2) return;

        const isLoop = comp.data.isLoop as boolean | undefined;

        ctx.save();
        ctx.translate(pos.x, -pos.y);
        ctx.rotate(rad);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(CHAIN_DASH.map(d => d / zoom));
        ctx.beginPath();

        for (let i = 0; i < points.length; i++) {
            const px = points[i].x * ppu * scale.x;
            const py = -points[i].y * ppu * scale.y;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        if (isLoop) ctx.closePath();
        ctx.stroke();

        if (isSelected) {
            for (const p of points) {
                this.drawHandle(ctx, p.x * ppu * scale.x, -p.y * ppu * scale.y, zoom);
            }
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
            } else if (comp.type === 'SegmentCollider') {
                const p1 = comp.data.point1 as { x: number; y: number } | undefined;
                const p2 = comp.data.point2 as { x: number; y: number } | undefined;
                if (!p1 || !p2) continue;

                const p1x = p1.x * ppu * scale.x;
                const p1y = p1.y * ppu * scale.y;
                const p2x = p2.x * ppu * scale.x;
                const p2y = p2.y * ppu * scale.y;

                if (Math.abs(localX - p1x) < hitRadius && Math.abs(localY - p1y) < hitRadius) {
                    return { componentType: 'SegmentCollider', handleId: 'point1' };
                }
                if (Math.abs(localX - p2x) < hitRadius && Math.abs(localY - p2y) < hitRadius) {
                    return { componentType: 'SegmentCollider', handleId: 'point2' };
                }
            } else if (comp.type === 'PolygonCollider') {
                const vertices = comp.data.vertices as { x: number; y: number }[] | undefined;
                if (!vertices) continue;

                for (let i = 0; i < vertices.length; i++) {
                    const vx = vertices[i].x * ppu * scale.x;
                    const vy = vertices[i].y * ppu * scale.y;
                    if (Math.abs(localX - vx) < hitRadius && Math.abs(localY - vy) < hitRadius) {
                        return { componentType: 'PolygonCollider', handleId: `vertex-${i}` };
                    }
                }
            } else if (comp.type === 'ChainCollider') {
                const points = comp.data.points as { x: number; y: number }[] | undefined;
                if (!points) continue;

                for (let i = 0; i < points.length; i++) {
                    const px = points[i].x * ppu * scale.x;
                    const py = points[i].y * ppu * scale.y;
                    if (Math.abs(localX - px) < hitRadius && Math.abs(localY - py) < hitRadius) {
                        return { componentType: 'ChainCollider', handleId: `vertex-${i}` };
                    }
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
            if (Array.isArray(value)) {
                result[key] = value.map(v =>
                    typeof v === 'object' && v !== null ? { ...v } : v
                );
            } else if (typeof value === 'object' && value !== null) {
                result[key] = { ...value as Record<string, unknown> };
            } else {
                result[key] = value;
            }
        }
        return result;
    }
}
