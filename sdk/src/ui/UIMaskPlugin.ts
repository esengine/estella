import type { App, Plugin } from '../app';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { MaskProcessorFn, RenderPipeline } from '../renderPipeline';
import type { Entity } from '../types';
import type { World } from '../world';
import { WorldTransform, Parent } from '../component';
import type { WorldTransformData, ParentData } from '../component';
import { UIMask, type UIMaskData } from './UIMask';
import { UIRect, type UIRectData } from './UIRect';

interface ScreenRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w);
    const t = Math.min(a.y + a.h, b.y + b.h);
    return { x, y, w: Math.max(0, r - x), h: Math.max(0, t - y) };
}

function worldRectToScreen(
    worldX: number, worldY: number,
    worldW: number, worldH: number,
    pivotX: number, pivotY: number,
    vp: Float32Array,
    vpX: number, vpY: number, vpW: number, vpH: number
): ScreenRect {
    const left = worldX - worldW * pivotX;
    const right = worldX + worldW * (1 - pivotX);
    const bottom = worldY - worldH * pivotY;
    const top = worldY + worldH * (1 - pivotY);

    function toScreen(wx: number, wy: number): [number, number] {
        const clipX = vp[0] * wx + vp[4] * wy + vp[12];
        const clipY = vp[1] * wx + vp[5] * wy + vp[13];
        const clipW = vp[3] * wx + vp[7] * wy + vp[15];
        const ndcX = clipX / clipW;
        const ndcY = clipY / clipW;
        return [
            vpX + (ndcX * 0.5 + 0.5) * vpW,
            vpY + (ndcY * 0.5 + 0.5) * vpH,
        ];
    }

    const [px0, py0] = toScreen(left, bottom);
    const [px1, py1] = toScreen(right, top);

    const minX = Math.min(px0, px1);
    const maxX = Math.max(px0, px1);
    const minY = Math.min(py0, py1);
    const maxY = Math.max(py0, py1);

    return {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(maxX - minX),
        h: Math.round(maxY - minY),
    };
}

function computeMaskScreenRect(
    world: World, entity: Entity,
    vp: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number
): ScreenRect | null {
    if (!world.has(entity, UIRect) || !world.has(entity, WorldTransform)) {
        return null;
    }
    const uiRect = world.get(entity, UIRect) as UIRectData;
    const wt = world.get(entity, WorldTransform) as WorldTransformData;
    const worldW = uiRect.size.x * wt.scale.x;
    const worldH = uiRect.size.y * wt.scale.y;
    return worldRectToScreen(
        wt.position.x, wt.position.y,
        worldW, worldH,
        0.5, 0.5,
        vp, vpX, vpY, vpW, vpH
    );
}

export function createMaskProcessor(wasm: ESEngineModule, world: World): MaskProcessorFn {
    return (
        cppRegistry: CppRegistry,
        vp: Float32Array,
        vpX: number, vpY: number, vpW: number, vpH: number
    ) => {
        wasm.renderer_clearAllClipRects();

        const maskEntities = world.getEntitiesWithComponents([UIMask]);
        if (maskEntities.length === 0) return;

        try {
            processMasks(wasm, world, cppRegistry, maskEntities, vp, vpX, vpY, vpW, vpH);
        } catch (_) {
            wasm.renderer_clearAllClipRects();
        }
    };
}

function processMasks(
    wasm: ESEngineModule, world: World, cppRegistry: CppRegistry,
    maskEntities: Entity[],
    vp: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number
): void {
    const maskSet = new Set<number>();
    for (const e of maskEntities) {
        const mask = world.get(e, UIMask) as UIMaskData;
        if (mask.enabled) maskSet.add(e as number);
    }

    const rootMasks: Entity[] = [];
    for (const entity of maskEntities) {
        if (!maskSet.has(entity as number)) continue;
        let isRoot = true;
        let current = entity;
        while (world.has(current, Parent)) {
            const p = world.get(current, Parent) as ParentData;
            if (maskSet.has(p.entity as number)) {
                isRoot = false;
                break;
            }
            current = p.entity;
        }
        if (isRoot) rootMasks.push(entity);
    }

    function applyToDescendants(entity: Entity, clipRect: ScreenRect): void {
        const children = wasm.getChildEntities(cppRegistry, entity as number);
        for (const childId of children) {
            let childClip = clipRect;

            if (maskSet.has(childId)) {
                const childRect = computeMaskScreenRect(
                    world, childId as Entity,
                    vp, vpX, vpY, vpW, vpH
                );
                if (childRect) {
                    childClip = intersectRects(clipRect, childRect);
                }
            }

            wasm.renderer_setEntityClipRect(
                childId, childClip.x, childClip.y, childClip.w, childClip.h
            );
            applyToDescendants(childId as Entity, childClip);
        }
    }

    for (const entity of rootMasks) {
        const screenRect = computeMaskScreenRect(
            world, entity,
            vp, vpX, vpY, vpW, vpH
        );
        if (!screenRect) continue;
        applyToDescendants(entity, screenRect);
    }
}

export class UIMaskPlugin implements Plugin {
    build(app: App): void {
        if (!app.wasmModule) return;
        const pipeline = (app as any).pipeline_ as RenderPipeline | null;
        if (!pipeline) return;

        pipeline.setMaskProcessor(createMaskProcessor(app.wasmModule, app.world));
    }
}

export const uiMaskPlugin = new UIMaskPlugin();
