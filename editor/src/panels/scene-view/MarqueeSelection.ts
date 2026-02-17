import type { Entity } from 'esengine';
import type { EditorStore } from '../../store/EditorStore';
import type { EntityData } from '../../types/SceneTypes';

export type BoundsProvider = (entityData: EntityData) => { width: number; height: number; offsetX?: number; offsetY?: number };

export class MarqueeSelection {
    active = false;
    startX = 0;
    startY = 0;
    endX = 0;
    endY = 0;

    start(worldX: number, worldY: number): void {
        this.active = true;
        this.startX = worldX;
        this.startY = worldY;
        this.endX = worldX;
        this.endY = worldY;
    }

    update(worldX: number, worldY: number): void {
        this.endX = worldX;
        this.endY = worldY;
    }

    finish(store: EditorStore, getBounds: BoundsProvider, addToExisting: boolean): void {
        this.active = false;
        const hits = this.findEntitiesInRect(store, getBounds);

        if (addToExisting) {
            const existing = Array.from(store.selectedEntities);
            const merged = new Set([...existing, ...hits.map(h => h as number)]);
            store.selectEntities(Array.from(merged));
        } else {
            store.selectEntities(hits.map(h => h as number));
        }
    }

    findEntitiesInRect(store: EditorStore, getBounds: BoundsProvider): Entity[] {
        const minX = Math.min(this.startX, this.endX);
        const maxX = Math.max(this.startX, this.endX);
        const minY = Math.min(this.startY, this.endY);
        const maxY = Math.max(this.startY, this.endY);

        const scene = store.scene;
        const result: Entity[] = [];

        for (const entity of scene.entities) {
            if (!store.isEntityVisible(entity.id)) continue;
            const transform = entity.components.find(c => c.type === 'LocalTransform');
            if (!transform) continue;

            const worldTransform = store.getWorldTransform(entity.id);
            const pos = worldTransform.position;
            const scale = worldTransform.scale;
            const bounds = getBounds(entity);
            const w = bounds.width * Math.abs(scale.x);
            const h = bounds.height * Math.abs(scale.y);
            const offsetX = (bounds.offsetX ?? 0) * scale.x;
            const offsetY = (bounds.offsetY ?? 0) * scale.y;

            const centerX = pos.x + offsetX;
            const centerY = pos.y + offsetY;
            const halfW = w / 2;
            const halfH = h / 2;

            if (centerX + halfW >= minX && centerX - halfW <= maxX &&
                centerY + halfH >= minY && centerY - halfH <= maxY) {
                result.push(entity.id as Entity);
            }
        }

        return result;
    }

    draw(ctx: CanvasRenderingContext2D, zoom: number): void {
        const x = Math.min(this.startX, this.endX);
        const y = Math.min(-this.startY, -this.endY);
        const w = Math.abs(this.endX - this.startX);
        const h = Math.abs(this.endY - this.startY);

        ctx.fillStyle = 'rgba(0, 170, 255, 0.1)';
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = '#00aaff';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([]);
        ctx.strokeRect(x, y, w, h);
    }
}
