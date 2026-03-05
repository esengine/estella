/**
 * @file    ParticleOverlay.ts
 * @brief   Overlay for particle emitter shape visualization
 */

import type { EditorStore } from '../store/EditorStore';
import type { EntityData } from '../types/SceneTypes';
import { quatToEuler } from '../math/Transform';
import type { OverlayContext } from './ColliderOverlay';
import { findScenePixelsPerUnit } from '../utils/sceneQueries';

const PARTICLE_COLOR = 'rgba(255, 165, 0, 0.8)';
const PARTICLE_FILL = 'rgba(255, 165, 0, 0.15)';
const DASH_PATTERN = [6, 4];
const CROSSHAIR_SIZE_PX = 12;
const POINT_RADIUS_PX = 4;

const enum EmitterShape {
    Point = 0,
    Circle = 1,
    Rectangle = 2,
    Cone = 3,
}

export class ParticleOverlay {
    drawAll(octx: OverlayContext): void {
        const { store } = octx;
        const selectedIds = store.selectedEntities;
        if (selectedIds.size === 0) return;

        for (const entity of store.scene.entities) {
            if (!selectedIds.has(entity.id)) continue;
            if (!store.isEntityVisible(entity.id)) continue;
            this.drawEntityParticle(octx, entity);
        }
    }

    private drawEntityParticle(octx: OverlayContext, entity: EntityData): void {
        const comp = entity.components.find(c => c.type === 'ParticleEmitter');
        if (!comp) return;

        const { ctx, zoom, store } = octx;
        const ppu = findScenePixelsPerUnit(store.scene.entities);
        const worldTransform = store.getWorldTransform(entity.id);
        const pos = worldTransform.position;
        const scale = worldTransform.scale;
        const euler = quatToEuler(worldTransform.rotation);
        const rad = -euler.z * Math.PI / 180;

        const shape = (comp.data.shape as number) ?? EmitterShape.Point;
        const lineWidth = 2 / zoom;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.translate(pos.x, -pos.y);
        ctx.rotate(rad);

        ctx.strokeStyle = PARTICLE_COLOR;
        ctx.fillStyle = PARTICLE_COLOR;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(DASH_PATTERN.map(v => v / zoom));

        switch (shape) {
            case EmitterShape.Point:
                this.drawPoint(ctx, zoom);
                break;
            case EmitterShape.Circle:
                this.drawCircle(ctx, comp.data, scale, ppu);
                break;
            case EmitterShape.Rectangle:
                this.drawRectangle(ctx, comp.data, scale, ppu);
                break;
            case EmitterShape.Cone:
                this.drawCone(ctx, comp.data, scale, ppu);
                break;
        }

        ctx.restore();
    }

    private drawPoint(ctx: CanvasRenderingContext2D, zoom: number): void {
        const size = CROSSHAIR_SIZE_PX / zoom;
        const r = POINT_RADIUS_PX / zoom;

        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(-size, 0);
        ctx.lineTo(size, 0);
        ctx.moveTo(0, -size);
        ctx.lineTo(0, size);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
    }

    private drawCircle(
        ctx: CanvasRenderingContext2D,
        data: Record<string, unknown>,
        scale: { x: number; y: number; z: number },
        ppu: number,
    ): void {
        const radius = (data.shapeRadius as number) ?? 1;
        const maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y));
        const r = radius * ppu * maxScale;

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = PARTICLE_FILL;
        ctx.fill();
    }

    private drawRectangle(
        ctx: CanvasRenderingContext2D,
        data: Record<string, unknown>,
        scale: { x: number; y: number; z: number },
        ppu: number,
    ): void {
        const size = data.shapeSize as { x: number; y: number } | undefined;
        const sx = (size?.x ?? 1) * ppu * Math.abs(scale.x);
        const sy = (size?.y ?? 1) * ppu * Math.abs(scale.y);

        ctx.strokeRect(-sx / 2, -sy / 2, sx, sy);

        ctx.fillStyle = PARTICLE_FILL;
        ctx.fillRect(-sx / 2, -sy / 2, sx, sy);
    }

    private drawCone(
        ctx: CanvasRenderingContext2D,
        data: Record<string, unknown>,
        scale: { x: number; y: number; z: number },
        ppu: number,
    ): void {
        const radius = (data.shapeRadius as number) ?? 1;
        const angle = (data.shapeAngle as number) ?? 45;
        const maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y));
        const r = radius * ppu * maxScale;
        const halfAngleRad = (angle / 2) * Math.PI / 180;

        const startAngle = -Math.PI / 2 - halfAngleRad;
        const endAngle = -Math.PI / 2 + halfAngleRad;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(
            Math.cos(startAngle) * r,
            Math.sin(startAngle) * r
        );
        ctx.arc(0, 0, r, startAngle, endAngle);
        ctx.lineTo(0, 0);
        ctx.stroke();

        ctx.fillStyle = PARTICLE_FILL;
        ctx.fill();
    }

}
